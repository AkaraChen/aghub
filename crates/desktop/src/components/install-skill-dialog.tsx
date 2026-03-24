import { MagnifyingGlassIcon, PlusIcon } from "@heroicons/react/24/solid";
import type { Selection } from "@heroui/react";
import {
	Button,
	ListBox,
	Modal,
	SearchField,
	Spinner,
	Tag,
	TagGroup,
} from "@heroui/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { createApi } from "../lib/api";
import type { MarketSkill } from "../lib/api-types";
import { capitalize } from "../lib/mcp-utils";
import { useAgentAvailability } from "../hooks/use-agent-availability";
import { useServer } from "../hooks/use-server";
import { ResultStatusItem } from "./result-status-item";
import { StepIndicator } from "./step-indicator";

interface InstallSkillDialogProps {
	isOpen: boolean;
	onClose: () => void;
	projectPath?: string;
}

type WizardStep = 1 | 2;

interface InstallResult {
	agentId: string;
	displayName: string;
	status: "pending" | "success" | "error";
	error?: string;
}

export function InstallSkillDialog({
	isOpen,
	onClose,
	projectPath,
}: InstallSkillDialogProps) {
	const { t } = useTranslation();
	const { baseUrl } = useServer();
	const api = createApi(baseUrl);
	const queryClient = useQueryClient();
	const { availableAgents } = useAgentAvailability();

	const skillAgents = useMemo(
		() =>
			availableAgents.filter(
				(a) => a.isUsable && a.capabilities.skills_mutable,
			),
		[availableAgents],
	);

	const [step, setStep] = useState<WizardStep>(1);
	const [searchQuery, setSearchQuery] = useState("");
	const [selectedSkill, setSelectedSkill] = useState<MarketSkill | null>(
		null,
	);
	const [selectedAgents, setSelectedAgents] = useState<Set<string>>(
		() => new Set(),
	);
	const [results, setResults] = useState<InstallResult[]>(() => []);

	const isInstalling = results.some((r) => r.status === "pending");

	const agentNameMap = useMemo(
		() => new Map(availableAgents.map((a) => [a.id, a.display_name])),
		[availableAgents],
	);

	const getAgentDisplayName = useMemo(() => {
		return (agentId: string) => {
			return agentNameMap.get(agentId) ?? capitalize(agentId);
		};
	}, [agentNameMap]);

	const { data: marketResults = [], isFetching: isSearching } = useQuery<
		MarketSkill[]
	>({
		queryKey: ["market", "search", searchQuery],
		queryFn: () => api.market.search(searchQuery, 10),
		enabled: searchQuery.length >= 2 && isOpen,
		staleTime: 60_000,
	});

	const handleSkillSelect = (skill: MarketSkill) => {
		setSelectedSkill(skill);
	};

	const handleAgentSelectionChange = (keys: Selection) => {
		setSelectedAgents(keys as Set<string>);
	};

	const handleInstall = async () => {
		if (!selectedSkill || selectedAgents.size === 0) return;

		setStep(2);

		const pendingResults: InstallResult[] = Array.from(
			selectedAgents,
			(agentId) => ({
				agentId,
				displayName: getAgentDisplayName(agentId),
				status: "pending",
			}),
		);
		setResults(pendingResults);

		const skillsCliNames = Array.from(selectedAgents, (id) => {
			const agent = availableAgents.find((a) => a.id === id);
			return agent?.skills_cli_name;
		}).filter((name): name is string => !!name);

		try {
			const response = await api.skills.install({
				source: selectedSkill.source,
				agents: skillsCliNames,
				scope: projectPath ? "project" : "global",
				project_path: projectPath,
			});

			const updatedResults = pendingResults.map((result) => ({
				...result,
				status: (response.success ? "success" : "error") as
					| "success"
					| "error",
				error: response.success ? undefined : response.stderr,
			}));

			setResults(updatedResults);
		} catch (err) {
			const updatedResults = pendingResults.map((result) => ({
				...result,
				status: "error" as const,
				error: err instanceof Error ? err.message : String(err),
			}));
			setResults(updatedResults);
		}

		queryClient.invalidateQueries({ queryKey: ["skills"] });
	};

	const handleClose = () => {
		setStep(1);
		setSearchQuery("");
		setSelectedSkill(null);
		setSelectedAgents(new Set());
		setResults([]);
		onClose();
	};

	const stepLabels = [t("selectSourceAndAgents"), t("installation")];

	const canInstall = selectedSkill !== null && selectedAgents.size > 0;

	return (
		<Modal.Backdrop isOpen={isOpen} onOpenChange={handleClose}>
			<Modal.Container>
				<Modal.Dialog className="max-w-2xl">
					<Modal.CloseTrigger />
					<Modal.Header>
						<Modal.Heading>{t("installSkill")}</Modal.Heading>
					</Modal.Header>

					<Modal.Body className="p-2">
						<StepIndicator currentStep={step} labels={stepLabels} />

						{step === 1 && (
							<div className="space-y-4">
								<p className="text-sm text-muted">
									{t("searchSkillMarketDescription")}
								</p>

								<SearchField
									value={searchQuery}
									onChange={setSearchQuery}
									aria-label={t("searchMarket")}
									variant="secondary"
									className="w-full"
								>
									<SearchField.Group>
										<SearchField.SearchIcon />
										<SearchField.Input
											placeholder={t(
												"searchMarketPlaceholder",
											)}
										/>
										<SearchField.ClearButton />
									</SearchField.Group>
								</SearchField>

								{searchQuery.length >= 2 && (
									<div className="overflow-hidden rounded-lg border border-border">
										{isSearching ? (
											<div className="flex items-center justify-center py-8">
												<Spinner size="sm" />
											</div>
										) : marketResults.length > 0 ? (
											<div className="max-h-64 overflow-y-auto">
												<ListBox
													aria-label={t(
														"searchResults",
													)}
													selectionMode="single"
													selectedKeys={
														selectedSkill
															? new Set([
																	selectedSkill.slug,
																])
															: new Set()
													}
													onSelectionChange={(
														keys,
													) => {
														const selectedKey = [
															...(keys as Set<string>),
														][0];
														const skill =
															marketResults.find(
																(s) =>
																	s.slug ===
																	selectedKey,
															);
														if (skill)
															handleSkillSelect(
																skill,
															);
													}}
												>
													{marketResults.map(
														(skill) => (
															<ListBox.Item
																key={skill.slug}
																id={skill.slug}
																textValue={
																	skill.name
																}
																className="data-selected:bg-accent/10"
															>
																<div className="flex w-full items-center justify-between py-1">
																	<div className="min-w-0 flex-1">
																		<p className="truncate text-sm font-medium">
																			{
																				skill.name
																			}
																		</p>
																		<p className="truncate text-xs text-muted">
																			{
																				skill.source
																			}
																		</p>
																	</div>
																	<span className="ml-2 shrink-0 text-xs text-muted">
																		{skill.installs.toLocaleString()}{" "}
																		{t(
																			"installs",
																		)}
																	</span>
																</div>
															</ListBox.Item>
														),
													)}
												</ListBox>
											</div>
										) : (
											<p className="px-4 py-6 text-center text-sm text-muted">
												{t("noResults")}
											</p>
										)}
									</div>
								)}

								{selectedSkill && (
									<div className="
           rounded-lg border border-accent-soft-hover bg-accent/5 p-3
         ">
										<p className="mb-1 text-xs tracking-wide text-muted uppercase">
											{t("selectedSkill")}
										</p>
										<p className="font-medium">
											{selectedSkill.name}
										</p>
										<p className="text-sm text-muted">
											{selectedSkill.source}
										</p>
									</div>
								)}

								{/* Agent selection */}
								<div>
									<p className="mb-3 text-sm text-muted">
										{t("selectAgentsForSkill")}
									</p>

									{skillAgents.length === 0 ? (
										<div className="py-6 text-center">
											<MagnifyingGlassIcon className="mx-auto mb-2 size-8 text-muted" />
											<p className="text-sm text-muted">
												{t("noTargetAgents")}
											</p>
										</div>
									) : (
										<TagGroup
											selectionMode="multiple"
											selectedKeys={selectedAgents}
											onSelectionChange={
												handleAgentSelectionChange
											}
											variant="surface"
										>
											<TagGroup.List className="flex-wrap">
												{skillAgents.map((agent) => {
													const isSelected =
														selectedAgents.has(
															agent.id,
														);
													return (
														<Tag
															key={agent.id}
															id={agent.id}
														>
															<div className="flex items-center gap-1.5">
																{
																	agent.display_name
																}
																{isSelected && (
																	<PlusIcon className="size-3" />
																)}
															</div>
														</Tag>
													);
												})}
											</TagGroup.List>
										</TagGroup>
									)}
								</div>
							</div>
						)}

						{step === 2 && (
							<div className="space-y-3">
								{results.length === 0 ? (
									<p className="py-4 text-center text-sm text-muted">
										{t("noChanges")}
									</p>
								) : (
									<>
										{isInstalling && (
											<div className="flex items-center justify-center py-4">
												<Spinner size="lg" />
											</div>
										)}
										{results.map((result) => (
											<ResultStatusItem
												key={result.agentId}
												displayName={result.displayName}
												status={result.status}
												statusText={
													result.status === "pending"
														? t("installing")
														: result.status ===
																"success"
															? t(
																	"installSuccess",
																)
															: ""
												}
												error={result.error}
											/>
										))}
									</>
								)}
							</div>
						)}
					</Modal.Body>

					<Modal.Footer>
						{step === 1 && (
							<>
								<Button slot="close" variant="secondary">
									{t("cancel")}
								</Button>
								<Button
									onPress={handleInstall}
									isDisabled={!canInstall}
								>
									{t("install")}
								</Button>
							</>
						)}
						{step === 2 && (
							<Button slot="close" variant="secondary">
								{t("done")}
							</Button>
						)}
					</Modal.Footer>
				</Modal.Dialog>
			</Modal.Container>
		</Modal.Backdrop>
	);
}
