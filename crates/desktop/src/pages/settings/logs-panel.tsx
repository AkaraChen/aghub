import {
	ArrowPathIcon,
	Cog6ToothIcon,
	FolderOpenIcon,
	ArrowDownTrayIcon,
	TrashIcon,
} from "@heroicons/react/24/solid";
import {
	AlertDialog,
	Button,
	Card,
	ListBox,
	Modal,
	SearchField,
	Select,
	Spinner,
	Tooltip,
	toast,
} from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Virtuoso } from "react-virtuoso";
import { getStore } from "../../lib/store";
import { cn } from "../../lib/utils";

interface LogEntry {
	timestamp: string;
	level: string;
	target: string;
	message: string;
}

interface GetLogEntriesResponse {
	entries: LogEntry[];
	total_count: number;
	has_more: boolean;
}

interface LogStats {
	total_entries: number;
	entries_by_level: Record<string, number>;
	log_files: string[];
	total_size_bytes: number;
	log_dir_path: string;
}

interface LogConfig {
	max_file_size_mb: number;
	max_archives: number;
}

const LEVELS = ["ERROR", "WARN", "INFO", "DEBUG", "TRACE"] as const;

const levelColor: Record<string, string> = {
	ERROR: "bg-red-500/15 text-red-600",
	WARN: "bg-amber-500/15 text-amber-600",
	INFO: "bg-blue-500/15 text-blue-600",
	DEBUG: "bg-zinc-500/15 text-zinc-500",
	TRACE: "bg-zinc-400/10 text-zinc-400",
};

