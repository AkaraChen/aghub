import { ArrowPathIcon, FunnelIcon } from "@heroicons/react/24/solid";
import { Button, Card, Input, Spinner } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Virtuoso } from "react-virtuoso";
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
	const [search, setSearch] = useState("");
	const [activeLevels, setActiveLevels] = useState<string[]>([]);

	const statsQuery = useQuery({
		queryKey: ["log-stats"],
		queryFn: () => invoke<LogStats>("get_log_stats"),
	});

	const entriesQuery = useQuery({
		queryKey: ["log-entries", activeLevels, search],
		queryFn: () =>
			invoke<GetLogEntriesResponse>("get_log_entries", {
				params: {
					offset: 0,
					limit: 5000,
					level_filter: activeLevels.length > 0 ? activeLevels : null,
					search: search || null,
				},
			}),
	});

	const entries = entriesQuery.data?.entries ?? [];
	const totalCount = entriesQuery.data?.total_count ?? 0;

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
			<Card className="p-0">
				<Card.Content className="space-y-3 p-4">
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-3">
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
									&middot; {statsQuery.data.log_files.length}{" "}
									{t("files")}
								</span>
							)}
						</div>
						<Button
							isIconOnly
							variant="ghost"
							size="sm"
							onPress={handleRefresh}
						>
							<ArrowPathIcon
								className={cn(
									"size-4",
									entriesQuery.isFetching && "animate-spin",
								)}
							/>
						</Button>
					</div>

					<div className="flex items-center gap-2">
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
				</Card.Content>
			</Card>

			<Card className="p-0">
				<Card.Content className="p-0">
					{entriesQuery.isLoading ? (
						<div className="flex justify-center py-12">
							<Spinner />
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
								<div className="flex gap-2 border-b border-border px-3 py-1.5 font-mono text-xs">
									<span className="shrink-0 text-muted">
										{entry.timestamp
											.replace("T", " ")
											.slice(0, 23)}
									</span>
									<span
										className={cn(
											"shrink-0 rounded px-1 font-semibold",
											levelColor[entry.level] ??
												"text-muted",
										)}
									>
										{entry.level.padEnd(5)}
									</span>
									<span className="shrink-0 text-muted">
										{entry.target}
									</span>
									<span className="min-w-0 break-all text-foreground">
										{entry.message}
									</span>
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
		</div>
	);
}
