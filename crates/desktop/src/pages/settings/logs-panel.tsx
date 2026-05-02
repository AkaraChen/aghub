import {
	ArrowPathIcon,
	FolderOpenIcon,
	FunnelIcon,
	ArrowDownTrayIcon,
	TrashIcon,
} from "@heroicons/react/24/solid";
import {
	AlertDialog,
	Button,
	Card,
	Input,
	Spinner,
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
	const [activeLevels, setActiveLevels] = useState<string[]>([]);
	const [showClearDialog, setShowClearDialog] = useState(false);
	const [draftConfig, setDraftConfig] = useState<LogConfig | null>(null);
	const debounceRef = useRef<ReturnType<typeof setTimeout>>();

	useEffect(() => {
		debounceRef.current = setTimeout(() => setDebouncedSearch(search), 300);
		return () => clearTimeout(debounceRef.current);
	}, [search]);

	const statsQuery = useQuery({
		queryKey: ["log-stats"],
		queryFn: () => invoke<LogStats>("get_log_stats"),
	});

	const entriesQuery = useQuery({
		queryKey: ["log-entries", activeLevels, debouncedSearch],
		queryFn: () =>
			invoke<GetLogEntriesResponse>("get_log_entries", {
				params: {
					offset: 0,
					limit: 5000,
					level_filter: activeLevels.length > 0 ? activeLevels : null,
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
				save_path: savePath,
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

	const toggleLevel = useCallback((level: string) => {
		setActiveLevels((prev) =>
			prev.includes(level)
				? prev.filter((l) => l !== level)
				: [...prev, level],
		);
	}, []);

	const handleRefresh = useCallback(() => {
		statsQuery.refetch();
		entriesQuery.refetch();
	}, [statsQuery, entriesQuery]);

	return (
		<div className="space-y-4">
			{/* Header: directory path + actions */}
			<Card className="p-0">
				<Card.Content className="p-4">
					<div className="flex items-start justify-between gap-4">
						<div className="min-w-0 space-y-1">
							<div className="flex items-center gap-2">
								<span className="text-sm font-medium">
									{t("diagnosticLogs")}
								</span>
								{statsQuery.data && (
									<span className="text-xs text-muted">
										{statsQuery.data.total_entries.toLocaleString()}{" "}
										{t("entries")} &middot;{" "}
										{formatSize(
											statsQuery.data.total_size_bytes,
										)}{" "}
										&middot;{" "}
										{statsQuery.data.log_files.length}{" "}
										{t("files")}
									</span>
								)}
							</div>
							{logDirPath && (
								<p className="truncate text-xs text-muted">
									{logDirPath}
								</p>
							)}
							{configQuery.data &&
								(() => {
									const saved = configQuery.data;
									const current = draftConfig ?? saved;
									const isDirty =
										current.max_file_size_mb !==
											saved.max_file_size_mb ||
										current.max_archives !==
											saved.max_archives;
									return (
										<div className="flex items-center gap-2 pt-1 text-xs text-muted">
											<span>
												{t("logRotationSettings")}:
											</span>
											<input
												type="number"
												min={1}
												max={100}
												className="w-14 rounded border border-border bg-transparent px-1.5 py-0.5 text-center text-xs text-foreground"
												value={current.max_file_size_mb}
												onChange={(e) => {
													const v = Number.parseInt(
														e.target.value,
														10,
													);
													if (
														Number.isNaN(v) ||
														v < 1
													)
														return;
													setDraftConfig({
														...current,
														max_file_size_mb: v,
													});
												}}
											/>
											<span>MB &times;</span>
											<input
												type="number"
												min={1}
												max={20}
												className="w-12 rounded border border-border bg-transparent px-1.5 py-0.5 text-center text-xs text-foreground"
												value={current.max_archives}
												onChange={(e) => {
													const v = Number.parseInt(
														e.target.value,
														10,
													);
													if (
														Number.isNaN(v) ||
														v < 1
													)
														return;
													setDraftConfig({
														...current,
														max_archives: v,
													});
												}}
											/>
											<span>{t("files")}</span>
											{isDirty && (
												<>
													<Button
														size="sm"
														variant="tertiary"
														className="ml-1 h-5 text-xs"
														onPress={() =>
															setDraftConfig(null)
														}
													>
														{t("reset")}
													</Button>
													<Button
														size="sm"
														className="h-5 text-xs"
														isPending={
															updateConfigMutation.isPending
														}
														onPress={() =>
															updateConfigMutation.mutate(
																current,
															)
														}
													>
														{t("save")}
													</Button>
													<span className="text-amber-500">
														{t(
															"logRotationSettingsDescription",
														)}
													</span>
												</>
											)}
										</div>
									);
								})()}
						</div>
						<div className="flex shrink-0 items-center gap-1">
							<Button
								isIconOnly
								variant="ghost"
								size="sm"
								aria-label={t("openLogFolder")}
								onPress={() => {
									if (logDirPath) revealItemInDir(logDirPath);
								}}
							>
								<FolderOpenIcon className="size-4" />
							</Button>
							<Button
								isIconOnly
								variant="ghost"
								size="sm"
								aria-label={t("exportLogs")}
								isPending={exportMutation.isPending}
								onPress={() => exportMutation.mutate()}
							>
								<ArrowDownTrayIcon className="size-4" />
							</Button>
							<Button
								isIconOnly
								variant="ghost"
								size="sm"
								aria-label={t("clearLogs")}
								onPress={() => setShowClearDialog(true)}
							>
								<TrashIcon className="size-4" />
							</Button>
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
						</div>
					</div>
				</Card.Content>
			</Card>

			{/* Log entries */}
			<Card className="p-0">
				<Card.Content className="p-0">
					{/* Search + level filter */}
					<div className="flex items-center gap-2 border-b border-border px-3 py-2">
						<Input
							className="flex-1"
							placeholder={t("searchLogs")}
							value={search}
							onChange={(e) => setSearch(e.target.value)}
						/>
						<div className="flex items-center gap-1">
							<FunnelIcon className="size-3.5 text-muted" />
							{LEVELS.map((level) => (
								<button
									key={level}
									type="button"
									className={cn(
										"rounded px-1.5 py-0.5 text-[10px] font-medium transition-opacity",
										levelColor[level],
										activeLevels.length > 0 &&
											!activeLevels.includes(level) &&
											"opacity-30",
									)}
									onClick={() => toggleLevel(level)}
								>
									{level}
									{statsQuery.data?.entries_by_level[level] !=
										null && (
										<span className="ml-1 opacity-60">
											{
												statsQuery.data
													.entries_by_level[level]
											}
										</span>
									)}
								</button>
							))}
						</div>
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
							style={{ height: "50vh" }}
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
			</Card>

			{totalCount > 0 && (
				<div className="text-right text-xs text-muted">
					{t("showingEntries", {
						shown: entries.length,
						total: totalCount,
					})}
				</div>
			)}

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
		</div>
	);
}
