import { ArrowTopRightOnSquareIcon } from "@heroicons/react/24/outline";
import { ArrowRightIcon } from "@heroicons/react/24/solid";
import { SearchField, Spinner } from "@heroui/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import type { AvailableAgent } from "../contexts/agent-availability";
import { useAgentAvailability } from "../hooks/use-agent-availability";
import { type SearchMatch, useGlobalSearch } from "../hooks/use-global-search";
import { AgentIcon } from "../lib/agent-icons";
import { cn } from "../lib/utils";

const PER_GROUP_LIMIT = 4;
const LIBRARY_LIMIT = 5;

export function GlobalSearch() {
	const { t } = useTranslation();
	const [, setLocation] = useLocation();
	const { availableAgents } = useAgentAvailability();
	const [query, setQuery] = useState("");
	const [isOpen, setIsOpen] = useState(false);
	const [activeIndex, setActiveIndex] = useState(-1);
	const containerRef = useRef<HTMLDivElement>(null);

	const { groups, isMarketFetching } = useGlobalSearch({
		query,
		perGroupLimit: PER_GROUP_LIMIT,
		libraryLimit: LIBRARY_LIMIT,
	});

	const trimmed = query.trim();

	const flatMatches = useMemo(() => groups.flatMap((g) => g.items), [groups]);

	useEffect(() => {
		if (!isOpen) return;
		const handleClick = (event: MouseEvent) => {
			if (
				containerRef.current &&
				!containerRef.current.contains(event.target as Node)
			) {
				setIsOpen(false);
			}
		};
		document.addEventListener("mousedown", handleClick);
		return () => document.removeEventListener("mousedown", handleClick);
	}, [isOpen]);

	const agentLookup = useMemo(() => {
		const map = new Map<string, AvailableAgent>();
		for (const agent of availableAgents) {
			map.set(agent.id, agent);
		}
		return map;
	}, [availableAgents]);

	const handleSelect = (match: SearchMatch) => {
		setIsOpen(false);
		setQuery("");
		setLocation(match.href);
	};

	const openSearchPage = () => {
		if (!trimmed) return;
		setIsOpen(false);
		setQuery("");
		setLocation(`/search?q=${encodeURIComponent(trimmed)}`);
	};

	const showPopover = isOpen && trimmed.length > 0;

	return (
		<div ref={containerRef} className="relative">
			<SearchField
				value={query}
				onChange={(value) => {
					setQuery(value);
					setIsOpen(true);
					setActiveIndex(-1);
				}}
				aria-label={t("globalSearchLabel")}
				variant="secondary"
				className="w-full"
			>
				<SearchField.Group>
					<SearchField.SearchIcon />
					<SearchField.Input
						placeholder={t("globalSearchPlaceholder")}
						onFocus={() => {
							if (trimmed) setIsOpen(true);
						}}
						onKeyDown={(event) => {
							if (event.key === "Escape") {
								setIsOpen(false);
								return;
							}
							if (
								event.key === "ArrowDown" &&
								flatMatches.length > 0
							) {
								event.preventDefault();
								setActiveIndex((i) =>
									Math.min(i + 1, flatMatches.length - 1),
								);
								return;
							}
							if (
								event.key === "ArrowUp" &&
								flatMatches.length > 0
							) {
								event.preventDefault();
								setActiveIndex((i) => Math.max(i - 1, -1));
								return;
							}
							if (event.key === "Enter") {
								event.preventDefault();
								const match =
									activeIndex >= 0
										? flatMatches[activeIndex]
										: null;
								if (match) {
									handleSelect(match);
								} else {
									openSearchPage();
								}
							}
						}}
					/>
					<SearchField.ClearButton />
				</SearchField.Group>
			</SearchField>

			{showPopover && (
				<div
					role="listbox"
					aria-label={t("globalSearchLabel")}
					className="absolute left-0 right-0 top-full z-50 mt-1 max-h-[60vh] overflow-y-auto rounded-md border border-border bg-surface shadow-lg"
				>
					{flatMatches.length === 0 && !isMarketFetching ? (
						<>
							<p className="px-3 py-3 text-sm text-muted">
								{t("globalSearchNoResults")}
							</p>
						</>
					) : (
						groups.map((group) => (
							<div key={group.kind} className="py-1">
								<div className="flex items-center justify-between px-3 py-1">
									<span className="text-[11px] font-medium tracking-wider text-muted uppercase">
										{t(group.labelKey)}
									</span>
								</div>
								{group.items.map((match) => {
									const flatIdx = flatMatches.indexOf(match);
									const isActive = flatIdx === activeIndex;
									const owningAgent = match.agentId
										? agentLookup.get(match.agentId)
										: null;
									return (
										<button
											key={`${match.kind}:${match.id}`}
											type="button"
											role="option"
											aria-selected={isActive}
											onMouseEnter={() =>
												setActiveIndex(flatIdx)
											}
											onClick={() => handleSelect(match)}
											className={cn(
												"flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors",
												isActive
													? "bg-surface-secondary"
													: "hover:bg-surface-secondary",
											)}
										>
											{owningAgent ? (
												<AgentIcon
													id={owningAgent.id}
													name={
														owningAgent.display_name
													}
													size="xs"
													variant="ghost"
												/>
											) : match.kind === "library" ? (
												<ArrowTopRightOnSquareIcon className="size-4 shrink-0 text-muted" />
											) : (
												<span className="size-5 shrink-0" />
											)}
											<div className="min-w-0 flex-1">
												<div className="truncate font-medium">
													{match.name}
												</div>
												{match.subtitle && (
													<div className="truncate text-xs text-muted">
														{match.subtitle}
													</div>
												)}
											</div>
											{owningAgent && (
												<span className="shrink-0 text-[11px] text-muted">
													{owningAgent.display_name}
												</span>
											)}
										</button>
									);
								})}
							</div>
						))
					)}
					{isMarketFetching && (
						<div className="flex items-center gap-2 px-3 py-2 text-xs text-muted">
							<Spinner size="sm" />
							{t("globalSearchLibraryLoading")}
						</div>
					)}
					<button
						type="button"
						onClick={openSearchPage}
						className={cn(
							"flex w-full items-center justify-between gap-2 border-t border-border px-3 py-2 text-left text-xs transition-colors",
							"hover:bg-surface-secondary focus:bg-surface-secondary focus:outline-none",
						)}
					>
						<span>
							{t("globalSearchViewAll", { query: trimmed })}
						</span>
						<ArrowRightIcon className="size-3.5 text-muted" />
					</button>
				</div>
			)}
		</div>
	);
}
