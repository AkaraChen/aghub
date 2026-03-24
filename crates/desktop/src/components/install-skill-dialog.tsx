import {
	ArrowPathIcon,
	CheckCircleIcon,
	ChevronLeftIcon,
	ChevronRightIcon,
	MagnifyingGlassIcon,
	PlusIcon,
	XCircleIcon,
} from "@heroicons/react/24/solid";
import {
	Button,
	ListBox,
	Modal,
	SearchField,
	Spinner,
	Tag,
	TagGroup,
	type Selection,
} from "@heroui/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAgentAvailability } from "../providers/agent-availability";
import { useServer } from "../providers/server";
import { createApi } from "../lib/api";
import type { MarketSkill } from "../lib/api-types";

interface InstallSkillDialogProps {
	isOpen: boolean;
	onClose: () => void;
	projectPath?: string;
}

type WizardStep = 1 | 2 | 3;

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

	const skillAgents = availableAgents.filter(
		(a) => a.isUsable && a.capabilities.skills_mutable,
	);

	const [step, setStep] = useState<WizardStep>(1);
	const [searchQuery, setSearchQuery] = useState("");
	const [selectedSkill, setSelectedSkill] = useState<MarketSkill | null>(null);
	const [selectedAgents, setSelectedAgents] = useState<Set<string>>(new Set());
	const [results, setResults] = useState<InstallResult[]>([]);
	const [isInstalling, setIsInstalling] = useState(false);

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

	const getAgentDisplayName = useCallback(
		(agentId: string) => {
			const agent = availableAgents.find((a) => a.id === agentId);
			if (agent) return agent.display_name;
			return agentId.charAt(0).toUpperCase() + agentId.slice(1);
		},
		[availableAgents],
	);

	const handleInstall = async () => {
		if (!selectedSkill || selectedAgents.size === 0) return;

		setStep(3);
		setIsInstalling(true);

		const pendingResults: InstallResult[] = [...selectedAgents].map(
			(agentId) => ({
				agentId,
				displayName: getAgentDisplayName(agentId),
				status: "pending",
			}),
		);
		setResults(pendingResults);

		const skillsCliNames = [...selectedAgents]
			.map((id) => {
				const agent = availableAgents.find((a) => a.id === id);
				return agent?.skills_cli_name;
			})
			.filter((name): name is string => !!name);

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

		setIsInstalling(false);
		queryClient.invalidateQueries({ queryKey: ["skills"] });
	};

	const handleClose = () => {
		setStep(1);
		setSearchQuery("");
		setSelectedSkill(null);
		setSelectedAgents(new Set());
		setResults([]);
		setIsInstalling(false);
		onClose();
	};

	const stepLabels = [
		t("selectSource"),
		t("selectAgents"),
		t("installation"),
	];

	const canProceedStep1 = selectedSkill !== null;
	const canProceedStep2 = selectedAgents.size > 0;

	return (
		<Modal.Backdrop isOpen={isOpen} onOpenChange={handleClose}>
			<Modal.Container>
				<Modal.Dialog className="max-w-2xl">
					<Modal.CloseTrigger />
					<Modal.Header>
						<Modal.Heading>{t("installSkill")}</Modal.Heading>
					</Modal.Header>

					<Modal.Body className="p-2">
						<div className="flex items-center justify-center gap-2 mb-6">
							{[1, 2, 3].map((s, idx) => (
								<div
									key={s}
									className="flex items-center gap-2"
								>
									<div
										className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
											s < step
												? "bg-accent/15 text-accent"
												: s === step
													? "bg-accent text-accent-foreground"
													: "bg-default-100 text-muted"
										}`}
									>
										<span
											className={`flex items-center justify-center size-4.5 rounded-full text-[10px] font-bold ${
												s < step
													? "bg-accent text-accent-foreground"
													: s === step
														? "bg-accent-foreground text-accent"
														: "bg-default-200 text-muted"
											}`}
										>
											{s < step ? "✓" : s}
										</span>
										{stepLabels[idx]}
									</div>
									{idx < 2 && (
										<div
											className={`w-6 h-px ${
												s < step
													? "bg-accent"
													: "bg-default-200"
											}`}
										/>
									)}
								</div>
							))}
						</div>

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
									<div className="border border-border rounded-lg overflow-hidden">
										{isSearching ? (
											<div className="flex items-center justify-center py-8">
												<Spinner size="sm" />
											</div>
										) : marketResults.length > 0 ? (
											<div className="max-h-64 overflow-y-auto">
												<ListBox
													aria-label={t("searchResults")}
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
															handleSkillSelect(skill);
													}}
												>
													{marketResults.map((skill) => (
														<ListBox.Item
															key={skill.slug}
															id={skill.slug}
															textValue={skill.name}
															className="data-selected:bg-accent/10"
														>
															<div className="flex items-center justify-between w-full py-1">
																<div className="min-w-0 flex-1">
																	<p className="text-sm font-medium truncate">
																		{skill.name}
																	</p>
																	<p className="text-xs text-muted truncate">
																		{skill.source}
																	</p>
																</div>
																<span className="text-xs text-muted shrink-0 ml-2">
																	{skill.installs.toLocaleString()}{" "}
																	{t("installs")}
																</span>
															</div>
														</ListBox.Item>
													))}
												</ListBox>
											</div>
										) : (
											<p className="px-4 py-6 text-sm text-muted text-center">
												{t("noResults")}
											</p>
										)}
									</div>
								)}

								{selectedSkill && (
									<div className="p-3 bg-accent/5 border border-accent/20 rounded-lg">
										<p className="text-xs text-muted uppercase tracking-wide mb-1">
											{t("selectedSkill")}
										</p>
									<p className="font-medium">{selectedSkill.name}</p>
																	<p className="text-sm text-muted">
																		{selectedSkill.source}
																	</p>
									</div>
								)}
							</div>
						)}

						{step === 2 && selectedSkill && (
							<div className="space-y-4">
								<div className="p-3 bg-default-50 border border-border rounded-lg">
									<p className="text-xs text-muted uppercase tracking-wide mb-1">
										{t("installingSkill")}
									</p>
									<p className="font-medium">{selectedSkill.name}</p>
									<p className="text-sm text-muted">{selectedSkill.source}</p>
								</div>

								<div>
									<p className="text-sm text-muted mb-3">
										{t("selectAgentsForSkill")}
									</p>

									{skillAgents.length === 0 ? (
										<div className="text-center py-6">
											<MagnifyingGlassIcon className="size-8 text-muted mx-auto mb-2" />
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
										>
											<TagGroup.List className="flex-wrap">
												{skillAgents.map((agent) => {
													const isSelected = selectedAgents.has(
														agent.id,
													);
													return (
														<Tag
															key={agent.id}
															id={agent.id}
														>
															<div className="flex items-center gap-1.5">
																{agent.display_name}
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

						{step === 3 && (
							<div className="space-y-3">
								{results.length === 0 ? (
									<p className="text-sm text-muted text-center py-4">
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
											<div
												key={result.agentId}
												className="flex items-start gap-2 p-3 rounded-lg bg-default-50"
											>
												{result.status === "pending" && (
													<ArrowPathIcon className="size-4 text-muted shrink-0 mt-0.5 animate-spin" />
												)}
												{result.status === "success" && (
													<CheckCircleIcon className="size-4 text-success shrink-0 mt-0.5" />
												)}
												{result.status === "error" && (
													<XCircleIcon className="size-4 text-danger shrink-0 mt-0.5" />
												)}
												<div className="min-w-0">
													<p className="text-sm font-medium">
														{result.displayName}
													</p>
													<p className="text-xs text-muted">
														{result.status === "pending"
															? t("installing")
															: result.status ===
																	"success"
																? t(
																		"installSuccess",
																	)
																: result.error}
													</p>
												</div>
											</div>
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
									onPress={() => setStep(2)}
									isDisabled={!canProceedStep1}
								>
									{t("next")}
									<ChevronRightIcon className="size-3.5" />
								</Button>
							</>
						)}
						{step === 2 && (
							<>
								<Button
									variant="secondary"
									onPress={() => setStep(1)}
								>
									<ChevronLeftIcon className="size-3.5" />
									{t("back")}
								</Button>
								<Button
									onPress={handleInstall}
									isDisabled={!canProceedStep2}
								>
									{t("install")}
									<ChevronRightIcon className="size-3.5" />
								</Button>
							</>
						)}
						{step === 3 && (
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
