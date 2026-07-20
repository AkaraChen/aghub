import {
	closestCenter,
	type Collision,
	type CollisionDetection,
	DndContext,
	DragOverlay,
	type DragEndEvent,
	type DragOverEvent,
	type DragStartEvent,
	type KeyboardCoordinateGetter,
	KeyboardSensor,
	PointerSensor,
	pointerWithin,
	rectIntersection,
	useDraggable,
	useDroppable,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import { Meter } from "@heroui/react";
import { type ReactNode, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AgentIcon } from "../../lib/agent-icons";
import { cn } from "../../lib/utils";
import {
	type CardLayoutModel,
	compactLayout,
	type LayoutSlotType,
	layoutsEqual,
	projectLayout,
	shownIds,
} from "./usage-layout-model";

export type { CardLayoutModel } from "./usage-layout-model";

export interface LayoutField {
	id: string;
	label: string;
	hint?: string;
}

export interface LayoutPreview {
	agentId: string;
	agentName: string;
}

interface DragSession {
	activeId: string;
	type: LayoutSlotType;
	origin: CardLayoutModel;
	overId: string | null;
}

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
	const [session, setSession] = useState<DragSession | null>(null);
	const sessionRef = useRef<DragSession | null>(null);
	const fieldNodesRef = useRef(new Map<string, HTMLElement>());
	const keyboardTargetRef = useRef<string | null>(null);
	const fieldById = new Map(
		[...windowFields, ...statFields].map((field) => [field.id, field]),
	);
	const windowIds = new Set(windowFields.map((field) => field.id));
	const statIds = new Set(statFields.map((field) => field.id));
	const incomingLayout = compactLayout(
		{ windowSlots, statSlots },
		windowIds,
		statIds,
	);
	const displayLayout = session
		? projectLayout(
				session.origin,
				session.activeId,
				session.type,
				session.overId,
			)
		: incomingLayout;

	const registerFieldNode = (id: string, node: HTMLElement | null) => {
		if (node) fieldNodesRef.current.set(id, node);
		else fieldNodesRef.current.delete(id);
	};
	const restoreFocus = (id: string) => {
		requestAnimationFrame(() => fieldNodesRef.current.get(id)?.focus());
	};
	const keyboardCoordinates: KeyboardCoordinateGetter = (event, args) =>
		layoutKeyboardCoordinates(event, args, (id) => {
			keyboardTargetRef.current = id;
		});
	const detectCollision: CollisionDetection = (args) =>
		layoutCollisionDetection(args, keyboardTargetRef.current);

	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
		useSensor(KeyboardSensor, {
			coordinateGetter: keyboardCoordinates,
		}),
	);

	const startDrag = (event: DragStartEvent) => {
		if (isDisabled) return;
		keyboardTargetRef.current = null;
		const type = dataSlotType(event.active.data.current?.type);
		if (!type) return;
		const next = {
			activeId: String(event.active.id),
			type,
			origin: incomingLayout,
			overId: null,
		};
		sessionRef.current = next;
		setSession(next);
	};
	const updateDrag = (event: DragOverEvent) => {
		const current = sessionRef.current;
		if (!current) return;
		const next = {
			...current,
			overId: event.over ? String(event.over.id) : null,
		};
		sessionRef.current = next;
		setSession(next);
	};
	const cancelDrag = () => {
		const current = sessionRef.current;
		if (!current) return;
		const { activeId } = current;
		sessionRef.current = null;
		keyboardTargetRef.current = null;
		setSession(null);
		restoreFocus(activeId);
	};
	const endDrag = (event: DragEndEvent) => {
		const current = sessionRef.current;
		if (!current) return;
		const overId = event.over ? String(event.over.id) : current.overId;
		const next = projectLayout(
			current.origin,
			current.activeId,
			current.type,
			overId,
		);
		const { activeId, origin } = current;
		sessionRef.current = null;
		keyboardTargetRef.current = null;
		setSession(null);
		if (!layoutsEqual(origin, next)) onCommit(next);
		restoreFocus(activeId);
	};

	const shownWindows = shownIds(displayLayout, "window");
	const shownStats = shownIds(displayLayout, "stat");
	const hiddenWindows = hiddenFields(windowFields, shownWindows);
	const hiddenStats = hiddenFields(statFields, shownStats);
	const activeField = session ? fieldById.get(session.activeId) : undefined;
	const activeStartedOnCard = session
		? shownIds(session.origin, session.type).includes(session.activeId)
		: false;
	const activeBarIndex =
		session?.type === "window"
			? shownIds(session.origin, "window").indexOf(session.activeId)
			: -1;

	return (
		<DndContext
			sensors={sensors}
			collisionDetection={detectCollision}
			onDragStart={startDrag}
			onDragOver={updateDrag}
			onDragEnd={endDrag}
			onDragCancel={cancelDrag}
		>
			<div
				aria-disabled={isDisabled || undefined}
				inert={isDisabled || undefined}
				className={cn(
					"grid w-full grid-cols-1 gap-5 lg:grid-cols-[20rem_minmax(0,1fr)] lg:items-start",
					"transition-opacity duration-[var(--dur-fast)] ease-[var(--ease-out)] motion-reduce:transition-none",
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

					<CardSection
						type="window"
						isDisabled={isDisabled}
						className="flex min-h-7 flex-col gap-1.5 rounded-md"
						data-testid="layout-window-section"
					>
						{shownWindows.map((id, index) => {
							const field = fieldById.get(id);
							if (!field) return null;
							return (
								<CardDropSlot
									key={layoutSlotId("window", index)}
									type="window"
									index={index}
									isDisabled={isDisabled}
								>
									<DraggableFieldRow
										field={field}
										type="window"
										isDisabled={isDisabled}
										isActive={
											session?.activeId === field.id
										}
										onNodeChange={registerFieldNode}
										data-testid={`layout-card-item-${field.id}`}
										className="-mx-1 flex items-center rounded-md px-1 py-0.5"
									>
										<BarBody
											label={field.label}
											pct={
												PREVIEW_BAR_PCT[
													index %
														PREVIEW_BAR_PCT.length
												]
											}
										/>
									</DraggableFieldRow>
								</CardDropSlot>
							);
						})}
					</CardSection>

					<CardSection
						type="stat"
						isDisabled={isDisabled}
						className={cn(
							"grid min-h-5 grid-cols-2 gap-x-3 gap-y-1 rounded",
							shownWindows.length > 0 && "mt-2",
						)}
						data-testid="layout-stat-section"
					>
						{shownStats.map((id, index) => {
							const field = fieldById.get(id);
							if (!field) return null;
							return (
								<CardDropSlot
									key={layoutSlotId("stat", index)}
									type="stat"
									index={index}
									isDisabled={isDisabled}
								>
									<DraggableFieldRow
										field={field}
										type="stat"
										isDisabled={isDisabled}
										isActive={
											session?.activeId === field.id
										}
										onNodeChange={registerFieldNode}
										data-testid={`layout-card-item-${field.id}`}
										data-layout-type="stat"
										className="-mx-1 flex min-w-0 items-center rounded px-1 py-0.5 text-[11px]"
									>
										<span className="truncate text-muted">
											{field.label}
										</span>
									</DraggableFieldRow>
								</CardDropSlot>
							);
						})}
					</CardSection>

					{shownWindows.length === 0 && shownStats.length === 0 && (
						<p className="py-3 text-center text-[11px] text-muted">
							{t("usageLayoutEmptyCard")}
						</p>
					)}
				</div>

				<HiddenDrawer
					active={activeStartedOnCard}
					isDisabled={isDisabled}
					windows={hiddenWindows}
					stats={hiddenStats}
					activeId={session?.activeId ?? null}
					onNodeChange={registerFieldNode}
				/>
			</div>

			<DragOverlay adjustScale={false} dropAnimation={null}>
				{activeField && session ? (
					<DragGhost
						field={activeField}
						type={session.type}
						barPct={
							activeBarIndex >= 0
								? PREVIEW_BAR_PCT[
										activeBarIndex % PREVIEW_BAR_PCT.length
									]
								: 0
						}
					/>
				) : null}
			</DragOverlay>
		</DndContext>
	);
}

function CardSection({
	type,
	isDisabled,
	className,
	children,
	...props
}: {
	type: LayoutSlotType;
	isDisabled?: boolean;
	className?: string;
	children: ReactNode;
} & React.HTMLAttributes<HTMLDivElement>) {
	const { setNodeRef, isOver } = useDroppable({
		id: `section:${type}`,
		disabled: isDisabled,
		data: { kind: "section", type },
	});
	return (
		<div
			{...props}
			ref={setNodeRef}
			className={cn(
				className,
				isOver && "bg-accent/5",
				"transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)] motion-reduce:transition-none",
			)}
		>
			{children}
		</div>
	);
}

function CardDropSlot({
	type,
	index,
	isDisabled,
	children,
}: {
	type: LayoutSlotType;
	index: number;
	isDisabled?: boolean;
	children: ReactNode;
}) {
	const { setNodeRef } = useDroppable({
		id: `slot:${type}:${index}`,
		disabled: isDisabled,
		data: { kind: "slot", type, index },
	});
	return <div ref={setNodeRef}>{children}</div>;
}

function DraggableFieldRow({
	field,
	type,
	isDisabled,
	isActive,
	onNodeChange,
	className,
	children,
	...props
}: {
	field: LayoutField;
	type: LayoutSlotType;
	isDisabled?: boolean;
	isActive: boolean;
	onNodeChange: (id: string, node: HTMLElement | null) => void;
	className?: string;
	children: ReactNode;
} & Omit<React.HTMLAttributes<HTMLDivElement>, "title">) {
	const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
		id: field.id,
		disabled: isDisabled,
		data: { kind: "field", type },
	});
	const setRowRef = (node: HTMLDivElement | null) => {
		setNodeRef(node);
		onNodeChange(field.id, node);
	};
	return (
		<div
			{...props}
			{...attributes}
			{...listeners}
			ref={setRowRef}
			title={field.hint}
			aria-label={field.label}
			className={cn(
				"min-w-0 touch-none select-none outline-none",
				"transition-[background-color,box-shadow,opacity] duration-[var(--dur-fast)] ease-[var(--ease-out)] motion-reduce:transition-none",
				isDisabled
					? "opacity-40"
					: "cursor-grab hover:bg-surface-secondary active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-surface",
				isDragging && isActive && "opacity-45",
				className,
			)}
		>
			{children}
		</div>
	);
}

