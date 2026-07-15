import {
	closestCenter,
	type CollisionDetection,
	DndContext,
	DragOverlay,
	type DragEndEvent,
	type DragStartEvent,
	KeyboardSensor,
	MeasuringStrategy,
	PointerSensor,
	pointerWithin,
	rectIntersection,
	useDraggable,
	useDroppable,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import { Bars2Icon, PlusIcon, XMarkIcon } from "@heroicons/react/24/solid";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "../../lib/utils";

/** A draggable usage field (a rate-limit bar or a bottom stat). */
export interface LayoutField {
	id: string;
	label: string;
	hint?: string;
}

/** Fixed slot arrays the editor edits; `null` = an empty slot kept in place. */
export interface CardLayoutModel {
	windowSlots: (string | null)[];
	statSlots: (string | null)[];
}

export interface LayoutLabels {
	preview: string;
	available: string;
	bars: string;
	stats: string;
	empty: string;
}

type SlotType = "window" | "stat";

/** Fixed placeholder fills so the preview reads as bars without implying data. */
const PREVIEW_BAR_PCT = [62, 38, 84];

export function InteractiveCardLayout({
	windowFields,
	statFields,
	windowSlots,
	statSlots,
	isDisabled,
	onCommit,
	labels,
}: {
	windowFields: LayoutField[];
	statFields: LayoutField[];
	windowSlots: (string | null)[];
	statSlots: (string | null)[];
	isDisabled?: boolean;
	onCommit: (next: CardLayoutModel) => void;
	labels: LayoutLabels;
}) {
	const [activeId, setActiveId] = useState<string | null>(null);

	const fieldById = new Map<string, LayoutField>(
		[...windowFields, ...statFields].map((f) => [f.id, f]),
	);
	const windowIdSet = new Set(windowFields.map((f) => f.id));
	const typeOf = (id: string): SlotType =>
		windowIdSet.has(id) ? "window" : "stat";
	const slotsOf = (type: SlotType) =>
		type === "window" ? windowSlots : statSlots;

	// The palette is derived: every field of a type not currently in a slot.
	const paletteOf = (type: SlotType): LayoutField[] => {
		const placed = new Set(
			slotsOf(type).filter((x): x is string => x != null),
		);
		return (type === "window" ? windowFields : statFields).filter(
			(f) => !placed.has(f.id),
		);
	};

	// Placed fields stay compacted to the top; empty slots always trail. Commit
	// takes an ordered list of placed ids and lays it back over the fixed slot
	// count, so the card never shows a gap above a filled slot.
	const commitPlaced = (type: SlotType, placed: string[]) => {
		const slots = slotsOf(type).map((_, i) => placed[i] ?? null);
		onCommit(
			type === "window"
				? { windowSlots: slots, statSlots }
				: { windowSlots, statSlots: slots },
		);
	};

	const placedOf = (type: SlotType): string[] =>
		slotsOf(type).filter((x): x is string => x != null);

	// Insert `id` at visual position `index` among the placed fields (moving it
	// there if it was already placed). Dropping past the end appends.
	const placeInSlot = (id: string, type: SlotType, index: number) => {
		const rest = placedOf(type).filter((x) => x !== id);
		const at = Math.min(index, rest.length);
		commitPlaced(type, [...rest.slice(0, at), id, ...rest.slice(at)]);
	};

	const removeToPalette = (id: string, type: SlotType) =>
		commitPlaced(
			type,
			placedOf(type).filter((x) => x !== id),
		);

	const addField = (id: string, type: SlotType) =>
		commitPlaced(type, [...placedOf(type), id]);

	// Discrete, non-overlapping slots: resolve to whatever is under the pointer,
	// so dragging out onto the palette lands there instead of snapping to a slot.
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
		const overId = String(over.id);
		if (overId === `palette:${type}`) {
			removeToPalette(id, type);
			return;
		}
		const m = /^slot:(window|stat):(\d+)$/.exec(overId);
		if (m && m[1] === type) placeInSlot(id, type, Number(m[2]));
	};

	const activeField = activeId ? fieldById.get(activeId) : undefined;
	const activeType = activeId ? typeOf(activeId) : null;

	// Stable per-slot keys (positions never reorder) instead of array indices.
	const windowSlotList = windowSlots.map((id, index) => ({
		key: `window-slot-${index}`,
		id,
		index,
	}));
	const statSlotList = statSlots.map((id, index) => ({
		key: `stat-slot-${index}`,
		id,
		index,
	}));

	return (
		<DndContext
			sensors={sensors}
			collisionDetection={collisionDetection}
			measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
			onDragStart={onDragStart}
			onDragEnd={onDragEnd}
			onDragCancel={() => setActiveId(null)}
		>
			<div
				className={cn(
					"grid grid-cols-1 gap-3 sm:grid-cols-2",
					isDisabled && "pointer-events-none opacity-60",
				)}
			>
				{/* Left: the card's fixed slot layout. */}
				<div className="flex flex-col gap-2 rounded-lg border border-border bg-surface-secondary p-3 dark:shadow-[0_2px_4px_0_#0000004d,0_1px_2px_0_#00000066,0_0_1px_0_#00000066]">
					<span className="text-[10px] font-medium tracking-wide text-muted uppercase">
						{labels.preview}
					</span>
					<div className="flex flex-col gap-2 border-t border-border pt-2">
						<div className="flex flex-col gap-1.5">
							{windowSlotList.map((slot) => (
								<SlotBox
									key={slot.key}
									type="window"
									index={slot.index}
									variant="bar"
									field={
										slot.id
											? fieldById.get(slot.id)
											: undefined
									}
									barPct={
										PREVIEW_BAR_PCT[
											slot.index % PREVIEW_BAR_PCT.length
										]
									}
									accepts={activeType === "window"}
									onRemove={() =>
										slot.id &&
										removeToPalette(slot.id, "window")
									}
								/>
							))}
						</div>
						<div className="grid grid-cols-2 gap-1.5">
							{statSlotList.map((slot) => (
								<SlotBox
									key={slot.key}
									type="stat"
									index={slot.index}
									variant="stat"
									field={
										slot.id
											? fieldById.get(slot.id)
											: undefined
									}
									accepts={activeType === "stat"}
									onRemove={() =>
										slot.id &&
										removeToPalette(slot.id, "stat")
									}
								/>
							))}
						</div>
					</div>
				</div>

				{/* Right: available fields to drag or add onto the card. */}
				<div className="flex flex-col gap-3 rounded-lg border border-dashed border-border p-3">
					<span className="text-[11px] font-medium tracking-wide text-muted uppercase">
						{labels.available}
					</span>
					<PaletteZone
						type="window"
						label={labels.bars}
						empty={labels.empty}
						fields={paletteOf("window")}
						accepts={activeType === "window"}
						onAdd={(id) => addField(id, "window")}
					/>
					<PaletteZone
						type="stat"
						label={labels.stats}
						empty={labels.empty}
						fields={paletteOf("stat")}
						accepts={activeType === "stat"}
						onAdd={(id) => addField(id, "stat")}
					/>
				</div>
			</div>

			<DragOverlay>
				{activeField ? (
					<FieldOverlay field={activeField} type={activeType} />
				) : null}
			</DragOverlay>
		</DndContext>
	);
}

