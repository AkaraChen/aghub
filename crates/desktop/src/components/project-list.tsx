import {
	ChevronDownIcon,
	ChevronUpIcon,
	EllipsisVerticalIcon,
	FolderIcon,
	PencilIcon,
	PlusIcon,
	TrashIcon,
} from "@heroicons/react/24/solid";
import { Button, Dropdown, Label, Menu } from "@heroui/react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "wouter";
import {
	useProjects,
	useRemoveProject,
	useRenameProject,
} from "../hooks/use-projects";
import type { Project } from "../lib/store";
import { cn } from "../lib/utils";
import { ContextMenu, useContextMenu } from "./context-menu";
import { CreateProjectDialog } from "./edit-project-dialog";
import { GroupNameDialog } from "./resource-group-dialogs";

interface ProjectListItemProps {
	project: Project;
	isActive: boolean;
}

function ProjectListItem({ project, isActive }: ProjectListItemProps) {
	const { t } = useTranslation();
	const removeProject = useRemoveProject();
	const renameProject = useRenameProject();
	const [isOpen, setIsOpen] = useState(false);
	const [isRenameOpen, setIsRenameOpen] = useState(false);
	const contextMenu = useContextMenu<null>();

	const handleAction = (key: React.Key) => {
		if (key === "rename") setIsRenameOpen(true);
		else if (key === "delete") removeProject.mutate(project.id);
	};

	return (
		<div className="group relative">
			<Link
				href={`/projects/${project.id}`}
				onContextMenu={(event) => contextMenu.open(event, null)}
				className={cn(
					"flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors select-none",
					isActive
						? "bg-surface font-medium text-foreground"
						: "text-muted hover:bg-surface-secondary hover:text-foreground",
				)}
			>
				<FolderIcon className="size-4 shrink-0" />
				<span className="truncate">{project.name}</span>
			</Link>
			<Dropdown isOpen={isOpen} onOpenChange={setIsOpen}>
				<Button
					isIconOnly
					variant="ghost"
					size="sm"
					aria-label={t("actions")}
					className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted opacity-0 group-hover:opacity-100 data-[pressed]:opacity-100 data-[open]:opacity-100"
				>
					<EllipsisVerticalIcon className="size-4" />
				</Button>
				<Dropdown.Popover placement="bottom end">
					<Dropdown.Menu onAction={handleAction}>
						<Dropdown.Item id="rename" textValue={t("rename")}>
							{t("rename")}
						</Dropdown.Item>
						<Dropdown.Item
							id="delete"
							textValue={t("remove")}
							variant="danger"
						>
							{t("remove")}
						</Dropdown.Item>
					</Dropdown.Menu>
				</Dropdown.Popover>
			</Dropdown>

			<ContextMenu
				position={contextMenu.state?.position ?? null}
				onClose={contextMenu.close}
				aria-label={t("actions")}
			>
				<Menu.Item
					id="rename"
					textValue={t("rename")}
					onAction={() => setIsRenameOpen(true)}
				>
					<div className="flex items-center gap-2">
						<PencilIcon className="size-4" />
						<Label>{t("rename")}</Label>
					</div>
				</Menu.Item>
				<Menu.Item
					id="delete"
					textValue={t("remove")}
					onAction={() => removeProject.mutate(project.id)}
				>
					<div className="flex items-center gap-2 text-danger">
						<TrashIcon className="size-4" />
						<Label>{t("remove")}</Label>
					</div>
				</Menu.Item>
			</ContextMenu>

			<GroupNameDialog
				isOpen={isRenameOpen}
				onClose={() => setIsRenameOpen(false)}
				title={t("renameProject")}
				initialName={project.name}
				onSubmit={async (name) => {
					await renameProject.mutateAsync({ id: project.id, name });
				}}
			/>
		</div>
	);
}

export function ProjectList() {
	const { t } = useTranslation();
	const [location] = useLocation();
	const { data: projects = [] } = useProjects();
	const [isExpanded, setIsExpanded] = useState(true);
	const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);

	const ChevronIcon = isExpanded ? ChevronUpIcon : ChevronDownIcon;

	return (
		<>
			{/* Projects Header */}
			<div>
				<div className="flex items-center justify-between px-2 py-1">
					<button
						className="flex flex-1 items-center gap-2"
						onClick={() => setIsExpanded(!isExpanded)}
					>
						<h3 className="text-xs font-medium tracking-wide text-muted uppercase">
							{t("projects")}
						</h3>
						<ChevronIcon className="size-3 text-muted" />
					</button>
					<button
						className="
        flex size-5 min-w-0 items-center justify-center rounded-sm text-muted
        hover:bg-surface-secondary hover:text-foreground
      "
						data-tour="project-add"
						aria-label={t("addProject")}
						onClick={(e) => {
							e.stopPropagation();
							setIsCreateDialogOpen(true);
						}}
					>
						<PlusIcon className="size-3" />
					</button>
				</div>

				{/* Projects List */}
				{isExpanded && (
					<div className="flex flex-col gap-0.5">
						{projects.map((project) => (
							<ProjectListItem
								key={project.id}
								project={project}
								isActive={
									location === `/projects/${project.id}`
								}
							/>
						))}
					</div>
				)}
			</div>

			{/* Create Dialog */}
			<CreateProjectDialog
				key={isCreateDialogOpen ? "open" : "closed"}
				isOpen={isCreateDialogOpen}
				onClose={() => setIsCreateDialogOpen(false)}
			/>
		</>
	);
}
