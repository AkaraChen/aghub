import { StarIcon as StarIconOutline } from "@heroicons/react/24/outline";
import {
	ChevronDownIcon,
	ChevronUpIcon,
	CodeBracketIcon,
	DocumentIcon,
	ExclamationTriangleIcon,
	FolderIcon,
	GlobeAltIcon,
	HashtagIcon,
	LinkIcon,
	StarIcon as StarIconSolid,
	TrashIcon,
	XCircleIcon,
} from "@heroicons/react/24/solid";
import {
	Accordion,
	Button,
	Card,
	Chip,
	Modal,
	Spinner,
	Tooltip,
} from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import * as pathe from "pathe";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { siGithub } from "simple-icons";
import { useAgentAvailability } from "../hooks/use-agent-availability";
import { useFavorites } from "../hooks/use-favorites";
import { useCurrentCodeEditor } from "../hooks/use-integrations";
import { useServer } from "../hooks/use-server";
import { createApi } from "../lib/api";
import type {
	GlobalSkillLockResponse,
	ProjectSkillLockResponse,
	SkillResponse,
	SkillTreeNodeResponse,
} from "../lib/api-types";
import { ConfigSource } from "../lib/api-types";
import { cn, sortAgents } from "../lib/utils";

interface LocationGroup {
	sourcePath: string;
	agents: string[];
	canonicalPath?: string;
}

interface SkillGroup {
	name: string;
	items: SkillResponse[];
}

interface SkillDetailProps {
	group: SkillGroup;
	projectPath?: string;
}

// Module-scoped regex for better performance
const GITHUB_PREFIX_REGEX = /^github\//;
const SKILL_MARKDOWN_FILE = "SKILL.md";

function getNodeChildren(node: SkillTreeNodeResponse): SkillTreeNodeResponse[] {
	return Array.isArray(node.children) ? node.children : [];
}

function hasSupplementarySkillFiles(node: SkillTreeNodeResponse): boolean {
	return getNodeChildren(node).some((child) => {
		if (child.name !== SKILL_MARKDOWN_FILE) {
			return true;
		}

		return hasSupplementarySkillFiles(child);
	});
}

function formatAgentName(agent: string): string {
	return agent.charAt(0).toUpperCase() + agent.slice(1).toLowerCase();
}

