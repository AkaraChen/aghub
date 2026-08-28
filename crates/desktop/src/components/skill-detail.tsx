import { StarIcon as StarIconOutline } from "@heroicons/react/24/outline";
import {
	ArrowPathIcon,
	ChevronDownIcon,
	ChevronUpIcon,
	CodeBracketIcon,
	EyeSlashIcon,
	GlobeAltIcon,
	HashtagIcon,
	LinkIcon,
	MagnifyingGlassIcon,
	PlusIcon,
	StarIcon as StarIconSolid,
	TrashIcon,
} from "@heroicons/react/24/solid";
import { Accordion, Button, Card, Chip, toast, Tooltip } from "@heroui/react";
import { useMutation, useQueries, useQuery } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { siGithub } from "simple-icons";
import { useLocation } from "wouter";
import { useAgentAvailability } from "../hooks/use-agent-availability";
import { useApi } from "../hooks/use-api";
import { useAuditAcknowledgements } from "../hooks/use-audit-acknowledgements";
import { useSkillPreferences } from "../hooks/use-skill-preferences";
import { useSkillAuditPreference } from "../hooks/use-skill-audit-preference";
import { useFavorites } from "../hooks/use-favorites";
import { useCurrentCodeEditor } from "../hooks/use-integrations";
import {
	skillSourceTargetId,
	UNIVERSAL_SKILL_TARGET_ID,
} from "../lib/skill-targets";
import { cn, filterItemsByAgentIds } from "../lib/utils";
import { openWithEditorMutationOptions } from "../requests/integrations";
import {
	globalSkillLockQueryOptions,
	openSkillFolderMutationOptions,
	projectSkillLockQueryOptions,
	skillAuditQueryOptions,
	skillContentQueryOptions,
	skillTreeQueryOptions,
} from "../requests/skills";
import { ManageSkillAgentsDialog } from "./manage-skill-agents-dialog";
import { SkillAudit, SkillAuditBadge } from "./skill-audit";
import {
	DeleteSkillDialog,
	DeleteSkillLocationDialog,
} from "./skill-detail-dialogs";
import {
	buildLocationGroups,
	countTreeFiles,
	findContainedSkills,
	getInstalledSkillAuditPaths,
	hasSupplementarySkillFiles,
	type LocationGroup,
	type SkillGroup,
	summarizeSkillLinks,
} from "./skill-detail-helpers";
import {
	LocationRow,
	SkillFilesUnavailableAlert,
	SkillTree,
} from "./skill-detail-views";
import { SkillLinkSummary } from "./skill-link-state";
import { SkillLocationDrift } from "./skill-location-drift";
import { SyncGithubSkillDialog } from "./sync-github-skill-dialog";
import { TransferDialog } from "./transfer-dialog";

interface SkillDetailProps {
	group: SkillGroup;
	projectPath?: string;
}

const GITHUB_PREFIX_REGEX = /^github\//;