function HiddenDrawer({
	active,
	isDisabled,
	windows,
	stats,
	activeId,
	onNodeChange,
}: {
	active: boolean;
	isDisabled?: boolean;
	windows: LayoutField[];
	stats: LayoutField[];
	activeId: string | null;
	onNodeChange: (id: string, node: HTMLElement | null) => void;
}) {
	const { t } = useTranslation();
	const { setNodeRef, isOver } = useDroppable({
		id: "hidden-drawer",
		disabled: isDisabled,
		data: { kind: "drawer" },
	});
	const empty = windows.length === 0 && stats.length === 0;
	return (
		<div
			ref={setNodeRef}
			data-testid="layout-hidden-drawer"
			className={cn(
				"flex min-w-0 flex-col gap-1.5 rounded-lg border-t border-border pt-4 outline -outline-offset-1 outline-transparent",
				"transition-[background-color,outline-color] duration-[var(--dur-fast)] ease-[var(--ease-out)] motion-reduce:transition-none",
				"lg:rounded-lg lg:border-t-0 lg:border-l lg:pt-0 lg:pl-5",
				active && isOver && "bg-accent/5 outline-accent",
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
					{windows.map((field) => (
						<DraggableFieldRow
							key={field.id}
							field={field}
							type="window"
							isDisabled={isDisabled}
							isActive={activeId === field.id}
							onNodeChange={onNodeChange}
							data-testid={`layout-hidden-item-${field.id}`}
							className="-mx-1 flex items-center rounded-md px-1 py-0.5"
						>
							<BarBody label={field.label} pct={0} />
						</DraggableFieldRow>
					))}
					{stats.length > 0 && (
						<div className="grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-x-3 gap-y-1">
							{stats.map((field) => (
								<DraggableFieldRow
									key={field.id}
									field={field}
									type="stat"
									isDisabled={isDisabled}
									isActive={activeId === field.id}
									onNodeChange={onNodeChange}
									data-testid={`layout-hidden-item-${field.id}`}
									data-layout-type="stat"
									className="-mx-1 flex min-w-0 items-center rounded px-1 py-0.5 text-[11px]"
								>
									<span className="truncate text-muted">
										{field.label}
									</span>
								</DraggableFieldRow>
							))}
						</div>
					)}
				</>
			)}
		</div>
	);
}

