import { ArrowTopRightOnSquareIcon } from "@heroicons/react/24/outline";
import {
	ChevronDownIcon,
	MagnifyingGlassIcon,
} from "@heroicons/react/24/solid";
import { SearchField, Spinner } from "@heroui/react";
import { useQueryState } from "nuqs";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import type { AvailableAgent } from "../contexts/agent-availability";
import { useAgentAvailability } from "../hooks/use-agent-availability";
import {
	type SearchGroup,
	type SearchMatch,
	useGlobalSearch,
} from "../hooks/use-global-search";
import { AgentIcon } from "../lib/agent-icons";
import { cn } from "../lib/utils";

const PAGE_LIBRARY_LIMIT = 20;
const COLLAPSED_GROUP_LIMIT = 8;

function ResultRow({
	match,
	owningAgent,
	onSelect,
	isFirst,
}: {
	match: SearchMatch;
	owningAgent: AvailableAgent | null;
	onSelect: (match: SearchMatch) => void;
	isFirst: boolean;
}) {
	return (
		<li>
			<button
				type="button"
				onClick={() => onSelect(match)}
				className={cn(
					"flex w-full items-center gap-3 px-4 py-3 text-left transition-colors",
					"hover:bg-surface-secondary focus:bg-surface-secondary focus:outline-none",
					!isFirst && "border-t border-border",
				)}
			>
				{owningAgent ? (
					<AgentIcon
						id={owningAgent.id}
						name={owningAgent.display_name}
						size="sm"
						variant="ghost"
					/>
				) : match.kind === "library" ? (
					<div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-surface-secondary">
						<ArrowTopRightOnSquareIcon className="size-4 text-muted" />
					</div>
				) : (
					<span className="size-8 shrink-0" />
				)}
				<div className="min-w-0 flex-1">
					<div className="truncate font-medium">{match.name}</div>
					{match.subtitle && (
						<div className="line-clamp-1 text-xs text-muted">
							{match.subtitle}
						</div>
					)}
				</div>
				{owningAgent && (
					<span className="shrink-0 text-xs text-muted">
						{owningAgent.display_name}
					</span>
				)}
			</button>
		</li>
	);
}

function ResultGroupSection({
	group,
	agentLookup,
	onSelect,
}: {
	group: SearchGroup;
	agentLookup: Map<string, AvailableAgent>;
	onSelect: (match: SearchMatch) => void;
}) {
	const { t } = useTranslation();
	const [expanded, setExpanded] = useState(false);

	const totalCount = group.items.length;
	const overflow = totalCount > COLLAPSED_GROUP_LIMIT;
	const visibleItems =
		expanded || !overflow
			? group.items
			: group.items.slice(0, COLLAPSED_GROUP_LIMIT);
	const hiddenCount = totalCount - visibleItems.length;

	return (
		<section aria-label={t(group.labelKey)} className="flex flex-col gap-2">
			<div className="flex items-baseline justify-between">
				<h2 className="text-sm font-medium tracking-wider text-muted uppercase">
					{t(group.labelKey)}
				</h2>
				<span className="text-xs text-muted">{totalCount}</span>
			</div>
			<ul className="overflow-hidden rounded-md border border-border bg-surface">
				{visibleItems.map((match, idx) => {
					const owningAgent = match.agentId
						? (agentLookup.get(match.agentId) ?? null)
						: null;
					return (
						<ResultRow
							key={`${match.kind}:${match.id}`}
							match={match}
							owningAgent={owningAgent}
							onSelect={onSelect}
							isFirst={idx === 0}
						/>
					);
				})}
				{overflow && (
					<li className="border-t border-border">
						<button
							type="button"
							onClick={() => setExpanded((value) => !value)}
							aria-expanded={expanded}
							className={cn(
								"flex w-full items-center justify-center gap-1.5 px-4 py-2.5 text-xs font-medium text-muted transition-colors",
								"hover:bg-surface-secondary hover:text-foreground focus:bg-surface-secondary focus:outline-none",
							)}
						>
							<ChevronDownIcon
								className={cn(
									"size-3.5 transition-transform",
									expanded && "rotate-180",
								)}
							/>
							{expanded
								? t("searchResultsShowLess")
								: t("searchResultsShowMore", {
										count: hiddenCount,
									})}
						</button>
					</li>
				)}
			</ul>
		</section>
	);
}

export default function SearchResultsPage() {
	const { t } = useTranslation();
	const [, setLocation] = useLocation();
	const { availableAgents } = useAgentAvailability();
	const [urlQuery, setUrlQuery] = useQueryState("q", { defaultValue: "" });
	const [draft, setDraft] = useState(urlQuery);
	const [lastSyncedQuery, setLastSyncedQuery] = useState(urlQuery);
	if (urlQuery !== lastSyncedQuery) {
		setLastSyncedQuery(urlQuery);
		setDraft(urlQuery);
	}

	const { groups, isMarketFetching } = useGlobalSearch({
		query: urlQuery,
		libraryLimit: PAGE_LIBRARY_LIMIT,
	});

	const totalCount = useMemo(
		() => groups.reduce((sum, g) => sum + g.items.length, 0),
		[groups],
	);

	const agentLookup = useMemo(() => {
		const map = new Map<string, AvailableAgent>();
		for (const agent of availableAgents) {
			map.set(agent.id, agent);
		}
		return map;
	}, [availableAgents]);

	const handleSelect = (match: SearchMatch) => {
		setLocation(match.href);
	};

	const trimmed = urlQuery.trim();

	return (
		<div className="h-full overflow-y-auto">
			<div className="mx-auto w-full max-w-4xl p-4 sm:p-6">
				<header className="mb-6 flex flex-col gap-3">
					<div className="flex items-center gap-2">
						<MagnifyingGlassIcon className="size-5 text-muted" />
						<h1 className="text-2xl font-semibold tracking-tight">
							{t("searchResultsTitle")}
						</h1>
					</div>
					<SearchField
						value={draft}
						onChange={setDraft}
						aria-label={t("globalSearchLabel")}
						variant="secondary"
						className="w-full"
					>
						<SearchField.Group>
							<SearchField.SearchIcon />
							<SearchField.Input
								placeholder={t("globalSearchPlaceholder")}
								autoFocus
								onKeyDown={(event) => {
									if (event.key === "Enter") {
										event.preventDefault();
										setUrlQuery(draft.trim() || null);
									}
								}}
							/>
							<SearchField.ClearButton />
						</SearchField.Group>
					</SearchField>
					{trimmed && (
						<p className="text-sm text-muted">
							{t("searchResultsSubtitle", {
								count: totalCount,
								query: trimmed,
							})}
						</p>
					)}
				</header>

				{!trimmed ? (
					<div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted">
						{t("searchResultsEmptyHint")}
					</div>
				) : groups.length === 0 && !isMarketFetching ? (
					<div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted">
						{t("globalSearchNoResults")}
					</div>
				) : (
					<div className="flex flex-col gap-6">
						{groups.map((group) => (
							<ResultGroupSection
								key={group.kind}
								group={group}
								agentLookup={agentLookup}
								onSelect={handleSelect}
							/>
						))}
						{isMarketFetching && (
							<div className="flex items-center gap-2 text-xs text-muted">
								<Spinner size="sm" />
								{t("globalSearchLibraryLoading")}
							</div>
						)}
					</div>
				)}
			</div>
		</div>
	);
}
