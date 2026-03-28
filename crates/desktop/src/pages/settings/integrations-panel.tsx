import { Avatar, Card, ListBox, Select, Spinner } from "@heroui/react";
import type { Key } from "react-aria-components";
import { useTranslation } from "react-i18next";
import { useCurrentCodeEditor } from "../../hooks/use-integrations";
import type { CodeEditorType } from "../../lib/api-types";

const iconModules = import.meta.glob<{ default: string }>(
	"../../assets/agent/*.svg",
	{ eager: true, query: "?raw" },
);

const ICON_ALIASES: Record<string, string> = {
	vs_code_insiders: "vs_code",
	fleet: "rust_rover",
};

const UNDERSCORE_REGEX = /_/g;

function EditorIcon({ id, name }: { id: string; name: string }) {
	const resolvedId = ICON_ALIASES[id] ?? id;
	const path =
		iconModules[`../../assets/agent/${resolvedId}.svg`] ??
		iconModules[
			`../../assets/agent/${resolvedId.replace(UNDERSCORE_REGEX, "")}.svg`
		];
	const svg = path;

	if (svg) {
		return (
			<div
				className="flex size-5 shrink-0 items-center justify-center [&_svg]:size-4"
				// eslint-disable-next-line react-dom/no-dangerously-set-innerhtml
				dangerouslySetInnerHTML={{
					__html: (svg.default || svg) as string,
				}}
			/>
		);
	}

	return (
		<Avatar size="sm" variant="soft" className="size-5">
			<Avatar.Fallback className="text-[10px]">
				{name.charAt(0).toUpperCase()}
			</Avatar.Fallback>
		</Avatar>
	);
}

export default function IntegrationsPanel() {
	const { t } = useTranslation();
	const { codeEditors, isLoading, selectedEditor, setCurrentEditor } =
		useCurrentCodeEditor();

	const handleEditorChange = async (value: Key | null) => {
		if (!value) return;
		const editor = value as CodeEditorType;
		await setCurrentEditor(editor || undefined);
	};

	if (isLoading) {
		return (
			<div className="flex h-32 items-center justify-center">
				<Spinner size="lg" />
			</div>
		);
	}

	const installedEditors = codeEditors?.filter((e) => e.installed) || [];

	return (
		<Card className="p-4">
			<Card.Content className="space-y-4">
				<div className="flex items-center justify-between">
					<div className="space-y-0.5">
						<span className="text-sm font-medium text-(--foreground)">
							{t("codeEditors")}
						</span>
						<span className="block text-xs text-muted">
							{t("codeEditorsDescription")}
						</span>
					</div>
					<Select
						variant="secondary"
						selectedKey={selectedEditor || null}
						onSelectionChange={handleEditorChange}
						aria-label={t("codeEditors")}
						className="min-w-56"
					>
						<Select.Trigger>
							<Select.Value />
							<Select.Indicator />
						</Select.Trigger>
						<Select.Popover>
							<ListBox>
								{installedEditors.map((editor) => (
									<ListBox.Item
										key={editor.id}
										id={editor.id}
										textValue={editor.name}
									>
										<div className="flex items-center gap-2">
											<EditorIcon
												id={editor.id}
												name={editor.name}
											/>
											{editor.name}
										</div>
									</ListBox.Item>
								))}
							</ListBox>
						</Select.Popover>
					</Select>
				</div>
			</Card.Content>
		</Card>
	);
}
