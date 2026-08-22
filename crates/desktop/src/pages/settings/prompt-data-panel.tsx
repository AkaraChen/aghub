import {
	ArrowDownTrayIcon,
	ArrowUpTrayIcon,
	DocumentTextIcon,
} from "@heroicons/react/24/solid";
import {
	Button,
	Card,
	Description,
	Label,
	Modal,
	Radio,
	RadioGroup,
	toast,
} from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { PromptBackupDto, PromptImportModeDto } from "../../generated/dto";
import { useApi } from "../../hooks/use-api";
import {
	openPromptBackupFile,
	savePromptBackupFile,
} from "../../lib/prompt-backup-file";
import {
	importPromptBackupMutationOptions,
	promptListQueryOptions,
} from "../../requests/prompts";

export default function PromptDataPanel() {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();
	const [backup, setBackup] = useState<PromptBackupDto | null>(null);
	const [importMode, setImportMode] = useState<PromptImportModeDto>("merge");
	const { data: prompts = [] } = useQuery(promptListQueryOptions({ api }));

	const exportMutation = useMutation({
		mutationFn: async () => {
			const promptBackup = await api.prompts.exportBackup();
			return savePromptBackupFile(promptBackup);
		},
		onSuccess: (saved) => {
			if (saved) toast.success(t("promptBackupExported"));
		},
		onError: (error) => {
			console.error("Failed to export prompt backup:", error);
			toast.danger(t("promptBackupExportError"));
		},
	});

	const importMutation = useMutation({
		...importPromptBackupMutationOptions({
			api,
			queryClient,
			onSuccess: (result) => {
				toast.success(
					t("promptBackupImported", {
						added: result.added,
						updated: result.updated,
						removed: result.removed,
						total: result.total,
					}),
				);
				setBackup(null);
			},
		}),
		onError: (error) => {
			console.error("Failed to import prompt backup:", error);
			toast.danger(
				error instanceof Error
					? error.message
					: t("promptBackupImportError"),
			);
		},
	});

	const chooseBackup = async () => {
		try {
			const selected = await openPromptBackupFile();
			if (!selected) return;
			setImportMode("merge");
			setBackup(selected);
		} catch (error) {
			console.error("Failed to read prompt backup:", error);
			toast.danger(t("promptBackupInvalid"));
		}
	};

	return (
		<>
			<Card className="p-0">
				<Card.Content className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
					<div className="min-w-0 space-y-0.5">
						<div className="flex items-center gap-2">
							<DocumentTextIcon className="size-4 shrink-0 text-muted" />
							<p className="text-sm font-medium text-foreground">
								{t("promptLocalLibrary")}
							</p>
						</div>
						<p className="text-xs text-muted">
							{t("promptLocalLibraryDescription", {
								count: prompts.length,
							})}
						</p>
					</div>
					<div className="flex shrink-0 flex-wrap items-center gap-2">
						<Button
							variant="secondary"
							onPress={() => void chooseBackup()}
						>
							<ArrowUpTrayIcon className="size-4" />
							{t("importPromptBackup")}
						</Button>
						<Button
							isPending={exportMutation.isPending}
							onPress={() => exportMutation.mutate()}
						>
							<ArrowDownTrayIcon className="size-4" />
							{t("exportPromptBackup")}
						</Button>
					</div>
				</Card.Content>
			</Card>

			<Modal.Backdrop
				isOpen={backup !== null}
				isDismissable={!importMutation.isPending}
				isKeyboardDismissDisabled={importMutation.isPending}
				onOpenChange={(open) => {
					if (!open && !importMutation.isPending) setBackup(null);
				}}
			>
				<Modal.Container>
					<Modal.Dialog className="max-w-md">
						<Modal.CloseTrigger
							isDisabled={importMutation.isPending}
						/>
						<Modal.Header>
							<Modal.Heading>
								{t("importPromptBackup")}
							</Modal.Heading>
						</Modal.Header>
						<Modal.Body className="space-y-4">
							<p className="text-sm text-muted">
								{t("promptBackupContains", {
									count: backup?.prompts.length ?? 0,
								})}
							</p>
							<RadioGroup
								aria-label={t("promptBackupImportMode")}
								value={importMode}
								onChange={(value) =>
									setImportMode(value as PromptImportModeDto)
								}
								className="grid gap-2"
							>
								<Radio
									value="merge"
									className="rounded-xl border border-border bg-surface-secondary/60 p-3 data-[selected=true]:border-accent/30 data-[selected=true]:bg-accent/5"
								>
									<Radio.Content>
										<Radio.Control>
											<Radio.Indicator />
										</Radio.Control>
										<Label>{t("mergePromptBackup")}</Label>
									</Radio.Content>
									<Description className="pl-7 text-xs text-muted">
										{t("mergePromptBackupDescription")}
									</Description>
								</Radio>
								<Radio
									value="replace"
									className="rounded-xl border border-border bg-surface-secondary/60 p-3 data-[selected=true]:border-danger/30 data-[selected=true]:bg-danger/5"
								>
									<Radio.Content>
										<Radio.Control>
											<Radio.Indicator />
										</Radio.Control>
										<Label>
											{t("replacePromptLibrary")}
										</Label>
									</Radio.Content>
									<Description className="pl-7 text-xs text-muted">
										{t("replacePromptLibraryDescription")}
									</Description>
								</Radio>
							</RadioGroup>
						</Modal.Body>
						<Modal.Footer>
							<Button
								variant="secondary"
								isDisabled={importMutation.isPending}
								onPress={() => setBackup(null)}
							>
								{t("cancel")}
							</Button>
							<Button
								variant={
									importMode === "replace"
										? "danger"
										: "primary"
								}
								isPending={importMutation.isPending}
								onPress={() => {
									if (!backup) return;
									importMutation.mutate({
										backup,
										mode: importMode,
									});
								}}
							>
								{t("importPromptBackup")}
							</Button>
						</Modal.Footer>
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</>
	);
}
