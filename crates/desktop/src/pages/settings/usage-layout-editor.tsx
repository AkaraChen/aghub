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
import { EyeSlashIcon, PlusIcon } from "@heroicons/react/24/solid";
import { Meter } from "@heroui/react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AgentIcon } from "../../lib/agent-icons";
import { meterColor } from "../../lib/usage-format";
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

/** Live values for the card replica, so the editor previews the real thing.
 *  `null` means no data for that field — the replica falls back to a fixed
 *  placeholder fill / an em dash. */
export interface LayoutPreview {
	agentId: string;
	agentName: string;
	windowPct: (id: string) => number | null;
	statValue: (id: string) => string | null;
	alertThresholdPct: number;
}

type SlotType = "window" | "stat";

/** Fixed placeholder fills so a bar without data still reads as a bar. */
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
			measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
			onDragStart={onDragStart}
			onDragEnd={onDragEnd}
			onDragCancel={() => setActiveId(null)}
		>
			{/* The card replica beside the dashed drawer of hidden fields.
			    Drag between the two (or use the eye / plus buttons) to show
			    and hide. */}
			<div
				className={cn(
					"flex flex-col gap-4 sm:flex-row sm:items-start",
					isDisabled && "pointer-events-none opacity-60",
				)}
			>
				<div className="w-72 max-w-full shrink-0 rounded-lg border border-border bg-surface p-3">
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
							const live = preview.windowPct(id);
							return (
								<PreviewBarRow
									key={id}
									field={field}
									index={index}
									pct={
										live ??
										PREVIEW_BAR_PCT[
											index % PREVIEW_BAR_PCT.length
										]
									}
									live={live != null}
									alertThresholdPct={
										preview.alertThresholdPct
									}
									accepts={activeType === "window"}
									onHide={() => hide(id, "window")}
								/>
							);
						})}
					</div>
					{shownStats.length > 0 && (
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
										value={preview.statValue(id)}
										accepts={activeType === "stat"}
										onHide={() => hide(id, "stat")}
									/>
								);
							})}
						</div>
					)}
					{shownWindows.length === 0 && shownStats.length === 0 && (
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

			<DragOverlay>
				{activeField ? (
					<div className="flex w-56 cursor-grabbing items-center gap-2 rounded-md border border-border bg-surface px-2 py-1.5 shadow-lg">
						<span className="truncate text-[11px] text-muted">
							{activeField.label}
						</span>
					</div>
				) : null}
			</DragOverlay>
		</DndContext>
	);
}

/** A quota bar on the replica: label + % + a real meter. Drag to reorder,
 *  eye to hide (revealed on hover). */
function PreviewBarRow({
	field,
	index,
	pct,
	live,
	alertThresholdPct,
	accepts,
	onHide,
}: {
	field: LayoutField;
	index: number;
	pct: number;
	live: boolean;
	alertThresholdPct: number;
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
					"group/row flex cursor-grab touch-none flex-col gap-0.5 rounded-md outline-none",
					isDragging && "opacity-40",
				)}
			>
				<div className="flex items-baseline justify-between gap-2 text-[11px]">
					<span className="truncate text-muted">{field.label}</span>
					<span className="flex shrink-0 items-center gap-1.5">
						<span
							className={cn(
								"font-medium tabular-nums",
								!live && "text-muted",
							)}
						>
							{Math.round(pct)}%
						</span>
						<button
							type="button"
							onClick={onHide}
							onPointerDown={(e) => e.stopPropagation()}
							aria-label={t("usageLayoutHide", {
								label: field.label,
							})}
							className="text-muted opacity-0 transition-opacity group-hover/row:opacity-100 hover:text-foreground focus-visible:opacity-100"
						>
							<EyeSlashIcon className="size-3.5" />
						</button>
					</span>
				</div>
				<Meter
					aria-label={field.label}
					value={pct}
					{...(live
						? { color: meterColor(pct, alertThresholdPct) }
						: {})}
					size="sm"
				>
					<Meter.Track>
						<Meter.Fill
							className={cn(!live && "bg-foreground/25")}
						/>
					</Meter.Track>
				</Meter>
			</div>
		</div>
	);
}

/** A bottom stat on the replica: label + value in the 2×2 grid. */
function PreviewStatCell({
	field,
	index,
	value,
	accepts,
	onHide,
}: {
	field: LayoutField;
	index: number;
	value: string | null;
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
					isDragging && "opacity-40",
				)}
			>
				<span className="truncate text-muted">{field.label}</span>
				<span className="flex shrink-0 items-center gap-1">
					<span className="text-foreground tabular-nums">
						{value ?? "—"}
					</span>
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

/** The drawer pane beside the card: everything not shown, kept in the
 *  field's own shape (a bar keeps its empty track). Also a drop target —
 *  dragging a field onto it hides the field. */
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
			className={cn(
				"flex w-56 max-w-full flex-col gap-1 rounded-lg border border-dashed border-border p-3 transition-colors",
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
				</>
			)}
		</div>
	);
}

/** A hidden quota bar: label over an empty track, so it still reads as a bar. */
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
			{...(atCap ? {} : attributes)}
			{...(atCap ? {} : listeners)}
			className={cn(
				"group/hid flex items-center gap-2 rounded-md outline-none transition-opacity",
				atCap
					? "opacity-40"
					: "cursor-grab touch-none opacity-70 hover:opacity-100",
				isDragging && "opacity-40",
			)}
		>
			<div className="flex min-w-0 flex-1 flex-col gap-1">
				<span className="flex items-baseline justify-between gap-2 text-[11px] text-muted">
					<span className="truncate">{field.label}</span>
					{field.hint && (
						<span className="shrink-0 text-foreground/40">
							{field.hint}
						</span>
					)}
				</span>
				<div className="h-1 rounded-full bg-foreground/10" />
			</div>
			<button
				type="button"
				onClick={onShow}
				onPointerDown={(e) => e.stopPropagation()}
				disabled={atCap}
				aria-label={showLabel}
				className="shrink-0 text-muted transition-colors hover:text-accent disabled:cursor-not-allowed disabled:hover:text-muted"
			>
				<PlusIcon className="size-3.5" />
			</button>
		</div>
	);
}

/** A hidden stat in the two-column drawer grid. */
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
			{...(atCap ? {} : attributes)}
			{...(atCap ? {} : listeners)}
			className={cn(
				"flex items-center justify-between gap-1 rounded text-[11px] outline-none transition-opacity",
				atCap
					? "opacity-40"
					: "cursor-grab touch-none opacity-70 hover:opacity-100",
				isDragging && "opacity-40",
			)}
		>
			<span className="truncate text-muted">{field.label}</span>
			<button
				type="button"
				onClick={onShow}
				onPointerDown={(e) => e.stopPropagation()}
				disabled={atCap}
				aria-label={showLabel}
				className="shrink-0 text-muted transition-colors hover:text-accent disabled:cursor-not-allowed disabled:hover:text-muted"
			>
				<PlusIcon className="size-3" />
			</button>
		</div>
	);
}
