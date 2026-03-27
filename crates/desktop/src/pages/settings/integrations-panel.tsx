import { Card, ListBox, Select, Spinner } from "@heroui/react";
import type { Key } from "react-aria-components";
import { useTranslation } from "react-i18next";
import { useCurrentCodeEditor } from "../../hooks/use-integrations";
import type { CodeEditorType } from "../../lib/api-types";

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
				{/* Code Editor Setting */}
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
										{editor.name}
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
