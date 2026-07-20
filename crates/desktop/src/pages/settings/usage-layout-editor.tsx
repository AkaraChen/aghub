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
import { Button, Meter } from "@heroui/react";
import { useRef, useState } from "react";
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
	const [activeWidth, setActiveWidth] = useState<number | null>(null);
	const [reduceMotion] = useState(
		() => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
	);
	const layoutRef = useRef({ windowSlots, statSlots });
	layoutRef.current = { windowSlots, statSlots };

	const fieldById = new Map<string, LayoutField>(
		[...windowFields, ...statFields].map((f) => [f.id, f]),
	);
	const windowIdSet = new Set(windowFields.map((f) => f.id));
	const typeOf = (id: string): SlotType =>
		windowIdSet.has(id) ? "window" : "stat";
	const slotsOf = (type: SlotType) =>
		type === "window"
			? layoutRef.current.windowSlots
			: layoutRef.current.statSlots;

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
		const next =
			type === "window"
				? { windowSlots: slots, statSlots: layoutRef.current.statSlots }
				: {
						windowSlots: layoutRef.current.windowSlots,
						statSlots: slots,
					};
		layoutRef.current = next;
		onCommit(next);
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

	const clearActive = () => {
		setActiveId(null);
		setActiveWidth(null);
	};
	const onDragStart = (e: DragStartEvent) => {
		if (isDisabled) return;
		setActiveId(String(e.active.id));
		setActiveWidth(e.active.rect.current.initial?.width ?? null);
	};
	const onDragEnd = (e: DragEndEvent) => {
		clearActive();
		const { active, over } = e;
		if (!over) return;
		const id = String(active.id);
		const type = typeOf(id);
		// Dropping onto the drawer hides the field; onto a slot reorders/shows.
		if (String(over.id) === "hidden-drawer") {
			if (shownOf(type).includes(id)) hide(id, type);
			return;
		}
		const m = /^slot:(window|stat):(\d+)$/.exec(String(over.id));
		if (m && m[1] === type) moveTo(id, type, Number(m[2]));
	};

	const activeField = activeId ? fieldById.get(activeId) : undefined;
	const activeType = activeId ? typeOf(activeId) : null;

	const shownWindows = shownOf("window");
	const shownStats = shownOf("stat");
	// The ghost mirrors its source: a bar dragged off the card keeps that
	// slot's placeholder fill, one from the drawer keeps its empty track.
	const activeBarIndex =
		activeType === "window" && activeId
			? shownWindows.indexOf(activeId)
			: -1;
	const activeBarPct =
		activeBarIndex >= 0
			? PREVIEW_BAR_PCT[activeBarIndex % PREVIEW_BAR_PCT.length]
			: 0;
	return (
		<DndContext
			sensors={sensors}
			collisionDetection={collisionDetection}
			onDragStart={onDragStart}
			onDragEnd={onDragEnd}
			onDragCancel={clearActive}
		>
			{/* The card replica sits beside a flat drawer of hidden fields.
			    Drag across or use the explicit eye / plus actions. */}
			<div
				aria-disabled={isDisabled || undefined}
				inert={isDisabled || undefined}
				className={cn(
					"grid w-full grid-cols-1 gap-5 lg:grid-cols-[20rem_minmax(0,1fr)] lg:items-start",
					"transition-opacity duration-[var(--dur-fast)] ease-[var(--ease-out)]",
					isDisabled && "opacity-55",
				)}
			>
				<div
					data-testid="layout-card-replica"
					className="w-full rounded-lg border border-border bg-surface p-3"
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
									isDisabled={isDisabled}
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
										isDisabled={isDisabled}
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
					active={
						activeId != null &&
						activeType != null &&
						shownOf(activeType).includes(activeId)
					}
					isDisabled={isDisabled}
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

			<DragOverlay dropAnimation={reduceMotion ? null : undefined}>
				{activeField && activeType ? (
					<DragGhost
						field={activeField}
						type={activeType}
						barPct={activeBarPct}
						width={activeWidth}
					/>
				) : null}
			</DragOverlay>
		</DndContext>
	);
}

/** The floating drag preview — the same shape and size as the row it left,
 *  which both panes share (bars span the row, stats fill half the grid). */
