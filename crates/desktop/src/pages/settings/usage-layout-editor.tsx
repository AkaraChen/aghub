import {
	closestCenter,
	type CollisionDetection,
	DndContext,
	DragOverlay,
	type DragEndEvent,
	type DragStartEvent,
	KeyboardSensor,
	PointerSensor,
	pointerWithin,
	rectIntersection,
	useDraggable,
	useDroppable,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import { EyeSlashIcon, PlusIcon } from "@heroicons/react/24/solid";
import { Meter } from "@heroui/react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AgentIcon } from "../../lib/agent-icons";
import { cn } from "../../lib/utils";

/** A usage field (a rate-limit bar or a bottom stat). */
export interface LayoutField {
	id: string;
	label: string;
	hint?: string;
}

/** Fixed-length slot arrays the editor edits; `null` = an unused slot. Shown
 *  fields stay compacted to the front, so the count of non-null entries is how
 *  many appear on the card and the array length is the cap. */
export interface CardLayoutModel {
	windowSlots: (string | null)[];
	statSlots: (string | null)[];
}

/** Whose card the replica represents — purely cosmetic; the preview never
 *  loads data, every bar and stat renders a fixed placeholder. */
export interface LayoutPreview {
	agentId: string;
	agentName: string;
}

type SlotType = "window" | "stat";

/** Fixed placeholder fills so a shown bar reads as a bar without implying
 *  real data. */
const PREVIEW_BAR_PCT = [62, 38, 84];

/** Rows opt into view transitions under this name so drop / show / hide
 *  morphs the field between its old and new place (card ↔ drawer). */
const rowTransitionName = (fieldId: string) => `usage-slot-${fieldId}`;

/**
 * Run a layout mutation inside a view transition so rows glide to their new
 * position. Falls back to an instant update when the platform lacks the API
 * or the user prefers reduced motion (also keeps e2e deterministic).
 */
function withLayoutTransition(mutate: () => void) {
	// Feature-detect: WKWebView < Safari 18 has no startViewTransition.
	const doc = document as Document & {
		startViewTransition?: (update: () => Promise<void>) => unknown;
	};
	if (
		!doc.startViewTransition ||
		window.matchMedia("(prefers-reduced-motion: reduce)").matches
	) {
		mutate();
		return;
	}
	doc.startViewTransition(() => {
		mutate();
		// The commit lands via react-query's optimistic update; two frames
		// span the re-render so the browser snapshots the settled DOM.
		return new Promise<void>((resolve) => {
			requestAnimationFrame(() => {
				requestAnimationFrame(() => resolve());
			});
		});
	});
}

export function InteractiveCardLayout({
	windowFields,
	statFields,
	windowSlots,
	statSlots,
	isDisabled,
	onCommit,
	preview,
}: {
	windowFields: LayoutField[];
	statFields: LayoutField[];
	windowSlots: (string | null)[];
	statSlots: (string | null)[];
	isDisabled?: boolean;
	onCommit: (next: CardLayoutModel) => void;
	preview: LayoutPreview;
}) {
	const { t } = useTranslation();
	const [activeId, setActiveId] = useState<string | null>(null);

	const fieldById = new Map<string, LayoutField>(
		[...windowFields, ...statFields].map((f) => [f.id, f]),
	);
	const windowIdSet = new Set(windowFields.map((f) => f.id));
	const typeOf = (id: string): SlotType =>
		windowIdSet.has(id) ? "window" : "stat";
	const slotsOf = (type: SlotType) =>
		type === "window" ? windowSlots : statSlots;

	// Shown fields in order. Slots may reference fields not offered to the
	// current target (e.g. a Claude-only bar inside the shared default
	// layout while editing Codex) — those render nowhere and drop out on
	// the next commit.
	const shownOf = (type: SlotType): string[] =>
		slotsOf(type).filter((x): x is string => x != null && fieldById.has(x));

	// Hidden fields: every field of a type not currently shown.
	const hiddenOf = (type: SlotType): LayoutField[] => {
		const shown = new Set(shownOf(type));
		return (type === "window" ? windowFields : statFields).filter(
			(f) => !shown.has(f.id),
		);
	};

	// Shown fields stay compacted to the top. Commit takes an ordered list of
	// shown ids and lays it back over the fixed slot count, so the card never
	// shows a gap and never exceeds the cap.
	const commit = (type: SlotType, shown: string[]) => {
		const slots = slotsOf(type).map((_, i) => shown[i] ?? null);
		withLayoutTransition(() =>
			onCommit(
				type === "window"
					? { windowSlots: slots, statSlots }
					: { windowSlots, statSlots: slots },
			),
		);
	};

	// Insert `id` at visual position `index` among the shown fields (moving it
	// there if it was already shown). Dropping past the end appends.
	const moveTo = (id: string, type: SlotType, index: number) => {
		const rest = shownOf(type).filter((x) => x !== id);
		const at = Math.min(index, rest.length);
		commit(type, [...rest.slice(0, at), id, ...rest.slice(at)]);
	};

	const hide = (id: string, type: SlotType) =>
		commit(
			type,
			shownOf(type).filter((x) => x !== id),
		);

	const show = (id: string, type: SlotType) =>
		commit(type, [...shownOf(type), id]);

	// Discrete, non-overlapping slots: resolve to whatever is under the pointer.
	const collisionDetection: CollisionDetection = (args) => {
		const p = pointerWithin(args);
		if (p.length > 0) return p;
		const r = rectIntersection(args);
		return r.length > 0 ? r : closestCenter(args);
	};

	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
		useSensor(KeyboardSensor),
	);

	const onDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id));
	const onDragEnd = (e: DragEndEvent) => {
		setActiveId(null);
		const { active, over } = e;
		if (!over) return;
		const id = String(active.id);
		const type = typeOf(id);
		// Dropping onto the drawer hides the field; onto a slot reorders/shows.
		if (String(over.id) === "hidden-drawer") {
			hide(id, type);
			return;
		}
		const m = /^slot:(window|stat):(\d+)$/.exec(String(over.id));
		if (m && m[1] === type) moveTo(id, type, Number(m[2]));
	};

	const activeField = activeId ? fieldById.get(activeId) : undefined;
	const activeType = activeId ? typeOf(activeId) : null;

	const shownWindows = shownOf("window");
	const shownStats = shownOf("stat");

	return (
		<DndContext
			sensors={sensors}
			collisionDetection={collisionDetection}
			onDragStart={onDragStart}
			onDragEnd={onDragEnd}
			onDragCancel={() => setActiveId(null)}
		>
			{/* The card replica beside the dashed drawer of hidden fields —
			    both panes share the card's width so a field keeps its exact
			    size when it moves between them. Drag across (or use the eye /
			    plus buttons) to show and hide. */}
			<div
				className={cn(
					"flex flex-col gap-4 sm:flex-row sm:items-start",
					isDisabled && "pointer-events-none opacity-60",
				)}
			>
				<div
					data-testid="layout-card-replica"
					className="w-80 max-w-full shrink-0 rounded-lg border border-border bg-surface p-3 shadow-xs"
				>
					<div className="flex items-center gap-2 pb-2">
						<AgentIcon
							id={preview.agentId}
							name={preview.agentName}
							size="xs"
						/>
						<span className="text-sm font-medium text-foreground">
							{preview.agentName}
						</span>
					</div>
					<div className="flex flex-col gap-1.5">
						{shownWindows.map((id, index) => {
							const field = fieldById.get(id);
							if (!field) return null;
							return (
								<PreviewBarRow
									key={id}
									field={field}
									index={index}
									pct={
										PREVIEW_BAR_PCT[
											index % PREVIEW_BAR_PCT.length
										]
									}
									accepts={activeType === "window"}
									onHide={() => hide(id, "window")}
								/>
							);
						})}
						{/* An append slot appears while dragging a bar and
						    the card still has room — dropping adds, nothing
						    is swapped out. */}
						{activeType === "window" &&
							shownWindows.length < windowSlots.length && (
								<EmptySlot
									type="window"
									index={shownWindows.length}
									variant="bar"
								/>
							)}
					</div>
					{(shownStats.length > 0 ||
						(activeType === "stat" &&
							shownStats.length < statSlots.length)) && (
						<div
							className={cn(
								"grid grid-cols-2 gap-x-3 gap-y-1",
								shownWindows.length > 0 &&
									"mt-2 border-t border-border pt-2",
							)}
						>
							{shownStats.map((id, index) => {
								const field = fieldById.get(id);
								if (!field) return null;
								return (
									<PreviewStatCell
										key={id}
										field={field}
										index={index}
										accepts={activeType === "stat"}
										onHide={() => hide(id, "stat")}
									/>
								);
							})}
							{activeType === "stat" &&
								shownStats.length < statSlots.length && (
									<EmptySlot
										type="stat"
										index={shownStats.length}
										variant="stat"
									/>
								)}
						</div>
					)}
					{shownWindows.length === 0 &&
						shownStats.length === 0 &&
						activeType == null && (
							<p className="py-3 text-center text-[11px] text-muted">
								{t("usageLayoutEmptyCard")}
							</p>
						)}
				</div>

				<HiddenDrawer
					active={activeId != null}
					windows={{
						fields: hiddenOf("window"),
						atCap: shownWindows.length >= windowSlots.length,
						onShow: (id) => show(id, "window"),
					}}
					stats={{
						fields: hiddenOf("stat"),
						atCap: shownStats.length >= statSlots.length,
						onShow: (id) => show(id, "stat"),
					}}
				/>
			</div>

			<DragOverlay dropAnimation={{ duration: 160 }}>
				{activeField && activeType ? (
					<DragGhost field={activeField} type={activeType} />
				) : null}
			</DragOverlay>
		</DndContext>
	);
}

