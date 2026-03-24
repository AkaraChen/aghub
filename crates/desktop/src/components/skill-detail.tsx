import {
	ChevronDownIcon,
	ChevronUpIcon,
	CodeBracketIcon,
	ExclamationTriangleIcon,
	FolderIcon,
	GlobeAltIcon,
	HashtagIcon,
	TrashIcon,
	XCircleIcon,
} from "@heroicons/react/24/solid";
import {
	Button,
	Chip,
	Modal,
	Spinner,
} from "@heroui/react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useServer } from "../providers/server";
import { createApi } from "../lib/api";
import { ConfigSource } from "../lib/api-types";
import type { SkillResponse } from "../lib/api-types";
import type {
	GlobalSkillLockResponse,
	ProjectSkillLockResponse,
} from "../lib/api-types";

interface LocationGroup {
	sourcePath: string;
	agents: string[];
}

export interface SkillGroup {
	name: string;
	items: SkillResponse[];
}

interface SkillDetailProps {
	group: SkillGroup;
	projectPath?: string;
}

export function SkillDetail({ group, projectPath }: SkillDetailProps) {
	const { t } = useTranslation();
	const { baseUrl } = useServer();
	const api = createApi(baseUrl);

	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
	const [showAllGlobal, setShowAllGlobal] = useState(false);
	const [showAllProject, setShowAllProject] = useState(false);

	const skill = group.items[0];

	const openFolderMutation = useMutation({
		mutationFn: (skillPath: string) => api.skills.openFolder(skillPath),
	});

	const editFolderMutation = useMutation({
		mutationFn: (skillPath: string) => api.skills.editFolder(skillPath),
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

	const currentSkillSource = useMemo(() => {
		const skillItem = group.items[0];
		if (skillItem.source === ConfigSource.Global) {
			const entry = globalLock?.skills.find((s) => s.name === skill.name);
			if (entry) {
				return {
					source: entry.source,
					sourceType: entry.sourceType,
					hash: entry.skillFolderHash,
					scope: "global",
				};
			}
		} else if (skillItem.source === ConfigSource.Project) {
			const entry = projectLock?.skills.find((s) => s.name === skill.name);
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

	const globalItems = group.items.filter(
		(item) => item.source === ConfigSource.Global,
	);
	const projectItems = group.items.filter(
		(item) => item.source === ConfigSource.Project,
	);

	const groupBySourcePath = (items: SkillResponse[]): LocationGroup[] => {
		const map = new Map<string, string[]>();
		for (const item of items) {
			const path = item.source_path ?? "";
			if (!map.has(path)) {
				map.set(path, []);
			}
			if (item.agent) {
				map.get(path)?.push(item.agent);
			}
		}
		return Array.from(map.entries())
			.filter(([path]) => path !== "")
			.map(([sourcePath, agents]) => ({ sourcePath, agents }));
	};

	const globalLocationGroups = useMemo(
		() => groupBySourcePath(globalItems),
		[globalItems],
	);
	const projectLocationGroups = useMemo(
		() => groupBySourcePath(projectItems),
		[projectItems],
	);

	return (
		<>
			<div className="h-full overflow-y-auto">
				<div className="p-6 max-w-3xl">
					<div className="flex items-center justify-between gap-3 mb-2">
						<h2 className="text-xl font-semibold text-foreground truncate">
							{skill.name}
						</h2>
						<div className="flex items-center gap-1">
							<Button
								isIconOnly
								variant="ghost"
								size="sm"
								className="text-muted hover:text-danger shrink-0"
								aria-label={t("deleteSkill")}
								onPress={() => setDeleteDialogOpen(true)}
							>
								<TrashIcon className="size-4" />
							</Button>
						</div>
					</div>

					{skill.description && (
						<div className="mb-6">
							<h3 className="text-xs font-medium text-muted uppercase tracking-wide mb-2">
								{t("description")}
							</h3>
							<p className="text-sm text-foreground">{skill.description}</p>
						</div>
					)}

					<div className="mb-6">
						<h3 className="text-xs font-medium text-muted uppercase tracking-wide mb-3">
							{t("locations")} ({group.items.length})
						</h3>

					{globalLocationGroups.length > 0 && (
						<CollapsibleLocations
							title={t("globalSkills")}
							locations={globalLocationGroups}
							showAll={showAllGlobal}
							onToggle={() => setShowAllGlobal(!showAllGlobal)}
							openFolderMutation={openFolderMutation}
							editFolderMutation={editFolderMutation}
						/>
					)}

					{projectLocationGroups.length > 0 && (
						<CollapsibleLocations
							title={t("projectSkills")}
							locations={projectLocationGroups}
							showAll={showAllProject}
							onToggle={() => setShowAllProject(!showAllProject)}
							openFolderMutation={openFolderMutation}
							editFolderMutation={editFolderMutation}
						/>
					)}
					</div>

					{(skill.author || skill.version) && (
						<div className="mb-6">
							<h3 className="text-xs font-medium text-muted uppercase tracking-wide mb-2">
								{t("metadata")}
							</h3>
							<div className="flex gap-6">
								{skill.author && (
									<div>
										<span className="text-xs text-muted block mb-0.5">
											{t("author")}
										</span>
										<span className="text-sm text-foreground">
											{skill.author}
										</span>
									</div>
								)}
								{skill.version && (
									<div>
										<span className="text-xs text-muted block mb-0.5">
											{t("version")}
										</span>
										<span className="text-sm text-foreground font-mono">
											{skill.version}
										</span>
									</div>
								)}
							</div>
						</div>
					)}

					{skill.tools.length > 0 && (
						<div className="mb-6">
							<h3 className="text-xs font-medium text-muted uppercase tracking-wide mb-2">
								{t("tools")} ({skill.tools.length})
							</h3>
							<div className="flex flex-wrap gap-1.5">
								{skill.tools.map((tool) => (
									<Chip key={tool} size="sm">{tool}</Chip>
								))}
							</div>
						</div>
					)}

					{currentSkillSource && (
						<div className="mb-6">
							<h3 className="text-xs font-medium text-muted uppercase tracking-wide mb-3 flex items-center gap-2">
								<GlobeAltIcon className="size-4" />
								{t("installedFrom")}
							</h3>
							<div className="p-3 border border-border rounded-lg bg-surface">
								<p className="text-sm font-medium text-foreground truncate">
									{currentSkillSource.source}
								</p>
								<div className="flex items-center gap-2 mt-1">
									<p className="text-xs text-muted">{currentSkillSource.sourceType}</p>
									<span className="text-xs text-muted font-mono">
										<HashtagIcon className="size-3 inline" /> {currentSkillSource.hash.slice(0, 8)}...
									</span>
								</div>
							</div>
						</div>
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

interface CollapsibleLocationsProps {
	title: string;
	locations: LocationGroup[];
	showAll: boolean;
	onToggle: () => void;
	openFolderMutation: { mutate: (path: string) => void; isPending: boolean };
	editFolderMutation: { mutate: (path: string) => void; isPending: boolean };
}

function CollapsibleLocations({
	title,
	locations,
	showAll,
	onToggle,
	openFolderMutation,
	editFolderMutation,
}: CollapsibleLocationsProps) {
	const { t } = useTranslation();
	const hasMore = locations.length > 2;
	const displayLocations = showAll || !hasMore
		? locations
		: locations.slice(0, 2);
	const hiddenCount = locations.length - 2;

	return (
		<div className="mb-4">
			<h4 className="text-xs text-muted mb-2">{title}</h4>
			<div className="space-y-2">
				{displayLocations.map((group) => (
					<LocationItem
						key={group.sourcePath}
						group={group}
						onOpenFolder={() => openFolderMutation.mutate(group.sourcePath)}
						onEditFolder={() => editFolderMutation.mutate(group.sourcePath)}
						isOpening={openFolderMutation.isPending}
						isEditing={editFolderMutation.isPending}
					/>
				))}
			</div>
			{hasMore && (
				<button
					type="button"
					onClick={onToggle}
					className="flex items-center gap-1 mt-2 text-xs text-muted hover:text-foreground transition-colors"
				>
					{showAll ? (
						<>
							<ChevronUpIcon className="size-3.5" />
							<span>{t("showLess")}</span>
						</>
					) : (
						<>
							<ChevronDownIcon className="size-3.5" />
							<span>{t("showMore", { count: hiddenCount })}</span>
						</>
					)}
				</button>
			)}
		</div>
	);
}

interface LocationItemProps {
	group: LocationGroup;
	onOpenFolder: () => void;
	onEditFolder: () => void;
	isOpening: boolean;
	isEditing: boolean;
}

function formatAgentName(agent: string): string {
	return agent.charAt(0).toUpperCase() + agent.slice(1).toLowerCase();
}

function LocationItem({
	group,
	onOpenFolder,
	onEditFolder,
	isOpening,
	isEditing,
}: LocationItemProps) {
	const { t } = useTranslation();

	return (
		<div className="flex items-center justify-between gap-3 p-3 bg-default-50 rounded-lg border border-border">
			<div className="min-w-0 flex-1">
				<div className="flex flex-wrap items-center gap-2 mb-1">
					{group.agents.map((agent) => (
						<Chip key={agent} size="sm" variant="secondary">
							{formatAgentName(agent)}
						</Chip>
					))}
				</div>
				<p className="text-xs text-muted font-mono truncate">
					{group.sourcePath}
				</p>
			</div>
			<div className="flex items-center gap-1">
				<Button
					isIconOnly
					variant="ghost"
					size="sm"
					className="text-muted hover:text-foreground shrink-0"
					aria-label={t("editInEditor")}
					onPress={onEditFolder}
					isDisabled={isEditing}
				>
					{isEditing ? (
						<Spinner size="sm" />
					) : (
						<CodeBracketIcon className="size-4" />
					)}
				</Button>
				<Button
					isIconOnly
					variant="ghost"
					size="sm"
					className="text-muted hover:text-foreground shrink-0"
					aria-label={t("openFolder")}
					onPress={onOpenFolder}
					isDisabled={isOpening}
				>
					{isOpening ? (
						<Spinner size="sm" />
					) : (
						<FolderIcon className="size-4" />
					)}
				</Button>
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
	const api = createApi(baseUrl);
	const queryClient = useQueryClient();

	const skill = group.items[0];

	const deleteMutation = useMutation({
		mutationFn: async () => {
			await Promise.all(
				group.items.map(async (item) => {
					if (!item.agent) return;
					const scope =
						item.source === ConfigSource.Project ? "project" : "global";
					return api.skills.delete(
						item.agent,
						skill.name,
						scope,
						projectPath,
					);
				}),
			);
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["skills"] });
			queryClient.invalidateQueries({ queryKey: ["project-skills"] });
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
						<p className="text-sm text-muted mb-4">
							{t("deleteSkillWarning", { count: group.items.length })}
						</p>

						<div className="space-y-4">
							{globalItems.length > 0 && (
								<div>
									<h4 className="text-xs font-medium text-muted uppercase tracking-wide mb-2">
										{t("globalSkills")}
									</h4>
									<div className="space-y-2">
										{globalItems.map((item) => (
											<div
												key={item.agent}
												className="flex items-center gap-2 text-sm"
											>
												<XCircleIcon className="size-4 text-danger shrink-0" />
												<span className="text-foreground">
													{item.agent
														? item.agent.charAt(0).toUpperCase() +
														  item.agent.slice(1).toLowerCase()
														: t("default")}
												</span>
												{item.source_path && (
													<span className="text-muted text-xs truncate flex-1">
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
									<h4 className="text-xs font-medium text-muted uppercase tracking-wide mb-2">
										{t("projectSkills")}
									</h4>
									<div className="space-y-2">
										{projectItems.map((item) => (
											<div
												key={item.agent}
												className="flex items-center gap-2 text-sm"
											>
												<XCircleIcon className="size-4 text-danger shrink-0" />
												<span className="text-foreground">
													{item.agent
														? item.agent.charAt(0).toUpperCase() +
														  item.agent.slice(1).toLowerCase()
														: t("default")}
												</span>
												{item.source_path && (
													<span className="text-muted text-xs truncate flex-1">
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
