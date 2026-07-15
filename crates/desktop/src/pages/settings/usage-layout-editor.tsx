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
import { Bars2Icon, EyeIcon, EyeSlashIcon } from "@heroicons/react/24/solid";
import { useState } from "react";
import { useTranslation } from "react-i18next";
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

export interface LayoutLabels {
	bars: string;
	stats: string;
}

type SlotType = "window" | "stat";

/** Fixed placeholder fills so a shown bar reads as a bar without implying data. */
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

	// Shown fields in order.
	const shownOf = (type: SlotType): string[] =>
		slotsOf(type).filter((x): x is string => x != null);

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
		onCommit(
			type === "window"
				? { windowSlots: slots, statSlots }
				: { windowSlots, statSlots: slots },
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
		const m = /^slot:(window|stat):(\d+)$/.exec(String(over.id));
		if (m && m[1] === type) moveTo(id, type, Number(m[2]));
	};

	const activeField = activeId ? fieldById.get(activeId) : undefined;
	const activeType = activeId ? typeOf(activeId) : null;

	const section = (
		type: SlotType,
		label: string,
		variant: "bar" | "stat",
	) => {
		const shown = shownOf(type);
		const hidden = hiddenOf(type);
		const full = shown.length >= slotsOf(type).length;
		return (
			<div className="flex flex-col gap-1.5">
				<span className="text-[10px] font-medium tracking-wide text-muted uppercase">
					{label}
				</span>
				{shown.map((id, index) => {
					const field = fieldById.get(id);
					if (!field) return null;
					return (
						<ShownRow
							key={id}
							field={field}
							type={type}
							index={index}
							variant={variant}
							accepts={activeType === type}
							onHide={() => hide(id, type)}
						/>
					);
				})}
				{hidden.map((field) => (
					<HiddenRow
						key={field.id}
						field={field}
						variant={variant}
						atCap={full}
						onShow={() => show(field.id, type)}
					/>
				))}
			</div>
		);
	};

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
					"flex flex-col gap-4 rounded-lg border border-border bg-surface-secondary p-3",
					isDisabled && "pointer-events-none opacity-60",
				)}
			>
				{section("window", labels.bars, "bar")}
				{section("stat", labels.stats, "stat")}
			</div>

			<DragOverlay>
				{activeField ? (
					<FieldOverlay field={activeField} type={activeType} />
				) : null}
			</DragOverlay>
		</DndContext>
	);
}

/** The icon + bar/stat body shared by shown and hidden rows, so a bar always
 *  reads as a bar and a stat as a stat. A shown bar is filled; a hidden one
 *  keeps the empty track. */
function FieldBody({
	field,
	variant,
	barPct,
	shown,
}: {
	field: LayoutField;
	variant: "bar" | "stat";
	barPct?: number;
	shown: boolean;
}) {
	return (
		<>
			<Bars2Icon className="size-3.5 shrink-0 text-muted" />
			{variant === "bar" ? (
				<div className="flex min-w-0 flex-1 flex-col gap-1">
					<span className="truncate text-[11px] text-muted">
						{field.label}
					</span>
					<div className="h-1.5 overflow-hidden rounded-full bg-foreground/10">
						{barPct != null && (
							<div
								className="h-full rounded-full bg-foreground/25"
								style={{ width: `${barPct}%` }}
							/>
						)}
					</div>
				</div>
			) : (
				<div className="flex min-w-0 flex-1 items-baseline justify-between gap-1 text-[11px]">
					<span className="truncate text-muted">{field.label}</span>
					{shown && (
						<span className="text-foreground tabular-nums">—</span>
					)}
				</div>
			)}
		</>
	);
}

/** A field shown on the card: a drop slot at its position, draggable to reorder,
 *  with an eye toggle to hide it. */
function ShownRow({
	field,
	type,
	index,
	variant,
	accepts,
	onHide,
}: {
	field: LayoutField;
	type: SlotType;
	index: number;
	variant: "bar" | "stat";
	accepts: boolean;
	onHide: () => void;
}) {
	const { t } = useTranslation();
	const { setNodeRef: dropRef, isOver } = useDroppable({
		id: `slot:${type}:${index}`,
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
					"group/row flex cursor-grab touch-none items-center gap-2 rounded-md px-1.5 py-1 outline-none transition-colors hover:bg-foreground/[0.04]",
					isDragging && "opacity-40",
				)}
			>
				<FieldBody
					field={field}
					variant={variant}
					barPct={PREVIEW_BAR_PCT[index % PREVIEW_BAR_PCT.length]}
					shown
				/>
				<button
					type="button"
					onClick={onHide}
					onPointerDown={(e) => e.stopPropagation()}
					aria-label={t("usageLayoutHide", { label: field.label })}
					className="shrink-0 text-muted transition-colors hover:text-foreground"
				>
					<EyeIcon className="size-4" />
				</button>
			</div>
		</div>
	);
}

/** A field not on the card: dimmed, draggable in, with an eye toggle to show it.
 *  Disabled once the card is at its cap for this type. */
function HiddenRow({
	field,
	variant,
	atCap,
	onShow,
}: {
	field: LayoutField;
	variant: "bar" | "stat";
	atCap: boolean;
	onShow: () => void;
}) {
	const { t } = useTranslation();
	const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
		id: field.id,
		disabled: atCap,
	});
	return (
		<div
			ref={setNodeRef}
			title={field.hint}
			{...(atCap ? {} : attributes)}
			{...(atCap ? {} : listeners)}
			className={cn(
				"flex items-center gap-2 rounded-md px-1.5 py-1 outline-none transition-opacity",
				atCap
					? "opacity-40"
					: "cursor-grab touch-none opacity-60 hover:opacity-100",
				isDragging && "opacity-40",
			)}
		>
			<FieldBody field={field} variant={variant} shown={false} />
			<button
				type="button"
				onClick={onShow}
				onPointerDown={(e) => e.stopPropagation()}
				disabled={atCap}
				aria-label={t("usageLayoutShow", { label: field.label })}
				className="shrink-0 text-muted transition-colors hover:text-accent disabled:cursor-not-allowed disabled:hover:text-muted"
			>
				<EyeSlashIcon className="size-4" />
			</button>
		</div>
	);
}

/** The drag preview — a solid card shaped like the field it carries (a bar row
 *  or a stat), so dragging never collapses the row into a floating pill. */
function FieldOverlay({
	field,
	type,
}: {
	field: LayoutField;
	type: SlotType | null;
}) {
	return (
		<div className="flex w-48 cursor-grabbing items-center gap-2 rounded-md border border-border bg-surface px-2 py-1.5 shadow-lg">
			<FieldBody
				field={field}
				variant={type === "window" ? "bar" : "stat"}
				barPct={type === "window" ? 62 : undefined}
				shown
			/>
		</div>
	);
}