export function SkillDetail({ group, projectPath }: SkillDetailProps) {
	const { t } = useTranslation();
	const { allAgents } = useAgentAvailability();
	const { baseUrl } = useServer();
	const api = useMemo(() => createApi(baseUrl), [baseUrl]);

	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
	const [showAllLocations, setShowAllLocations] = useState(false);

	const { isSkillStarred, toggleSkillStar } = useFavorites();
	const isStarred = isSkillStarred(group.items[0].name);
	const { selectedEditor } = useCurrentCodeEditor();

	const skill = group.items[0];

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

	// Fetch skill content (SKILL.md body)
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
					scope: "global",
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
					scope: "project",
				};
			}
		}
		return null;
	}, [globalLock, projectLock, skill.name, group.items]);

	const sourceUrl = useMemo(() => {
		if (!currentSkillSource) return null;
		if (currentSkillSource.sourceUrl) return currentSkillSource.sourceUrl;
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

	const primarySource = skill.source;

	// Group locations across all items
	const allLocationGroups = useMemo(() => {
		const map = new Map<
			string,
			{ agents: string[]; canonicalPath?: string }
		>();
		for (const item of group.items) {
			const path = item.source_path ?? "";
			if (path === "") continue;
			if (!map.has(path)) {
				map.set(path, {
					agents: [],
					canonicalPath: item.canonical_path,
				});
			}
			if (item.agent) {
				map.get(path)?.agents.push(item.agent);
			}
		}
		return Array.from(map.entries()).map(([sourcePath, data]) => ({
			sourcePath,
			agents: sortAgents(data.agents, allAgents),
			canonicalPath: data.canonicalPath,
		}));
	}, [group.items, allAgents]);

	// Metadata pieces for subtitle
	const metaParts: string[] = [];
	if (skill.author) metaParts.push(skill.author);
	if (skill.version) metaParts.push(`v${skill.version}`);
	if (primarySource) {
		metaParts.push(
			primarySource === ConfigSource.Project ? t("project") : t("global"),
		);
	}

	const displayedLocations =
		showAllLocations || allLocationGroups.length <= 3
			? allLocationGroups
			: allLocationGroups.slice(0, 2);
	const hasMoreLocations = allLocationGroups.length > 3;
	const hiddenLocationCount = allLocationGroups.length - 2;
	const resourceCount = useMemo(() => {
		function countNodes(node: SkillTreeNodeResponse): number {
			return (
				getNodeChildren(node).length +
				getNodeChildren(node).reduce(
					(total, child) => total + countNodes(child),
					0,
				)
			);
		}

		return skillTree ? countNodes(skillTree) : 0;
	}, [skillTree]);
	const hasSupplementaryFiles = useMemo(
		() => (skillTree ? hasSupplementarySkillFiles(skillTree) : false),
		[skillTree],
	);

	return (
		<>
			<div className="h-full overflow-y-auto">
				<div
					className="
       max-w-2xl space-y-4 p-4
       sm:p-5
       md:p-6
     "
				>
					{/* Main Info Card */}
					<Card>
						<Card.Header className="flex flex-col items-start gap-3">
							<div className="flex w-full flex-row items-start justify-between gap-3">
								<div className="min-w-0 flex-1">
									<h2 className="text-xl font-semibold text-foreground">
										{skill.name}
									</h2>
								</div>
								<div
									className="
          flex items-center gap-1.5
          sm:gap-2
        "
								>
									<Tooltip delay={0}>
										<Button
											isIconOnly
											variant="ghost"
											size="md"
											className={cn(
												"min-h-11 min-w-11 text-muted hover:text-warning",
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
											className="
            min-h-11 min-w-11 text-muted
            hover:text-danger
          "
											aria-label={t("deleteSkill")}
											onPress={() =>
												setDeleteDialogOpen(true)
											}
										>
											<TrashIcon className="size-5" />
										</Button>
										<Tooltip.Content>
											{t("deleteSkill")}
										</Tooltip.Content>
									</Tooltip>
								</div>
							</div>
						</Card.Header>

						<Card.Content className="space-y-5">
							{/* Description */}
							{skill.description && (
								<p className="text-sm/relaxed text-foreground">
									{skill.description}
								</p>
							)}

							{/* Tools */}
							{skill.tools.length > 0 ? (
								<div>
									<p
										className="
            mb-2 text-xs font-medium tracking-wider text-muted uppercase
          "
									>
										{t("tools")} ({skill.tools.length})
									</p>
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
							) : null}

							{/* Locations */}
							{allLocationGroups.length > 0 && (
								<div>
									<p
										className="
            mb-2 text-xs font-medium tracking-wider text-muted uppercase
          "
									>
										{t("locations")} (
										{allLocationGroups.length})
									</p>
									<div className="space-y-1.5">
										{displayedLocations.map((loc) => (
											<LocationRow
												key={loc.sourcePath}
												group={loc}
												onOpenFolder={() =>
													openFolderMutation.mutate(
														loc.sourcePath,
													)
												}
												onEditFolder={() =>
													openInEditorMutation.mutate(
														loc.sourcePath,
													)
												}
											/>
										))}
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
             mt-2 flex items-center gap-1 text-xs text-muted transition-colors
             hover:text-foreground
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

							{/* Installation Source */}
							{currentSkillSource && (
								<div>
									<p
										className="
            mb-2 text-xs font-medium tracking-wider text-muted uppercase
          "
									>
										{t("installedFrom")}
									</p>
									<div
										className="
            flex items-center justify-between gap-3 rounded-lg
            bg-surface-secondary px-3 py-2
          "
									>
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
						</Card.Content>
					</Card>

					{/* Skill Content — collapsed by default */}
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
		</>
	);
}

function SkillTree({ root }: { root: SkillTreeNodeResponse }) {
	const items = flattenTree(root);

	return (
		<div className="rounded-xl border border-default-200/60 bg-surface-secondary/60 p-2">
			{items.map((node) => (
				<TreeNodeRow key={node.path} node={node} />
			))}
		</div>
	);
}

function flattenTree(
	root: SkillTreeNodeResponse,
): Array<SkillTreeNodeResponse & { depth?: number }> {
	const items: Array<SkillTreeNodeResponse & { depth?: number }> = [];

	function visit(node: SkillTreeNodeResponse, depth: number): void {
		for (const child of getNodeChildren(node)) {
			items.push({ ...child, depth });
			visit(child, depth + 1);
		}
	}

	visit(root, 1);

	return items;
}

function TreeNodeRow({
	node,
}: {
	node: SkillTreeNodeResponse & { depth?: number };
}) {
	return (
		<div
			className="
				flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm
				text-foreground
			"
			style={{ paddingLeft: `${(node.depth ?? 0) * 16 + 8}px` }}
			title={node.path}
		>
			{node.kind === "directory" ? (
				<FolderIcon className="size-4 shrink-0 text-primary" />
			) : (
				<DocumentIcon className="size-4 shrink-0 text-muted" />
			)}
			<span className="min-w-0 flex-1 truncate">{node.name}</span>
		</div>
	);
}

function LocationRow({
	group,
	onOpenFolder,
	onEditFolder,
}: {
	group: LocationGroup;
	onOpenFolder: () => void;
	onEditFolder: () => void;
}) {
	const { t } = useTranslation();
	const folderPath = useMemo(
		() => pathe.dirname(group.sourcePath),
		[group.sourcePath],
	);

	return (
		<div className="flex items-center justify-between gap-3 rounded-lg bg-surface-secondary px-3 py-2">
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-2">
					<p
						tabIndex={0}
						className="cursor-default truncate rounded-sm font-mono text-xs text-foreground focus:ring-2 focus:ring-offset-2 focus:outline-none"
						title={group.sourcePath}
					>
						{folderPath}
					</p>
					{group.canonicalPath && (
						<Tooltip delay={0}>
							<Button
								isIconOnly
								variant="ghost"
								size="sm"
								className="size-6 text-muted"
								aria-label={t("symlink")}
							>
								<LinkIcon className="size-3" />
							</Button>
							<Tooltip.Content>
								<div className="max-w-xs">
									<p className="mb-1 font-medium">
										{t("symlink")}
									</p>
									<p className="font-mono text-xs">
										{pathe.dirname(group.canonicalPath)}
									</p>
								</div>
							</Tooltip.Content>
						</Tooltip>
					)}
				</div>
				<p className="mt-0.5 text-[11px] text-muted">
					{group.agents.map(formatAgentName).join(", ")}
				</p>
			</div>
			<div className="flex shrink-0 items-center gap-1">
				<Tooltip delay={0}>
					<Button
						isIconOnly
						variant="ghost"
						size="sm"
						className="size-8 text-muted"
						aria-label={t("editInEditor")}
						onPress={onEditFolder}
					>
						<CodeBracketIcon className="size-4" />
					</Button>
					<Tooltip.Content>{t("editInEditor")}</Tooltip.Content>
				</Tooltip>
				<Tooltip delay={0}>
					<Button
						isIconOnly
						variant="ghost"
						size="sm"
						className="size-8 text-muted"
						aria-label={t("openFolder")}
						onPress={onOpenFolder}
					>
						<FolderIcon className="size-4" />
					</Button>
					<Tooltip.Content>{t("openFolder")}</Tooltip.Content>
				</Tooltip>
			</div>
		</div>
	);
}

interface DeleteSkillDialogProps {
	group: SkillGroup;
	isOpen: boolean;
	onClose: () => void;
	projectPath?: string;
}

function DeleteSkillDialog({
	group,
	isOpen,
	onClose,
	projectPath,
}: DeleteSkillDialogProps) {
	const { t } = useTranslation();
	const { baseUrl } = useServer();
	const api = useMemo(() => createApi(baseUrl), [baseUrl]);
	const queryClient = useQueryClient();

	const skill = group.items[0];

	const deleteMutation = useMutation({
		mutationFn: async () => {
			const deletions = group.items
				.filter((item) => item.agent)
				.map((item) => ({
					agent: item.agent!,
					scope:
						item.source === ConfigSource.Project
							? ("project" as const)
							: ("global" as const),
				}));
			const results = await Promise.allSettled(
				deletions.map(({ agent, scope }) =>
					api.skills.delete(agent, skill.name, scope, projectPath),
				),
			);
			const failures = results
				.map((result, index) => ({
					result,
					deletion: deletions[index],
				}))
				.filter(({ result }) => result.status === "rejected");
			if (failures.length > 0) {
				console.error("Skill delete failures:", failures);
				throw new Error(
					`${failures.length} of ${deletions.length} deletions failed`,
				);
			}
		},
		onSettled: () => {
			queryClient.invalidateQueries({ queryKey: ["skills"] });
			queryClient.invalidateQueries({
				queryKey: ["project-skills"],
			});
			onClose();
		},
	});

	const globalItems = group.items.filter(
		(item) => item.source === ConfigSource.Global,
	);
	const projectItems = group.items.filter(
		(item) => item.source === ConfigSource.Project,
	);

	return (
		<Modal.Backdrop isOpen={isOpen} onOpenChange={onClose}>
			<Modal.Container>
				<Modal.Dialog>
					<Modal.CloseTrigger />
					<Modal.Header>
						<div className="flex items-center gap-2">
							<ExclamationTriangleIcon className="size-5 text-warning" />
							<Modal.Heading>{t("deleteSkill")}</Modal.Heading>
						</div>
					</Modal.Header>

					<Modal.Body className="p-2">
						<p className="mb-4 text-sm text-muted">
							{t("deleteSkillWarning", {
								count: group.items.length,
							})}
						</p>

						<div className="space-y-4">
							{globalItems.length > 0 && (
								<div>
									<h4
										className="
            mb-2 text-xs font-medium tracking-wide text-muted uppercase
          "
									>
										{t("globalSkills")}
									</h4>
									<div className="space-y-2">
										{globalItems.map((item) => (
											<div
												key={item.agent}
												className="flex items-center gap-2 text-sm"
											>
												<XCircleIcon className="size-4 shrink-0 text-danger" />
												<span className="text-foreground">
													{item.agent
														? formatAgentName(
																item.agent,
															)
														: t("default")}
												</span>
												{item.source_path && (
													<span className="flex-1 truncate text-xs text-muted">
														{item.source_path}
													</span>
												)}
											</div>
										))}
									</div>
								</div>
							)}

							{projectItems.length > 0 && (
								<div>
									<h4
										className="
            mb-2 text-xs font-medium tracking-wide text-muted uppercase
          "
									>
										{t("projectSkills")}
									</h4>
									<div className="space-y-2">
										{projectItems.map((item) => (
											<div
												key={item.agent}
												className="flex items-center gap-2 text-sm"
											>
												<XCircleIcon className="size-4 shrink-0 text-danger" />
												<span className="text-foreground">
													{item.agent
														? formatAgentName(
																item.agent,
															)
														: t("default")}
												</span>
												{item.source_path && (
													<span className="flex-1 truncate text-xs text-muted">
														{item.source_path}
													</span>
												)}
											</div>
										))}
									</div>
								</div>
							)}
						</div>
					</Modal.Body>

					<Modal.Footer>
						<Button
							slot="close"
							variant="secondary"
							onPress={onClose}
							isDisabled={deleteMutation.isPending}
						>
							{t("cancel")}
						</Button>
						<Button
							variant="danger"
							onPress={() => deleteMutation.mutate()}
							isDisabled={deleteMutation.isPending}
						>
							{deleteMutation.isPending ? (
								<>
									<Spinner size="sm" className="mr-2" />
									{t("deleting")}
								</>
							) : (
								t("deleteAll")
							)}
						</Button>
					</Modal.Footer>
				</Modal.Dialog>
			</Modal.Container>
		</Modal.Backdrop>
	);
}
