import {
	ArrowDownTrayIcon,
	ArrowPathIcon,
	CommandLineIcon,
	PlusIcon,
} from "@heroicons/react/24/solid";
import { Button, Dropdown } from "@heroui/react";
import { useQueryState } from "nuqs";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { CreateSkillPanel } from "../../components/create-skill-panel";
import { ImportSkillPanel } from "../../components/import-skill-panel";
import { ListSearchHeader } from "../../components/list-search-header";
import { SkillDetail } from "../../components/skill-detail";
import { SkillList } from "../../components/skill-list";
import { useSkills } from "../../hooks/use-skills";
import type { SkillResponse } from "../../lib/api-types";
import { cn } from "../../lib/utils";

export default function SkillsPage() {
	const { t } = useTranslation();
	const { data: skills, refetch, isFetching } = useSkills();
	const [searchQuery, setSearchQuery] = useState("");
	const [selectedName, setSelectedName] = useQueryState("skill");
	const [panelMode, setPanelMode] = useState<"create" | "import" | null>(
		null,
	);
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
		setPanelMode(null);
	};

	const handleCreateSkill = () => {
		setSelectedName(null);
		setPanelMode("create");
	};

	const handleImportSkill = () => {
		setSelectedName(null);
		setPanelMode("import");
	};

	return (
		<div className="flex h-full">
			{/* Skills List Panel */}
			<div className="flex w-80 shrink-0 flex-col border-r border-border">
				<ListSearchHeader
					searchValue={searchQuery}
					onSearchChange={setSearchQuery}
					placeholder={t("searchSkills")}
					ariaLabel={t("searchSkills")}
				>
					<Dropdown>
						<Button
							isIconOnly
							variant="ghost"
							size="sm"
							className="shrink-0"
							aria-label={t("addSkill")}
						>
							<PlusIcon className="size-4" />
						</Button>
						<Dropdown.Popover placement="bottom end">
							<Dropdown.Menu
								onAction={(key) => {
									if (key === "create") {
										handleCreateSkill();
									} else if (key === "import") {
										handleImportSkill();
									}
								}}
							>
								<Dropdown.Item
									id="create"
									textValue={t("createCustomSkill")}
								>
									<div className="flex items-center gap-2">
										<CommandLineIcon className="size-4" />
										<span>{t("createCustomSkill")}</span>
									</div>
								</Dropdown.Item>
								<Dropdown.Item
									id="import"
									textValue={t("importFromFile")}
								>
									<div className="flex items-center gap-2">
										<ArrowDownTrayIcon className="size-4" />
										<span>{t("importFromFile")}</span>
									</div>
								</Dropdown.Item>
							</Dropdown.Menu>
						</Dropdown.Popover>
					</Dropdown>
					<Button
						isIconOnly
						variant="ghost"
						size="sm"
						className="shrink-0"
						aria-label={t("refreshSkills")}
						onPress={() => refetch()}
					>
						<ArrowPathIcon
							className={cn(
								"size-4",
								isFetching && "animate-spin",
							)}
						/>
					</Button>
				</ListSearchHeader>

				{/* Skills List */}
				<SkillList
					skills={skills}
					selectedKey={selectedName ?? activeGroup?.name ?? null}
					searchQuery={searchQuery}
					onSelect={handleSelect}
					groupBySource={true}
				/>
			</div>

			<div className="flex-1 overflow-hidden">
				{panelMode === "create" ? (
					<CreateSkillPanel onDone={() => setPanelMode(null)} />
				) : panelMode === "import" ? (
					<ImportSkillPanel onDone={() => setPanelMode(null)} />
				) : activeGroup ? (
					<SkillDetail group={activeGroup} />
				) : (
					<div className="flex h-full flex-col items-center justify-center gap-4">
						<div className="text-center">
							<p className="mb-2 text-sm text-muted">
								{t("selectSkill")}
							</p>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
