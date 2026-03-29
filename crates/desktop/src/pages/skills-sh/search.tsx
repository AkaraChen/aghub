import { MagnifyingGlassIcon } from "@heroicons/react/24/solid";
import { Button, Spinner } from "@heroui/react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useQueryState } from "nuqs";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TableComponents } from "react-virtuoso";
import { TableVirtuoso } from "react-virtuoso";
import { useLocation } from "wouter";
import {
	Empty,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "../../components/ui/empty";
import { useServer } from "../../hooks/use-server";
import { createApi } from "../../lib/api";
import type { MarketSkill } from "../../lib/api-types";
import { InstallModal } from "./components/install-modal";
import { SkillsHeader } from "./components/skills-header";
import { useSkillInstall } from "./hooks/use-skill-install";

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
			className="border-b border-border"
			style={{ height: ROW_HEIGHT, ...style }}
			{...props}
		/>
	),
};

export default function SkillsSearchPage() {
	const { t, i18n } = useTranslation();
	const { baseUrl } = useServer();
	const api = createApi(baseUrl);
	const [, setLocation] = useLocation();

	const {
		installModalOpen,
		selectedSkill,
		selectedAgents,
		setSelectedAgents,
		installResults,
		isInstalling,
		skillAgents,
		installAll,
		setInstallAll,
		installToProject,
		setInstallToProject,
		canInstallToProject,
		selectedProjectId,
		setSelectedProjectId,
		projects,
		handleInstallClick,
		handleInstall,
		handleCloseInstallModal,
	} = useSkillInstall();

	const compactFormatter = useMemo(
		() =>
			new Intl.NumberFormat(i18n.language, {
				notation: "compact",
				compactDisplay: "short",
			}),
		[i18n.language],
	);

	const [urlQuery, setUrlQuery] = useQueryState("q");
	const [visibleCount, setVisibleCount] = useState(BATCH_SIZE);

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

	if (submittedQuery.length < 2) {
		setLocation("/skills-sh");
		return null;
	}

	return (
		<div className="h-full flex flex-col p-6 overflow-hidden">
			<div className="shrink-0 pb-4">
				<div className="flex items-center gap-6">
					<SearchHeader
						key={submittedQuery}
						size="compact"
						initialQuery={submittedQuery}
						onSearch={(query) => {
							setUrlQuery(query);
							setVisibleCount(BATCH_SIZE);
						}}
						showSearchButton={true}
					/>
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
										variant="tertiary"
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
								<th className="h-12 px-4 align-middle w-[15%]" />
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

			<InstallModal
				isOpen={installModalOpen}
				selectedSkill={selectedSkill}
				selectedAgents={selectedAgents}
				onSelectedAgentsChange={setSelectedAgents}
				installResults={installResults}
				isInstalling={isInstalling}
				skillAgents={skillAgents}
				installAll={installAll}
				onInstallAllChange={setInstallAll}
				installToProject={installToProject}
				canInstallToProject={canInstallToProject}
				onInstallToProjectChange={setInstallToProject}
				selectedProjectId={selectedProjectId}
				onSelectedProjectIdChange={setSelectedProjectId}
				projects={projects}
				onClose={handleCloseInstallModal}
				onInstall={handleInstall}
			/>
		</div>
	);
}

function SearchHeader({
	size,
	initialQuery,
	onSearch,
	showSearchButton,
}: {
	size: "large" | "compact";
	initialQuery: string;
	onSearch: (query: string) => void;
	showSearchButton: boolean;
}) {
	const [searchQuery, setSearchQuery] = useState(initialQuery);

	return (
		<SkillsHeader
			size={size}
			searchQuery={searchQuery}
			onSearchQueryChange={setSearchQuery}
			onSearch={() => {
				const query = searchQuery.trim();
				if (query.length >= 2) {
					onSearch(query);
				}
			}}
			showSearchButton={showSearchButton}
		/>
	);
}
