import { ArrowPathIcon, PlusIcon } from "@heroicons/react/24/solid";
import { Button, SearchField } from "@heroui/react";
import { useQueryState } from "nuqs";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { InstallSkillDialog } from "../../components/install-skill-dialog";
import { SkillDetail } from "../../components/skill-detail";
import { SkillList } from "../../components/skill-list";
import { useSkills } from "../../hooks/use-skills";
import type { SkillResponse } from "../../lib/api-types";
import { cn } from "../../lib/utils";

export default function SkillsPage() {
	const { t } = useTranslation();
	const { data: skills, refetch, isFetching } = useSkills();
	const [searchQuery, setSearchQuery] = useState("");
	const [isInstallDialogOpen, setIsInstallDialogOpen] = useState(false);
	const [selectedName, setSelectedName] = useQueryState("skill");

	const groupedSkills = useMemo(() => {
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

	const activeGroup = useMemo(() => {
		if (!selectedName) {
			return groupedSkills[0] ?? null;
		}
		return groupedSkills.find((g) => g.name === selectedName) ?? null;
	}, [selectedName, groupedSkills]);

	const handleSelect = (name: string) => {
		setSelectedName(name);
	};

	const handleOpenInstallDialog = () => {
		setIsInstallDialogOpen(true);
	};

	return (
		<div className="flex h-full">
			{/* Skills List Panel */}
			<div className="flex w-80 shrink-0 flex-col border-r border-border">
				{/* Search Header */}
				<div className="flex items-center gap-2 p-3">
					<SearchField
						value={searchQuery}
						onChange={setSearchQuery}
						aria-label={t("searchSkills")}
						className="min-w-0 flex-1"
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
						<ArrowPathIcon className={cn("size-4", isFetching && "animate-spin")} />
					</Button>
				</div>

				{/* Skills List */}
				<SkillList
					skills={skills}
					selectedKey={selectedName ?? activeGroup?.name ?? null}
					searchQuery={searchQuery}
					onSelect={handleSelect}
					groupBySource={true}
				/>
			</div>

			{/* Right Panel */}
			<div className="flex-1 overflow-hidden">
				{activeGroup ? (
					<SkillDetail group={activeGroup} />
				) : (
					<div className="flex h-full items-center justify-center">
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
