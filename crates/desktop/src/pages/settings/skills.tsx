import { ArrowPathIcon, FolderIcon, PlusIcon } from "@heroicons/react/24/solid";
import {
	Button,
	Chip,
	Fieldset,
	Form,
	Input,
	Label,
	ListBox,
	SearchField,
	Select,
	type Selection,
	TextField,
} from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import { homeDir } from "@tauri-apps/api/path";
import { openPath } from "@tauri-apps/plugin-opener";
import { dirname } from "pathe";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useCreateSkill, useSkills } from "../../hooks/use-skills";
import { createApi } from "../../lib/api";
import type { MarketSkill, SkillResponse } from "../../lib/api-types";
import { useAgentAvailability } from "../../providers/agent-availability";
import { useServer } from "../../providers/server";

interface SkillGroup {
	name: string;
	items: SkillResponse[];
}

export default function SkillsPage() {
	const { t } = useTranslation();
	const { data: skills, refetch } = useSkills();
	const [searchQuery, setSearchQuery] = useState("");
	const [isCreating, setIsCreating] = useState(false);
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

	const actualSelected = useMemo(() => {
		if (isCreating) return new Set<string>();
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
	}, [selected, isCreating, filteredGroups]);

	const activeGroup = useMemo(() => {
		if (actualSelected.size === 0) return null;
		const key = [...actualSelected][0];
		return filteredGroups.find((g) => g.name === key) ?? null;
	}, [actualSelected, filteredGroups]);

	const handleSelectionChange = (keys: Selection) => {
		setSelected(keys);
		setIsCreating(false);
	};

	const handleCreate = () => {
		setSelected(new Set());
		setIsCreating(true);
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
						onPress={handleCreate}
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

			{/* Right Panel */}
			<div className="flex-1 overflow-hidden">
				{isCreating ? (
					<CreateSkillPanel onDone={() => setIsCreating(false)} />
				) : activeGroup ? (
					<SkillDetail group={activeGroup} />
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

	const handleOpenFolder = async () => {
		if (skill.source_path) {
			try {
				let path = skill.source_path;
				if (path.startsWith("~/")) {
					const home = await homeDir();
					// Avoid replacing all characters if malformed, safely append
					path = `${home}/${path.slice(2)}`;
				}
				const folderPath = dirname(path);
				await openPath(folderPath);
			} catch (error) {
				console.error("Failed to open folder:", error);
			}
		}
	};

	return (
		<div className="h-full overflow-y-auto">
			<div className="p-6 max-w-3xl">
				{/* Header */}
				<div className="flex items-center justify-between gap-3 mb-1">
					<h2 className="text-xl font-semibold leading-tight text-foreground truncate">
						{skill.name}
					</h2>
					{skill.source_path && (
						<Button
							isIconOnly
							variant="ghost"
							size="sm"
							className="text-muted hover:text-foreground shrink-0"
							aria-label={t("openFolder")}
							onPress={handleOpenFolder}
						>
							<FolderIcon className="size-4" />
						</Button>
					)}
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

function CreateSkillPanel({ onDone }: { onDone: () => void }) {
	const { t } = useTranslation();
	const { baseUrl } = useServer();
	const api = createApi(baseUrl);
	const createSkill = useCreateSkill();
	const { availableAgents } = useAgentAvailability();

	const skillAgents = availableAgents.filter(
		(a) => a.isUsable && a.capabilities.skills_mutable,
	);

	const [agent, setAgent] = useState(skillAgents[0]?.id ?? "");
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [author, setAuthor] = useState("");
	const [version, setVersion] = useState("");

	// Market search
	const [marketQuery, setMarketQuery] = useState("");
	const { data: marketResults = [], isFetching: isSearching } = useQuery<
		MarketSkill[]
	>({
		queryKey: ["market", "search", marketQuery],
		queryFn: () => api.market.search(marketQuery, 10),
		enabled: marketQuery.length >= 2,
		staleTime: 60_000,
	});

	const handleMarketSelect = (skill: MarketSkill) => {
		setName(skill.name);
		setDescription(`Source: ${skill.source}`);
		setMarketQuery("");
	};

	const handleSave = () => {
		if (!name.trim() || !agent) return;
		createSkill.mutate(
			{
				agent,
				data: {
					name: name.trim(),
					description: description.trim() || undefined,
					author: author.trim() || undefined,
					version: version.trim() || undefined,
				},
			},
			{ onSuccess: onDone },
		);
	};

	return (
		<div className="h-full overflow-y-auto">
			<div className="p-6 max-w-3xl">
				<h2 className="text-xl font-semibold text-foreground mb-6">
					{t("createSkill")}
				</h2>

				{/* Market Search */}
				<div className="mb-6">
					<h3 className="text-xs font-medium text-muted uppercase tracking-wide mb-2">
						{t("searchMarket")}
					</h3>
					<SearchField
						value={marketQuery}
						onChange={setMarketQuery}
						aria-label={t("searchMarket")}
						variant="secondary"
						className="w-full"
					>
						<SearchField.Group>
							<SearchField.SearchIcon />
							<SearchField.Input
								placeholder={t("searchMarketPlaceholder")}
							/>
							<SearchField.ClearButton />
						</SearchField.Group>
					</SearchField>

					{/* Search Results */}
					{marketQuery.length >= 2 && (
						<div className="mt-2 border border-border rounded-lg overflow-hidden">
							{isSearching ? (
								<p className="px-3 py-4 text-sm text-muted text-center">
									{t("searching")}
								</p>
							) : marketResults.length > 0 ? (
								<div className="max-h-48 overflow-y-auto">
									{marketResults.map((skill) => (
										<button
											key={skill.slug}
											type="button"
											className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-surface-secondary transition-colors"
											onClick={() =>
												handleMarketSelect(skill)
											}
										>
											<div className="min-w-0">
												<p className="text-sm font-medium text-foreground truncate">
													{skill.name}
												</p>
												<p className="text-xs text-muted truncate">
													{skill.source}
												</p>
											</div>
											<span className="text-xs text-muted shrink-0 ml-2">
												{skill.installs.toLocaleString()}{" "}
												installs
											</span>
										</button>
									))}
								</div>
							) : (
								<p className="px-3 py-4 text-sm text-muted text-center">
									{t("noResults")}
								</p>
							)}
						</div>
					)}
				</div>

				{/* Form Fields */}
				<Form>
					{/* Target Agent */}
					<Fieldset>
						<Fieldset.Group>
							<Select
								selectedKey={agent}
								onSelectionChange={(key) =>
									setAgent(key as string)
								}
								aria-label={t("targetAgent")}
								className="w-full"
							>
								<Label>{t("targetAgent")}</Label>
								<Select.Trigger>
									<Select.Value />
									<Select.Indicator />
								</Select.Trigger>
								<Select.Popover>
									<ListBox>
										{skillAgents.map((a) => (
											<ListBox.Item
												key={a.id}
												id={a.id}
												textValue={a.display_name}
											>
												{a.display_name}
											</ListBox.Item>
										))}
									</ListBox>
								</Select.Popover>
							</Select>
						</Fieldset.Group>
					</Fieldset>

					{/* Name & Description */}
					<Fieldset>
						<Fieldset.Group>
							<TextField className="w-full" isRequired>
								<Label>{t("skillName")}</Label>
								<Input
									value={name}
									onChange={(e) => setName(e.target.value)}
									placeholder={t("skillName")}
								/>
							</TextField>
							<TextField className="w-full">
								<Label>{t("description")}</Label>
								<Input
									value={description}
									onChange={(e) =>
										setDescription(e.target.value)
									}
									placeholder={t("description")}
								/>
							</TextField>
						</Fieldset.Group>
					</Fieldset>

					{/* Author & Version */}
					<Fieldset>
						<Fieldset.Group>
							<TextField className="flex-1">
								<Label>{t("author")}</Label>
								<Input
									value={author}
									onChange={(e) => setAuthor(e.target.value)}
									placeholder={t("author")}
								/>
							</TextField>
							<TextField className="flex-1">
								<Label>{t("version")}</Label>
								<Input
									value={version}
									onChange={(e) => setVersion(e.target.value)}
									placeholder="1.0.0"
								/>
							</TextField>
						</Fieldset.Group>
					</Fieldset>

					{/* Actions */}
					<div className="flex justify-end gap-2 pt-2">
						<Button variant="secondary" onPress={onDone}>
							{t("cancel")}
						</Button>
						<Button
							onPress={handleSave}
							isDisabled={
								!name.trim() || !agent || createSkill.isPending
							}
						>
							{createSkill.isPending ? t("creating") : t("save")}
						</Button>
					</div>
				</Form>
			</div>
		</div>
	);
}
