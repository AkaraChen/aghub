import { isTauri } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import type { PromptBackupDto, PromptBackupItemDto } from "../generated/dto";

const JSON_FILTER = [{ name: "JSON", extensions: ["json"] }];

function isNullableString(value: unknown): value is string | null {
	return value === null || typeof value === "string";
}

function isPromptBackupItem(value: unknown): value is PromptBackupItemDto {
	if (!value || typeof value !== "object") return false;
	const prompt = value as Record<string, unknown>;
	return (
		typeof prompt.id === "string" &&
		typeof prompt.title === "string" &&
		isNullableString(prompt.description) &&
		isNullableString(prompt.category) &&
		typeof prompt.content === "string" &&
		Array.isArray(prompt.tags) &&
		prompt.tags.every((tag) => typeof tag === "string") &&
		typeof prompt.created_at === "number" &&
		typeof prompt.updated_at === "number"
	);
}

export function parsePromptBackup(text: string): PromptBackupDto {
	const value: unknown = JSON.parse(text);
	if (!value || typeof value !== "object") {
		throw new Error("Invalid prompt backup");
	}
	const backup = value as Record<string, unknown>;
	if (
		typeof backup.format !== "string" ||
		typeof backup.version !== "number" ||
		typeof backup.exported_at !== "number" ||
		!Array.isArray(backup.prompts) ||
		!backup.prompts.every(isPromptBackupItem)
	) {
		throw new Error("Invalid prompt backup");
	}
	return backup as PromptBackupDto;
}

function backupFileName() {
	return `aghub-prompts-${new Date().toISOString().slice(0, 10)}.json`;
}

export async function savePromptBackupFile(
	backup: PromptBackupDto,
): Promise<boolean> {
	const content = `${JSON.stringify(backup, null, 2)}\n`;
	if (isTauri()) {
		const path = await save({
			defaultPath: backupFileName(),
			filters: JSON_FILTER,
		});
		if (!path) return false;
		await writeTextFile(path, content);
		return true;
	}

	const url = URL.createObjectURL(
		new Blob([content], { type: "application/json" }),
	);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = backupFileName();
	anchor.click();
	setTimeout(() => URL.revokeObjectURL(url), 0);
	return true;
}

async function selectBrowserBackup(): Promise<string | null> {
	return new Promise((resolve) => {
		const input = document.createElement("input");
		input.type = "file";
		input.accept = "application/json,.json";
		input.addEventListener(
			"change",
			() => {
				const file = input.files?.[0];
				if (!file) {
					resolve(null);
					return;
				}
				void file.text().then(resolve);
			},
			{ once: true },
		);
		input.addEventListener("cancel", () => resolve(null), { once: true });
		input.click();
	});
}

export async function openPromptBackupFile(): Promise<PromptBackupDto | null> {
	let content: string | null;
	if (isTauri()) {
		const path = await open({
			multiple: false,
			directory: false,
			filters: JSON_FILTER,
		});
		if (!path) return null;
		content = await readTextFile(path);
	} else {
		content = await selectBrowserBackup();
	}
	return content === null ? null : parsePromptBackup(content);
}