/** One fixed slot on the card: a draggable field, or an empty dashed drop box. */
function SlotBox({
	type,
	index,
	variant,
	field,
	barPct,
	accepts,
	onRemove,
}: {
	type: SlotType;
	index: number;
	variant: "bar" | "stat";
	field?: LayoutField;
	barPct?: number;
	accepts: boolean;
	onRemove: () => void;
}) {
	const { setNodeRef, isOver } = useDroppable({
		id: `slot:${type}:${index}`,
	});
	return (
		<div
			ref={setNodeRef}
			className={cn(
				"rounded-md border border-dashed transition-colors",
				variant === "bar" ? "min-h-[38px]" : "min-h-[30px]",
				isOver && accepts
					? "border-accent bg-accent/10"
					: field
						? "border-transparent"
						: "border-border",
			)}
		>
			{field ? (
				<DraggableField
					field={field}
					variant={variant}
					barPct={barPct}
					onRemove={onRemove}
				/>
			) : null}
		</div>
	);
}

/** A field placed on the card — whole row draggable, `×` returns it to palette. */
function DraggableField({
	field,
	variant,
	barPct,
	onRemove,
}: {
	field: LayoutField;
	variant: "bar" | "stat";
	barPct?: number;
	onRemove: () => void;
}) {
	const { t } = useTranslation();
	const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
		id: field.id,
	});
	return (
		<div
			ref={setNodeRef}
			title={field.hint}
			{...attributes}
			{...listeners}
			className={cn(
				"group/field flex h-full cursor-grab touch-none items-center gap-1.5 rounded-md px-1.5 py-1 outline-none transition-colors hover:bg-foreground/[0.04]",
				isDragging && "opacity-40",
			)}
		>
			<span className="shrink-0 text-muted">
				<Bars2Icon className="size-3.5" />
			</span>
			{variant === "bar" ? (
				<div className="flex min-w-0 flex-1 flex-col gap-1">
					<span className="truncate text-[11px] text-muted">
						{field.label}
					</span>
					<div className="h-1.5 overflow-hidden rounded-full bg-foreground/10">
						<div
							className="h-full rounded-full bg-foreground/25"
							style={{ width: `${barPct ?? 50}%` }}
						/>
					</div>
				</div>
			) : (
				<div className="flex min-w-0 flex-1 items-baseline justify-between gap-1 text-[11px]">
					<span className="truncate text-muted">{field.label}</span>
					<span className="text-foreground tabular-nums">—</span>
				</div>
			)}
			<button
				type="button"
				onClick={onRemove}
				onPointerDown={(e) => e.stopPropagation()}
				aria-label={t("usageLayoutHide", { label: field.label })}
				className="shrink-0 text-muted opacity-0 transition-opacity group-hover/field:opacity-100 hover:text-danger focus-visible:opacity-100"
			>
				<XMarkIcon className="size-3.5" />
			</button>
		</div>
	);
}

