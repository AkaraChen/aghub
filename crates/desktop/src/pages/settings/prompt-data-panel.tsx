import { ArrowDownTrayIcon, ArrowUpTrayIcon } from "@heroicons/react/24/solid";
import {
	Button,
	Card,
	Chip,
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
	promptStorageQueryOptions,
} from "../../requests/prompts";

export default function PromptDataPanel() {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();
	const [backup, setBackup] = useState<PromptBackupDto | null>(null);
	const [importMode, setImportMode] = useState<PromptImportModeDto>("merge");
	const { data: prompts = [] } = useQuery(promptListQueryOptions({ api }));
	const storageQuery = useQuery(promptStorageQueryOptions({ api }));
	const categoryCounts = Array.from(
		prompts
			.reduce((counts, prompt) => {
				if (prompt.category) {
					counts.set(
						prompt.category,
						(counts.get(prompt.category) ?? 0) + 1,
					);
				}
				return counts;
			}, new Map<string, number>())
			.entries(),
	).sort(([left], [right]) => left.localeCompare(right));
	const uncategorizedCount = prompts.filter(
		(prompt) => !prompt.category,
	).length;

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
			<div data-testid="prompt-data-panel" className="mx-auto max-w-4xl">
				<Card className="p-0">
					<Card.Content className="space-y-5 p-4">
						<div className="space-y-0.5">
							<h3 className="text-sm font-medium text-foreground">
								{t("promptLocalLibrary")}
							</h3>
							<p className="text-xs text-muted">
								{t("promptLocalLibraryDescription")}
							</p>
						</div>

						<div className="space-y-4 border-t border-separator pt-4">
							<section
								aria-labelledby="prompt-storage-heading"
								className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6"
							>
								<h4
									id="prompt-storage-heading"
									className="shrink-0 text-sm font-medium text-foreground"
								>
									{t("promptStorageLocation")}
								</h4>
								<p className="min-w-0 break-all font-mono text-xs text-muted sm:max-w-[75%] sm:text-right">
									{storageQuery.isPending
										? t("loading")
										: storageQuery.isError
											? t("promptDataFileUnavailable")
											: storageQuery.data.file_path}
								</p>
							</section>

							<section
								aria-labelledby="prompt-categories-heading"
								className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-6"
							>
								<h4
									id="prompt-categories-heading"
									className="shrink-0 text-sm font-medium text-foreground"
								>
									{t("promptCategories")}
								</h4>
								{categoryCounts.length > 0 ||
								uncategorizedCount > 0 ? (
									<div className="flex flex-wrap gap-1.5 sm:justify-end">
										{categoryCounts.map(
											([category, count]) => (
												<Chip
													key={category}
													aria-label={t(
														"promptCategoryUsage",
														{
															category,
															count,
														},
													)}
													size="sm"
													variant="soft"
												>
													<span>{category}</span>
													<span className="ml-1.5 tabular-nums text-muted">
														{count}
													</span>
												</Chip>
											),
										)}
										{uncategorizedCount > 0 && (
											<Chip
												aria-label={t(
													"promptCategoryUsage",
													{
														category:
															t("uncategorized"),
														count: uncategorizedCount,
													},
												)}
												size="sm"
												variant="soft"
											>
												<span>
													{t("uncategorized")}
												</span>
												<span className="ml-1.5 tabular-nums text-muted">
													{uncategorizedCount}
												</span>
											</Chip>
										)}
									</div>
								) : (
									<p className="text-xs text-muted">
										{t("promptNoCategories")}
									</p>
								)}
							</section>

							<section
								aria-labelledby="prompt-backup-heading"
								className="flex flex-col gap-3 border-t border-separator pt-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6"
							>
								<div className="min-w-0 space-y-0.5">
									<h4
										id="prompt-backup-heading"
										className="text-sm font-medium text-foreground"
									>
										{t("promptBackupAndRestore")}
									</h4>
									<p className="text-xs text-muted">
										{t("promptBackupDescription")}
									</p>
								</div>
								<div className="flex shrink-0 flex-wrap gap-2">
									<Button
										variant="secondary"
										size="sm"
										onPress={() => void chooseBackup()}
									>
										<ArrowUpTrayIcon className="size-4" />
										{t("importPromptBackup")}
									</Button>
									<Button
										size="sm"
										isPending={exportMutation.isPending}
										onPress={() => exportMutation.mutate()}
									>
										<ArrowDownTrayIcon className="size-4" />
										{t("exportPromptBackup")}
									</Button>
								</div>
							</section>
						</div>
					</Card.Content>
				</Card>
			</div>

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
