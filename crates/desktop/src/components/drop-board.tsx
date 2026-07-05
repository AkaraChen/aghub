import { useDroppable } from "@dnd-kit/core";
import {
	FolderIcon,
	FolderMinusIcon,
	FolderPlusIcon,
} from "@heroicons/react/24/solid";
import type { ComponentType, SVGProps } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "../lib/utils";
import {
	boardDropId,
	groupDropId,
	NEW_GROUP_DROP_ID,
	UNGROUPED_DROP_ID,
} from "./list-dnd";

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

interface BoardCardProps {
	dropId: string;
	testId: string;
	icon: IconComponent;
	title: string;
	subtitle: string;
	dashed?: boolean;
	index: number;
}

function BoardCard({
	dropId,
	testId,
	icon: Icon,
	title,
	subtitle,
	dashed,
	index,
}: BoardCardProps) {
	const { setNodeRef, isOver } = useDroppable({ id: dropId });
	return (
		<div
			ref={setNodeRef}
			data-testid={testId}
			style={{ animationDelay: `${index * 30}ms` }}
			className={cn(
				"flex flex-col gap-1 rounded-xl border p-3 animate-[board-card-in_var(--dur-base)_var(--ease-out)_both] transition-[background-color,transform] duration-[var(--dur-fast)] ease-[var(--ease-out)]",
				dashed
					? "border-dashed border-separator bg-transparent"
					: "border-border bg-surface",
				isOver &&
					"scale-[1.02] border-accent bg-accent/10 ring-1 ring-inset ring-accent",
			)}
		>
			<Icon
				className={cn("size-5", isOver ? "text-accent" : "text-muted")}
			/>
			<span
				className={cn(
					"truncate text-sm font-medium",
					isOver ? "text-accent" : "text-foreground",
				)}
			>
				{title}
			</span>
			<span className="truncate text-xs text-muted">{subtitle}</span>
		</div>
	);
}

export interface DropBoardGroup {
	id: string;
	name: string;
	count: number;
}

interface DropBoardProps {
	/** Number of items being dragged, for the heading */
	count: number;
	/** Custom groups shown as cards */
	groups: DropBoardGroup[];
	/** Show the ungrouped card (a dragged item is currently grouped) */
	showUngrouped: boolean;
}

/**
 * Right-panel target board shown while dragging list items. Mirrors the
 * list's drop targets as large cards under a `board:` id so far-away
 * groups are reachable without scrolling, and search-filtered groups are
 * still droppable.
 */
export function DropBoard({ count, groups, showUngrouped }: DropBoardProps) {
	const { t } = useTranslation();
	let index = 0;

	return (
		<div className="flex h-full flex-col gap-3 overflow-y-auto p-4 sm:p-6">
			<p className="text-sm text-muted">
				{t("dragBoardTitle", { count })}
			</p>
			<div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
				{groups.map((group) => (
					<BoardCard
						key={group.id}
						dropId={boardDropId(groupDropId(group.id))}
						testId={`board-card-${group.name}`}
						icon={FolderIcon}
						title={group.name}
						subtitle={t("memberCount", { count: group.count })}
						index={index++}
					/>
				))}
				{showUngrouped && (
					<BoardCard
						dropId={boardDropId(UNGROUPED_DROP_ID)}
						testId="board-card-ungrouped"
						icon={FolderMinusIcon}
						title={t("ungrouped")}
						subtitle={t("removeFromGroup")}
						index={index++}
					/>
				)}
				<BoardCard
					dropId={boardDropId(NEW_GROUP_DROP_ID)}
					testId="board-card-new-group"
					icon={FolderPlusIcon}
					title={t("createGroup")}
					subtitle={t("dragBoardNewGroupHint")}
					dashed
					index={index++}
				/>
			</div>
		</div>
	);
}

interface DragPreviewProps {
	label: string;
	count: number;
	icon: IconComponent;
}

/** The floating drag image rendered inside dnd-kit's DragOverlay. */
export function DragPreview({ label, count, icon: Icon }: DragPreviewProps) {
	return (
		<div className="flex items-center gap-2 rounded-lg border border-separator bg-surface px-3 py-2 text-sm font-medium text-foreground shadow-[var(--overlay-shadow)]">
			<Icon className="size-4 shrink-0 text-muted" />
			<span className="max-w-[220px] truncate">{label}</span>
			{count > 1 && (
				<span className="ml-1 inline-flex h-5 min-w-5 animate-[badge-pop_var(--dur-fast)_var(--ease-out)] items-center justify-center rounded-full bg-accent px-1.5 text-xs text-accent-foreground">
					{count}
				</span>
			)}
		</div>
	);
}