function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function LogsPanel() {
	const { t } = useTranslation();
	const queryClient = useQueryClient();
	const [search, setSearch] = useState("");
	const [debouncedSearch, setDebouncedSearch] = useState("");
	const [activeLevel, setActiveLevel] = useState<string>("ALL");
	const [showClearDialog, setShowClearDialog] = useState(false);
	const [showSettingsDialog, setShowSettingsDialog] = useState(false);
	const [draftConfig, setDraftConfig] = useState<LogConfig | null>(null);
	const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

	useEffect(() => {
		debounceRef.current = setTimeout(setDebouncedSearch, 300, search);
		return () => clearTimeout(debounceRef.current);
	}, [search]);

	const statsQuery = useQuery({
		queryKey: ["log-stats"],
		queryFn: () => invoke<LogStats>("get_log_stats"),
	});

	const entriesQuery = useQuery({
		queryKey: ["log-entries", activeLevel, debouncedSearch],
		queryFn: () =>
			invoke<GetLogEntriesResponse>("get_log_entries", {
				params: {
					offset: 0,
					limit: 5000,
					level_filter: activeLevel !== "ALL" ? [activeLevel] : null,
					search: debouncedSearch || null,
				},
			}),
	});

	const configQuery = useQuery({
		queryKey: ["log-config"],
		queryFn: async () => {
			const store = await getStore();
			return (
				(await store.get<LogConfig>("logConfig")) ?? {
					max_file_size_mb: 10,
					max_archives: 5,
				}
			);
		},
	});

	const updateConfigMutation = useMutation({
		mutationFn: async (config: LogConfig) => {
			const store = await getStore();
			await store.set("logConfig", config);
			return config;
		},
		onSuccess: async (savedConfig) => {
			queryClient.setQueryData(["log-config"], savedConfig);
			setDraftConfig(null);
			toast.success(t("logConfigSaved"));
		},
	});

	const exportMutation = useMutation({
		mutationFn: async () => {
			const defaultName = `aghub-logs-${new Date().toISOString().slice(0, 10)}.zip`;
			const savePath = await save({
				defaultPath: defaultName,
				filters: [{ name: "ZIP", extensions: ["zip"] }],
			});
			if (!savePath) return null;
			await invoke<string>("export_diagnostic_logs", {
				savePath,
			});
			return savePath;
		},
		onSuccess: (path) => {
			if (!path) return;
			toast.success(t("exportLogsSuccess"), {
				description: path,
				actionProps: {
					onPress: () => revealItemInDir(path),
					variant: "tertiary",
					children: t("openLogFolder"),
				},
			});
		},
		onError: (error) => {
			toast.danger(
				`${t("exportLogsError")}: ${error instanceof Error ? error.message : String(error)}`,
			);
		},
	});

	const clearMutation = useMutation({
		mutationFn: () => invoke<number>("clear_log_files"),
		onSuccess: (count) => {
			setShowClearDialog(false);
			queryClient.invalidateQueries({ queryKey: ["log-stats"] });
			queryClient.invalidateQueries({ queryKey: ["log-entries"] });
			toast.success(t("logsClearedSuccess", { count: String(count) }));
		},
	});

	const entries = entriesQuery.data?.entries ?? [];
	const totalCount = entriesQuery.data?.total_count ?? 0;
	const logDirPath = statsQuery.data?.log_dir_path ?? "";

	const savedConfig = configQuery.data ?? null;
	const currentConfig = draftConfig ?? savedConfig;
	const isConfigDirty =
		savedConfig != null &&
		currentConfig != null &&
		(currentConfig.max_file_size_mb !== savedConfig.max_file_size_mb ||
			currentConfig.max_archives !== savedConfig.max_archives);

	const handleRefresh = useCallback(() => {
		statsQuery.refetch();
		entriesQuery.refetch();
	}, [statsQuery, entriesQuery]);

	return (
		<>
			<Card className="gap-0 p-0">
				{/* Header: title + stats + actions */}
				<div className="flex items-center justify-between gap-3 px-4 py-2.5">
					<div className="flex min-w-0 items-center gap-2">
						<h3 className="text-sm font-semibold">
							{t("diagnosticLogs")}
						</h3>
						{statsQuery.data && (
							<span className="text-xs text-muted">
								{statsQuery.data.total_entries.toLocaleString()}{" "}
								{t("entries")} &middot;{" "}
								{formatSize(statsQuery.data.total_size_bytes)}{" "}
								&middot; {statsQuery.data.log_files.length}{" "}
								{t("files")}
							</span>
						)}
					</div>
					<div className="flex shrink-0 items-center gap-1">
						<Tooltip delay={0}>
							<Tooltip.Trigger>
								<Button
									isIconOnly
									variant="ghost"
									size="sm"
									onPress={() => setShowSettingsDialog(true)}
								>
									<Cog6ToothIcon className="size-4" />
								</Button>
							</Tooltip.Trigger>
							<Tooltip.Content>
								{t("logRotationSettings")}
							</Tooltip.Content>
						</Tooltip>
						<Tooltip delay={0}>
							<Tooltip.Trigger>
								<Button
									isIconOnly
									variant="ghost"
									size="sm"
									onPress={() => {
										if (logDirPath)
											revealItemInDir(logDirPath);
									}}
								>
									<FolderOpenIcon className="size-4" />
								</Button>
							</Tooltip.Trigger>
							<Tooltip.Content>
								{t("openLogFolder")}
							</Tooltip.Content>
						</Tooltip>
						<Tooltip delay={0}>
							<Tooltip.Trigger>
								<Button
									isIconOnly
									variant="ghost"
									size="sm"
									isPending={exportMutation.isPending}
									onPress={() => exportMutation.mutate()}
								>
									<ArrowDownTrayIcon className="size-4" />
								</Button>
							</Tooltip.Trigger>
							<Tooltip.Content>{t("exportLogs")}</Tooltip.Content>
						</Tooltip>
						<Tooltip delay={0}>
							<Tooltip.Trigger>
								<Button
									isIconOnly
									variant="ghost"
									size="sm"
									onPress={() => setShowClearDialog(true)}
								>
									<TrashIcon className="size-4" />
								</Button>
							</Tooltip.Trigger>
							<Tooltip.Content>{t("clearLogs")}</Tooltip.Content>
						</Tooltip>
						<Tooltip delay={0}>
							<Tooltip.Trigger>
								<Button
									isIconOnly
									variant="ghost"
									size="sm"
									onPress={handleRefresh}
								>
									<ArrowPathIcon
										className={cn(
											"size-4",
											entriesQuery.isFetching &&
												"animate-spin",
										)}
									/>
								</Button>
							</Tooltip.Trigger>
							<Tooltip.Content>{t("refresh")}</Tooltip.Content>
						</Tooltip>
					</div>
				</div>

				<Card.Content className="p-0">
					<div className="flex items-center gap-2 border-b border-border p-3">
						<SearchField
							value={search}
							onChange={setSearch}
							aria-label={t("searchLogs")}
							variant="secondary"
							className="min-w-0 flex-1"
						>
							<SearchField.Group>
								<SearchField.SearchIcon />
								<SearchField.Input
									placeholder={t("searchLogs")}
								/>
								<SearchField.ClearButton />
							</SearchField.Group>
						</SearchField>
						<Select
							variant="secondary"
							selectedKey={activeLevel}
							onSelectionChange={(key) =>
								setActiveLevel(String(key))
							}
							aria-label={t("logLevel")}
							className="w-28 shrink-0"
						>
							<Select.Trigger>
								<Select.Value />
								<Select.Indicator />
							</Select.Trigger>
							<Select.Popover>
								<ListBox>
									<ListBox.Item
										key="ALL"
										id="ALL"
										textValue="ALL"
									>
										ALL
									</ListBox.Item>
									{LEVELS.map((level) => (
										<ListBox.Item
											key={level}
											id={level}
											textValue={level}
										>
											<span
												className={cn(
													level === "ERROR" &&
														"text-red-500",
													level === "WARN" &&
														"text-amber-500",
													level === "INFO" &&
														"text-blue-500",
													level === "DEBUG" &&
														"text-zinc-400",
													level === "TRACE" &&
														"text-zinc-500",
												)}
											>
												{level}
											</span>
										</ListBox.Item>
									))}
								</ListBox>
							</Select.Popover>
						</Select>
					</div>

					{entriesQuery.isLoading ? (
						<div className="flex justify-center py-12">
							<Spinner />
						</div>
					) : entriesQuery.isError ? (
						<div className="py-12 text-center text-sm text-red-500">
							{t("logLoadError")}:{" "}
							{entriesQuery.error instanceof Error
								? entriesQuery.error.message
								: String(entriesQuery.error)}
						</div>
					) : entries.length === 0 ? (
						<div className="py-12 text-center text-sm text-muted">
							{t("noLogEntries")}
						</div>
					) : (
						<Virtuoso
							style={{ height: "60vh" }}
							data={entries}
							itemContent={(_, entry) => (
								<div className="border-b border-border px-3 py-1.5 font-mono text-xs">
									<div className="flex items-center gap-2">
										<span className="shrink-0 text-muted">
											{entry.timestamp
												.replace("T", " ")
												.slice(0, 23)}
										</span>
										<span
											className={cn(
												"inline-block w-[3.2rem] shrink-0 rounded px-1 text-center font-semibold",
												levelColor[entry.level] ??
													"text-muted",
											)}
										>
											{entry.level}
										</span>
										<span className="truncate text-muted">
											{entry.target}
										</span>
									</div>
									<p className="mt-0.5 break-words text-foreground">
										{entry.message}
									</p>
								</div>
							)}
							followOutput="smooth"
						/>
					)}
				</Card.Content>

				{totalCount > 0 && (
					<Card.Footer className="px-4 py-2">
						<span className="ml-auto text-xs text-muted">
							{t("showingEntries", {
								shown: entries.length,
								total: totalCount,
							})}
						</span>
					</Card.Footer>
				)}
			</Card>

			{/* Settings dialog */}
			<Modal.Backdrop
				isOpen={showSettingsDialog}
				onOpenChange={(open) => {
					if (!open) {
						setShowSettingsDialog(false);
						setDraftConfig(null);
					}
				}}
			>
				<Modal.Container>
					<Modal.Dialog className="sm:max-w-[400px]">
						<Modal.Header>
							<Modal.Heading>
								{t("logRotationSettings")}
							</Modal.Heading>
						</Modal.Header>
						<Modal.Body className="space-y-4">
							{currentConfig && (
								<>
									<div className="space-y-1">
										<label className="text-sm font-medium">
											{t("maxFileSizeMb")}
										</label>
										<input
											type="number"
											min={1}
											max={100}
											className="w-full rounded border border-border bg-transparent px-3 py-1.5 text-sm text-foreground"
											value={
												currentConfig.max_file_size_mb
											}
											onChange={(e) => {
												const v = Number.parseInt(
													e.target.value,
													10,
												);
												if (Number.isNaN(v) || v < 1)
													return;
												setDraftConfig({
													...currentConfig,
													max_file_size_mb: v,
												});
											}}
										/>
									</div>
									<div className="space-y-1">
										<label className="text-sm font-medium">
											{t("maxArchives")}
										</label>
										<input
											type="number"
											min={1}
											max={20}
											className="w-full rounded border border-border bg-transparent px-3 py-1.5 text-sm text-foreground"
											value={currentConfig.max_archives}
											onChange={(e) => {
												const v = Number.parseInt(
													e.target.value,
													10,
												);
												if (Number.isNaN(v) || v < 1)
													return;
												setDraftConfig({
													...currentConfig,
													max_archives: v,
												});
											}}
										/>
									</div>
									{isConfigDirty && (
										<p className="text-xs text-amber-500">
											{t(
												"logRotationSettingsDescription",
											)}
										</p>
									)}
								</>
							)}
						</Modal.Body>
						<Modal.Footer>
							<Button
								variant="tertiary"
								onPress={() => {
									setShowSettingsDialog(false);
									setDraftConfig(null);
								}}
							>
								{t("cancel")}
							</Button>
							<Button
								isPending={updateConfigMutation.isPending}
								isDisabled={!isConfigDirty}
								onPress={() => {
									if (currentConfig) {
										updateConfigMutation.mutate(
											currentConfig,
											{
												onSuccess: () =>
													setShowSettingsDialog(
														false,
													),
											},
										);
									}
								}}
							>
								{t("save")}
							</Button>
						</Modal.Footer>
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>

			{/* Clear dialog */}
			<AlertDialog.Backdrop
				isOpen={showClearDialog}
				onOpenChange={(open) => {
					if (!open) setShowClearDialog(false);
				}}
			>
				<AlertDialog.Container>
					<AlertDialog.Dialog className="sm:max-w-[420px]">
						<AlertDialog.CloseTrigger />
						<AlertDialog.Header>
							<AlertDialog.Icon status="danger" />
							<AlertDialog.Heading>
								{t("clearLogs")}
							</AlertDialog.Heading>
						</AlertDialog.Header>
						<AlertDialog.Body>
							{t("clearLogsConfirm")}
						</AlertDialog.Body>
						<AlertDialog.Footer>
							<Button
								variant="tertiary"
								onPress={() => setShowClearDialog(false)}
							>
								{t("cancel")}
							</Button>
							<Button
								variant="danger"
								isPending={clearMutation.isPending}
								onPress={() => clearMutation.mutate()}
							>
								{t("clearLogs")}
							</Button>
						</AlertDialog.Footer>
					</AlertDialog.Dialog>
				</AlertDialog.Container>
			</AlertDialog.Backdrop>
		</>
	);
}