/** The floating drag preview — the same shape and size as the row it left,
 *  which both panes share (bars span the row, stats fill half the grid). */
function DragGhost({ field, type }: { field: LayoutField; type: SlotType }) {
	if (type === "window") {
		return (
			<div className="w-[296px] cursor-grabbing rounded-md border border-border bg-surface p-1 shadow-lg">
				<BarBody label={field.label} pct={PREVIEW_BAR_PCT[0]} />
			</div>
		);
	}
	return (
		<div className="flex w-[142px] cursor-grabbing items-baseline justify-between gap-1 rounded-md border border-border bg-surface px-1.5 py-0.5 text-[11px] shadow-lg">
			<span className="truncate text-muted">{field.label}</span>
			<span className="text-foreground tabular-nums">—</span>
		</div>
	);
}

/** Label over a placeholder meter — the one bar shape used on the card, in
 *  the drawer, and in the drag ghost, so a bar never changes size. */
function BarBody({ label, pct }: { label: string; pct: number }) {
	return (
		<div className="flex min-w-0 flex-1 flex-col gap-0.5">
			<span className="truncate text-[11px] text-muted">{label}</span>
			<Meter aria-hidden value={pct} size="sm">
				<Meter.Track>
					<Meter.Fill className="bg-foreground/25" />
				</Meter.Track>
			</Meter>
		</div>
	);
}

