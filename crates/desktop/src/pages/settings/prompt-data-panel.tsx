import {
	ArrowDownTrayIcon,
	ArrowUpTrayIcon,
	DocumentTextIcon,
} from "@heroicons/react/24/solid";
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
	const tagCount = new Set(prompts.flatMap((prompt) => prompt.tags)).size;
	const libraryStats = [
		{ label: t("prompts"), value: prompts.length },
		{ label: t("promptCategories"), value: categoryCounts.length },
		{ label: t("promptTags"), value: tagCount },
	];

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
			<div
				data-testid="prompt-data-panel"
				className="mx-auto max-w-4xl space-y-4"
			>
				<Card className="p-0">
					<Card.Header className="border-b border-separator p-4">
						<div className="flex min-w-0 items-start gap-2">
							<DocumentTextIcon className="size-4 shrink-0 text-muted" />
							<div className="min-w-0 space-y-0.5">
								<Card.Title>
									{t("promptLocalLibrary")}
								</Card.Title>
								<Card.Description>
									{t("promptLocalLibraryDescription")}
								</Card.Description>
							</div>
						</div>
					</Card.Header>
					<Card.Content className="divide-y divide-separator p-0">
						<section
							aria-labelledby="prompt-library-overview-heading"
							className="grid gap-3 p-4 sm:grid-cols-[7rem_minmax(0,1fr)] sm:items-center"
						>
							<h4
								id="prompt-library-overview-heading"
								className="text-sm font-medium text-foreground"
							>
								{t("promptLibraryOverview")}
							</h4>
							<dl className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
								{libraryStats.map((stat) => (
									<div
										key={stat.label}
										className="flex min-w-0 items-baseline gap-1.5"
									>
										<dt className="text-xs text-muted">
											{stat.label}
										</dt>
										<dd className="text-sm font-medium tabular-nums text-foreground">
											{stat.value}
										</dd>
									</div>
								))}
							</dl>
						</section>

						<section
							aria-labelledby="prompt-storage-heading"
							className="grid gap-2 p-4 sm:grid-cols-[7rem_minmax(0,1fr)] sm:items-baseline"
						>
							<h4
								id="prompt-storage-heading"
								className="text-sm font-medium text-foreground"
							>
								{t("promptStorageLocation")}
							</h4>
							<p className="break-all font-mono text-xs text-muted">
								{storageQuery.isPending
									? t("loading")
									: storageQuery.isError
										? t("promptDataFileUnavailable")
										: storageQuery.data.file_path}
							</p>
						</section>

						<section
							aria-labelledby="prompt-categories-heading"
							className="grid gap-2 p-4 sm:grid-cols-[7rem_minmax(0,1fr)] sm:items-center"
						>
							<h4
								id="prompt-categories-heading"
								className="text-sm font-medium text-foreground"
							>
								{t("promptCategories")}
							</h4>
							{categoryCounts.length > 0 ||
							uncategorizedCount > 0 ? (
								<div className="flex flex-wrap gap-1.5">
									{categoryCounts.map(([category, count]) => (
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
									))}
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
											<span>{t("uncategorized")}</span>
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
					</Card.Content>
				</Card>

				<Card className="p-0">
					<Card.Header className="p-4">
						<Card.Title>{t("promptBackupAndRestore")}</Card.Title>
						<Card.Description>
							{t("promptBackupDescription")}
						</Card.Description>
					</Card.Header>
					<Card.Footer className="flex flex-wrap gap-2 border-t border-separator p-4">
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
					</Card.Footer>
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
