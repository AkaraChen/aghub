import { ListBox, Select, Spinner } from "@heroui/react";
import { useEffect, useState } from "react";
import type { Key } from "react-aria-components";
import { useTranslation } from "react-i18next";
import { useCodeEditors } from "../../hooks/use-integrations";
import type { CodeEditorType } from "../../lib/api-types";
import {
	getIntegrationPreferences,
	saveIntegrationPreferences,
} from "../../lib/store";

export default function IntegrationsPanel() {
	const { t } = useTranslation();
	const { data: codeEditors, isLoading } = useCodeEditors();

	const [selectedEditor, setSelectedEditor] = useState<CodeEditorType | "">(
		"",
	);

	useEffect(() => {
		async function loadPreferences() {
			const prefs = await getIntegrationPreferences();
			if (prefs.codeEditor) setSelectedEditor(prefs.codeEditor);
		}
		loadPreferences();
	}, []);

	const handleEditorChange = async (value: Key | null) => {
		if (!value) return;
		const editor = value as CodeEditorType;
		setSelectedEditor(editor);
		await saveIntegrationPreferences({ codeEditor: editor || undefined });
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
		<div className="space-y-2">
			{/* Code Editor Setting */}
			<div className="rounded-lg bg-[var(--surface)] p-4">
				<div className="flex items-center justify-between">
					<div className="space-y-0.5">
						<span className="text-sm font-medium text-[var(--foreground)]">
							{t("codeEditors")}
						</span>
						<span className="block text-xs text-[var(--muted)]">
							{t("codeEditorsDescription")}
						</span>
					</div>
					<Select
						selectedKey={selectedEditor || null}
						onSelectionChange={handleEditorChange}
						aria-label={t("codeEditors")}
						className="min-w-[14rem]"
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
			</div>
		</div>
	);
}
