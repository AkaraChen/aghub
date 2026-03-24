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
import { useServer } from "../providers/server";

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
	const [expandedSources, setExpandedSources] = useState<Set<string>>(
		new Set(),
	);

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

	const findSkillSource = (
		skillName: string,
	): { source: string; sourceType: string } | null => {
		const globalEntry = globalLock?.skills.find((s) => s.name === skillName);
		if (globalEntry) {
			return { source: globalEntry.source, sourceType: globalEntry.sourceType };
		}
		const projectEntry = projectLock?.skills.find(
			(s) => s.name === skillName,
		);
		if (projectEntry) {
			return { source: projectEntry.source, sourceType: projectEntry.sourceType };
		}
		return null;
	};

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

	const { sourceGroups, unknownGroups } = useMemo(() => {
		if (!groupBySource) {
			return { sourceGroups: [], unknownGroups: filteredByName };
		}

		const groups = new Map<string, SourceGroup>();
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

		return {
			sourceGroups: Array.from(groups.values()).sort((a, b) => a.source.localeCompare(b.source)),
			unknownGroups: unknown,
		};
	}, [filteredByName, groupBySource, globalLock, projectLock]);

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
			sourceGroups.length > 0 || unknownGroups.length > 0;
		if (!hasItems) {
			return (
				<p className="px-3 py-6 text-sm text-muted text-center">
					{emptyMessage ?? t("noSkillsMatch")}
				</p>
			);
		}

		return (
			<div className="flex-1 overflow-y-auto">
				{sourceGroups.map((sg) => (
					<div key={sg.source} className="border-b border-border">
						<button
							type="button"
							onClick={() => toggleSource(sg.source)}
							className="flex items-center gap-2 w-full px-3 py-2.5 hover:bg-surface-secondary transition-colors text-left"
						>
							{expandedSources.has(sg.source) ? (
								<ChevronDownIcon className="size-4 text-muted shrink-0" />
							) : (
								<ChevronRightIcon className="size-4 text-muted shrink-0" />
							)}
							<div className="flex-1 min-w-0">
								<p className="text-sm font-medium text-foreground truncate">
									{sg.source}
								</p>
								<p className="text-xs text-muted">{sg.sourceType}</p>
							</div>
							<Chip size="sm" variant="secondary">
								{sg.skills.length}
							</Chip>
						</button>

						{expandedSources.has(sg.source) && (
							<div className="px-3 pb-2">
								{sg.skills.map((skillGroup) => (
									<button
										key={skillGroup.name}
										type="button"
										onClick={() => onSelect(skillGroup.name)}
										className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
											selectedKey === skillGroup.name
												? "bg-accent/10 text-foreground"
												: "text-muted hover:bg-surface-secondary"
										}`}
									>
										<span className="truncate block">
											{skillGroup.name}
										</span>
									</button>
								))}
							</div>
						)}
					</div>
				))}

				{unknownGroups.map((group) => (
					<button
						key={group.name}
						type="button"
						onClick={() => onSelect(group.name)}
						className={`flex items-center gap-2 w-full px-3 py-2.5 border-b border-border text-left transition-colors ${
							selectedKey === group.name
								? "bg-accent/10 text-foreground"
								: "text-muted hover:bg-surface-secondary"
						}`}
					>
						<BookOpenIcon className="size-3.5 shrink-0 text-muted" />
						<span className="truncate flex-1 text-sm font-medium text-foreground">
							{group.name}
						</span>
					</button>
				))}
			</div>
		);
	}

	if (filteredByName.length === 0) {
		return (
			<p className="px-3 py-6 text-sm text-muted text-center">
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
					className="data-selected:bg-accent/10"
				>
					<div className="flex items-center gap-2 w-full">
						<BookOpenIcon className="size-3.5 shrink-0 text-muted" />
						<Label className="truncate flex-1">{group.name}</Label>
					</div>
				</ListBox.Item>
			))}
		</ListBox>
	);
}
