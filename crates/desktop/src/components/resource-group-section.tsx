import {
	ChevronRightIcon,
	PlusIcon,
	Square2StackIcon,
} from "@heroicons/react/24/solid";
import { useDndContext, useDraggable, useDroppable } from "@dnd-kit/core";
import { Chip } from "@heroui/react";
import { type ReactNode, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "../lib/utils";
import { NEW_GROUP_DROP_ID } from "./list-dnd";

/** How long a drag hovers a collapsed group before it springs open. */
const SPRING_LOAD_MS = 600;

// The same base classes HeroUI applies to a ListBox.Item, so a group
// header is visually a list item (padding, radius, min-height, hover,
// press-scale) rather than a full-width band.
const LIST_ITEM_CLASS = "list-box-item list-box-item--default";

interface ResourceGroupSectionProps {
	title: string;
	count: number;
	isExpanded: boolean;
	/** Highlights the header while the whole group is selected */
	isSelected: boolean;
	onToggleExpanded: () => void;
	/** Header click selects the whole group */
	onSelectAll: () => void;
	onContextMenu?: (event: React.MouseEvent) => void;
	/** Droppable id; omit to reject drops (source groups) */
	dropId?: string;
	/** Draggable id for the header (drags the whole group) */
	dragId: string;
	/** Member keys carried when the header itself is dragged */
	dragKeys?: string[];
	/** F2 on the focused header opens rename (custom groups) */
	onRename?: () => void;
	/** Render as a peer of the skill rows (source clusters): normal weight,
	 * muted count — not a bold first-class group header */
	subtle?: boolean;
	children?: ReactNode;
}

/**
 * Collapsible group header rendered as a list item: clicking the row
 * selects every member, the leading chevron alone toggles expansion,
 * dragging the header drags the whole group, and custom groups accept
 * member drops.
 */
export function ResourceGroupSection({
	title,
	count,
	isExpanded,
	isSelected,
	onToggleExpanded,
	onSelectAll,
	onContextMenu,
	dropId,
	dragId,
	dragKeys,
	onRename,
	subtle = false,
	children,
}: ResourceGroupSectionProps) {
	const { t } = useTranslation();

	const { setNodeRef: setDropRef, isOver } = useDroppable({
		id: dropId ?? dragId,
		disabled: !dropId,
	});

	const { setNodeRef: setDragRef, listeners } = useDraggable({
		id: dragId,
		data: { keys: dragKeys ?? [] },
		disabled: !dragKeys || dragKeys.length === 0,
	});

	// Subtle clusters cannot accept drops; dim them while a drag is
	// underway so they read as non-targets.
	const { active: dndActive } = useDndContext();
	const isDropInert = subtle && dndActive != null;

	// Spring-loading: hovering a collapsed group mid-drag pops it open so
	// the drag can continue into its members.
	const toggleRef = useRef(onToggleExpanded);
	toggleRef.current = onToggleExpanded;
	useEffect(() => {
		if (!isOver || isExpanded) return;
		const timer = window.setTimeout(
			() => toggleRef.current(),
			SPRING_LOAD_MS,
		);
		return () => window.clearTimeout(timer);
	}, [isOver, isExpanded]);

	return (
		<div
			ref={setDropRef}
			data-testid={`group-section-${title}`}
			data-drop-id={dropId}
			className={cn(
				"rounded-lg transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)]",
				isOver &&
					dropId &&
					"bg-accent/5 ring-1 ring-inset ring-accent/40",
			)}
		>
			{/* No sticky here: an opaque backdrop for a stuck header has no
			 * token that matches the UA canvas, and it reads as the very
			 * full-width band the header design forbids. */}
			{/* subtle: no vertical padding of its own — the row must sit in
			 * the exact rhythm of the skill rows around it */}
			<div className={cn(subtle ? "px-2" : "px-2 pt-2")}>
				<div
					ref={setDragRef}
					role="button"
					tabIndex={0}
					aria-pressed={isSelected}
					aria-expanded={subtle ? isExpanded : undefined}
					{...listeners}
					onClick={(event) => {
						// A subtle cluster is a browsing container: the row
						// click toggles it (meta/ctrl still selects all).
						if (subtle && !(event.metaKey || event.ctrlKey)) {
							onToggleExpanded();
							return;
						}
						onSelectAll();
					}}
					onKeyDown={(event) => {
						// Ignore keys bubbling up from the chevron button so
						// Enter there only toggles, not select-all too.
						if (event.target !== event.currentTarget) return;
						if (event.key === "Enter" || event.key === " ") {
							event.preventDefault();
							if (subtle) onToggleExpanded();
							else onSelectAll();
						}
						if (event.key === "F2" && onRename) {
							event.preventDefault();
							onRename();
						}
					}}
					onContextMenu={onContextMenu}
					aria-label={
						subtle ? title : t("selectAllInGroup", { name: title })
					}
					className={cn(
						LIST_ITEM_CLASS,
						"transition-[color,background-color,opacity] duration-[var(--dur-fast)] ease-[var(--ease-out)]",
						isSelected && "bg-surface",
						isDropInert && "opacity-50",
					)}
				>
					{subtle ? (
						// The icon slot mirrors a skill row's book icon in
						// weight; the expand cue sits at the trailing edge
						<Square2StackIcon
							aria-hidden
							className="size-4 shrink-0 text-muted"
						/>
					) : (
						<button
							type="button"
							onClick={(event) => {
								event.stopPropagation();
								onToggleExpanded();
							}}
							// Keep the drag sensor from swallowing the press
							onPointerDown={(event) => event.stopPropagation()}
							className="-ml-0.5 flex size-5 shrink-0 items-center justify-center rounded text-muted transition-colors hover:text-foreground"
							aria-label={title}
							aria-expanded={isExpanded}
						>
							<ChevronRightIcon
								className={cn(
									"size-4 transition-transform duration-[var(--dur-fast)] ease-[var(--ease-out)]",
									isExpanded && "rotate-90",
								)}
							/>
						</button>
					)}
					<span
						className={cn(
							"min-w-0 flex-1 truncate text-sm",
							subtle
								? "text-foreground"
								: "font-medium text-foreground",
						)}
					>
						{title}
					</span>
					{subtle ? (
						// Count badge in the same voice as the agent-icons
						// overflow bubble, then the expand cue
						<span className="flex shrink-0 items-center gap-1">
							<span className="flex size-5 items-center justify-center rounded-full bg-default text-[10px] font-medium text-muted ring-1 ring-surface">
								{count}
							</span>
							<ChevronRightIcon
								aria-hidden
								className={cn(
									"size-3 text-muted transition-transform duration-[var(--dur-fast)] ease-[var(--ease-out)]",
									isExpanded && "rotate-90",
								)}
							/>
						</span>
					) : (
						<Chip size="sm" variant="secondary">
							{count}
						</Chip>
					)}
				</div>
			</div>
			<div
				className={cn(
					"grid transition-[grid-template-rows] duration-[var(--dur-base)] ease-[var(--ease-out)]",
					isExpanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
				)}
			>
				{/* invisible while collapsed so it leaves the a11y tree and
				 * reads as hidden to tests, not just clipped by overflow */}
				<div
					className={cn(
						"overflow-hidden",
						!isExpanded && "invisible",
					)}
				>
					{children}
				</div>
			</div>
		</div>
	);
}

interface DropRegionProps {
	/** dnd-kit droppable id */
	id: string;
	className?: string;
	children: ReactNode;
}

/** A plain droppable wrapper for regions that are not group headers
 * (the ungrouped area). Highlights on hover-over during a drag. */
export function DropRegion({ id, className, children }: DropRegionProps) {
	const { setNodeRef, isOver } = useDroppable({ id });
	return (
		<div
			ref={setNodeRef}
			data-drop-id={id}
			className={cn(
				"transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)]",
				isOver && "bg-accent/5 ring-1 ring-inset ring-accent/40",
				className,
			)}
		>
			{children}
		</div>
	);
}

/** Drop target shown while dragging: dropping creates a new group. */
export function NewGroupDropZone() {
	const { t } = useTranslation();
	const { setNodeRef, isOver } = useDroppable({ id: NEW_GROUP_DROP_ID });

	return (
		<div
			ref={setNodeRef}
			data-testid="new-group-dropzone"
			className={cn(
				"mx-2 my-2 flex items-center justify-center gap-2 rounded-lg border border-dashed border-separator px-3 py-3 text-xs text-muted transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)]",
				isOver && "border-accent bg-accent/10 text-accent",
			)}
		>
			<PlusIcon className="size-4" />
			{t("dragToNewGroup")}
		</div>
	);
}
