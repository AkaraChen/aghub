import { ArrowPathIcon, PlusIcon } from "@heroicons/react/24/solid";
import {
	Button,
	Chip,
	Label,
	ListBox,
	SearchField,
	type Selection,
} from "@heroui/react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSkills } from "../../hooks/use-skills";
import type { SkillResponse } from "../../lib/api-types";

interface SkillGroup {
	name: string;
	items: SkillResponse[];
}

export default function SkillsPage() {
	const { t } = useTranslation();
	const { data: skills, refetch } = useSkills();
	const [searchQuery, setSearchQuery] = useState("");

	const groupedSkills = useMemo(() => {
		const map = new Map<string, SkillResponse[]>();
		for (const skill of skills) {
			const existing = map.get(skill.name) ?? [];
			map.set(skill.name, [...existing, skill]);
		}
		return Array.from(map.entries()).map(([name, items]) => ({
			name,
			items,
		}));
	}, [skills]);

	const [selected, setSelected] = useState<Selection>(
		new Set(groupedSkills[0] ? [groupedSkills[0].name] : []),
	);

	const filteredGroups = useMemo(
		() =>
			groupedSkills.filter(
				({ name, items }) =>
					name.toLowerCase().includes(searchQuery.toLowerCase()) ||
					items.some((s) =>
						(s.description ?? "")
							.toLowerCase()
							.includes(searchQuery.toLowerCase()),
					),
			),
		[groupedSkills, searchQuery],
	);

	const selectedKey = [...(selected as Set<string>)][0];
	const selectedGroup =
		filteredGroups.find((g) => g.name === selectedKey) ?? null;

	return (
		<div className="flex h-full">
			{/* Skills List Panel */}
			<div className="w-80 shrink-0 border-r border-border flex flex-col">
				{/* Search Header */}
				<div className="flex items-center gap-2 p-3 border-b border-border">
					<SearchField
						value={searchQuery}
						onChange={setSearchQuery}
						aria-label={t("searchSkills")}
						variant="secondary"
						className="flex-1 min-w-0"
					>
						<SearchField.Group>
							<SearchField.SearchIcon />
							<SearchField.Input
								placeholder={t("searchSkills")}
							/>
							<SearchField.ClearButton />
						</SearchField.Group>
					</SearchField>
					<Button
						isIconOnly
						variant="ghost"
						size="sm"
						className="shrink-0"
						aria-label={t("addSkill")}
					>
						<PlusIcon className="size-4" />
					</Button>
					<Button
						isIconOnly
						variant="ghost"
						size="sm"
						className="shrink-0"
						aria-label={t("refreshSkills")}
						onPress={() => refetch()}
					>
						<ArrowPathIcon className="size-4" />
					</Button>
				</div>

				{/* Skills List */}
				<ListBox
					aria-label="Skills"
					selectionMode="single"
					selectedKeys={selected}
					onSelectionChange={setSelected}
					className="flex-1 overflow-y-auto p-2"
				>
					{filteredGroups.map((group) => (
						<ListBox.Item
							key={group.name}
							id={group.name}
							textValue={group.name}
							className="data-[selected]:bg-accent/10"
						>
							<Label className="truncate">{group.name}</Label>
						</ListBox.Item>
					))}
				</ListBox>
				{filteredGroups.length === 0 && (
					<p className="px-3 py-6 text-sm text-muted text-center">
						{t("noSkillsMatch")} &ldquo;{searchQuery}&rdquo;
					</p>
				)}
			</div>

			{/* Skill Detail Panel */}
			<div className="flex-1 overflow-hidden">
				{selectedGroup ? (
					<SkillDetail group={selectedGroup} />
				) : (
					<div className="flex items-center justify-center h-full">
						<p className="text-sm text-muted">{t("selectSkill")}</p>
					</div>
				)}
			</div>
		</div>
	);
}

function SkillDetail({ group }: { group: SkillGroup }) {
	const { t } = useTranslation();
	const skill = group.items[0];

	return (
		<div className="h-full overflow-y-auto">
			<div className="p-6 max-w-3xl">
				{/* Header */}
				<div className="flex items-center gap-2 mb-1 flex-wrap">
					<h2 className="text-xl font-semibold leading-tight text-foreground">
						{skill.name}
					</h2>
				</div>
				{skill.source_path && (
					<p className="text-xs text-muted mb-6 font-mono">
						{skill.source_path}
					</p>
				)}

				{/* Description */}
				{skill.description && (
					<div className="mb-6">
						<h3 className="text-xs font-medium text-muted uppercase tracking-wide mb-2">
							{t("description")}
						</h3>
						<p className="text-sm text-foreground">
							{skill.description}
						</p>
					</div>
				)}

				{/* Metadata */}
				{(skill.author || skill.version) && (
					<div className="mb-6 flex gap-6">
						{skill.author && (
							<div>
								<h3 className="text-xs font-medium text-muted uppercase tracking-wide mb-1">
									{t("author")}
								</h3>
								<p className="text-sm text-foreground">
									{skill.author}
								</p>
							</div>
						)}
						{skill.version && (
							<div>
								<h3 className="text-xs font-medium text-muted uppercase tracking-wide mb-1">
									{t("version")}
								</h3>
								<p className="text-sm text-foreground font-mono">
									{skill.version}
								</p>
							</div>
						)}
					</div>
				)}

				{/* Tools */}
				{skill.tools.length > 0 && (
					<div className="mb-6">
						<h3 className="text-xs font-medium text-muted uppercase tracking-wide mb-2">
							{t("tools")} ({skill.tools.length})
						</h3>
						<div className="flex flex-wrap gap-1.5">
							{skill.tools.map((tool) => (
								<Chip key={tool} size="sm">
									{tool}
								</Chip>
							))}
						</div>
					</div>
				)}

				{/* Source scope */}
				{skill.source && (
					<div>
						<h3 className="text-xs font-medium text-muted uppercase tracking-wide mb-1">
							{t("source")}
						</h3>
						<Chip size="sm">{skill.source}</Chip>
					</div>
				)}
			</div>
		</div>
	);
}