function DragGhost({
	field,
	type,
	barPct,
}: {
	field: LayoutField;
	type: LayoutSlotType;
	barPct: number;
}) {
	if (type === "window") {
		return (
			<div className="w-72 max-w-[calc(100vw-2rem)] cursor-grabbing rounded-md border border-border bg-overlay p-1 shadow-[var(--overlay-shadow)]">
				<BarBody label={field.label} pct={barPct} />
			</div>
		);
	}
	return (
		<div className="w-36 cursor-grabbing truncate rounded-md border border-border bg-overlay px-1.5 py-1 text-[11px] text-muted shadow-[var(--overlay-shadow)]">
			{field.label}
		</div>
	);
}

function BarBody({ label, pct }: { label: string; pct: number }) {
	return (
		<div className="flex min-w-0 flex-1 flex-col gap-0.5">
			<span className="truncate text-[11px] text-muted">{label}</span>
			<Meter aria-hidden aria-label={label} value={pct} size="sm">
				<Meter.Track>
					<Meter.Fill className="bg-foreground/25" />
				</Meter.Track>
			</Meter>
		</div>
	);
}

function hiddenFields(fields: LayoutField[], shown: string[]): LayoutField[] {
	const shownSet = new Set(shown);
	return fields.filter((field) => !shownSet.has(field.id));
}

