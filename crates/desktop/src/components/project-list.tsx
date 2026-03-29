import {
	ChevronDownIcon,
	ChevronUpIcon,
	EllipsisVerticalIcon,
	FolderIcon,
	PlusIcon,
} from "@heroicons/react/24/solid";
import { Button, Dropdown } from "@heroui/react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "wouter";
import { useProjects, useRemoveProject } from "../hooks/use-projects";
import type { Project } from "../lib/store";
import { cn } from "../lib/utils";
import { CreateProjectDialog } from "./edit-project-dialog";

interface ProjectListItemProps {
	project: Project;
	isActive: boolean;
}

function ProjectListItem({ project, isActive }: ProjectListItemProps) {
	const { t } = useTranslation();
	const removeProject = useRemoveProject();
	const [isOpen, setIsOpen] = useState(false);

	const handleAction = (key: React.Key) => {
		if (key === "delete") {
			removeProject.mutate(project.id);
		}
	};

	return (
		<div className="group relative">
			<Link
				href={`/projects/${project.id}`}
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
			<div className="mt-4">
				<div className="flex items-center justify-between px-3 py-2">
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
