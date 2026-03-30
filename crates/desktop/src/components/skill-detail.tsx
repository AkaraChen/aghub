import { StarIcon as StarIconOutline } from "@heroicons/react/24/outline";
import {
	ChevronDownIcon,
	ChevronUpIcon,
	CodeBracketIcon,
	GlobeAltIcon,
	HashtagIcon,
	LinkIcon,
	MagnifyingGlassIcon,
	PlusIcon,
	StarIcon as StarIconSolid,
	TrashIcon,
} from "@heroicons/react/24/solid";
import { Accordion, Button, Card, Chip, Tooltip } from "@heroui/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { siGithub } from "simple-icons";
import { useLocation } from "wouter";
import { useAgentAvailability } from "../hooks/use-agent-availability";
import { useFavorites } from "../hooks/use-favorites";
import { useCurrentCodeEditor } from "../hooks/use-integrations";
import { useServer } from "../hooks/use-server";
import { createApi } from "../lib/api";
import type {
	GlobalSkillLockResponse,
	ProjectSkillLockResponse,
	SkillTreeNodeResponse,
} from "../lib/api-types";
import { ConfigSource } from "../lib/api-types";
import { cn } from "../lib/utils";
import { ManageSkillAgentsDialog } from "./manage-skill-agents-dialog";
import {
	DeleteSkillDialog,
	DeleteSkillLocationDialog,
} from "./skill-detail-dialogs";
import {
	buildLocationGroups,
	countTreeNodes,
	hasSupplementarySkillFiles,
	type LocationGroup,
	type SkillGroup,
} from "./skill-detail-helpers";
import { LocationRow, SkillTree } from "./skill-detail-views";
import { TransferDialog } from "./transfer-dialog";

interface SkillDetailProps {
	group: SkillGroup;
	projectPath?: string;
}

const GITHUB_PREFIX_REGEX = /^github\//;