function layoutCollisionDetection(
	args: Parameters<CollisionDetection>[0],
	keyboardTargetId: string | null,
): ReturnType<CollisionDetection> {
	if (!args.pointerCoordinates && keyboardTargetId) {
		return [{ id: keyboardTargetId }];
	}
	const activeType = dataSlotType(args.active.data.current?.type);
	if (!activeType) return [];

	const pointer = pointerWithin(args);
	if (pointer.length > 0) return prioritizeOverlapping(pointer, activeType);

	const intersecting = rectIntersection(args);
	if (intersecting.length > 0) {
		return prioritizeOverlapping(intersecting, activeType);
	}

	return firstCompatible(closestCenter(args), activeType);
}

function prioritizeOverlapping(
	collisions: Collision[],
	type: LayoutSlotType,
): Collision[] {
	const slot = collisions.find((collision) =>
		String(collision.id).startsWith(`slot:${type}:`),
	);
	if (slot) return [slot];
	const section = collisions.find(
		(collision) => String(collision.id) === `section:${type}`,
	);
	if (section) return [section];
	const drawer = collisions.find(
		(collision) => String(collision.id) === "hidden-drawer",
	);
	return drawer ? [drawer] : [];
}

function firstCompatible(
	collisions: Collision[],
	type: LayoutSlotType,
): Collision[] {
	const collision = collisions.find((candidate) =>
		isCompatibleTarget(String(candidate.id), type),
	);
	return collision ? [collision] : [];
}