export function SkillDetail({ group, projectPath }: SkillDetailProps) {
	const { t } = useTranslation();
	const [, setLocation] = useLocation();
	const { allAgents, availableAgents } = useAgentAvailability();
	const api = useApi();
	const { skillAuditEnabled, skillAuditReady } = useSkillAuditPreference();
	const { skillPreferences, skillPreferencesReady } = useSkillPreferences();

	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
	const [locationToDelete, setLocationToDelete] =
		useState<LocationGroup | null>(null);
	const [showAllLocations, setShowAllLocations] = useState(false);
	const [transferDialogOpen, setTransferDialogOpen] = useState(false);
	const [manageDialogOpen, setManageDialogOpen] = useState(false);
	const [syncDialogOpen, setSyncDialogOpen] = useState(false);
	const [manualCopyCheckKey, setManualCopyCheckKey] = useState<string | null>(
		null,
	);

	const { isSkillStarred, toggleSkillStar } = useFavorites();
	const isStarred = isSkillStarred(group.items[0].name);
	const { isAssessmentAcknowledged, setAssessmentAcknowledged } =
		useAuditAcknowledgements();
	const { selectedEditor } = useCurrentCodeEditor();

	const skill = group.items[0];
	const isProviderManagedSkill = group.items.every(
		(item) =>
			Boolean(item.locations?.length) &&
			item.locations?.every((location) => location.provider?.managed) ===
				true,
	);
	const auditPaths = getInstalledSkillAuditPaths(group.items);
	const primaryScope = skill.source ?? "global";
	const skillQueryScope =
		primaryScope === "project" && projectPath ? "project" : "global";
	const skillQueryEnabled =
		primaryScope !== "project" || Boolean(projectPath);
	const trimmedSkillName = skill.name.trim();
	const canSearchSkillsSh = trimmedSkillName.length >= 2;

	const handleSearchSkillsSh = () => {
		if (!canSearchSkillsSh) {
			return;
		}

		setLocation(`/market/search?q=${encodeURIComponent(trimmedSkillName)}`);
	};

	const openFolderMutation = useMutation(
		openSkillFolderMutationOptions({ api }),
	);

	const openInEditorMutation = useMutation(
		openWithEditorMutationOptions({ api }),
	);

	const { data: globalLock } = useQuery({
		...globalSkillLockQueryOptions({ api }),
	});

	const { data: projectLock } = useQuery({
		...projectSkillLockQueryOptions({ api, projectPath }),
	});

	const { data: skillContent } = useQuery({
		...skillContentQueryOptions({
			api,
			path: skill.source_path ?? undefined,
			scope: skillQueryScope,
			projectRoot: projectPath,
			enabled: skillQueryEnabled,
		}),
	});

	const {
		data: skillTree,
		error: skillTreeError,
		isFetching: isSkillTreeFetching,
		refetch: refetchSkillTree,
	} = useQuery({
		...skillTreeQueryOptions({
			api,
			path: skill.source_path ?? undefined,
			scope: skillQueryScope,
			projectRoot: projectPath,
			enabled: skillQueryEnabled,
		}),
	});

	const { data: auditedSkill } = useQuery({
		...skillAuditQueryOptions({
			api,
			paths: auditPaths,
			enabled: skillAuditReady && skillAuditEnabled,
		}),
	});
	const skillAudit = skillAuditEnabled ? auditedSkill : undefined;
	const isAuditAcknowledged = skillAudit
		? isAssessmentAcknowledged(skill.name, skillAudit.assessment_digest)
		: false;
	const updateAuditAcknowledgement = (acknowledged: boolean) => {
		if (!skillAudit) return;
		void setAssessmentAcknowledged(
			skill.name,
			skillAudit.assessment_digest,
			acknowledged,
		).catch(() => toast.danger(t("auditAcknowledgementError")));
	};

	const currentSkillSource = useMemo(() => {
		const skillItem = group.items[0];
		if (skillItem.source === "global") {
			const entry = globalLock?.skills.find((s) => s.name === skill.name);
			if (entry) {
				return {
					source: entry.source,
					sourceType: entry.sourceType,
					hash: entry.skillFolderHash,
					sourceUrl: entry.sourceUrl,
					skillPath: entry.skillPath ?? null,
				};
			}
		} else if (skillItem.source === "project") {
			const entry = projectLock?.skills.find(
				(s) => s.name === skill.name,
			);
			if (entry) {
				return {
					source: entry.source,
					sourceType: entry.sourceType,
					hash: entry.computedHash,
				};
			}
		}

		return null;
	}, [globalLock, group.items, projectLock, skill.name]);

	const sourceUrl = useMemo(() => {
		if (!currentSkillSource) {
			return null;
		}

		if (currentSkillSource.sourceUrl) {
			return currentSkillSource.sourceUrl;
		}

		if (
			currentSkillSource.sourceType === "github" &&
			currentSkillSource.source
		) {
			const path = currentSkillSource.source.replace(
				GITHUB_PREFIX_REGEX,
				"",
			);
			return `https://github.com/${path}`;
		}

		return null;
	}, [currentSkillSource]);

	const enabledAgentIds = useMemo(() => {
		const ids = new Set(
			availableAgents
				.filter((agent) => !agent.isDisabled)
				.map((agent) => agent.id),
		);
		ids.add(UNIVERSAL_SKILL_TARGET_ID);
		return ids;
	}, [availableAgents]);
	const visibleGroupItems = useMemo(
		() => filterItemsByAgentIds(group.items, enabledAgentIds),
		[group.items, enabledAgentIds],
	);

	const allLocationGroups = useMemo(
		() => buildLocationGroups(visibleGroupItems, allAgents),
		[visibleGroupItems, allAgents],
	);
	const copyLocationGroups = useMemo(
		() => buildLocationGroups(group.items, allAgents),
		[group.items, allAgents],
	);
	const copyCheckKey = copyLocationGroups
		.map((location) => location.sourcePath)
		.join("\n");
	const manualCopyCheckRequested = manualCopyCheckKey === copyCheckKey;
	const copyCheckEnabled =
		skillPreferencesReady &&
		skillPreferences.enabled &&
		(skillPreferences.mode === "automatic" || manualCopyCheckRequested);

	const displayedLocations =
		showAllLocations || allLocationGroups.length <= 3
			? allLocationGroups
			: allLocationGroups.slice(0, 2);
	const hasMoreLocations = allLocationGroups.length > 3;
	const hiddenLocationCount = allLocationGroups.length - 2;
	const additionalDisplayedLocations = displayedLocations.filter(
		(location) => location.sourcePath !== skill.source_path,
	);
	const additionalLocationTreeQueries = useQueries({
		queries: additionalDisplayedLocations.map((location) => {
			const includesProjectLocation = location.installations.some(
				(installation) => installation.source === "project",
			);
			return skillTreeQueryOptions({
				api,
				path: location.sourcePath,
				scope:
					includesProjectLocation && projectPath
						? "project"
						: "global",
				projectRoot: projectPath,
				enabled:
					copyCheckEnabled &&
					(!includesProjectLocation || Boolean(projectPath)),
			});
		}),
	});
	const locationTreeStateByPath = new Map<
		string,
		{
			tree?: typeof skillTree;
			unavailable: boolean;
			isFetching: boolean;
			retry: () => Promise<void>;
		}
	>();
	if (skill.source_path) {
		locationTreeStateByPath.set(skill.source_path, {
			tree: skillTree,
			unavailable: Boolean(skillTreeError),
			isFetching: isSkillTreeFetching,
			retry: async () => {
				const refreshed = await refetchSkillTree();
				if (refreshed.isError) {
					toast.warning(t("skillFilesUnavailable"), {
						description: t("skillFilesUnavailableDescription"),
					});
				}
			},
		});
	}
	additionalDisplayedLocations.forEach((location, index) => {
		const query = additionalLocationTreeQueries[index];
		locationTreeStateByPath.set(location.sourcePath, {
			tree: copyCheckEnabled ? query?.data : undefined,
			unavailable: copyCheckEnabled && Boolean(query?.error),
			isFetching: copyCheckEnabled && Boolean(query?.isFetching),
			retry: async () => {
				const refreshed = await query?.refetch();
				if (refreshed?.isError) {
					toast.warning(t("skillFilesUnavailable"), {
						description: t("skillFilesUnavailableDescription"),
					});
				}
			},
		});
	});
	const resourceCount = useMemo(
		() => (skillTree ? countTreeFiles(skillTree) : 0),
		[skillTree],
	);
	const linkSummary = useMemo(
		() => (skillTree ? summarizeSkillLinks(skillTree) : null),
		[skillTree],
	);
	const hasSupplementaryFiles = useMemo(
		() => (skillTree ? hasSupplementarySkillFiles(skillTree) : false),
		[skillTree],
	);
	const containedSkills = useMemo(
		() => (skillTree ? findContainedSkills(skillTree) : []),
		[skillTree],
	);
	const displayName = skillPreferences.showDisplayNames
		? (group.items
				.find((item) => item.display_name?.trim())
				?.display_name?.trim() ?? null)
		: null;
	const showsDisplayName = displayName !== null && displayName !== skill.name;

	return (
		<>
			<div className="h-full overflow-y-auto">
				<div className="w-full space-y-4 p-4 sm:p-6">
					<Card>
						<Card.Header className="flex flex-row items-start justify-between gap-3">
							<div className="min-w-0 flex-1 select-text">
								<div className="flex min-w-0 items-baseline gap-2">
									<h2 className="min-w-0 truncate text-xl font-semibold text-foreground">
										{skill.name}
									</h2>
									{showsDisplayName && (
										<span className="min-w-0 truncate text-sm text-muted">
											{displayName}
										</span>
									)}
									{skillAudit &&
										(isAuditAcknowledged ? (
											<span
												role="img"
												className="inline-flex size-4 shrink-0"
												aria-label={t(
													"auditAcknowledged",
												)}
											>
												<EyeSlashIcon
													aria-hidden
													className="size-4 shrink-0 text-muted"
												/>
											</span>
										) : (
											<SkillAuditBadge
												report={skillAudit}
											/>
										))}
								</div>
								{skill.description && (
									<Card.Description className="mt-2">
										{skill.description}
									</Card.Description>
								)}
							</div>
							<div className="flex items-center gap-2">
								<Tooltip delay={0}>
									<Button
										isIconOnly
										variant="ghost"
										size="md"
										className="text-muted min-w-[44px] min-h-[44px] hover:text-foreground"
										aria-label={t("searchOnSkillsSh")}
										isDisabled={!canSearchSkillsSh}
										onPress={handleSearchSkillsSh}
									>
										<MagnifyingGlassIcon className="size-5" />
									</Button>
									<Tooltip.Content>
										{t("searchOnSkillsSh")}
									</Tooltip.Content>
								</Tooltip>
								<Tooltip delay={0}>
									<Button
										isIconOnly
										variant="ghost"
										size="md"
										className={cn(
											"text-muted min-w-[44px] min-h-[44px] hover:text-warning",
											isStarred && "text-warning",
										)}
										aria-label={
											isStarred
												? t("unstarSkill")
												: t("starSkill")
										}
										onPress={() =>
											toggleSkillStar(skill.name)
										}
									>
										{isStarred ? (
											<StarIconSolid className="size-5" />
										) : (
											<StarIconOutline className="size-5" />
										)}
									</Button>
									<Tooltip.Content>
										{isStarred
											? t("unstarSkill")
											: t("starSkill")}
									</Tooltip.Content>
								</Tooltip>
								{!isProviderManagedSkill && (
									<Tooltip delay={0}>
										<Button
											isIconOnly
											variant="ghost"
											size="md"
											className="text-muted hover:text-danger min-w-[44px] min-h-[44px]"
											aria-label={t("deleteSkill")}
											onPress={() =>
												setDeleteDialogOpen(true)
											}
										>
											<TrashIcon className="size-4" />
										</Button>
										<Tooltip.Content>
											{t("deleteSkill")}
										</Tooltip.Content>
									</Tooltip>
								)}
							</div>
						</Card.Header>

						<Card.Content className="flex flex-col gap-6">
							{skillAudit &&
								skillAudit.verdict !== "benign" &&
								(isAuditAcknowledged ? (
									<div className="flex items-center justify-between gap-3 rounded-lg border border-separator bg-surface-secondary px-3 py-2">
										<span className="flex items-center gap-2 text-sm text-muted">
											<EyeSlashIcon className="size-4 shrink-0" />
											{t("auditAcknowledgedHint")}
										</span>
										<Button
											variant="ghost"
											size="sm"
											onPress={() =>
												updateAuditAcknowledgement(
													false,
												)
											}
										>
											{t("restoreAuditWarning")}
										</Button>
									</div>
								) : (
									<div className="space-y-2">
										<SkillAudit
											key={skillAudit.assessment_digest}
											report={skillAudit}
											embedded
											installed
										/>
										<div className="flex justify-end">
											<Button
												variant="secondary"
												size="sm"
												onPress={() =>
													updateAuditAcknowledgement(
														true,
													)
												}
											>
												{t("acknowledgeAudit")}
											</Button>
										</div>
									</div>
								))}

							{skill.tools.length > 0 && (
								<div className="space-y-3">
									<h3 className="text-xs font-medium tracking-wider text-muted uppercase">
										{t("tools")} ({skill.tools.length})
									</h3>
									<div className="flex flex-wrap gap-1.5">
										{skill.tools.map((tool) => (
											<Chip
												key={tool}
												size="sm"
												variant="soft"
											>
												{tool}
											</Chip>
										))}
									</div>
								</div>
							)}

							{allLocationGroups.length > 0 && (
								<div className="space-y-3">
									<h3 className="text-xs font-medium tracking-wider text-muted uppercase">
										{t("locations")} (
										{allLocationGroups.length})
									</h3>
									<div className="space-y-1.5">
										{displayedLocations.map(
											(locationGroup) => {
												const treeState =
													locationTreeStateByPath.get(
														locationGroup.sourcePath,
													);

												return (
													<LocationRow
														key={locationGroup.key}
														group={locationGroup}
														tree={treeState?.tree}
														treeUnavailable={
															treeState?.unavailable
														}
														isRetrying={
															treeState?.isFetching
														}
														onRetry={
															treeState
																? () => {
																		void treeState.retry();
																	}
																: undefined
														}
														editorAvailable={Boolean(
															selectedEditor,
														)}
														onDelete={() =>
															setLocationToDelete(
																locationGroup,
															)
														}
														onEditFolder={() => {
															if (!selectedEditor)
																return;
															openInEditorMutation.mutate(
																{
																	path: locationGroup.sourcePath,
																	editor: selectedEditor,
																},
															);
														}}
														onOpenFolder={() =>
															openFolderMutation.mutate(
																locationGroup.sourcePath,
															)
														}
													/>
												);
											},
										)}
									</div>
									{hasMoreLocations && (
										<button
											type="button"
											onClick={() =>
												setShowAllLocations(
													!showAllLocations,
												)
											}
											className="
												mt-2 flex items-center gap-1 text-xs text-muted
												transition-colors hover:text-foreground
											"
										>
											{showAllLocations ? (
												<>
													<ChevronUpIcon className="size-3.5" />
													<span>{t("showLess")}</span>
												</>
											) : (
												<>
													<ChevronDownIcon className="size-3.5" />
													<span>
														{t("showMore", {
															count: hiddenLocationCount,
														})}
													</span>
												</>
											)}
										</button>
									)}
								</div>
							)}

							{containedSkills.length > 0 && (
								<section
									aria-label={t("containedSkills")}
									className="space-y-3"
								>
									<div className="space-y-1">
										<h3 className="text-xs font-medium tracking-wider text-muted uppercase">
											{t("containedSkills")} (
											{containedSkills.length})
										</h3>
										<p className="text-xs text-muted">
											{t("containedSkillsDescription")}
										</p>
									</div>
									<div className="max-h-64 divide-y divide-separator overflow-y-auto rounded-lg bg-surface-secondary px-3">
										{containedSkills.map((contained) => (
											<div
												key={contained.relativePath}
												className="flex min-w-0 items-center justify-between gap-3 py-2"
											>
												<div className="flex min-w-0 items-baseline gap-1.5">
													<span className="shrink-0 text-sm text-foreground">
														{contained.name}
													</span>
													{skillPreferences.showDisplayNames &&
														contained.displayName &&
														contained.displayName !==
															contained.name && (
															<span className="min-w-0 truncate text-xs text-muted">
																{
																	contained.displayName
																}
															</span>
														)}
												</div>
												<code
													className="min-w-0 truncate text-xs text-muted"
													title={
														contained.relativePath
													}
												>
													{contained.relativePath}
												</code>
											</div>
										))}
									</div>
								</section>
							)}

							{currentSkillSource && (
								<div className="space-y-3">
									<h3 className="text-xs font-medium tracking-wider text-muted uppercase">
										{t("installedFrom")}
									</h3>
									<div className="flex items-center justify-between gap-3 rounded-lg bg-surface-secondary px-3 py-2">
										<div className="min-w-0 flex-1">
											<div className="flex items-center gap-1.5">
												{currentSkillSource.sourceType.toLowerCase() ===
												"github" ? (
													<svg
														role="img"
														className="size-3.5 shrink-0 text-muted"
														viewBox="0 0 24 24"
														fill="currentColor"
													>
														<path
															d={siGithub.path}
														/>
													</svg>
												) : (
													<GlobeAltIcon className="size-3.5 shrink-0 text-muted" />
												)}
												<span className="min-w-0 truncate text-sm text-foreground">
													{currentSkillSource.source}
												</span>
											</div>
											<div className="mt-1 flex items-center text-xs text-muted">
												<span className="font-mono">
													<HashtagIcon className="inline size-3" />
													{currentSkillSource.hash.slice(
														0,
														8,
													)}
												</span>
											</div>
										</div>
										{sourceUrl && (
											<div className="flex shrink-0 items-center gap-1">
												<Tooltip delay={0}>
													<Button
														isIconOnly
														variant="ghost"
														size="sm"
														className="size-8 text-muted"
														aria-label={t(
															"syncFromSource",
														)}
														onPress={() =>
															setSyncDialogOpen(
																true,
															)
														}
													>
														<ArrowPathIcon className="size-4" />
													</Button>
													<Tooltip.Content>
														{t("syncFromSource")}
													</Tooltip.Content>
												</Tooltip>
												<Tooltip delay={0}>
													<Button
														isIconOnly
														variant="ghost"
														size="sm"
														className="size-8 text-muted"
														aria-label={t(
															"openInBrowser",
														)}
														onPress={() =>
															openUrl(sourceUrl)
														}
													>
														<LinkIcon className="size-4" />
													</Button>
													<Tooltip.Content>
														{t("openInBrowser")}
													</Tooltip.Content>
												</Tooltip>
											</div>
										)}
									</div>
								</div>
							)}

							{!isProviderManagedSkill && (
								<Card.Footer className="pt-4 border-t border-separator flex flex-wrap gap-3">
									<Button
										variant="secondary"
										onPress={() =>
											setTransferDialogOpen(true)
										}
									>
										<PlusIcon className="size-4" />
										{t("transfer")}
									</Button>
									<Button
										variant="primary"
										onPress={() =>
											setManageDialogOpen(true)
										}
									>
										<PlusIcon className="size-4" />
										{t("addToAgent")}
									</Button>
								</Card.Footer>
							)}
						</Card.Content>
					</Card>

					<SkillLocationDrift
						key={skill.name}
						locations={copyLocationGroups}
						scope={projectPath ? "all" : "global"}
						projectRoot={projectPath}
						isCheckEnabled={copyCheckEnabled}
						canRequestCheck={
							skillPreferencesReady &&
							skillPreferences.enabled &&
							skillPreferences.mode === "manual" &&
							!manualCopyCheckRequested
						}
						onRequestCheck={() =>
							setManualCopyCheckKey(copyCheckKey)
						}
						groupIdenticalCopies={
							skillPreferences.groupIdenticalCopies
						}
						defaultStorageMode={skillPreferences.defaultStorageMode}
					/>

					{skillContent && (
						<Accordion variant="surface">
							<Accordion.Item>
								<Accordion.Heading>
									<Accordion.Trigger>
										{t("skillContent")}
										<Accordion.Indicator>
											<ChevronDownIcon className="size-4" />
										</Accordion.Indicator>
									</Accordion.Trigger>
								</Accordion.Heading>
								<Accordion.Panel>
									<Accordion.Body>
										<pre
											role="article"
											aria-label={t("skillContent")}
											className="overflow-x-auto rounded-md bg-surface-secondary p-3 font-mono text-xs whitespace-pre-wrap text-foreground"
										>
											{skillContent}
										</pre>
									</Accordion.Body>
								</Accordion.Panel>
							</Accordion.Item>
						</Accordion>
					)}

					{(skillTreeError ||
						(skillTree && hasSupplementaryFiles)) && (
						<Accordion variant="surface">
							<Accordion.Item>
								<Accordion.Heading>
									<Accordion.Trigger>
										<div className="flex min-w-0 flex-1 flex-col items-start text-left">
											<span>{t("skillFiles")}</span>
											<span className="text-xs font-normal text-muted">
												{skillTreeError
													? t("skillFilesUnavailable")
													: t(
															"skillFilesDescription",
															{
																count: resourceCount,
															},
														)}
											</span>
											{linkSummary && (
												<SkillLinkSummary
													summary={linkSummary}
													className="mt-0.5"
												/>
											)}
										</div>
										<Accordion.Indicator>
											<ChevronDownIcon className="size-4" />
										</Accordion.Indicator>
									</Accordion.Trigger>
								</Accordion.Heading>
								<Accordion.Panel>
									<Accordion.Body>
										<div className="space-y-3">
											{skillTreeError && (
												<SkillFilesUnavailableAlert
													isRetrying={
														isSkillTreeFetching
													}
													onRetry={() => {
														void locationTreeStateByPath
															.get(
																skill.source_path ??
																	"",
															)
															?.retry();
													}}
												/>
											)}
											{selectedEditor &&
												!isProviderManagedSkill &&
												skillTree && (
													<div className="flex justify-start">
														<Button
															variant="ghost"
															size="sm"
															onPress={() =>
																openInEditorMutation.mutate(
																	{
																		path: skillTree.path,
																		editor: selectedEditor!,
																	},
																)
															}
														>
															<CodeBracketIcon className="size-4" />
															{t("editInEditor")}
														</Button>
													</div>
												)}
											{skillTree && (
												<SkillTree root={skillTree} />
											)}
										</div>
									</Accordion.Body>
								</Accordion.Panel>
							</Accordion.Item>
						</Accordion>
					)}
				</div>
			</div>

			<DeleteSkillDialog
				group={group}
				agents={allAgents}
				isOpen={deleteDialogOpen}
				onClose={() => setDeleteDialogOpen(false)}
				projectPath={projectPath}
			/>
			<DeleteSkillLocationDialog
				key={
					locationToDelete
						? `${skill.name}:${locationToDelete.key}`
						: "delete-skill-location-dialog"
				}
				item={locationToDelete}
				isOpen={locationToDelete !== null}
				onClose={() => setLocationToDelete(null)}
				projectPath={projectPath}
				skillName={skill.name}
				isLastLocation={allLocationGroups.length === 1}
			/>
			<TransferDialog
				isOpen={transferDialogOpen}
				onClose={() => setTransferDialogOpen(false)}
				resourceType="skill"
				items={[
					{
						name: skill.name,
						sourceAgent: skillSourceTargetId(skill),
					},
				]}
				sourceScope={primaryScope}
				sourceProjectRoot={projectPath}
			/>
			<ManageSkillAgentsDialog
				groups={[group]}
				isOpen={manageDialogOpen}
				onClose={() => setManageDialogOpen(false)}
				projectPath={projectPath}
			/>
			{sourceUrl && (
				<SyncGithubSkillDialog
					group={group}
					sourceUrl={sourceUrl}
					skillPath={
						(currentSkillSource &&
							"skillPath" in currentSkillSource &&
							currentSkillSource.skillPath) ||
						null
					}
					isOpen={syncDialogOpen}
					onClose={() => setSyncDialogOpen(false)}
					projectPath={projectPath}
				/>
			)}
		</>
	);
}
