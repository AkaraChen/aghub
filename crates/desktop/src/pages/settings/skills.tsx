import { ArrowPathIcon, PlusIcon } from "@heroicons/react/24/solid";
import {
	Button,
	Label,
	ListBox,
	SearchField,
	type Selection,
} from "@heroui/react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { InstallSkillDialog } from "../../components/install-skill-dialog";
import { SkillDetail } from "../../components/skill-detail";
import { useSkills } from "../../hooks/use-skills";
import type { SkillResponse } from "../../lib/api-types";

export default function SkillsPage() {
	const { t } = useTranslation();
	const { data: skills, refetch } = useSkills();
	const [searchQuery, setSearchQuery] = useState("");
	const [isInstallDialogOpen, setIsInstallDialogOpen] = useState(false);
	const [selected, setSelected] = useState<Selection>(new Set());

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

	const filteredGroups = useMemo(() => {
		const query = searchQuery.toLowerCase();
		if (!query) return groupedSkills;

		const nameMatches: typeof groupedSkills = [];
		const descMatches: typeof groupedSkills = [];
		for (const group of groupedSkills) {
			if (group.name.toLowerCase().includes(query)) {
				nameMatches.push(group);
			} else if (
				group.items.some((s) =>
					(s.description ?? "").toLowerCase().includes(query),
				)
			) {
				descMatches.push(group);
			}
		}
		return [...nameMatches, ...descMatches];
	}, [groupedSkills, searchQuery]);

	const actualSelected = useMemo(() => {
		if (
			selected !== "all" &&
			(selected as Set<string>).size > 0 &&
			Array.from(selected as Set<string>).some((key) =>
				filteredGroups.some((g) => g.name === key),
			)
		) {
			return selected as Set<string>;
		}
		return new Set<string>(
			filteredGroups[0] ? [filteredGroups[0].name] : [],
		);
	}, [selected, filteredGroups]);

	const activeGroup = useMemo(() => {
		if (actualSelected.size === 0) return null;
		const key = [...actualSelected][0];
		return filteredGroups.find((g) => g.name === key) ?? null;
	}, [actualSelected, filteredGroups]);

	const handleSelectionChange = (keys: Selection) => {
		setSelected(keys);
	};

	const handleOpenInstallDialog = () => {
		setIsInstallDialogOpen(true);
	};

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
						onPress={handleOpenInstallDialog}
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
					selectedKeys={actualSelected}
					onSelectionChange={handleSelectionChange}
					className="flex-1 overflow-y-auto p-2"
				>
					{filteredGroups.map((group) => (
						<ListBox.Item
							key={group.name}
							id={group.name}
							textValue={group.name}
							className="data-selected:bg-accent/10"
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

			{/* Right Panel */}
			<div className="flex-1 overflow-hidden">
				{activeGroup ? (
					<SkillDetail group={activeGroup} />
				) : (
					<div className="flex items-center justify-center h-full">
						<p className="text-sm text-muted">{t("selectSkill")}</p>
					</div>
				)}
			</div>

			<InstallSkillDialog
				isOpen={isInstallDialogOpen}
				onClose={() => setIsInstallDialogOpen(false)}
			/>
		</div>
	);
}