/** The append target while a matching drag is in flight: a dashed slot at
 *  the end of the card's bars / stats. Dropping here adds the field. */
function EmptySlot({
	type,
	index,
	variant,
}: {
	type: SlotType;
	index: number;
	variant: "bar" | "stat";
}) {
	const { setNodeRef, isOver } = useDroppable({
		id: `slot:${type}:${index}`,
	});
	return (
		<div
			ref={setNodeRef}
			data-testid={`layout-empty-slot-${type}`}
			className={cn(
				"flex items-center justify-center rounded-md border border-dashed border-border text-foreground/40 transition-colors",
				variant === "bar" ? "h-7" : "h-[18px]",
				isOver && "border-accent bg-accent/5 text-accent",
			)}
		>
			<PlusIcon className="size-3" />
		</div>
	);
}

/** A quota bar on the replica. Drag to reorder, eye to hide (on hover). */
function PreviewBarRow({
	field,
	index,
	pct,
	accepts,
	onHide,
}: {
	field: LayoutField;
	index: number;
	pct: number;
	accepts: boolean;
	onHide: () => void;
}) {
	const { t } = useTranslation();
	const { setNodeRef: dropRef, isOver } = useDroppable({
		id: `slot:window:${index}`,
	});
	const {
		attributes,
		listeners,
		setNodeRef: dragRef,
		isDragging,
	} = useDraggable({ id: field.id });
	return (
		<div
			ref={dropRef}
			style={{ viewTransitionName: rowTransitionName(field.id) }}
			className={cn(
				"rounded-md transition-colors",
				isOver && accepts && "ring-1 ring-accent",
			)}
		>
			<div
				ref={dragRef}
				title={field.hint}
				{...attributes}
				{...listeners}
				className={cn(
					"group/row flex cursor-grab touch-none items-center gap-2 rounded-md outline-none",
					isDragging && "opacity-30",
				)}
			>
				<BarBody label={field.label} pct={pct} />
				<button
					type="button"
					onClick={onHide}
					onPointerDown={(e) => e.stopPropagation()}
					aria-label={t("usageLayoutHide", {
						label: field.label,
					})}
					className="shrink-0 text-muted opacity-0 transition-opacity group-hover/row:opacity-100 hover:text-foreground focus-visible:opacity-100"
				>
					<EyeSlashIcon className="size-3.5" />
				</button>
			</div>
		</div>
	);
}