export function SkillDetail({ group, projectPath }: SkillDetailProps) {
	const { t } = useTranslation();
	const [, setLocation] = useLocation();
	const { allAgents } = useAgentAvailability();
	const { baseUrl } = useServer();
	const api = useMemo(() => createApi(baseUrl), [baseUrl]);

	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
	const [locationToDelete, setLocationToDelete] =
		useState<LocationGroup | null>(null);
	const [showAllLocations, setShowAllLocations] = useState(false);
	const [transferDialogOpen, setTransferDialogOpen] = useState(false);
	const [manageDialogOpen, setManageDialogOpen] = useState(false);

	const { isSkillStarred, toggleSkillStar } = useFavorites();
	const isStarred = isSkillStarred(group.items[0].name);
	const { selectedEditor } = useCurrentCodeEditor();

	const skill = group.items[0];
	const primaryScope =
		skill.source === ConfigSource.Project ? "project" : "global";
	const trimmedSkillName = skill.name.trim();
	const canSearchSkillsSh = trimmedSkillName.length >= 2;

	const handleSearchSkillsSh = () => {
		if (!canSearchSkillsSh) {
			return;
		}

		setLocation(
			`/skills-sh/search?q=${encodeURIComponent(trimmedSkillName)}`,
		);
	};

	const openFolderMutation = useMutation({
		mutationFn: (skillPath: string) => api.skills.openFolder(skillPath),
	});

	const openInEditorMutation = useMutation({
		mutationFn: async (path: string) => {
			if (!selectedEditor) {
				throw new Error("No configured code editor");
			}

			return api.integrations.openWithEditor(path, selectedEditor);
		},
	});

	const { data: globalLock } = useQuery<GlobalSkillLockResponse>({
		queryKey: ["skill-locks", "global"],
		queryFn: () => api.skills.getGlobalLock(),
		staleTime: 30_000,
	});

	const { data: projectLock } = useQuery<ProjectSkillLockResponse>({
		queryKey: ["skill-locks", "project", projectPath],
		queryFn: () => api.skills.getProjectLock(projectPath),
		staleTime: 30_000,
	});

	const { data: skillContent } = useQuery<string>({
		queryKey: ["skill-content", skill.source_path],
		queryFn: () => api.skills.getContent(skill.source_path!),
		enabled: !!skill.source_path,
		staleTime: 60_000,
	});

	const { data: skillTree } = useQuery<SkillTreeNodeResponse>({
		queryKey: ["skill-tree", skill.source_path],
		queryFn: () => api.skills.getTree(skill.source_path!),
		enabled: !!skill.source_path,
		staleTime: 60_000,
	});

	const currentSkillSource = useMemo(() => {
		const skillItem = group.items[0];
		if (skillItem.source === ConfigSource.Global) {
			const entry = globalLock?.skills.find((s) => s.name === skill.name);
			if (entry) {
				return {
					source: entry.source,
					sourceType: entry.sourceType,
					hash: entry.skillFolderHash,
					sourceUrl: entry.sourceUrl,
				};
			}
		} else if (skillItem.source === ConfigSource.Project) {
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

	const allLocationGroups = useMemo(
		() => buildLocationGroups(group.items, allAgents),
		[group.items, allAgents],
	);

	const displayedLocations =
		showAllLocations || allLocationGroups.length <= 3
			? allLocationGroups
			: allLocationGroups.slice(0, 2);
	const hasMoreLocations = allLocationGroups.length > 3;
	const hiddenLocationCount = allLocationGroups.length - 2;
	const resourceCount = useMemo(
		() => (skillTree ? countTreeNodes(skillTree) : 0),
		[skillTree],
	);
	const hasSupplementaryFiles = useMemo(
		() => (skillTree ? hasSupplementarySkillFiles(skillTree) : false),
		[skillTree],
	);

	return (
		<>
			<div className="h-full overflow-y-auto">
				<div className="w-full max-w-2xl space-y-4 p-4 sm:p-6">
					<Card>
						<Card.Header className="flex flex-row items-start justify-between gap-3">
							<div className="min-w-0 flex-1">
								<h2 className="text-xl font-semibold text-foreground truncate">
									{skill.name}
								</h2>
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
							</div>
						</Card.Header>

						<Card.Content className="flex flex-col gap-6">
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
											(locationGroup) => (
												<LocationRow
													key={locationGroup.key}
													group={locationGroup}
													onDelete={() =>
														setLocationToDelete(
															locationGroup,
														)
													}
													onEditFolder={() =>
														openInEditorMutation.mutate(
															locationGroup.sourcePath,
														)
													}
													onOpenFolder={() =>
														openFolderMutation.mutate(
															locationGroup.sourcePath,
														)
													}
												/>
											),
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
											<div className="flex shrink-0 items-center">
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

							<Card.Footer className="pt-4 border-t border-separator flex flex-wrap gap-3">
								<Button
									variant="secondary"
									onPress={() => setTransferDialogOpen(true)}
								>
									<PlusIcon className="size-4" />
									{t("transfer")}
								</Button>
								<Button
									variant="primary"
									onPress={() => setManageDialogOpen(true)}
								>
									<PlusIcon className="size-4" />
									{t("addToAgent")}
								</Button>
							</Card.Footer>
						</Card.Content>
					</Card>

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

					{skillTree && hasSupplementaryFiles && (
						<Accordion variant="surface">
							<Accordion.Item>
								<Accordion.Heading>
									<Accordion.Trigger>
										<div className="flex min-w-0 flex-1 flex-col items-start text-left">
											<span>{t("skillFiles")}</span>
											<span className="text-xs font-normal text-muted">
												{t("skillFilesDescription", {
													count: resourceCount,
												})}
											</span>
										</div>
										<Accordion.Indicator>
											<ChevronDownIcon className="size-4" />
										</Accordion.Indicator>
									</Accordion.Trigger>
								</Accordion.Heading>
								<Accordion.Panel>
									<Accordion.Body>
										<div className="space-y-3">
											{selectedEditor && (
												<div className="flex justify-start">
													<Button
														variant="ghost"
														size="sm"
														onPress={() =>
															openInEditorMutation.mutate(
																skillTree.path,
															)
														}
													>
														<CodeBracketIcon className="size-4" />
														{t("editInEditor")}
													</Button>
												</div>
											)}
											<SkillTree root={skillTree} />
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
			/>
			<TransferDialog
				isOpen={transferDialogOpen}
				onClose={() => setTransferDialogOpen(false)}
				resourceType="skill"
				name={skill.name}
				sourceAgent={skill.agent ?? "claude"}
				sourceScope={primaryScope}
				sourceProjectRoot={projectPath}
			/>
			<ManageSkillAgentsDialog
				group={group}
				isOpen={manageDialogOpen}
				onClose={() => setManageDialogOpen(false)}
				projectPath={projectPath}
			/>
		</>
	);
}
