"use client";

import {
	ExclamationCircleIcon,
	MagnifyingGlassIcon,
} from "@heroicons/react/24/solid";
import { Button, Chip, Spinner, Table } from "@heroui/react";
import { useTranslation } from "react-i18next";
import type { CCPluginMarketResponse } from "../../generated/dto";
import { cn } from "../../lib/utils";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";

const SEMANTIC_VERSION_REGEX = /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/;
const GIT_HASH_REGEX = /^[0-9a-f]{7,40}$/i;

interface PluginMarketTableProps {
	plugins: CCPluginMarketResponse[];
	isLoading: boolean;
	isError: boolean;
	error: unknown;
	searchQuery: string;
	compactFormatter: Intl.NumberFormat;
	getCategoryLabel: (category: string) => string;
	onRetry: () => void;
	onInstall: (pluginId: string) => void;
	installingPluginId?: string | null;
}

function formatPluginVersion(version: string) {
	if (!version) {
		return "unknown";
	}

	if (version === "latest" || version.startsWith("v")) {
		return version;
	}

	if (version.startsWith("#")) {
		return version;
	}

	if (GIT_HASH_REGEX.test(version)) {
		return `#${version}`;
	}

	if (SEMANTIC_VERSION_REGEX.test(version)) {
		return `v${version}`;
	}

	return version;
}

export function PluginMarketTable({
	plugins,
	isLoading,
	isError,
	error,
	searchQuery,
	compactFormatter,
	getCategoryLabel,
	onRetry,
	onInstall,
	installingPluginId,
}: PluginMarketTableProps) {
	const { t } = useTranslation();

	return (
		<div className="flex min-h-[50vh] flex-1 flex-col overflow-hidden rounded-lg border border-separator bg-surface">
			{isLoading ? (
				<div className="flex flex-1 items-center justify-center">
					<Spinner size="lg" />
				</div>
			) : isError ? (
				<div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
					<ExclamationCircleIcon className="mb-2 size-8 text-danger" />
					<p className="text-sm text-muted">
						{error instanceof Error
							? error.message
							: t("unknownError")}
					</p>
					<Button
						variant="ghost"
						size="sm"
						onPress={onRetry}
						className="mt-4"
					>
						{t("retry")}
					</Button>
				</div>
			) : plugins.length === 0 ? (
				<div className="flex flex-1 items-center justify-center">
					<Empty className="border-0">
						<EmptyHeader>
							<EmptyMedia>
								<MagnifyingGlassIcon className="size-8 text-muted" />
							</EmptyMedia>
							<EmptyTitle className="text-sm font-normal text-muted">
								{searchQuery
									? t("noPluginsFound")
									: t("noPluginsAvailable")}
							</EmptyTitle>
						</EmptyHeader>
					</Empty>
				</div>
			) : (
				<div className="min-h-0 flex-1 overflow-hidden">
					<Table className="h-full">
						<Table.ScrollContainer className="h-full [scrollbar-gutter:stable]">
							<Table.Content
								aria-label={t("pluginMarket")}
								className={cn(
									"table-fixed border-separate border-spacing-0",
									"[&_thead]:sticky [&_thead]:top-0 [&_thead]:z-10 [&_thead]:bg-surface",
									"[&_thead_th]:h-11 [&_thead_th]:border-b [&_thead_th]:border-separator/70 [&_thead_th]:bg-surface-secondary/70 [&_thead_th]:px-4 [&_thead_th]:text-[11px] [&_thead_th]:font-semibold [&_thead_th]:tracking-[0.08em] [&_thead_th]:text-muted",
									"[&_tbody_td]:px-4 [&_tbody_td]:py-3 [&_tbody_td]:align-top",
									"[&_tbody_tr]:border-b [&_tbody_tr]:border-separator/60 [&_tbody_tr]:transition-colors",
									"[&_tbody_tr:hover]:bg-surface-secondary/30",
									"[&_tbody_tr:last-child]:border-b-0",
								)}
							>
								<Table.Header>
									<Table.Column
										isRowHeader
										className="w-[58%]"
									>
										{t("name")}
									</Table.Column>
									<Table.Column className="w-[120px] text-right">
										{t("installs")}
									</Table.Column>
									<Table.Column className="w-[180px]">
										{t("author")}
									</Table.Column>
									<Table.Column className="w-[140px] text-right">
										{t("installation")}
									</Table.Column>
								</Table.Header>
								<Table.Body items={plugins}>
									{(plugin) => (
										<Table.Row
											id={plugin.id}
											className="align-top"
										>
											<Table.Cell className="align-top">
												<div className="min-w-0 space-y-2 py-1.5">
													<div className="flex min-w-0 items-center gap-2">
														<span className="truncate text-base font-semibold text-foreground">
															{plugin.name}
														</span>
														<div className="flex shrink-0 items-center gap-1.5">
															{plugin.category && (
																<Chip
																	size="sm"
																	variant="secondary"
																	className="h-6 px-2 text-[10px] font-semibold uppercase"
																>
																	{getCategoryLabel(
																		plugin.category,
																	)}
																</Chip>
															)}
															{plugin.has_mcp && (
																<Chip
																	size="sm"
																	variant="secondary"
																	className="h-6 px-2 text-[10px] font-semibold text-blue-400"
																>
																	MCP
																</Chip>
															)}
															{plugin.has_skills && (
																<Chip
																	size="sm"
																	variant="secondary"
																	className="h-6 px-2 text-[10px] font-semibold text-violet-400"
																>
																	SKILL
																</Chip>
															)}
														</div>
													</div>
													{plugin.description && (
														<p className="line-clamp-2 text-sm leading-6 text-muted">
															{plugin.description}
														</p>
													)}
												</div>
											</Table.Cell>
											<Table.Cell className="align-top">
												<div className="flex justify-end py-1.5">
													<span className="text-sm tabular-nums text-muted">
														{plugin.installs > 0
															? compactFormatter.format(
																	plugin.installs,
																)
															: "—"}
													</span>
												</div>
											</Table.Cell>
											<Table.Cell className="align-top">
												<div className="flex flex-col gap-1 py-1.5">
													<span
														className={cn(
															"truncate text-sm font-medium",
															plugin.author
																? "text-foreground"
																: "text-muted",
														)}
													>
														{plugin.author ||
															t("unknown")}
													</span>
													<span className="text-xs text-muted">
														{formatPluginVersion(
															plugin.version,
														)}
													</span>
												</div>
											</Table.Cell>
											<Table.Cell className="align-top">
												<div className="flex justify-end py-1">
													<Button
														size="sm"
														variant="tertiary"
														className="min-w-[104px]"
														onPress={() =>
															onInstall(plugin.id)
														}
														isPending={
															installingPluginId ===
															plugin.id
														}
													>
														{t("install")}
													</Button>
												</div>
											</Table.Cell>
										</Table.Row>
									)}
								</Table.Body>
							</Table.Content>
						</Table.ScrollContainer>
					</Table>
				</div>
			)}
		</div>
	);
}
