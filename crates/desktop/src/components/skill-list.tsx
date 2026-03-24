import {
	BookOpenIcon,
	ChevronDownIcon,
	ChevronRightIcon,
} from "@heroicons/react/24/solid";
import { Chip, Label, ListBox } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import Fuse from "fuse.js";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { createApi } from "../lib/api";
import type {
	GlobalSkillLockResponse,
	ProjectSkillLockResponse,
	SkillResponse,
} from "../lib/api-types";
import { useServer } from "../hooks/use-server";

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
	selectedKey: string | null;
	searchQuery: string;
	onSelect: (key: string) => void;
	emptyMessage?: string;
	groupBySource?: boolean;
	projectPath?: string;
}


export function SkillList({
	skills,
	selectedKey,
	searchQuery,
	onSelect,
	emptyMessage,
	groupBySource = false,
	projectPath,
}: SkillListProps) {
	const { t } = useTranslation();
	const { baseUrl } = useServer();
	const api = createApi(baseUrl);

	const { data: globalLock } = useQuery<GlobalSkillLockResponse>({
		queryKey: ["skill-locks", "global"],
		queryFn: () => api.skills.getGlobalLock(),
		staleTime: 30_000,
		enabled: groupBySource,
	});

	const { data: projectLock } = useQuery<ProjectSkillLockResponse>({
		queryKey: ["skill-locks", "project", projectPath],
		queryFn: () => api.skills.getProjectLock(projectPath),
		staleTime: 30_000,
		enabled: groupBySource,
	});

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

	const filteredByName = useMemo(() => {
		if (!searchQuery) return groupedByName;
		return fuse.search(searchQuery).map((result) => result.item);
	}, [fuse, groupedByName, searchQuery]);

	const { sourceGroups, singleItemGroups, unknownGroups } = useMemo(() => {
		const findSkillSource = (
			skillName: string,
		): { source: string; sourceType: string } | null => {
			const globalEntry = globalLock?.skills.find(
				(s) => s.name === skillName,
			);
			if (globalEntry) {
				return {
					source: globalEntry.source,
					sourceType: globalEntry.sourceType,
				};
			}
			const projectEntry = projectLock?.skills.find(
				(s) => s.name === skillName,
			);
			if (projectEntry) {
				return {
					source: projectEntry.source,
					sourceType: projectEntry.sourceType,
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

		const sortedSourceGroups = multiItemGroups.sort((a, b) =>
			a.source.localeCompare(b.source),
		);
		const sortedSingleItems = singleItems.sort((a, b) =>
			a.name.localeCompare(b.name),
		);
		return {
			sourceGroups: sortedSourceGroups,
			singleItemGroups: sortedSingleItems,
			unknownGroups: unknown,
		};
	}, [filteredByName, groupBySource, globalLock, projectLock]);

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

	if (groupBySource) {
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
					<div key={sg.source}>
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
								selectionMode="single"
								selectedKeys={
									selectedKey ? new Set([selectedKey]) : new Set()
								}
								onSelectionChange={(keys) => {
									if (keys === "all") return;
									const key = [...keys][0] as string;
									if (key) onSelect(key);
								}}
								className="p-2"
							>
								{sg.skills.map((skillGroup) => (
									<ListBox.Item
										key={skillGroup.name}
										id={skillGroup.name}
										textValue={skillGroup.name}
										className="data-selected:bg-surface"
									>
										<div className="flex w-full items-center gap-2">
											<BookOpenIcon className="size-3.5 shrink-0 text-muted" />
											<Label className="flex-1 truncate">
												{skillGroup.name}
											</Label>
										</div>
									</ListBox.Item>
								))}
							</ListBox>
						)}
					</div>
				))}

				{(singleItemGroups.length > 0 || unknownGroups.length > 0) && (
					<ListBox
						aria-label="Ungrouped skills"
						selectionMode="single"
						selectedKeys={selectedKey ? new Set([selectedKey]) : new Set()}
						onSelectionChange={(keys) => {
							if (keys === "all") return;
							const key = [...keys][0] as string;
							if (key) onSelect(key);
						}}
						className="p-2"
					>
						{[...singleItemGroups, ...unknownGroups].map((group) => (
							<ListBox.Item
								key={group.name}
								id={group.name}
								textValue={group.name}
								className="data-selected:bg-surface"
							>
								<div className="flex w-full items-center gap-2">
									<BookOpenIcon className="size-3.5 shrink-0 text-muted" />
									<Label className="flex-1 truncate">{group.name}</Label>
								</div>
							</ListBox.Item>
						))}
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
		<ListBox
			aria-label="Skills"
			selectionMode="single"
			selectedKeys={selectedKey ? new Set([selectedKey]) : new Set()}
			onSelectionChange={(keys) => {
				if (keys === "all") return;
				const key = [...keys][0] as string;
				if (key) onSelect(key);
			}}
			className="p-2"
		>
			{filteredByName.map((group) => (
				<ListBox.Item
					key={group.name}
					id={group.name}
					textValue={group.name}
					className="data-selected:bg-surface"
				>
					<div className="flex w-full items-center gap-2">
						<BookOpenIcon className="size-4 shrink-0 text-muted" />
						<Label className="flex-1 truncate">{group.name}</Label>
					</div>
				</ListBox.Item>
			))}
		</ListBox>
	);
}