/** A bottom stat on the replica: label + placeholder in the 2×2 grid. */
function PreviewStatCell({
	field,
	index,
	accepts,
	onHide,
}: {
	field: LayoutField;
	index: number;
	accepts: boolean;
	onHide: () => void;
}) {
	const { t } = useTranslation();
	const { setNodeRef: dropRef, isOver } = useDroppable({
		id: `slot:stat:${index}`,
	});
	const {
		attributes,
		listeners,
		setNodeRef: dragRef,
		isDragging,
	} = useDraggable({ id: field.id });
	return (
		<div
			ref={dropRef}
			style={{ viewTransitionName: rowTransitionName(field.id) }}
			className={cn(
				"rounded transition-colors",
				isOver && accepts && "ring-1 ring-accent",
			)}
		>
			<div
				ref={dragRef}
				title={field.hint}
				{...attributes}
				{...listeners}
				className={cn(
					"group/cell flex cursor-grab touch-none items-baseline justify-between gap-1 text-[11px] outline-none",
					isDragging && "opacity-30",
				)}
			>
				<span className="truncate text-muted">{field.label}</span>
				<span className="flex shrink-0 items-center gap-1">
					<span className="text-foreground tabular-nums">—</span>
					<button
						type="button"
						onClick={onHide}
						onPointerDown={(e) => e.stopPropagation()}
						aria-label={t("usageLayoutHide", {
							label: field.label,
						})}
						className="text-muted opacity-0 transition-opacity group-hover/cell:opacity-100 hover:text-foreground focus-visible:opacity-100"
					>
						<EyeSlashIcon className="size-3" />
					</button>
				</span>
			</div>
		</div>
	);
}

interface DrawerSection {
	fields: LayoutField[];
	atCap: boolean;
	onShow: (id: string) => void;
}

/** The drawer pane beside the card: everything not shown, laid out exactly
 *  like the card (full-width bars, stats in the same 2-column grid) so
 *  fields keep their size when dragged across. Also a drop target —
 *  dropping a field here hides it. */
