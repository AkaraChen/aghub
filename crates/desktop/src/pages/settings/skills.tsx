import { ArrowPathIcon, PlusIcon } from "@heroicons/react/24/solid";
import { Button, Dropdown, SearchField } from "@heroui/react";
import { useQueryState } from "nuqs";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { CreateSkillPanel } from "../../components/create-skill-panel";
import { ImportSkillPanel } from "../../components/import-skill-panel";
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

	const handleOpenInstallDialog = () => {
		setIsInstallDialogOpen(true);
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
									if (key === "market") {
										handleOpenInstallDialog();
									} else if (key === "create") {
										handleCreateSkill();
									} else if (key === "import") {
										handleImportSkill();
									}
								}}
							>
								<Dropdown.Item
									id="market"
									textValue={t("installFromMarket")}
								>
									{t("installFromMarket")}
								</Dropdown.Item>
								<Dropdown.Item
									id="create"
									textValue={t("createCustomSkill")}
								>
									{t("createCustomSkill")}
								</Dropdown.Item>
								<Dropdown.Item
									id="import"
									textValue={t("importFromFile")}
								>
									{t("importFromFile")}
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

			<InstallSkillDialog
				isOpen={isInstallDialogOpen}
				onClose={() => setIsInstallDialogOpen(false)}
			/>
		</div>
	);
}
