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
import { Button, Card, Chip, Modal, Spinner } from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as pathe from "pathe";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { createApi } from "../lib/api";
import type {
	GlobalSkillLockResponse,
	ProjectSkillLockResponse,
	SkillResponse,
} from "../lib/api-types";
import { ConfigSource } from "../lib/api-types";
import { useServer } from "../hooks/use-server";

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
	const [showAll, setShowAll] = useState(false);

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
				<div className="max-w-3xl space-y-4 p-6">
					{/* Main Info Card */}
					<Card variant="default">
						<Card.Header className="flex flex-row items-start justify-between gap-3">
							<div className="flex-1">
								<Card.Title>{skill.name}</Card.Title>
								{skill.description && (
									<Card.Description className="mt-2">
										{skill.description}
									</Card.Description>
								)}
							</div>
							<Button
								isIconOnly
								variant="ghost"
								size="sm"
								className="shrink-0 text-muted hover:text-danger"
								aria-label={t("deleteSkill")}
								onPress={() => setDeleteDialogOpen(true)}
							>
								<TrashIcon className="size-4" />
							</Button>
						</Card.Header>

						{(skill.author || skill.version) && (
							<Card.Content className="flex gap-6 border-t border-border pt-4">
								{skill.author && (
									<div>
										<span className="mb-0.5 block text-xs text-muted">
											{t("author")}
										</span>
										<span className="text-sm text-foreground">
											{skill.author}
										</span>
									</div>
								)}
								{skill.version && (
									<div>
										<span className="mb-0.5 block text-xs text-muted">
											{t("version")}
										</span>
										<span className="font-mono text-sm text-foreground">
											{skill.version}
										</span>
									</div>
								)}
							</Card.Content>
						)}
					</Card>

					{/* Locations Card */}
					<Card variant="default">
						<Card.Header>
							<Card.Title>
								{t("locations")} (
								{globalLocationGroups.length + projectLocationGroups.length})
							</Card.Title>
						</Card.Header>
						<Card.Content>
							<CollapsibleLocations
								locations={[
									...globalLocationGroups,
									...projectLocationGroups,
								]}
								showAll={showAll}
								onToggle={() => setShowAll(!showAll)}
								openFolderMutation={openFolderMutation}
								editFolderMutation={editFolderMutation}
							/>
						</Card.Content>
					</Card>

					{/* Tools Card */}
					{skill.tools.length > 0 && (
						<Card variant="default">
							<Card.Header>
								<Card.Title>
									{t("tools")} ({skill.tools.length})
								</Card.Title>
							</Card.Header>
							<Card.Content>
								<div className="flex flex-wrap gap-1.5">
									{skill.tools.map((tool) => (
										<Chip key={tool} size="sm">
											{tool}
										</Chip>
									))}
								</div>
							</Card.Content>
						</Card>
					)}

					{/* Installation Source Card */}
					{currentSkillSource && (
						<Card variant="default">
							<Card.Header>
								<Card.Title>
									<span className="flex items-center gap-2">
										<GlobeAltIcon className="size-4" />
										{t("installedFrom")}
									</span>
								</Card.Title>
							</Card.Header>
							<Card.Content>
								<p className="truncate text-sm font-medium text-foreground">
									{currentSkillSource.source}
								</p>
								<div className="mt-1 flex items-center gap-2">
									<p className="text-xs text-muted">
										{currentSkillSource.sourceType}
									</p>
									<span className="font-mono text-xs text-muted">
										<HashtagIcon className="inline size-3" />{" "}
										{currentSkillSource.hash.slice(0, 8)}...
									</span>
								</div>
							</Card.Content>
						</Card>
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
	locations: LocationGroup[];
	showAll: boolean;
	onToggle: () => void;
	openFolderMutation: { mutate: (path: string) => void; isPending: boolean };
	editFolderMutation: { mutate: (path: string) => void; isPending: boolean };
}

function CollapsibleLocations({
	locations,
	showAll,
	onToggle,
	openFolderMutation,
	editFolderMutation,
}: CollapsibleLocationsProps) {
	const { t } = useTranslation();
	const hasMore = locations.length > 2;
	const displayLocations =
		showAll || !hasMore ? locations : locations.slice(0, 2);
	const hiddenCount = locations.length - 2;

	return (
		<div>
			<div className="grid grid-cols-2 gap-2">
				{displayLocations.map((group) => (
					<LocationItem
						key={group.sourcePath}
						group={group}
						onOpenFolder={() =>
							openFolderMutation.mutate(group.sourcePath)
						}
						onEditFolder={() =>
							editFolderMutation.mutate(group.sourcePath)
						}
						isOpening={openFolderMutation.isPending}
						isEditing={editFolderMutation.isPending}
					/>
				))}
			</div>
			{hasMore && (
				<button
					type="button"
					onClick={onToggle}
					className="
       mt-2 flex items-center gap-1 text-xs text-muted transition-colors
       hover:text-foreground
     "
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

	const folderPath = useMemo(() => {
		return pathe.dirname(group.sourcePath);
	}, [group.sourcePath]);

	return (
		<div className="
    flex items-center justify-between gap-2 rounded-lg border border-border
    bg-accent-soft p-2.5
  ">
			<div className="min-w-0 flex-1">
				<p className="mb-0.5 truncate text-xs font-medium text-foreground">
					{group.agents.map(formatAgentName).join(", ")}
				</p>
				<p
					className="truncate font-mono text-xs text-muted"
					title={group.sourcePath}
				>
					{folderPath}
				</p>
			</div>
			<div className="flex items-center gap-1">
				<Button
					isIconOnly
					variant="ghost"
					size="sm"
					className="
       shrink-0 text-muted
       hover:text-foreground
     "
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
					className="
       shrink-0 text-muted
       hover:text-foreground
     "
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
						item.source === ConfigSource.Project
							? "project"
							: "global";
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
						<p className="mb-4 text-sm text-muted">
							{t("deleteSkillWarning", {
								count: group.items.length,
							})}
						</p>

						<div className="space-y-4">
							{globalItems.length > 0 && (
								<div>
									<h4 className="
           mb-2 text-xs font-medium tracking-wide text-muted uppercase
         ">
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
														? item.agent
																.charAt(0)
																.toUpperCase() +
															item.agent
																.slice(1)
																.toLowerCase()
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
									<h4 className="
           mb-2 text-xs font-medium tracking-wide text-muted uppercase
         ">
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
														? item.agent
																.charAt(0)
																.toUpperCase() +
															item.agent
																.slice(1)
																.toLowerCase()
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
