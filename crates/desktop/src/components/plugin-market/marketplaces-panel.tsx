"use client";

import {
	ArrowPathIcon,
	CircleStackIcon,
	ExclamationCircleIcon,
	PlusIcon,
	TrashIcon,
} from "@heroicons/react/24/solid";
import { FolderIcon, GlobeAltIcon } from "@heroicons/react/24/outline";
import claudeCodeIcon from "@lobehub/icons-static-svg/icons/claudecode-color.svg?raw";
import githubIcon from "@lobehub/icons-static-svg/icons/github.svg?raw";
import {
	Button,
	Input,
	Label,
	Spinner,
	Table,
	TextField,
	Tooltip,
	toast,
} from "@heroui/react";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { CCMarketplaceSourceResponse } from "../../generated/dto";
import { useApi } from "../../hooks/use-api";
import { cn } from "../../lib/utils";
import {
	addMarketplaceMutationOptions,
	invalidateMarketplaceQueries,
	marketplaceListQueryOptions,
	removeMarketplaceMutationOptions,
} from "../../requests/plugins";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";

const PROTECTED_MARKETPLACES = new Set(["claude-plugins-official"]);
const OFFICIAL_GITHUB_URL = "https://github.com/anthropics/claude-code";
const OFFICIAL_GITHUB_REPO = "anthropics/claude-code";
const GITHUB_GIT_URL_RE =
	/^https:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?\/?$/;

interface MarketplacesPanelProps {
	enabled: boolean;
	installScope: "global" | "project" | "local";
}

