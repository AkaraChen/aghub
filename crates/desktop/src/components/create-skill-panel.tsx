import {
	Button,
	Fieldset,
	Form,
	Input,
	Label,
	ListBox,
	SearchField,
	Select,
	TextField,
} from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useCreateSkill } from "../hooks/use-skills";
import { createApi } from "../lib/api";
import type { MarketSkill } from "../lib/api-types";
import { useAgentAvailability } from "../providers/agent-availability";
import { useServer } from "../providers/server";

interface CreateSkillPanelProps {
	onDone: () => void;
	projectPath?: string;
}

export function CreateSkillPanel({ onDone, projectPath }: CreateSkillPanelProps) {
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
				projectPath,
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