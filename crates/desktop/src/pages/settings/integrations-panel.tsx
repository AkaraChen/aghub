import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Key } from "react-aria-components";
import {
	ListBox,
	Select,
	Spinner,
} from "@heroui/react";
import {
	useCodeEditors,
	useTerminals,
} from "../../hooks/use-integrations";
import {
	getIntegrationPreferences,
	saveIntegrationPreferences,
} from "../../lib/store";
import type { CodeEditorType, TerminalType } from "../../lib/api-types";

export default function IntegrationsPanel() {
	const { t } = useTranslation();
	const { data: codeEditors, isLoading: isLoadingEditors } = useCodeEditors();
	const { data: terminals, isLoading: isLoadingTerminals } = useTerminals();

	const [selectedEditor, setSelectedEditor] = useState<CodeEditorType | "">(
		"",
	);
	const [selectedTerminal, setSelectedTerminal] = useState<TerminalType | "">(
		"",
	);

	useEffect(() => {
		async function loadPreferences() {
			const prefs = await getIntegrationPreferences();
			if (prefs.codeEditor) setSelectedEditor(prefs.codeEditor);
			if (prefs.terminal) setSelectedTerminal(prefs.terminal);
		}
		loadPreferences();
	}, []);

	const handleEditorChange = async (value: Key | null) => {
		if (!value) return;
		const editor = value as CodeEditorType;
		setSelectedEditor(editor);
		await saveIntegrationPreferences({
			codeEditor: editor || undefined,
			terminal: selectedTerminal || undefined,
		});
	};

	const handleTerminalChange = async (value: Key | null) => {
		if (!value) return;
		const terminal = value as TerminalType;
		setSelectedTerminal(terminal);
		await saveIntegrationPreferences({
			codeEditor: selectedEditor || undefined,
			terminal: terminal || undefined,
		});
	};

	const isLoading = isLoadingEditors || isLoadingTerminals;

	if (isLoading) {
		return (
			<div className="flex h-32 items-center justify-center">
				<Spinner size="lg" />
			</div>
		);
	}

	const installedEditors =
		codeEditors?.filter((e) => e.installed) || [];
	const installedTerminals =
		terminals?.filter((t) => t.installed) || [];

	return (
		<div className="space-y-8">
			<div className="flex items-center justify-between">
				<span className="text-sm">{t("codeEditors")}</span>
				<Select
					selectedKey={selectedEditor || null}
					onSelectionChange={handleEditorChange}
					aria-label={t("codeEditors")}
					className="w-56"
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

			<div className="flex items-center justify-between">
				<span className="text-sm">{t("terminals")}</span>
				<Select
					selectedKey={selectedTerminal || null}
					onSelectionChange={handleTerminalChange}
					aria-label={t("terminals")}
					className="w-56"
				>
					<Select.Trigger>
						<Select.Value />
						<Select.Indicator />
					</Select.Trigger>
					<Select.Popover>
						<ListBox>
							{installedTerminals.map((terminal) => (
								<ListBox.Item
									key={terminal.id}
									id={terminal.id}
									textValue={terminal.name}
								>
									{terminal.name}
								</ListBox.Item>
							))}
						</ListBox>
					</Select.Popover>
				</Select>
			</div>
		</div>
	);
}
