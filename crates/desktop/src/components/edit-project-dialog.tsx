import { FolderIcon } from "@heroicons/react/24/outline";
import {
	Button,
	Fieldset,
	Input,
	Label,
	Modal,
	TextField,
} from "@heroui/react";
import { invoke } from "@tauri-apps/api/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAddProject } from "../hooks/use-projects";
import { basename } from "pathe";

interface CreateProjectDialogProps {
	isOpen: boolean;
	onClose: () => void;
}

export function CreateProjectDialog({
	isOpen,
	onClose,
}: CreateProjectDialogProps) {
	const { t } = useTranslation();
	const addProject = useAddProject();
	const [name, setName] = useState("");
	const [path, setPath] = useState("");

	const handleFolderSelect = async () => {
		try {
			const selectedPath = await invoke<string | null>("pick_folder");
			if (selectedPath) {
				setPath(selectedPath);
				const folderName = basename(selectedPath) || "";
				if (folderName && !name) {
					setName(folderName);
				}
			}
		} catch (error) {
			console.error("Failed to pick folder:", error);
		}
	};

	const handleSave = () => {
		if (name.trim() && path.trim()) {
			addProject.mutate(
				{ name: name.trim(), path: path.trim() },
				{
					onSuccess: onClose,
					onError: (error) => {
						console.error("Failed to create project:", error);
					},
				},
			);
		}
	};

	return (
		<Modal.Backdrop isOpen={isOpen} onOpenChange={onClose}>
			<Modal.Container>
				<Modal.Dialog>
					<Modal.CloseTrigger />
					<Modal.Header>
						<Modal.Heading>{t("addProject")}</Modal.Heading>
					</Modal.Header>
					<Modal.Body>
						<Fieldset>
							<div className="flex flex-col gap-2">
								<Label>{t("projectPath")}</Label>
								<button
									type="button"
									onClick={handleFolderSelect}
									className="
           flex h-32 w-full cursor-pointer flex-col items-center justify-center
           rounded-lg border-2 border-dashed border-border bg-transparent
           transition-colors
           hover:bg-accent-soft
         "
								>
									<FolderIcon className="mb-2 size-10 text-muted" />
									<span className="text-sm font-medium text-foreground">
										{t("selectProjectFolder")}
									</span>
									<span className="text-xs text-muted">
										{t("clickToBrowse")}
									</span>
								</button>
								{path && (
									<Input
										value={path}
										readOnly
										className="mt-2"
									/>
								)}
							</div>

							<TextField className="w-full">
								<Label>{t("projectName")}</Label>
								<Input
									value={name}
									onChange={(e) => setName(e.target.value)}
									placeholder={t("projectName")}
								/>
							</TextField>
						</Fieldset>
					</Modal.Body>
					<Modal.Footer>
						<Button slot="close" variant="secondary">
							{t("cancel")}
						</Button>
						<Button
							onPress={handleSave}
							isDisabled={!name.trim() || !path.trim()}
						>
							{t("create")}
						</Button>
					</Modal.Footer>
				</Modal.Dialog>
			</Modal.Container>
		</Modal.Backdrop>
	);
}
