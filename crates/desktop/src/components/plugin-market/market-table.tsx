"use client";

import {
	CheckCircleIcon,
	ExclamationCircleIcon,
	MagnifyingGlassIcon,
} from "@heroicons/react/24/solid";
import { Button, Spinner, Table } from "@heroui/react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { CCPluginMarketResponse } from "../../generated/dto";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";

import { formatPluginVersion } from "../../lib/plugin-version";

interface PluginMarketTableProps {
	plugins: CCPluginMarketResponse[];
	isLoading: boolean;
	isError: boolean;
	error: unknown;
	searchQuery: string;
	compactFormatter: Intl.NumberFormat;
	onRetry: () => void;
	onInstall: (pluginId: string) => void;
	installStates: Record<string, "installing" | "installed">;
}

type TableInstallState = "idle" | "installing" | "installed";

interface PluginMarketRow {
	id: string;
	plugin: CCPluginMarketResponse;
	installState: TableInstallState;
}

function buildPluginMeta(
	plugin: CCPluginMarketResponse,
	t: (key: string) => string,
) {
	const values: string[] = [];

	if (plugin.has_mcp) {
		values.push(t("pluginCapabilityMcp"));
	}
	if (plugin.has_skills) {
		values.push(t("pluginCapabilitySkills"));
	}
	if (plugin.has_hooks) {
		values.push(t("pluginCapabilityHooks"));
	}

	return values.join(" · ");
}

export function PluginMarketTable({
	plugins,
	isLoading,
	isError,
	error,
	searchQuery,
	compactFormatter,
	onRetry,
	onInstall,
	installStates,
}: PluginMarketTableProps) {
	const { t } = useTranslation();
	const tableRows = useMemo<PluginMarketRow[]>(
		() =>
			plugins.map((plugin) => ({
				id: plugin.id,
				plugin,
				installState: installStates[plugin.id] ?? "idle",
			})),
		[plugins, installStates],
	);

	return (
		<div className="flex min-h-[16rem] max-h-[52vh] flex-col overflow-hidden rounded-lg bg-surface">
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
						variant="secondary"
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
						<Table.ScrollContainer className="h-full overflow-auto rounded-[inherit] [scrollbar-gutter:stable]">
							<Table.Content aria-label={t("pluginMarket")}>
								<Table.Header>
									<Table.Column
										isRowHeader
										className="w-[58%]"
									>
										{t("name")}
									</Table.Column>
									<Table.Column className="w-[112px] text-right">
										<span className="whitespace-nowrap">
											{t("installs")}
										</span>
									</Table.Column>
									<Table.Column className="w-[136px]">
										{t("author")}
									</Table.Column>
									<Table.Column className="w-[104px] text-right">
										<span className="sr-only">
											{t("install")}
										</span>
									</Table.Column>
								</Table.Header>
								<Table.Body items={tableRows}>
									{({ id, plugin, installState }) => {
										const isInstalling =
											installState === "installing";
										const isInstalled =
											installState === "installed";
										const pluginMeta = buildPluginMeta(
											plugin,
											t,
										);

										return (
											<Table.Row id={id}>
												<Table.Cell>
													<div className="min-w-0 space-y-1 py-0.5">
														<div className="flex min-w-0 items-center gap-2">
															<span className="truncate text-sm font-semibold text-foreground">
																{plugin.name}
															</span>
														</div>
														{plugin.description && (
															<p className="line-clamp-2 text-xs leading-5 text-muted">
																{
																	plugin.description
																}
															</p>
														)}
														{pluginMeta && (
															<p className="line-clamp-1 text-[11px] text-muted">
																{pluginMeta}
															</p>
														)}
													</div>
												</Table.Cell>
												<Table.Cell>
													<div className="flex justify-end py-0.5">
														<span className="whitespace-nowrap text-sm tabular-nums text-muted">
															{plugin.installs > 0
																? compactFormatter.format(
																		plugin.installs,
																	)
																: "—"}
														</span>
													</div>
												</Table.Cell>
												<Table.Cell>
													<div className="flex flex-col gap-1 py-0.5">
														<span
															className={
																plugin.author
																	? "truncate text-sm font-medium text-foreground"
																	: "truncate text-sm font-medium text-muted"
															}
														>
															{plugin.author ||
																t("unknown")}
														</span>
														<span className="font-mono text-xs text-muted">
															{formatPluginVersion(
																plugin.version,
															)}
														</span>
													</div>
												</Table.Cell>
												<Table.Cell>
													<div className="flex justify-end py-0.5">
														<Button
															size="sm"
															variant="tertiary"
															className="h-8 min-w-[92px] justify-center gap-1.5 whitespace-nowrap px-3 transition-colors duration-200"
															onPress={() =>
																onInstall(
																	plugin.id,
																)
															}
															isPending={
																isInstalling
															}
															isDisabled={
																isInstalled
															}
														>
															<span className="flex items-center gap-1.5">
																{isInstalling ? (
																	<Spinner
																		color="current"
																		size="sm"
																	/>
																) : isInstalled ? (
																	<CheckCircleIcon className="size-3.5" />
																) : null}
																{isInstalling
																	? t(
																			"installing",
																		)
																	: isInstalled
																		? t(
																				"installed",
																			)
																		: t(
																				"install",
																			)}
															</span>
														</Button>
													</div>
												</Table.Cell>
											</Table.Row>
										);
									}}
								</Table.Body>
							</Table.Content>
						</Table.ScrollContainer>
					</Table>
				</div>
			)}
		</div>
	);
}
