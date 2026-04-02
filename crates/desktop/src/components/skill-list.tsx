import {
	BookOpenIcon,
	ChevronDownIcon,
	ChevronRightIcon,
	StarIcon as StarIconSolid,
} from "@heroicons/react/24/solid";
import { Chip, Label, ListBox, Spinner, Tooltip } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import Fuse from "fuse.js";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SkillResponse } from "../generated/dto";
import { useAgentAvailability } from "../hooks/use-agent-availability";
import { useApi } from "../hooks/use-api";
import { useFavorites } from "../hooks/use-favorites";
import { AgentIcon } from "../lib/agent-icons";
import { sortAgents } from "../lib/utils";
import {
	globalSkillLockQueryOptions,
	projectSkillLockQueryOptions,
} from "../requests/skills";

function formatAgentName(agent: string): string {
	return agent.charAt(0).toUpperCase() + agent.slice(1).toLowerCase();
}

function SkillAgentIcons({ items }: { items: SkillResponse[] }) {
	const { allAgents } = useAgentAvailability();
	const agents = useMemo(() => {
		const set = new Set<string>();
		for (const item of items) {
			if (item.agent) set.add(item.agent);
		}
		return sortAgents(Array.from(set), allAgents);
	}, [items, allAgents]);

	if (agents.length === 0) {
		return null;
	}

	return (
		<div className="flex shrink-0 items-center -space-x-1">
			{agents.slice(0, 3).map((agentId, idx) => (
				<Tooltip key={agentId} delay={0}>
					<div
						className="relative rounded-full bg-surface ring-1 ring-surface transition-transform hover:scale-110"
						style={{ zIndex: 3 - idx }}
					>
						<AgentIcon
							id={agentId}
							name={formatAgentName(agentId)}
							size="xs"
							variant="ghost"
						/>
					</div>
					<Tooltip.Content>
						{formatAgentName(agentId)}
					</Tooltip.Content>
				</Tooltip>
			))}
			{agents.length > 3 && (
				<div className="relative z-0 flex size-5 items-center justify-center rounded-lg bg-default text-[10px] font-medium text-muted ring-1 ring-surface">
					+{agents.length - 3}
				</div>
			)}
		</div>
	);
}

interface SkillGroup {
	name: string;
	items: SkillResponse[];
	description: string;
}

interface SourceGroup {
	source: string;
	sourceType: string;
	skills: SkillGroup[];
}

interface SkillListProps {
	skills: SkillResponse[];
	selectedKeys: Set<string>;
	searchQuery: string;
	onSelectionChange: (keys: Set<string>, clickedKey?: string) => void;
	emptyMessage?: string;
	groupBySource?: boolean;
	projectPath?: string;
	selectionMode?: "none" | "single" | "multiple";
	isMultiSelectMode?: boolean;
}