function isCompatibleTarget(id: string, type: LayoutSlotType): boolean {
	return (
		id === "hidden-drawer" ||
		id === `section:${type}` ||
		id.startsWith(`slot:${type}:`)
	);
}

function layoutKeyboardCoordinates(
	event: Parameters<KeyboardCoordinateGetter>[0],
	{ currentCoordinates, context }: Parameters<KeyboardCoordinateGetter>[1],
	onTarget: (id: string) => void,
): ReturnType<KeyboardCoordinateGetter> {
	const direction = keyboardDirection(event.code);
	if (!direction) return;
	const type = dataSlotType(context.active?.data.current?.type);
	const sourceRect = context.over?.rect ?? context.draggingNodeRect;
	if (!type || !sourceRect) return;
	event.preventDefault();

	const sourceCenter = rectCenter(sourceRect);
	const compatibleTargets = [...context.droppableRects.entries()].filter(
		([id]) => isCompatibleTarget(String(id), type),
	);
	const hasVisibleSlots = compatibleTargets.some(([id]) =>
		String(id).startsWith(`slot:${type}:`),
	);
	const keyboardTargets = hasVisibleSlots
		? compatibleTargets.filter(([id]) => String(id) !== `section:${type}`)
		: compatibleTargets;
	const candidates = keyboardTargets
		.map(([id, rect]) => ({ id, rect, center: rectCenter(rect) }))
		.filter(({ id, center }) => {
			if (id === context.over?.id) return false;
			const delta =
				direction.axis === "x"
					? center.x - sourceCenter.x
					: center.y - sourceCenter.y;
			return direction.sign * delta > 1;
		})
		.sort((left, right) => {
			const leftPrimary =
				direction.axis === "x"
					? Math.abs(left.center.x - sourceCenter.x)
					: Math.abs(left.center.y - sourceCenter.y);
			const rightPrimary =
				direction.axis === "x"
					? Math.abs(right.center.x - sourceCenter.x)
					: Math.abs(right.center.y - sourceCenter.y);
			const leftSecondary =
				direction.axis === "x"
					? Math.abs(left.center.y - sourceCenter.y)
					: Math.abs(left.center.x - sourceCenter.x);
			const rightSecondary =
				direction.axis === "x"
					? Math.abs(right.center.y - sourceCenter.y)
					: Math.abs(right.center.x - sourceCenter.x);
			return (
				leftPrimary +
				leftSecondary * 0.35 -
				(rightPrimary + rightSecondary * 0.35)
			);
		});
	const target = candidates[0];
	if (!target) return;
	onTarget(String(target.id));
	return {
		x: currentCoordinates.x + target.center.x - sourceCenter.x,
		y: currentCoordinates.y + target.center.y - sourceCenter.y,
	};
}

function layoutSlotId(type: LayoutSlotType, index: number): string {
	return `slot:${type}:${index}`;
}

function dataSlotType(value: unknown): LayoutSlotType | null {
	return value === "window" || value === "stat" ? value : null;
}

function keyboardDirection(code: string): {
	axis: "x" | "y";
	sign: -1 | 1;
} | null {
	switch (code) {
		case "ArrowLeft":
			return { axis: "x", sign: -1 };
		case "ArrowRight":
			return { axis: "x", sign: 1 };
		case "ArrowUp":
			return { axis: "y", sign: -1 };
		case "ArrowDown":
			return { axis: "y", sign: 1 };
		default:
			return null;
	}
}

function rectCenter(rect: {
	left: number;
	top: number;
	width: number;
	height: number;
}) {
	return {
		x: rect.left + rect.width / 2,
		y: rect.top + rect.height / 2,
	};
}
