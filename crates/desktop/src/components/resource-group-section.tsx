import {
	ChevronRightIcon,
	PlusIcon,
	Square2StackIcon,
	StarIcon,
} from "@heroicons/react/24/solid";
import { useDndContext, useDraggable, useDroppable } from "@dnd-kit/core";
import { Button, Chip } from "@heroui/react";
import { type ReactNode, useEffect, useId, useRef } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "../lib/utils";
import { NEW_GROUP_DROP_ID } from "./list-dnd";

/** How long a drag hovers a collapsed group before it springs open. */
const SPRING_LOAD_MS = 600;

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
	/** Subtle rows only: the row body's click action (open the library
	 * page, or toggle the cluster selection in multi-select mode).
	 * Expansion belongs to the chevron alone. */
	onRowClick?: () => void;
	/** Subtle source groups mirror the favorite state of their members. */
	hasStarredMember?: boolean;
	children?: ReactNode;
}

/**
 * Collapsible group header rendered as a list item: the chevron alone
 * toggles expansion; clicking the row selects every member (custom
 * groups) or runs onRowClick (subtle clusters — open the library page).
 * Dragging the header drags the whole group, and custom groups accept
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
	onRowClick,
	hasStarredMember = false,
	children,
}: ResourceGroupSectionProps) {
	const { t } = useTranslation();
	const favoriteDescriptionId = useId();

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
	const {
		active: dndActive,
		measureDroppableContainers,
		droppableContainers,
	} = useDndContext();
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

	// A mid-drag expand/collapse shifts every section below this one — a
	// pure position change that neither measuring strategy nor a
	// ResizeObserver picks up, so drops below would land on stale rects.
	// Re-measure the lot when the height transition settles.
	const measureAllRef = useRef(() => {});
	measureAllRef.current = () => {
		if (!dndActive) return;
		measureDroppableContainers([...droppableContainers.keys()]);
	};

	const expansionButton = (
		<Button
			isIconOnly
			size="sm"
			variant="ghost"
			onPress={onToggleExpanded}
			className="size-5 min-h-0 w-5 shrink-0 rounded px-0 [--button-bg-hover:transparent] [--button-bg-pressed:transparent]"
			aria-label={t("toggleGroupExpansion", { name: title })}
			aria-expanded={isExpanded}
		>
			<ChevronRightIcon
				className={cn(
					"transition-transform duration-[var(--dur-fast)] ease-[var(--ease-out)]",
					subtle ? "size-3" : "size-4",
					isExpanded && "rotate-90",
				)}
			/>
		</Button>
	);

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
					data-slot="group-header"
					className={cn(
						"flex min-h-9 w-full items-center rounded-2xl transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:bg-default motion-reduce:transition-none",
						isSelected && "bg-surface",
					)}
				>
					{!subtle && expansionButton}
					<Button
						ref={setDragRef}
						variant="ghost"
						size="sm"
						aria-pressed={isSelected}
						{...listeners}
						onPress={(event) => {
							// A subtle cluster's row is a navigation surface —
							// expansion belongs to the chevron alone (meta/ctrl
							// still selects all).
							if (subtle && !(event.metaKey || event.ctrlKey)) {
								onRowClick?.();
								return;
							}
							onSelectAll();
						}}
						onKeyDown={(event) => {
							if (event.key === "F2" && onRename) {
								event.preventDefault();
								onRename();
							}
						}}
						onContextMenu={onContextMenu}
						aria-label={
							subtle
								? title
								: t("selectAllInGroup", { name: title })
						}
						aria-describedby={
							subtle && hasStarredMember
								? favoriteDescriptionId
								: undefined
						}
						className={cn(
							"h-auto min-h-9 min-w-0 flex-1 justify-start gap-2 rounded-2xl px-2 py-1.5 text-sm font-normal whitespace-normal active:[transform:none] data-[pressed=true]:[transform:none] [--button-bg-hover:transparent] [--button-bg-pressed:transparent] [&_svg]:mx-0",
							"transition-[color,background-color,opacity] duration-[var(--dur-fast)] ease-[var(--ease-out)] motion-reduce:transition-none",
							isDropInert && "opacity-50",
						)}
					>
						{subtle ? (
							// The icon slot mirrors a skill row's book icon in
							// weight; the expand cue sits at the trailing edge
							<span className="relative inline-flex size-4 shrink-0 items-center justify-center">
								<Square2StackIcon
									aria-hidden
									className="size-4 text-muted"
								/>
								{hasStarredMember && (
									<StarIcon
										aria-hidden
										data-slot="source-favorite-indicator"
										className="absolute -bottom-1 -left-1 size-2.5 text-warning"
									/>
								)}
							</span>
						) : null}
						<span
							className={cn(
								"min-w-0 flex-1 truncate text-left text-sm",
								subtle
									? "text-foreground"
									: "font-medium text-foreground",
							)}
						>
							{title}
						</span>
						{subtle ? (
							// Count badge in the same voice as the agent-icons
							// overflow bubble.
							<span className="flex shrink-0 items-center">
								<span className="flex size-5 items-center justify-center rounded-full bg-default text-[10px] font-medium text-muted ring-1 ring-surface">
									{count}
								</span>
							</span>
						) : (
							<Chip size="sm" variant="secondary">
								{count}
							</Chip>
						)}
					</Button>
					{subtle && expansionButton}
				</div>
				{subtle && hasStarredMember && (
					<span id={favoriteDescriptionId} className="sr-only">
						{t("sourceContainsFavoriteSkill")}
					</span>
				)}
			</div>
			<div
				className={cn(
					"grid transition-[grid-template-rows] duration-[var(--dur-base)] ease-[var(--ease-out)]",
					isExpanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
				)}
				onTransitionEnd={(event) => {
					if (event.target !== event.currentTarget) return;
					if (event.propertyName !== "grid-template-rows") return;
					// Coupled to the transition above: if it ever goes behind
					// motion-safe (no transition → no transitionend), mid-drag
					// drops below a spring-opened group regress — move this
					// re-measure to wherever the expansion settles instead.
					measureAllRef.current();
				}}
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
	children: ReactNode;
}

/** A plain droppable wrapper for regions that are not group headers
 * (the ungrouped area). Highlights on hover-over during a drag. */
export function DropRegion({ id, children }: DropRegionProps) {
	const { setNodeRef, isOver } = useDroppable({ id });
	return (
		<div
			ref={setNodeRef}
			data-drop-id={id}
			className={cn(
				"transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)]",
				isOver && "bg-accent/5 ring-1 ring-inset ring-accent/40",
			)}
		>
			{children}
		</div>
	);
}

/** Drop target shown while dragging: dropping creates a new group.
 * Subscribes to the drag state itself so the list that mounts it does
 * not — dnd-kit's context updates on every pointer move, and a list
 * that reads it re-renders every row per move. */
export function NewGroupDropZone() {
	const { t } = useTranslation();
	const { active } = useDndContext();
	const { setNodeRef, isOver } = useDroppable({ id: NEW_GROUP_DROP_ID });

	if (!active) return null;
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