function DragGhost({
	field,
	type,
	barPct,
	width,
}: {
	field: LayoutField;
	type: SlotType;
	/** Placeholder fill carried over from the source row; 0 = empty track. */
	barPct: number;
	width: number | null;
}) {
	if (type === "window") {
		return (
			<div
				className="cursor-grabbing rounded-md bg-surface p-1 shadow-md"
				style={width ? { width } : undefined}
			>
				<BarBody label={field.label} pct={barPct} />
			</div>
		);
	}
	return (
		<div
			className="flex cursor-grabbing items-baseline justify-between gap-1 rounded-md bg-surface px-1.5 py-0.5 text-[11px] shadow-md"
			style={width ? { width } : undefined}
		>
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
				"flex items-center justify-center rounded-md border border-dashed border-border text-foreground/40 transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)]",
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
	isDisabled,
	onHide,
}: {
	field: LayoutField;
	index: number;
	pct: number;
	accepts: boolean;
	isDisabled?: boolean;
	onHide: () => void;
}) {
	const { t } = useTranslation();
	const { setNodeRef: dropRef, isOver } = useDroppable({
		id: `slot:window:${index}`,
		disabled: isDisabled,
	});
	const {
		attributes,
		listeners,
		setNodeRef: dragRef,
		isDragging,
	} = useDraggable({ id: field.id, disabled: isDisabled });
	return (
		<div
			ref={dropRef}
			className={cn(
				"group/layout-row -mx-1 flex items-center gap-2 rounded-md px-1 py-0.5 transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:bg-surface-secondary",
				isOver && accepts && "ring-1 ring-accent",
				isDragging && "opacity-30",
			)}
		>
			<div
				ref={dragRef}
				title={field.hint}
				{...attributes}
				{...listeners}
				className="flex min-w-0 flex-1 cursor-grab touch-none rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-focus"
			>
				<BarBody label={field.label} pct={pct} />
			</div>
			<Button
				isIconOnly
				isDisabled={isDisabled}
				size="sm"
				variant="ghost"
				onPress={onHide}
				aria-label={t("usageLayoutHide", {
					label: field.label,
				})}
				className="size-6 shrink-0 text-muted transition-[color,opacity] duration-[var(--dur-fast)] ease-[var(--ease-out)] [@media(hover:hover)]:opacity-0 group-hover/layout-row:opacity-100 group-focus-within/layout-row:opacity-100"
			>
				<EyeSlashIcon className="size-3.5" />
			</Button>
		</div>
	);
}

/** A bottom stat on the replica: label + placeholder in the 2×2 grid. */
function PreviewStatCell({
	field,
	index,
	accepts,
	isDisabled,
	onHide,
}: {
	field: LayoutField;
	index: number;
	accepts: boolean;
	isDisabled?: boolean;
	onHide: () => void;
}) {
	const { t } = useTranslation();
	const { setNodeRef: dropRef, isOver } = useDroppable({
		id: `slot:stat:${index}`,
		disabled: isDisabled,
	});
	const {
		attributes,
		listeners,
		setNodeRef: dragRef,
		isDragging,
	} = useDraggable({ id: field.id, disabled: isDisabled });
	return (
		<div
			ref={dropRef}
			className={cn(
				"group/layout-row -mx-1 flex items-center gap-1 rounded px-1 transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:bg-surface-secondary",
				isOver && accepts && "ring-1 ring-accent",
				isDragging && "opacity-30",
			)}
		>
			<div
				ref={dragRef}
				title={field.hint}
				{...attributes}
				{...listeners}
				className="flex min-w-0 flex-1 cursor-grab touch-none items-baseline justify-between gap-1 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-focus"
			>
				<span className="truncate text-muted">{field.label}</span>
				<span className="shrink-0 text-foreground tabular-nums">—</span>
			</div>
			<Button
				isIconOnly
				isDisabled={isDisabled}
				size="sm"
				variant="ghost"
				onPress={onHide}
				aria-label={t("usageLayoutHide", {
					label: field.label,
				})}
				className="size-5 shrink-0 text-muted transition-[color,opacity] duration-[var(--dur-fast)] ease-[var(--ease-out)] [@media(hover:hover)]:opacity-0 group-hover/layout-row:opacity-100 group-focus-within/layout-row:opacity-100"
			>
				<EyeSlashIcon className="size-3" />
			</Button>
		</div>
	);
}

interface DrawerSection {
	fields: LayoutField[];
	atCap: boolean;
	onShow: (id: string) => void;
}

/** The flat drawer beside the card: everything not shown, grouped like the
 *  preview. It is also a drop target; dropping a field here hides it. */