function HiddenDrawer({
	active,
	windows,
	stats,
}: {
	/** A drag is in flight — highlight the drawer as a hide target. */
	active: boolean;
	windows: DrawerSection;
	stats: DrawerSection;
}) {
	const { t } = useTranslation();
	const { setNodeRef, isOver } = useDroppable({ id: "hidden-drawer" });
	const empty = windows.fields.length === 0 && stats.fields.length === 0;
	return (
		<div
			ref={setNodeRef}
			data-testid="layout-hidden-drawer"
			className={cn(
				"flex w-80 max-w-full flex-col gap-1.5 rounded-lg border border-dashed border-border p-3 transition-colors",
				active && isOver && "border-accent bg-accent/5",
			)}
		>
			<span className="pb-0.5 text-[11px] font-medium text-muted">
				{t("usageLayoutHiddenDrawer")}
			</span>
			{empty ? (
				<p className="py-3 text-center text-[11px] text-foreground/40">
					{t("usageLayoutDrawerEmpty")}
				</p>
			) : (
				<>
					{windows.fields.map((field) => (
						<HiddenBarRow
							key={field.id}
							field={field}
							atCap={windows.atCap}
							onShow={() => windows.onShow(field.id)}
							showLabel={t("usageLayoutShow", {
								label: field.label,
							})}
						/>
					))}
					{stats.fields.length > 0 && (
						<div className="grid grid-cols-2 gap-x-3 gap-y-1">
							{stats.fields.map((field) => (
								<HiddenStatCell
									key={field.id}
									field={field}
									atCap={stats.atCap}
									onShow={() => stats.onShow(field.id)}
									showLabel={t("usageLayoutShow", {
										label: field.label,
									})}
								/>
							))}
						</div>
					)}
				</>
			)}
		</div>
	);
}

/** A hidden quota bar: the same full-width bar shape as on the card. */
function HiddenBarRow({
	field,
	atCap,
	onShow,
	showLabel,
}: {
	field: LayoutField;
	atCap: boolean;
	onShow: () => void;
	showLabel: string;
}) {
	const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
		id: field.id,
		disabled: atCap,
	});
	return (
		<div
			ref={setNodeRef}
			title={field.hint}
			style={{ viewTransitionName: rowTransitionName(field.id) }}
			{...(atCap ? {} : attributes)}
			{...(atCap ? {} : listeners)}
			className={cn(
				"group/hid flex items-center gap-2 rounded-md outline-none transition-opacity",
				atCap
					? "opacity-40"
					: "cursor-grab touch-none opacity-70 hover:opacity-100",
				isDragging && "opacity-30",
			)}
		>
			<BarBody label={field.label} pct={0} />
			<button
				type="button"
				onClick={onShow}
				onPointerDown={(e) => e.stopPropagation()}
				disabled={atCap}
				aria-label={showLabel}
				className="shrink-0 text-muted opacity-0 transition-opacity group-hover/hid:opacity-100 hover:text-accent focus-visible:opacity-100 disabled:cursor-not-allowed disabled:hover:text-muted"
			>
				<PlusIcon className="size-3.5" />
			</button>
		</div>
	);
}

/** A hidden stat: the same half-width cell shape as on the card. */
function HiddenStatCell({
	field,
	atCap,
	onShow,
	showLabel,
}: {
	field: LayoutField;
	atCap: boolean;
	onShow: () => void;
	showLabel: string;
}) {
	const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
		id: field.id,
		disabled: atCap,
	});
	return (
		<div
			ref={setNodeRef}
			title={field.hint}
			style={{ viewTransitionName: rowTransitionName(field.id) }}
			{...(atCap ? {} : attributes)}
			{...(atCap ? {} : listeners)}
			className={cn(
				"group/hid flex items-baseline justify-between gap-1 rounded text-[11px] outline-none transition-opacity",
				atCap
					? "opacity-40"
					: "cursor-grab touch-none opacity-70 hover:opacity-100",
				isDragging && "opacity-30",
			)}
		>
			<span className="truncate text-muted">{field.label}</span>
			<span className="flex shrink-0 items-center gap-1">
				<span className="text-foreground/40 tabular-nums">—</span>
				<button
					type="button"
					onClick={onShow}
					onPointerDown={(e) => e.stopPropagation()}
					disabled={atCap}
					aria-label={showLabel}
					className="text-muted opacity-0 transition-opacity group-hover/hid:opacity-100 hover:text-accent focus-visible:opacity-100 disabled:cursor-not-allowed disabled:hover:text-muted"
				>
					<PlusIcon className="size-3" />
				</button>
			</span>
		</div>
	);
}
