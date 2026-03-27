import {
	Button,
	Modal,
	Pagination,
	SearchField,
	Spinner,
	Table,
	Tooltip,
} from "@heroui/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useQueryState } from "nuqs";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AgentSelector } from "../../components/agent-selector";
import { ResultStatusItem } from "../../components/result-status-item";
import { useAgentAvailability } from "../../hooks/use-agent-availability";
import { useServer } from "../../hooks/use-server";
import { createApi } from "../../lib/api";
import type { MarketSkill } from "../../lib/api-types";

const PAGE_SIZE = 10;

interface InstallResult {
	agentId: string;
	displayName: string;
	status: "pending" | "success" | "error";
	error?: string;
}

export default function SkillsShPage() {
	const { t } = useTranslation();
	const { baseUrl } = useServer();
	const api = createApi(baseUrl);
	const queryClient = useQueryClient();
	const { availableAgents } = useAgentAvailability();

	const [searchQuery, setSearchQuery] = useState("");
	const [urlQuery, setUrlQuery] = useQueryState("q");
	const [page, setPage] = useState(1);

	const [installModalOpen, setInstallModalOpen] = useState(false);
	const [selectedSkill, setSelectedSkill] = useState<MarketSkill | null>(
		null,
	);
	const [selectedAgents, setSelectedAgents] = useState<Set<string>>(
		() => new Set(),
	);
	const [installResults, setInstallResults] = useState<InstallResult[]>([]);
	const [isInstalling, setIsInstalling] = useState(false);

	const skillAgents = availableAgents.filter(
		(a) => a.isUsable && a.capabilities.skills_mutable,
	);

	const submittedQuery = urlQuery ?? "";
	const { data: searchResults = [], isFetching: isSearching } = useQuery<
		MarketSkill[]
	>({
		queryKey: ["market", "search", submittedQuery],
		queryFn: () => api.market.search(submittedQuery, 50),
		enabled: submittedQuery.length >= 2,
		staleTime: 60_000,
	});

	const totalPages = Math.ceil(searchResults.length / PAGE_SIZE);
	const paginatedResults = searchResults.slice(
		(page - 1) * PAGE_SIZE,
		page * PAGE_SIZE,
	);

	const handleSearch = () => {
		if (searchQuery.trim().length >= 2) {
			setUrlQuery(searchQuery.trim());
			setPage(1);
		}
	};

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Enter") {
			handleSearch();
		}
	};

	const handleInstallClick = (skill: MarketSkill) => {
		setSelectedSkill(skill);
		setSelectedAgents(new Set());
		setInstallResults([]);
		setInstallModalOpen(true);
	};

	const handleInstall = async () => {
		if (!selectedSkill || selectedAgents.size === 0) return;

		setIsInstalling(true);

		const pendingResults: InstallResult[] = Array.from(
			selectedAgents,
			(agentId) => {
				const agent = availableAgents.find((a) => a.id === agentId);
				return {
					agentId,
					displayName: agent?.display_name ?? agentId,
					status: "pending" as const,
				};
			},
		);
		setInstallResults(pendingResults);

		const skillsCliNames = Array.from(selectedAgents, (id) => {
			const agent = availableAgents.find((a) => a.id === id);
			return agent?.skills_cli_name;
		}).filter((name): name is string => !!name);

		try {
			const response = await api.skills.install({
				source: selectedSkill.source,
				agents: skillsCliNames,
				scope: "global",
			});

			const updatedResults = pendingResults.map((result) => ({
				...result,
				status: (response.success ? "success" : "error") as
					| "success"
					| "error",
				error: response.success ? undefined : response.stderr,
			}));

			setInstallResults(updatedResults);
		} catch (err) {
			const updatedResults = pendingResults.map((result) => ({
				...result,
				status: "error" as const,
				error: err instanceof Error ? err.message : String(err),
			}));
			setInstallResults(updatedResults);
		}

		setIsInstalling(false);
		queryClient.invalidateQueries({ queryKey: ["skills"] });
	};

	const handleCloseInstallModal = () => {
		setInstallModalOpen(false);
		setSelectedSkill(null);
		setSelectedAgents(new Set());
		setInstallResults([]);
	};

	return (
		<div className="flex h-full flex-col">
			<div className="flex flex-1 flex-col overflow-hidden">
				{submittedQuery.length >= 2 ? (
					<>
						<div className="flex items-center gap-6 py-3 px-6">
							<div className="flex items-center gap-2">
								<Tooltip delay={0}>
									<Tooltip.Trigger>
										<span className="text-muted hover:text-foreground cursor-default">
											<svg
												height="18"
												viewBox="0 0 16 16"
												width="18"
												className="text-current"
											>
												<path
													fillRule="evenodd"
													clipRule="evenodd"
													d="M8 1L16 15H0L8 1Z"
													fill="currentColor"
												/>
											</svg>
										</span>
									</Tooltip.Trigger>
									<Tooltip.Content>
										{t("poweredByVercel")}
									</Tooltip.Content>
								</Tooltip>
								<span className="text-muted">
									<svg
										height="16"
										viewBox="0 0 16 16"
										width="16"
										className="text-current"
									>
										<path
											fillRule="evenodd"
											clipRule="evenodd"
											d="M4.01526 15.3939L4.3107 14.7046L10.3107 0.704556L10.6061 0.0151978L11.9849 0.606077L11.6894 1.29544L5.68942 15.2954L5.39398 15.9848L4.01526 15.3939Z"
											fill="currentColor"
										/>
									</svg>
								</span>
								<Tooltip delay={0}>
									<Tooltip.Trigger>
										<span className="font-medium tracking-tight text-lg cursor-default">
											Skills
										</span>
									</Tooltip.Trigger>
									<Tooltip.Content>
										{t("dataFromSkillsSh")}
									</Tooltip.Content>
								</Tooltip>
							</div>
							<div className="flex items-center gap-2">
								<SearchField
									value={searchQuery}
									onChange={setSearchQuery}
									onKeyDown={handleKeyDown}
									aria-label={t("searchMarketSkills")}
									className="w-[400px]"
								>
									<SearchField.Group>
										<SearchField.SearchIcon />
										<SearchField.Input
											placeholder={t(
												"searchMarketSkillsPlaceholder",
											)}
										/>
										<SearchField.ClearButton />
									</SearchField.Group>
								</SearchField>
								<Button
									onPress={handleSearch}
									isDisabled={searchQuery.trim().length < 2}
								>
									{t("search")}
								</Button>
							</div>
						</div>

						<div className="flex-1 overflow-hidden">
							{isSearching ? (
								<div className="flex h-full items-center justify-center">
									<Spinner size="lg" />
								</div>
							) : searchResults.length === 0 ? (
								<div className="flex h-full items-center justify-center">
									<p className="text-sm text-muted">
										{t("noResults")}
									</p>
								</div>
							) : (
								<div className="flex h-full flex-col overflow-hidden">
									<Table
										variant="secondary"
										className="flex-1"
									>
										<Table.ScrollContainer>
											<Table.Content
												aria-label={t("searchResults")}
											>
												<Table.Header>
													<Table.Column>
														{t("name")}
													</Table.Column>
													<Table.Column>
														{t("installs")}
													</Table.Column>
													<Table.Column>
														{t("source")}
													</Table.Column>
													<Table.Column></Table.Column>
												</Table.Header>
												<Table.Body
													items={paginatedResults}
												>
													{(skill) => (
														<Table.Row
															id={skill.slug}
														>
															<Table.Cell>
																<span className="font-medium">
																	{skill.name}
																</span>
															</Table.Cell>
															<Table.Cell>
																<span className="text-muted">
																	{skill.installs.toLocaleString()}
																</span>
															</Table.Cell>
															<Table.Cell>
																<span className="text-muted text-sm">
																	{
																		skill.source
																	}
																</span>
															</Table.Cell>
															<Table.Cell>
																<Button
																	size="sm"
																	variant="secondary"
																	onPress={() =>
																		handleInstallClick(
																			skill,
																		)
																	}
																>
																	{t(
																		"install",
																	)}
																</Button>
															</Table.Cell>
														</Table.Row>
													)}
												</Table.Body>
											</Table.Content>
										</Table.ScrollContainer>
									</Table>

									{totalPages > 1 && (
										<div className="mt-4 flex justify-center">
											<Pagination>
												<Pagination.Content>
													<Pagination.Item>
														<Pagination.Previous
															isDisabled={
																page === 1
															}
															onPress={() =>
																setPage((p) =>
																	Math.max(
																		1,
																		p - 1,
																	),
																)
															}
														>
															<Pagination.PreviousIcon />
														</Pagination.Previous>
													</Pagination.Item>
													{Array.from(
														{ length: totalPages },
														(_, i) => i + 1,
													).map((pageNum) => (
														<Pagination.Item
															key={pageNum}
														>
															<Pagination.Link
																isActive={
																	pageNum ===
																	page
																}
																onPress={() =>
																	setPage(
																		pageNum,
																	)
																}
															>
																{pageNum}
															</Pagination.Link>
														</Pagination.Item>
													))}
													<Pagination.Item>
														<Pagination.Next
															isDisabled={
																page ===
																totalPages
															}
															onPress={() =>
																setPage((p) =>
																	Math.min(
																		totalPages,
																		p + 1,
																	),
																)
															}
														>
															<Pagination.NextIcon />
														</Pagination.Next>
													</Pagination.Item>
												</Pagination.Content>
											</Pagination>
										</div>
									)}
								</div>
							)}
						</div>
					</>
				) : (
					<div className="flex h-full flex-col items-center pt-[20vh]">
						<div className="flex items-center gap-2 mb-4">
							<Tooltip delay={0}>
								<Tooltip.Trigger>
									<span className="text-muted hover:text-foreground cursor-default">
										<svg
											height="18"
											viewBox="0 0 16 16"
											width="18"
											className="text-current"
										>
											<path
												fillRule="evenodd"
												clipRule="evenodd"
												d="M8 1L16 15H0L8 1Z"
												fill="currentColor"
											/>
										</svg>
									</span>
								</Tooltip.Trigger>
								<Tooltip.Content>
									{t("poweredByVercel")}
								</Tooltip.Content>
							</Tooltip>
							<span className="text-muted">
								<svg
									height="16"
									viewBox="0 0 16 16"
									width="16"
									className="text-current"
								>
									<path
										fillRule="evenodd"
										clipRule="evenodd"
										d="M4.01526 15.3939L4.3107 14.7046L10.3107 0.704556L10.6061 0.0151978L11.9849 0.606077L11.6894 1.29544L5.68942 15.2954L5.39398 15.9848L4.01526 15.3939Z"
										fill="currentColor"
									/>
								</svg>
							</span>
							<Tooltip delay={0}>
								<Tooltip.Trigger>
									<span className="font-medium tracking-tight text-lg cursor-default">
										Skills
									</span>
								</Tooltip.Trigger>
								<Tooltip.Content>
									{t("dataFromSkillsSh")}
								</Tooltip.Content>
							</Tooltip>
						</div>
						<div className="flex items-center gap-2">
							<SearchField
								value={searchQuery}
								onChange={setSearchQuery}
								onKeyDown={handleKeyDown}
								aria-label={t("searchMarketSkills")}
								className="w-[400px]"
							>
								<SearchField.Group>
									<SearchField.SearchIcon />
									<SearchField.Input
										placeholder={t(
											"searchMarketSkillsPlaceholder",
										)}
									/>
									<SearchField.ClearButton />
								</SearchField.Group>
							</SearchField>
							<Button
								onPress={handleSearch}
								isDisabled={searchQuery.trim().length < 2}
							>
								{t("search")}
							</Button>
						</div>
					</div>
				)}
			</div>

			<Modal.Backdrop
				isOpen={installModalOpen}
				onOpenChange={handleCloseInstallModal}
			>
				<Modal.Container>
					<Modal.Dialog className="max-w-md">
						<Modal.CloseTrigger />
						<Modal.Header>
							<Modal.Heading>{t("installSkill")}</Modal.Heading>
						</Modal.Header>

						<Modal.Body className="p-2">
							{selectedSkill && (
								<div className="mb-4 rounded-lg border border-accent-soft-hover bg-accent/5 p-3">
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

							{installResults.length === 0 && (
								<div className="space-y-4">
									<p className="text-sm text-muted">
										{t("selectAgentsForSkill")}
									</p>
									<AgentSelector
										agents={skillAgents}
										selectedKeys={selectedAgents}
										onSelectionChange={setSelectedAgents}
										emptyMessage={t("noTargetAgents")}
										showSelectedIcon
										variant="secondary"
									/>
								</div>
							)}

							{installResults.length > 0 && (
								<div className="space-y-3">
									{isInstalling && (
										<div className="flex items-center justify-center py-4">
											<Spinner size="lg" />
										</div>
									)}
									{installResults.map((result) => (
										<ResultStatusItem
											key={result.agentId}
											displayName={result.displayName}
											status={result.status}
											statusText={
												result.status === "pending"
													? t("installing")
													: result.status ===
															"success"
														? t("installSuccess")
														: ""
											}
											error={result.error}
										/>
									))}
								</div>
							)}
						</Modal.Body>

						<Modal.Footer>
							{installResults.length === 0 && (
								<>
									<Button slot="close" variant="secondary">
										{t("cancel")}
									</Button>
									<Button
										onPress={handleInstall}
										isDisabled={selectedAgents.size === 0}
									>
										{t("install")}
									</Button>
								</>
							)}
							{installResults.length > 0 && (
								<Button slot="close" variant="secondary">
									{t("done")}
								</Button>
							)}
						</Modal.Footer>
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</div>
	);
}
