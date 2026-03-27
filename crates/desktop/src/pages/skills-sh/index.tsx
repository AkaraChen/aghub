import { MagnifyingGlassIcon } from "@heroicons/react/24/solid";
import { Button, Modal, SearchField, Spinner, Tooltip } from "@heroui/react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useQueryState } from "nuqs";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TableComponents } from "react-virtuoso";
import { TableVirtuoso } from "react-virtuoso";
import { AgentSelector } from "../../components/agent-selector";
import { ResultStatusItem } from "../../components/result-status-item";
import { SkillInfoCard } from "../../components/skill-info-card";
import {
	Empty,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "../../components/ui/empty";
import { useAgentAvailability } from "../../hooks/use-agent-availability";
import { useServer } from "../../hooks/use-server";
import { createApi } from "../../lib/api";
import type { MarketSkill } from "../../lib/api-types";

const BATCH_SIZE = 20;
const FETCH_SIZE = 100;
const MAX_TOTAL = 1000;
const ROW_HEIGHT = 48;

const tableComponents: TableComponents<MarketSkill> = {
	Table: ({ style, ...props }) => (
		<table
			className="w-full table-fixed caption-bottom text-sm"
			style={style}
			{...props}
		/>
	),
	TableHead: (props) => (
		<thead className="border-b border-border" {...props} />
	),
	TableBody: (props) => <tbody {...props} />,
	TableRow: ({ style, ...props }) => (
		<tr
			className="border-b border-border transition-colors hover:bg-accent/5"
			style={{ height: ROW_HEIGHT, ...style }}
			{...props}
		/>
	),
};

interface InstallResult {
	agentId: string;
	displayName: string;
	status: "pending" | "success" | "error";
	error?: string;
}

export default function SkillsShPage() {
	const { t, i18n } = useTranslation();
	const { baseUrl } = useServer();
	const api = createApi(baseUrl);
	const queryClient = useQueryClient();
	const { availableAgents } = useAgentAvailability();

	const compactFormatter = useMemo(
		() =>
			new Intl.NumberFormat(i18n.language, {
				notation: "compact",
				compactDisplay: "short",
			}),
		[i18n.language],
	);

	const [searchQuery, setSearchQuery] = useState("");
	const [urlQuery, setUrlQuery] = useQueryState("q");
	const [visibleCount, setVisibleCount] = useState(BATCH_SIZE);

	const [installModalOpen, setInstallModalOpen] = useState(false);
	const [selectedSkill, setSelectedSkill] = useState<MarketSkill | null>(
		null,
	);
	const [selectedAgents, setSelectedAgents] = useState<Set<string>>(
		() => new Set(),
	);
	const [installResults, setInstallResults] = useState<InstallResult[]>([]);
	const [isInstalling, setIsInstalling] = useState(false);

	const skillAgents = availableAgents.filter(
		(a) => a.isUsable && a.capabilities.skills_mutable,
	);

	const submittedQuery = urlQuery ?? "";
	const { data, isFetching, isFetchingNextPage, hasNextPage, fetchNextPage } =
		useInfiniteQuery({
			queryKey: ["market", "search", submittedQuery],
			queryFn: async ({ pageParam }: { pageParam: number }) => {
				const offset = pageParam;
				const limit = Math.min(FETCH_SIZE, MAX_TOTAL - offset);
				const actualLimit = offset + limit;
				const results = await api.market.search(
					submittedQuery,
					actualLimit,
				);
				return results.slice(offset, actualLimit);
			},
			initialPageParam: 0,
			getNextPageParam: (
				lastPage: MarketSkill[],
				allPages: MarketSkill[][],
			) => {
				const totalFetched = allPages.reduce(
					(sum, page) => sum + page.length,
					0,
				);
				if (lastPage.length < FETCH_SIZE || totalFetched >= MAX_TOTAL) {
					return undefined;
				}
				return totalFetched;
			},
			enabled: submittedQuery.length >= 2,
			staleTime: 60_000,
		});

	const searchResults = useMemo(() => data?.pages.flat() ?? [], [data]);

	const displayedResults = useMemo(
		() => searchResults.slice(0, visibleCount),
		[searchResults, visibleCount],
	);

	const hasMore = visibleCount < searchResults.length;

	const handleEndReached = useCallback(() => {
		if (hasMore && !isFetching) {
			setVisibleCount((c) =>
				Math.min(c + BATCH_SIZE, searchResults.length),
			);
			const remaining = searchResults.length - visibleCount;
			if (remaining < FETCH_SIZE && hasNextPage && !isFetchingNextPage) {
				fetchNextPage();
			}
		}
	}, [
		hasMore,
		isFetching,
		searchResults.length,
		visibleCount,
		hasNextPage,
		isFetchingNextPage,
		fetchNextPage,
	]);

	const handleSearch = () => {
		if (searchQuery.trim().length >= 2) {
			setUrlQuery(searchQuery.trim());
			setVisibleCount(BATCH_SIZE);
		}
	};

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Enter") {
			handleSearch();
		}
	};

	const handleInstallClick = (skill: MarketSkill) => {
		setSelectedSkill(skill);
		setSelectedAgents(new Set());
		setInstallResults([]);
		setInstallModalOpen(true);
	};

	const handleInstall = async () => {
		if (!selectedSkill || selectedAgents.size === 0) return;

		setIsInstalling(true);

		const pendingResults: InstallResult[] = Array.from(
			selectedAgents,
			(agentId) => {
				const agent = availableAgents.find((a) => a.id === agentId);
				return {
					agentId,
					displayName: agent?.display_name ?? agentId,
					status: "pending" as const,
				};
			},
		);
		setInstallResults(pendingResults);

		const skillsCliNames = Array.from(selectedAgents, (id) => {
			const agent = availableAgents.find((a) => a.id === id);
			return agent?.skills_cli_name;
		}).filter((name): name is string => !!name);

		try {
			const response = await api.skills.install({
				source: selectedSkill.source,
				agents: skillsCliNames,
				scope: "global",
			});

			const updatedResults = pendingResults.map((result) => ({
				...result,
				status: (response.success ? "success" : "error") as
					| "success"
					| "error",
				error: response.success ? undefined : response.stderr,
			}));

			setInstallResults(updatedResults);
		} catch (err) {
			const updatedResults = pendingResults.map((result) => ({
				...result,
				status: "error" as const,
				error: err instanceof Error ? err.message : String(err),
			}));
			setInstallResults(updatedResults);
		}

		setIsInstalling(false);
		queryClient.invalidateQueries({ queryKey: ["skills"] });
	};

	const handleCloseInstallModal = () => {
		setInstallModalOpen(false);
		setSelectedSkill(null);
		setSelectedAgents(new Set());
		setInstallResults([]);
	};

	return (
		<div className="h-full flex flex-col p-6 overflow-hidden">
			{submittedQuery.length >= 2 ? (
				<>
					<div className="shrink-0 pb-4">
						<div className="flex items-center gap-6">
							<div className="flex items-center gap-2">
								<Tooltip delay={0}>
									<Tooltip.Trigger>
										<span className="text-muted hover:text-foreground cursor-default">
											<svg
												height="18"
												viewBox="0 0 16 16"
												width="18"
												className="text-current"
											>
												<path
													fillRule="evenodd"
													clipRule="evenodd"
													d="M8 1L16 15H0L8 1Z"
													fill="currentColor"
												/>
											</svg>
										</span>
									</Tooltip.Trigger>
									<Tooltip.Content>
										{t("poweredByVercel")}
									</Tooltip.Content>
								</Tooltip>
								<span className="text-muted">
									<svg
										height="16"
										viewBox="0 0 16 16"
										width="16"
										className="text-current"
									>
										<path
											fillRule="evenodd"
											clipRule="evenodd"
											d="M4.01526 15.3939L4.3107 14.7046L10.3107 0.704556L10.6061 0.0151978L11.9849 0.606077L11.6894 1.29544L5.68942 15.2954L5.39398 15.9848L4.01526 15.3939Z"
											fill="currentColor"
										/>
									</svg>
								</span>
								<Tooltip delay={0}>
									<Tooltip.Trigger>
										<span className="font-medium tracking-tight text-lg cursor-default">
											Skills
										</span>
									</Tooltip.Trigger>
									<Tooltip.Content>
										{t("dataFromSkillsSh")}
									</Tooltip.Content>
								</Tooltip>
							</div>
							<div className="flex items-center gap-2">
								<SearchField
									value={searchQuery}
									onChange={setSearchQuery}
									onKeyDown={handleKeyDown}
									aria-label={t("searchMarketSkills")}
									className="w-[400px]"
								>
									<SearchField.Group>
										<SearchField.SearchIcon />
										<SearchField.Input
											placeholder={t(
												"searchMarketSkillsPlaceholder",
											)}
										/>
										<SearchField.ClearButton />
									</SearchField.Group>
								</SearchField>
								<Button
									onPress={handleSearch}
									isDisabled={searchQuery.trim().length < 2}
								>
									{t("search")}
								</Button>
							</div>
						</div>
					</div>

					{isFetching && searchResults.length === 0 ? (
						<div className="flex items-center justify-center py-12">
							<Spinner size="lg" />
						</div>
					) : searchResults.length === 0 ? (
						<div className="flex flex-1 items-center justify-center">
							<Empty className="border-0">
								<EmptyHeader>
									<EmptyMedia>
										<MagnifyingGlassIcon className="size-8 text-muted" />
									</EmptyMedia>
									<EmptyTitle className="text-sm font-normal text-muted">
										{t("noResults")}
									</EmptyTitle>
								</EmptyHeader>
							</Empty>
						</div>
					) : (
						<div className="flex-1 min-h-0 overflow-hidden">
							<TableVirtuoso
								data={displayedResults}
								endReached={handleEndReached}
								fixedItemHeight={ROW_HEIGHT}
								style={{ height: "100%" }}
								components={tableComponents}
								itemContent={(_index, skill) => (
									<>
										<td className="p-2 align-middle">
											<span className="font-medium">
												{skill.name}
											</span>
										</td>
										<td className="p-2 align-middle">
											<span className="text-muted">
												{compactFormatter.format(
													skill.installs,
												)}
											</span>
										</td>
										<td className="p-2 align-middle">
											<span className="text-muted text-sm">
												{skill.source}
											</span>
										</td>
										<td className="p-2 align-middle">
											<Button
												size="sm"
												variant="secondary"
												onPress={() =>
													handleInstallClick(skill)
												}
											>
												{t("install")}
											</Button>
										</td>
									</>
								)}
							>
								<thead>
									<tr>
										<th className="h-12 px-2 text-left align-middle font-medium w-[35%]">
											{t("name")}
										</th>
										<th className="h-12 px-2 text-left align-middle font-medium w-[15%]">
											{t("installs")}
										</th>
										<th className="h-12 px-2 text-left align-middle font-medium w-[35%]">
											{t("source")}
										</th>
										<th className="h-12 px-2 px-4 align-middle w-[15%]" />
									</tr>
								</thead>
								<tfoot>
									{isFetchingNextPage && (
										<tr>
											<td
												colSpan={4}
												className="py-3 text-center"
											>
												<Spinner size="sm" />
											</td>
										</tr>
									)}
								</tfoot>
							</TableVirtuoso>
						</div>
					)}
				</>
			) : (
				<div className="flex flex-col items-center pt-[20vh]">
					<div className="flex items-center gap-2 mb-4">
						<Tooltip delay={0}>
							<Tooltip.Trigger>
								<span className="text-muted hover:text-foreground cursor-default">
									<svg
										height="18"
										viewBox="0 0 16 16"
										width="18"
										className="text-current"
									>
										<path
											fillRule="evenodd"
											clipRule="evenodd"
											d="M8 1L16 15H0L8 1Z"
											fill="currentColor"
										/>
									</svg>
								</span>
							</Tooltip.Trigger>
							<Tooltip.Content>
								{t("poweredByVercel")}
							</Tooltip.Content>
						</Tooltip>
						<span className="text-muted">
							<svg
								height="16"
								viewBox="0 0 16 16"
								width="16"
								className="text-current"
							>
								<path
									fillRule="evenodd"
									clipRule="evenodd"
									d="M4.01526 15.3939L4.3107 14.7046L10.3107 0.704556L10.6061 0.0151978L11.9849 0.606077L11.6894 1.29544L5.68942 15.2954L5.39398 15.9848L4.01526 15.3939Z"
									fill="currentColor"
								/>
							</svg>
						</span>
						<Tooltip delay={0}>
							<Tooltip.Trigger>
								<span className="font-medium tracking-tight text-lg cursor-default">
									Skills
								</span>
							</Tooltip.Trigger>
							<Tooltip.Content>
								{t("dataFromSkillsSh")}
							</Tooltip.Content>
						</Tooltip>
					</div>
					<div className="flex items-center gap-2">
						<SearchField
							value={searchQuery}
							onChange={setSearchQuery}
							onKeyDown={handleKeyDown}
							aria-label={t("searchMarketSkills")}
							className="w-[400px]"
						>
							<SearchField.Group>
								<SearchField.SearchIcon />
								<SearchField.Input
									placeholder={t(
										"searchMarketSkillsPlaceholder",
									)}
								/>
								<SearchField.ClearButton />
							</SearchField.Group>
						</SearchField>
						<Button
							onPress={handleSearch}
							isDisabled={searchQuery.trim().length < 2}
						>
							{t("search")}
						</Button>
					</div>
				</div>
			)}

			<Modal.Backdrop
				isOpen={installModalOpen}
				onOpenChange={handleCloseInstallModal}
			>
				<Modal.Container>
					<Modal.Dialog className="max-w-md">
						<Modal.CloseTrigger />
						<Modal.Header>
							<Modal.Heading>{t("installSkill")}</Modal.Heading>
						</Modal.Header>

						<Modal.Body className="p-2">
							{selectedSkill && (
								<SkillInfoCard
									name={selectedSkill.name}
									source={selectedSkill.source}
									className="mb-4"
								/>
							)}

							{installResults.length === 0 && (
								<div className="space-y-4">
									<p className="text-sm text-muted">
										{t("selectAgentsForSkill")}
									</p>
									<AgentSelector
										agents={skillAgents}
										selectedKeys={selectedAgents}
										onSelectionChange={setSelectedAgents}
										emptyMessage={t("noTargetAgents")}
										showSelectedIcon
										variant="secondary"
									/>
								</div>
							)}

							{installResults.length > 0 && (
								<div className="space-y-3">
									{isInstalling && (
										<div className="flex items-center justify-center py-4">
											<Spinner size="lg" />
										</div>
									)}
									{installResults.map((result) => (
										<ResultStatusItem
											key={result.agentId}
											displayName={result.displayName}
											status={result.status}
											statusText={
												result.status === "pending"
													? t("installing")
													: result.status ===
															"success"
														? t("installSuccess")
														: ""
											}
											error={result.error}
										/>
									))}
								</div>
							)}
						</Modal.Body>

						<Modal.Footer>
							{installResults.length === 0 && (
								<>
									<Button slot="close" variant="secondary">
										{t("cancel")}
									</Button>
									<Button
										onPress={handleInstall}
										isDisabled={selectedAgents.size === 0}
									>
										{t("install")}
									</Button>
								</>
							)}
							{installResults.length > 0 && (
								<Button slot="close" variant="secondary">
									{t("done")}
								</Button>
							)}
						</Modal.Footer>
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</div>
	);
}
