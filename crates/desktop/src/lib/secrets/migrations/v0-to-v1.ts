import { Client } from "@tauri-apps/plugin-stronghold";
import type { GitHubCredential } from "../types";

const OLD_KEY = "github_credential";
const NEW_KEY = "github_credentials";

function generateUUID(): string {
	return crypto.randomUUID();
}

async function getRecord(client: Client, key: string): Promise<string | null> {
	const store = client.getStore();
	try {
		const data = await store.get(key);
		if (!data) return null;
		return new TextDecoder().decode(new Uint8Array(data));
	} catch {
		return null;
	}
}

async function insertRecord(
	client: Client,
	key: string,
	value: string,
): Promise<void> {
	const store = client.getStore();
	const data = Array.from(new TextEncoder().encode(value));
	await store.insert(key, data);
}

async function removeRecord(client: Client, key: string): Promise<void> {
	const store = client.getStore();
	await store.remove(key);
}

export async function migrateV0ToV1(client: Client): Promise<void> {
	const oldData = await getRecord(client, OLD_KEY);
	if (!oldData) return;

	try {
		const oldCredential = JSON.parse(oldData) as Omit<
			GitHubCredential,
			"id"
		>;

		const newCredentials: GitHubCredential[] = [
			{
				...oldCredential,
				id: generateUUID(),
			},
		];

		await insertRecord(client, NEW_KEY, JSON.stringify(newCredentials));
		await removeRecord(client, OLD_KEY);
	} catch {
		// 如果解析失败，静默忽略（可能是损坏的数据）
	}
}