export function SkillList({
	skills,
	selectedKeys,
	searchQuery,
	onSelectionChange,
	emptyMessage,
	groupBySource = false,
	projectPath,
	selectionMode = "single",
	isMultiSelectMode = false,
}: SkillListProps) {
	const { t } = useTranslation();
	const api = useApi();
	const effectiveScope = groupBySource
		? projectPath
			? "project"
			: "global"
		: null;

	const { data: globalLock, isLoading: isLoadingGlobalLock } = useQuery({
		...globalSkillLockQueryOptions({
			api,
			enabled: effectiveScope === "global",
		}),
	});

	const { data: projectLock, isLoading: isLoadingProjectLock } = useQuery({
		...projectSkillLockQueryOptions({
			api,
			projectPath,
			enabled: effectiveScope === "project" && Boolean(projectPath),
		}),
	});

	const isGroupingLoading =
		groupBySource &&
		((effectiveScope === "global" && isLoadingGlobalLock) ||
			(effectiveScope === "project" && isLoadingProjectLock));

	const groupedByName = useMemo(() => {
		const map = new Map<string, SkillResponse[]>();
		for (const skill of skills) {
			const existing = map.get(skill.name) ?? [];
			map.set(skill.name, [...existing, skill]);
		}
		return Array.from(map.entries()).map(([name, items]) => ({
			name,
			items,
			description: items.find((s) => s.description)?.description ?? "",
		}));
	}, [skills]);

	const fuse = useMemo(
		() =>
			new Fuse(groupedByName, {
				keys: [
					{ name: "name", weight: 2 },
					{ name: "description", weight: 1 },
				],
				threshold: 0.4,
				includeScore: true,
			}),
		[groupedByName],
	);

	const { isSkillStarred } = useFavorites();

	const filteredByName = useMemo(() => {
		let items;
		if (!searchQuery) items = groupedByName;
		else items = fuse.search(searchQuery).map((result) => result.item);

		return [...items].sort((a, b) => {
			const aStarred = isSkillStarred(a.name);
			const bStarred = isSkillStarred(b.name);
			if (aStarred && !bStarred) return -1;
			if (!aStarred && bStarred) return 1;
			return 0;
		});
	}, [fuse, groupedByName, searchQuery, isSkillStarred]);

	const { sourceGroups, singleItemGroups, unknownGroups } = useMemo(() => {
		const findSkillSource = (
			skillName: string,
		): { source: string; sourceType: string } | null => {
			const relevantEntries =
				effectiveScope === "project"
					? projectLock?.skills
					: globalLock?.skills;
			const entry = relevantEntries?.find((s) => s.name === skillName);
			if (entry) {
				return {
					source: entry.source,
					sourceType: entry.sourceType,
				};
			}
			return null;
		};

		if (!groupBySource) {
			return {
				sourceGroups: [],
				singleItemGroups: [],
				unknownGroups: filteredByName,
			};
		}

		const groups = new Map<string, SourceGroup>();
		const singleItems: (SkillGroup & {
			source: string;
			sourceType: string;
		})[] = [];
		const unknown: SkillGroup[] = [];

		for (const group of filteredByName) {
			const sourceInfo = findSkillSource(group.name);
			if (sourceInfo) {
				const existing = groups.get(sourceInfo.source);
				if (existing) {
					existing.skills.push(group);
				} else {
					groups.set(sourceInfo.source, {
						source: sourceInfo.source,
						sourceType: sourceInfo.sourceType,
						skills: [group],
					});
				}
			} else {
				unknown.push(group);
			}
		}

		const multiItemGroups: SourceGroup[] = [];
		for (const sg of groups.values()) {
			if (sg.skills.length === 1) {
				singleItems.push({
					...sg.skills[0],
					source: sg.source,
					sourceType: sg.sourceType,
				});
			} else {
				multiItemGroups.push(sg);
			}
		}

		const sortedSourceGroups = multiItemGroups
			.map((sg) => ({
				...sg,
				skills: [...sg.skills].sort((a, b) => {
					const aStarred = isSkillStarred(a.name);
					const bStarred = isSkillStarred(b.name);
					if (aStarred && !bStarred) return -1;
					if (!aStarred && bStarred) return 1;
					return a.name.localeCompare(b.name);
				}),
			}))
			.sort((a, b) => a.source.localeCompare(b.source));

		const sortedSingleItems = singleItems.sort((a, b) => {
			const aStarred = isSkillStarred(a.name);
			const bStarred = isSkillStarred(b.name);
			if (aStarred && !bStarred) return -1;
			if (!aStarred && bStarred) return 1;
			return a.name.localeCompare(b.name);
		});

		const sortedUnknown = unknown.sort((a, b) => {
			const aStarred = isSkillStarred(a.name);
			const bStarred = isSkillStarred(b.name);
			if (aStarred && !bStarred) return -1;
			if (!aStarred && bStarred) return 1;
			return a.name.localeCompare(b.name);
		});

		return {
			sourceGroups: sortedSourceGroups,
			singleItemGroups: sortedSingleItems,
			unknownGroups: sortedUnknown,
		};
	}, [
		filteredByName,
		groupBySource,
		globalLock,
		effectiveScope,
		projectLock,
		isSkillStarred,
	]);

	const [expandedSources, setExpandedSources] = useState<Set<string>>(() => {
		if (sourceGroups.length <= 5) {
			return new Set(sourceGroups.map((sg) => sg.source));
		}
		return new Set();
	});

	const toggleSource = (source: string) => {
		setExpandedSources((prev) => {
			const next = new Set(prev);
			if (next.has(source)) {
				next.delete(source);
			} else {
				next.add(source);
			}
			return next;
		});
	};

	const modifiersRef = useRef({
		shift: false,
		meta: false,
	});
	const lastClickedRef = useRef<string | null>(null);

	useEffect(() => {
		const handler = (e: PointerEvent) => {
			modifiersRef.current = {
				shift: e.shiftKey,
				meta: e.metaKey || e.ctrlKey,
			};
		};
		window.addEventListener("pointerdown", handler, true);
		return () => window.removeEventListener("pointerdown", handler, true);
	}, []);

	const createSelectionHandler =
		(orderedKeys: string[]) => (keys: "all" | Set<React.Key>) => {
			if (keys === "all") return;
			const newKeys = new Set(Array.from(keys).map(String));
			const added = [...newKeys].find((k) => !selectedKeys.has(k));
			const removed = [...selectedKeys].find((k) => !newKeys.has(k));
			const clicked = added ?? removed;

			if (!clicked) {
				onSelectionChange(newKeys);
				return;
			}

			let finalKeys: Set<string>;

			if (modifiersRef.current.shift && lastClickedRef.current) {
				const start = orderedKeys.indexOf(lastClickedRef.current);
				const end = orderedKeys.indexOf(clicked);
				if (start !== -1 && end !== -1) {
					const [from, to] = [
						Math.min(start, end),
						Math.max(start, end),
					];
					finalKeys = new Set(orderedKeys.slice(from, to + 1));
				} else {
					finalKeys = new Set([...selectedKeys, clicked]);
				}
			} else if (!isMultiSelectMode && !modifiersRef.current.meta) {
				finalKeys = new Set([clicked]);
			} else {
				finalKeys = new Set(selectedKeys);
				if (finalKeys.has(clicked)) {
					finalKeys.delete(clicked);
				} else {
					finalKeys.add(clicked);
				}
			}

			if (!modifiersRef.current.shift) {
				lastClickedRef.current = clicked;
			}

			onSelectionChange(finalKeys, clicked);
		};

	// Helper to render a skill item
	const renderSkillItem = (skillGroup: SkillGroup) => (
		<ListBox.Item
			key={skillGroup.name}
			id={skillGroup.name}
			textValue={skillGroup.name}
			className="data-selected:bg-surface"
		>
			<div className="flex w-full items-center gap-2">
				<div className="relative inline-flex size-4 shrink-0 items-center justify-center">
					<BookOpenIcon className="size-4 text-muted" />
					{isSkillStarred(skillGroup.name) && (
						<StarIconSolid className="absolute -bottom-1 -left-1 size-2.5 text-warning" />
					)}
				</div>
				<Label className="flex-1 truncate">{skillGroup.name}</Label>
				<SkillAgentIcons items={skillGroup.items} />
			</div>
		</ListBox.Item>
	);

	if (groupBySource) {
		if (isGroupingLoading) {
			return (
				<div className="flex flex-1 items-center justify-center overflow-y-auto">
					<Spinner size="lg" />
				</div>
			);
		}

		const hasItems =
			sourceGroups.length > 0 ||
			singleItemGroups.length > 0 ||
			unknownGroups.length > 0;
		if (!hasItems) {
			return (
				<p className="px-3 py-6 text-center text-sm text-muted">
					{emptyMessage ?? t("noSkillsMatch")}
				</p>
			);
		}

		return (
			<div className="flex-1 overflow-y-auto">
				{sourceGroups.map((sg) => (
					<div key={sg.source} className="border-y border-separator">
						<button
							type="button"
							onClick={() => toggleSource(sg.source)}
							className="
         flex w-full items-center gap-2 px-3 py-2 text-left transition-colors
         hover:bg-surface-secondary
       "
						>
							{expandedSources.has(sg.source) ? (
								<ChevronDownIcon className="size-4 shrink-0 text-muted" />
							) : (
								<ChevronRightIcon className="size-4 shrink-0 text-muted" />
							)}
							<div className="min-w-0 flex-1">
								<p className="truncate text-sm font-medium text-foreground">
									{sg.source}
								</p>
							</div>
							<Chip size="sm" variant="secondary">
								{sg.skills.length}
							</Chip>
						</button>

						{expandedSources.has(sg.source) && (
							<ListBox
								aria-label={`Skills from ${sg.source}`}
								selectionMode={selectionMode}
								selectionBehavior="toggle"
								selectedKeys={selectedKeys}
								onSelectionChange={createSelectionHandler(
									sg.skills.map((s) => s.name),
								)}
								className="p-2 pl-6"
							>
								{sg.skills.map(renderSkillItem)}
							</ListBox>
						)}
					</div>
				))}

				{(singleItemGroups.length > 0 || unknownGroups.length > 0) && (
					<ListBox
						aria-label="Ungrouped skills"
						selectionMode={selectionMode}
						selectionBehavior="toggle"
						selectedKeys={selectedKeys}
						onSelectionChange={createSelectionHandler(
							[...singleItemGroups, ...unknownGroups].map(
								(s) => s.name,
							),
						)}
						className="p-2"
					>
						{[...singleItemGroups, ...unknownGroups].map(
							renderSkillItem,
						)}
					</ListBox>
				)}
			</div>
		);
	}

	if (filteredByName.length === 0) {
		return (
			<p className="px-3 py-6 text-center text-sm text-muted">
				{emptyMessage ?? t("noSkillsMatch")}
			</p>
		);
	}

	return (
		<div className="flex-1 overflow-y-auto">
			<ListBox
				aria-label="Skills"
				selectionMode={selectionMode}
				selectionBehavior="toggle"
				selectedKeys={selectedKeys}
				onSelectionChange={createSelectionHandler(
					filteredByName.map((s) => s.name),
				)}
				className="p-2"
			>
				{filteredByName.map(renderSkillItem)}
			</ListBox>
		</div>
	);
}