export function MarketplacesPanel({
	enabled,
	installScope,
}: MarketplacesPanelProps) {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();
	const [source, setSource] = useState("");
	const [updatingMarketplaces, setUpdatingMarketplaces] = useState<
		Set<string>
	>(() => new Set());
	const [isUpdatingAll, setIsUpdatingAll] = useState(false);

	const errorMessage = (value: unknown) =>
		value instanceof Error ? value.message : t("unknownError");

	const { data, isLoading, isError, error, refetch } = useQuery(
		marketplaceListQueryOptions({ api, enabled }),
	);

	const addMutation = useMutation({
		...addMarketplaceMutationOptions({
			api,
			queryClient,
			onSuccess: (resp) => {
				setSource("");
				toast.success(
					t("marketplaceAdded", {
						name: resp.marketplace?.name ?? source,
					}),
				);
			},
		}),
		onError: (mutationError) => {
			toast.danger(t("marketplaceAddFailed"), {
				description: errorMessage(mutationError),
			});
		},
	});

	const removeMutation = useMutation({
		...removeMarketplaceMutationOptions({
			api,
			queryClient,
			onSuccess: (_data, name) => {
				toast.success(t("marketplaceRemoved", { name }));
			},
		}),
		onError: (mutationError, name) => {
			toast.danger(t("marketplaceRemoveFailed", { name }), {
				description: errorMessage(mutationError),
			});
		},
	});

	const handleAdd = () => {
		const trimmed = source.trim();
		if (!trimmed) {
			return;
		}
		addMutation.mutate({
			source: trimmed,
			scope: installScope,
			sparse: [],
		});
	};

	const marketplaces = data?.marketplaces ?? [];

	const setMarketplaceUpdating = (name: string, value: boolean) => {
		setUpdatingMarketplaces((current) => {
			const next = new Set(current);
			if (value) {
				next.add(name);
			} else {
				next.delete(name);
			}
			return next;
		});
	};

	const updateMarketplace = async (
		name: string,
		{ announce, invalidate }: { announce: boolean; invalidate: boolean },
	) => {
		// 300ms floor in finally forces a macrotask boundary between
		// setMarketplaceUpdating(true) and setMarketplaceUpdating(false),
		// guaranteeing at least one render with the spinner visible.
		const floor = new Promise<void>((r) => setTimeout(r, 300));
		setMarketplaceUpdating(name, true);
		try {
			await api.plugins.updateMarketplaceOne(name);
			if (invalidate) {
				await invalidateMarketplaceQueries(queryClient);
			}
			if (announce) {
				toast.success(t("marketplaceUpdatedOne", { name }));
			}
		} catch (mutationError) {
			if (announce) {
				toast.danger(t("marketplaceUpdateFailed"), {
					description: `${name}: ${errorMessage(mutationError)}`,
				});
			}
			throw mutationError;
		} finally {
			await floor;
			setMarketplaceUpdating(name, false);
		}
	};

	const handleUpdateAll = async () => {
		if (
			isUpdatingAll ||
			updatingMarketplaces.size > 0 ||
			marketplaces.length === 0
		) {
			return;
		}

		setIsUpdatingAll(true);
		try {
			const names = marketplaces.map((entry) => entry.name);
			const results = await Promise.allSettled(
				names.map((name) =>
					updateMarketplace(name, {
						announce: false,
						invalidate: false,
					}),
				),
			);
			try {
				await invalidateMarketplaceQueries(queryClient);
			} catch {
				// ignore — stale data is preferable to a silent crash
			}

			const failures = results.filter(
				(result): result is PromiseRejectedResult =>
					result.status === "rejected",
			);
			const updatedCount = names.length - failures.length;

			if (failures.length === 0) {
				toast.success(t("marketplaceUpdated"), {
					description: t("marketplaceUpdatedCount", {
						count: updatedCount,
					}),
				});
			} else {
				toast.danger(t("marketplaceUpdateFailed"), {
					description: t("marketplaceUpdatedCount", {
						count: updatedCount,
					}),
				});
			}
		} finally {
			setIsUpdatingAll(false);
		}
	};

	return (
		// min-h-[16rem]: prevents panel from collapsing in the empty/loading states
		// max-h-[52vh]: fits inside the 80vh modal after the tab bar and dialog header
		<div className="flex min-h-[16rem] max-h-[52vh] flex-col overflow-hidden">
			<div className="flex shrink-0 items-end gap-2 border-b border-separator/50 p-2.5">
				<TextField
					className="min-w-0 flex-1"
					variant="secondary"
					value={source}
					onChange={setSource}
					isDisabled={addMutation.isPending}
				>
					<Label>{t("marketplaceAddLabel")}</Label>
					<Input
						variant="secondary"
						placeholder={t("marketplaceAddPlaceholder")}
						onKeyDown={(event) => {
							if (event.key === "Enter") {
								event.preventDefault();
								handleAdd();
							}
						}}
					/>
				</TextField>
				<Button
					variant="primary"
					size="sm"
					className="h-9 shrink-0 whitespace-nowrap"
					onPress={handleAdd}
					isDisabled={!source.trim() || addMutation.isPending}
				>
					{addMutation.isPending ? (
						<Spinner size="sm" />
					) : (
						<>
							<PlusIcon className="size-4" />
							{t("marketplaceAddSubmit")}
						</>
					)}
				</Button>
				<Tooltip delay={0}>
					<Button
						isIconOnly
						variant="ghost"
						size="sm"
						className="h-9 w-9 shrink-0"
						onPress={handleUpdateAll}
						isDisabled={isUpdatingAll || marketplaces.length === 0}
						aria-label={t("marketplaceRefreshAll")}
					>
						<ArrowPathIcon
							className={cn(
								"size-4",
								isUpdatingAll && "animate-spin",
							)}
						/>
					</Button>
					<Tooltip.Content>
						{t("marketplaceRefreshAll")}
					</Tooltip.Content>
				</Tooltip>
			</div>

			{isLoading ? (
				<div className="flex flex-1 items-center justify-center">
					<Spinner size="lg" />
				</div>
			) : isError ? (
				<Empty className="rounded-none border-0">
					<EmptyHeader>
						<EmptyMedia>
							<ExclamationCircleIcon className="size-8 text-danger" />
						</EmptyMedia>
						<EmptyTitle className="text-sm font-normal text-muted">
							{errorMessage(error)}
						</EmptyTitle>
					</EmptyHeader>
					<Button
						variant="secondary"
						size="sm"
						onPress={() => refetch()}
					>
						{t("retry")}
					</Button>
				</Empty>
			) : marketplaces.length === 0 ? (
				<Empty className="rounded-none border-0">
					<EmptyHeader>
						<EmptyMedia>
							<CircleStackIcon className="size-8 text-muted" />
						</EmptyMedia>
						<EmptyTitle className="text-sm font-normal text-muted">
							{t("marketplaceNoneTitle")}
						</EmptyTitle>
					</EmptyHeader>
				</Empty>
			) : (
				<div className="min-h-0 flex-1 overflow-hidden">
					<Table className="h-full">
						<Table.ScrollContainer className="h-full overflow-auto rounded-[inherit] [scrollbar-gutter:stable]">
							<Table.Content
								aria-label={t("pluginMarketTabMarketplaces")}
							>
								<Table.Header>
									<Table.Column isRowHeader>
										{t("name")}
									</Table.Column>
									<Table.Column className="w-[104px] text-right">
										<span className="sr-only">
											{t("actions")}
										</span>
									</Table.Column>
								</Table.Header>
								<Table.Body items={marketplaces}>
									{(entry) => {
										const isProtected =
											PROTECTED_MARKETPLACES.has(
												entry.name,
											);
										const isUpdating =
											updatingMarketplaces.has(
												entry.name,
											);
										const isRemoving =
											removeMutation.isPending &&
											removeMutation.variables ===
												entry.name;

										return (
											<Table.Row id={entry.name}>
												<Table.Cell>
													<div className="min-w-0 space-y-0.5 py-0.5">
														<div className="flex min-w-0 items-center gap-2">
															<span className="truncate text-sm font-medium text-foreground">
																{entry.name}
															</span>
															<span className="shrink-0 whitespace-nowrap text-xs text-muted">
																<SourceLink
																	source={
																		entry.source
																	}
																	isOfficial={
																		isProtected
																	}
																/>
															</span>
														</div>
														<p className="truncate font-mono text-[11px] text-muted/80">
															{
																entry.install_location
															}
														</p>
													</div>
												</Table.Cell>
												<Table.Cell>
													<div className="flex justify-end gap-1 py-0.5">
														<Tooltip delay={0}>
															<Button
																isIconOnly
																variant="ghost"
																size="sm"
																onPress={() =>
																	void updateMarketplace(
																		entry.name,
																		{
																			announce: true,
																			invalidate: true,
																		},
																	)
																}
																isDisabled={
																	isUpdating ||
																	isUpdatingAll
																}
																aria-label={t(
																	"marketplaceRefresh",
																)}
															>
																<ArrowPathIcon
																	className={cn(
																		"size-4",
																		isUpdating &&
																			"animate-spin",
																	)}
																/>
															</Button>
															<Tooltip.Content>
																{t(
																	"marketplaceRefresh",
																)}
															</Tooltip.Content>
														</Tooltip>
														{!isProtected && (
															<Tooltip delay={0}>
																<Button
																	isIconOnly
																	variant="tertiary"
																	size="sm"
																	onPress={() =>
																		removeMutation.mutate(
																			entry.name,
																		)
																	}
																	isDisabled={
																		isRemoving
																	}
																	aria-label={t(
																		"marketplaceRemove",
																	)}
																	className="text-danger"
																>
																	{isRemoving ? (
																		<Spinner size="sm" />
																	) : (
																		<TrashIcon className="size-4" />
																	)}
																</Button>
																<Tooltip.Content>
																	{t(
																		"marketplaceRemove",
																	)}
																</Tooltip.Content>
															</Tooltip>
														)}
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

function SourceLink({
	source,
	isOfficial,
}: {
	source: CCMarketplaceSourceResponse;
	isOfficial: boolean;
}) {
	if (isOfficial) {
		return (
			<a
				href={OFFICIAL_GITHUB_URL}
				rel="noopener noreferrer"
				className="flex min-w-0 items-center gap-1 text-muted transition-colors hover:text-foreground"
				onClick={(e) => {
					e.preventDefault();
					void openUrl(OFFICIAL_GITHUB_URL);
				}}
			>
				<span
					className="inline-flex size-3.5 shrink-0 items-center [&_svg]:size-full"
					// eslint-disable-next-line @eslint-react/dom-no-dangerously-set-innerhtml
					dangerouslySetInnerHTML={{ __html: claudeCodeIcon }}
				/>
				<span>{OFFICIAL_GITHUB_REPO}</span>
			</a>
		);
	}

	switch (source.kind) {
		case "github":
			return (
				<a
					href={`https://github.com/${source.repo}`}
					rel="noopener noreferrer"
					className="flex min-w-0 items-center gap-1 text-muted transition-colors hover:text-foreground"
					onClick={(e) => {
						e.preventDefault();
						void openUrl(`https://github.com/${source.repo}`);
					}}
				>
					<span
						className="inline-flex size-3.5 shrink-0 items-center [&_svg]:size-full"
						// eslint-disable-next-line @eslint-react/dom-no-dangerously-set-innerhtml
						dangerouslySetInnerHTML={{ __html: githubIcon }}
					/>
					<span>{source.repo}</span>
				</a>
			);
		case "git": {
			// CLI emits `git` for full git URLs the user typed instead of
			// the `owner/repo` shorthand. When the host is github.com,
			// reuse the github visual treatment for consistency.
			const githubRepo = source.url.match(GITHUB_GIT_URL_RE)?.[1];
			if (githubRepo) {
				const href = `https://github.com/${githubRepo}`;
				return (
					<a
						href={href}
						rel="noopener noreferrer"
						className="flex min-w-0 items-center gap-1 text-muted transition-colors hover:text-foreground"
						onClick={(e) => {
							e.preventDefault();
							void openUrl(href);
						}}
					>
						<span
							className="inline-flex size-3.5 shrink-0 items-center [&_svg]:size-full"
							// eslint-disable-next-line @eslint-react/dom-no-dangerously-set-innerhtml
							dangerouslySetInnerHTML={{ __html: githubIcon }}
						/>
						<span>{githubRepo}</span>
					</a>
				);
			}
			return (
				<a
					href={source.url}
					rel="noopener noreferrer"
					className="flex min-w-0 items-center gap-1 text-muted transition-colors hover:text-foreground"
					onClick={(e) => {
						e.preventDefault();
						void openUrl(source.url);
					}}
				>
					<GlobeAltIcon className="size-3.5 shrink-0" />
					<span>{source.url}</span>
				</a>
			);
		}
		case "url":
			return (
				<a
					href={source.url}
					rel="noopener noreferrer"
					className="flex min-w-0 items-center gap-1 text-muted transition-colors hover:text-foreground"
					onClick={(e) => {
						e.preventDefault();
						void openUrl(source.url);
					}}
				>
					<GlobeAltIcon className="size-3.5 shrink-0" />
					<span>{source.url}</span>
				</a>
			);
		case "local":
			return (
				<button
					type="button"
					className="flex cursor-pointer items-center gap-1 text-muted transition-colors hover:text-foreground"
					onClick={() => void revealItemInDir(source.path)}
				>
					<FolderIcon className="size-3.5 shrink-0" />
					<span>{source.path}</span>
				</button>
			);
	}
}