/** The palette for one type: unplaced fields to drag or `+` onto the card. */
function PaletteZone({
	type,
	label,
	empty,
	fields,
	accepts,
	onAdd,
}: {
	type: SlotType;
	label: string;
	empty: string;
	fields: LayoutField[];
	accepts: boolean;
	onAdd: (id: string) => void;
}) {
	const { setNodeRef, isOver } = useDroppable({ id: `palette:${type}` });
	return (
		<div className="space-y-1">
			<span className="text-[10px] tracking-wide text-muted uppercase">
				{label}
			</span>
			<div
				ref={setNodeRef}
				className={cn(
					"flex min-h-9 flex-wrap gap-1.5 rounded-md border border-dashed p-2 transition-colors",
					isOver && accepts
						? "border-accent bg-accent/10"
						: "border-border",
				)}
			>
				{fields.length === 0 ? (
					<span className="text-[11px] text-muted">{empty}</span>
				) : (
					fields.map((f) => (
						<DraggableChip
							key={f.id}
							field={f}
							onAdd={() => onAdd(f.id)}
						/>
					))
				)}
			</div>
		</div>
	);
}

/** An available field in the palette — draggable, `+` fills the first empty slot. */
function DraggableChip({
	field,
	onAdd,
}: {
	field: LayoutField;
	onAdd: () => void;
}) {
	const { t } = useTranslation();
	const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
		id: field.id,
	});
	return (
		<div
			ref={setNodeRef}
			title={field.hint}
			{...attributes}
			{...listeners}
			className={cn(
				"inline-flex cursor-grab touch-none items-center gap-1 rounded-md border border-border bg-surface-secondary py-0.5 pr-1 pl-1.5 text-[11px] text-(--foreground) outline-none transition-colors hover:border-foreground/30",
				isDragging && "opacity-40",
			)}
		>
			<span className="text-muted">
				<Bars2Icon className="size-3" />
			</span>
			<span className="truncate">{field.label}</span>
			<button
				type="button"
				onClick={onAdd}
				onPointerDown={(e) => e.stopPropagation()}
				aria-label={t("usageLayoutShow", { label: field.label })}
				className="text-muted hover:text-accent"
			>
				<PlusIcon className="size-3.5" />
			</button>
		</div>
	);
}

/** The drag preview — a solid card shaped like the field it carries (a bar row
 * or a stat), so dragging never collapses the row into a floating pill. */
function FieldOverlay({
	field,
	type,
}: {
	field: LayoutField;
	type: SlotType | null;
}) {
	return (
		<div className="flex cursor-grabbing items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1.5 shadow-lg">
			<Bars2Icon className="size-3.5 shrink-0 text-muted" />
			{type === "window" ? (
				<div className="flex w-40 min-w-0 flex-col gap-1">
					<span className="truncate text-[11px] text-muted">
						{field.label}
					</span>
					<div className="h-1.5 overflow-hidden rounded-full bg-foreground/10">
						<div
							className="h-full rounded-full bg-foreground/25"
							style={{ width: "62%" }}
						/>
					</div>
				</div>
			) : (
				<span className="truncate text-[11px] text-muted">
					{field.label}
				</span>
			)}
		</div>
	);
}