function HiddenDrawer({
	active,
	isDisabled,
	windows,
	stats,
}: {
	/** A drag is in flight — highlight the drawer as a hide target. */
	active: boolean;
	isDisabled?: boolean;
	windows: DrawerSection;
	stats: DrawerSection;
}) {
	const { t } = useTranslation();
	// `active` is true only while dragging a field that sits on the card —
	// hiding is the one thing dropping here can do, so the highlight never
	// shows for a drawer row dragged over its own pane.
	const { setNodeRef, isOver } = useDroppable({
		id: "hidden-drawer",
		disabled: isDisabled,
	});
	const empty = windows.fields.length === 0 && stats.fields.length === 0;
	return (
		<div
			ref={setNodeRef}
			data-testid="layout-hidden-drawer"
			className={cn(
				"flex min-w-0 flex-col gap-1.5 border-t border-border pt-4 transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)] lg:border-t-0 lg:border-l lg:pt-0 lg:pl-5",
				active && isOver && "bg-accent-soft",
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
							isDisabled={isDisabled}
							onShow={() => windows.onShow(field.id)}
							showLabel={t("usageLayoutShow", {
								label: field.label,
							})}
						/>
					))}
					{stats.fields.length > 0 && (
						<div className="grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-x-3 gap-y-1">
							{stats.fields.map((field) => (
								<HiddenStatCell
									key={field.id}
									field={field}
									atCap={stats.atCap}
									isDisabled={isDisabled}
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
	isDisabled,
	onShow,
	showLabel,
}: {
	field: LayoutField;
	atCap: boolean;
	isDisabled?: boolean;
	onShow: () => void;
	showLabel: string;
}) {
	const disabled = atCap || isDisabled;
	const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
		id: field.id,
		disabled,
	});
	return (
		<div
			data-testid={`layout-hidden-item-${field.id}`}
			className={cn(
				"group/layout-row -mx-1 flex items-center gap-2 rounded-md px-1 py-1 outline-none transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)]",
				disabled ? "opacity-40" : "hover:bg-surface-secondary",
				isDragging && "opacity-30",
			)}
		>
			<div
				ref={setNodeRef}
				title={field.hint}
				{...(disabled ? {} : attributes)}
				{...(disabled ? {} : listeners)}
				className={cn(
					"flex min-w-0 flex-1 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-focus",
					!disabled && "cursor-grab touch-none",
				)}
			>
				<BarBody label={field.label} pct={0} />
			</div>
			<Button
				isIconOnly
				isDisabled={disabled}
				size="sm"
				variant="ghost"
				onPress={onShow}
				aria-label={showLabel}
				className="size-6 shrink-0 text-muted transition-[color,opacity] duration-[var(--dur-fast)] ease-[var(--ease-out)] [@media(hover:hover)]:opacity-0 group-hover/layout-row:opacity-100 group-focus-within/layout-row:opacity-100"
			>
				<PlusIcon className="size-3.5" />
			</Button>
		</div>
	);
}

/** A hidden stat: the same half-width cell shape as on the card. */
function HiddenStatCell({
	field,
	atCap,
	isDisabled,
	onShow,
	showLabel,
}: {
	field: LayoutField;
	atCap: boolean;
	isDisabled?: boolean;
	onShow: () => void;
	showLabel: string;
}) {
	const disabled = atCap || isDisabled;
	const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
		id: field.id,
		disabled,
	});
	return (
		<div
			data-testid={`layout-hidden-item-${field.id}`}
			className={cn(
				"group/layout-row -mx-1 flex items-center gap-1 rounded px-1 py-0.5 text-[11px] outline-none transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)]",
				disabled ? "opacity-40" : "hover:bg-surface-secondary",
				isDragging && "opacity-30",
			)}
		>
			<div
				ref={setNodeRef}
				title={field.hint}
				{...(disabled ? {} : attributes)}
				{...(disabled ? {} : listeners)}
				className={cn(
					"flex min-w-0 flex-1 items-baseline justify-between gap-1 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-focus",
					!disabled && "cursor-grab touch-none",
				)}
			>
				<span className="truncate text-muted">{field.label}</span>
				<span className="shrink-0 text-foreground/40 tabular-nums">
					—
				</span>
			</div>
			<Button
				isIconOnly
				isDisabled={disabled}
				size="sm"
				variant="ghost"
				onPress={onShow}
				aria-label={showLabel}
				className="size-5 shrink-0 text-muted transition-[color,opacity] duration-[var(--dur-fast)] ease-[var(--ease-out)] [@media(hover:hover)]:opacity-0 group-hover/layout-row:opacity-100 group-focus-within/layout-row:opacity-100"
			>
				<PlusIcon className="size-3" />
			</Button>
		</div>
	);
}
