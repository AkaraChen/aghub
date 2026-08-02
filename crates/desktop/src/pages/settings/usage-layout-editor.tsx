import {
	type Announcements,
	type CollisionDetection,
	DndContext,
	type DragEndEvent,
	type DragOverEvent,
	type DragStartEvent,
	type KeyboardCoordinateGetter,
	KeyboardSensor,
	PointerSensor,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import { useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { UsageLayoutCanvas } from "./usage-layout-canvas";
import {
	dataSlotType,
	layoutCollisionDetection,
	layoutKeyboardCoordinates,
	prefersReducedMotion,
} from "./usage-layout-dnd";
import {
	type CardLayoutModel,
	compactLayout,
	layoutsEqual,
	projectLayout,
	setLayoutFieldVisible,
	shownIds,
} from "./usage-layout-model";
import type {
	LayoutDragPreview,
	LayoutField,
	LayoutPreview,
} from "./usage-layout-types";

export type { CardLayoutModel } from "./usage-layout-model";
export type { LayoutField, LayoutPreview } from "./usage-layout-types";

interface DragSession extends LayoutDragPreview {
	overId: string | null;
}

const LAYOUT_MOVE_DURATION_MS = 140;
const LAYOUT_MOVE_EASING = "cubic-bezier(0.2, 0, 0, 1)";
// Keep page scrolling at the viewport edge so crossing the side-by-side
// editor does not move the settings page unexpectedly.
const LAYOUT_AUTO_SCROLL_EDGE_RATIO = 0.08;
const LAYOUT_AUTO_SCROLL = {
	threshold: {
		x: LAYOUT_AUTO_SCROLL_EDGE_RATIO,
		y: LAYOUT_AUTO_SCROLL_EDGE_RATIO,
	},
};

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
	const fieldRectsRef = useRef(new Map<string, DOMRect>());
	const fieldAnimationsRef = useRef(new Map<string, Animation>());
	const animateNextLayoutRef = useRef(false);
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

	useLayoutEffect(() => {
		for (const animation of fieldAnimationsRef.current.values()) {
			animation.cancel();
		}
		fieldAnimationsRef.current.clear();

		const nextRects = new Map<string, DOMRect>();
		for (const [id, node] of fieldNodesRef.current) {
			nextRects.set(id, node.getBoundingClientRect());
		}

		const shouldAnimate = animateNextLayoutRef.current;
		animateNextLayoutRef.current = false;
		if (shouldAnimate && !prefersReducedMotion()) {
			for (const [id, nextRect] of nextRects) {
				if (id === session?.activeId) continue;
				const previousRect = fieldRectsRef.current.get(id);
				const node = fieldNodesRef.current.get(id);
				if (!previousRect || !node) continue;

				const deltaX = previousRect.left - nextRect.left;
				const deltaY = previousRect.top - nextRect.top;
				if (Math.abs(deltaX) < 0.5 && Math.abs(deltaY) < 0.5) continue;

				const animation = node.animate(
					[
						{ transform: `translate(${deltaX}px, ${deltaY}px)` },
						{ transform: "translate(0, 0)" },
					],
					{
						duration: LAYOUT_MOVE_DURATION_MS,
						easing: LAYOUT_MOVE_EASING,
					},
				);
				fieldAnimationsRef.current.set(id, animation);
				const clearAnimation = () => {
					if (fieldAnimationsRef.current.get(id) === animation) {
						fieldAnimationsRef.current.delete(id);
					}
				};
				void animation.finished.then(clearAnimation, clearAnimation);
			}
		}

		fieldRectsRef.current = nextRects;
	});

	useLayoutEffect(
		() => () => {
			for (const animation of fieldAnimationsRef.current.values()) {
				animation.cancel();
			}
		},
		[],
	);

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
		useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
		useSensor(KeyboardSensor, {
			coordinateGetter: keyboardCoordinates,
			scrollBehavior: "auto",
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
		if (next.overId === current.overId) return;
		animateNextLayoutRef.current = true;
		sessionRef.current = next;
		setSession(next);
	};
	const cancelDrag = () => {
		const current = sessionRef.current;
		if (!current) return;
		const { activeId } = current;
		animateNextLayoutRef.current = true;
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
		animateNextLayoutRef.current = true;
		sessionRef.current = null;
		keyboardTargetRef.current = null;
		setSession(null);
		if (!layoutsEqual(origin, next)) onCommit(next);
		restoreFocus(activeId);
	};

	const shownWindows = shownIds(displayLayout, "window");
	const shownStats = shownIds(displayLayout, "stat");
	const handleVisibilityChange = (
		id: string,
		type: "window" | "stat",
		isVisible: boolean,
	) => {
		if (isDisabled || session) return;
		const next = setLayoutFieldVisible(incomingLayout, id, type, isVisible);
		if (!layoutsEqual(incomingLayout, next)) onCommit(next);
	};
	const fieldLabel = (id: string) => fieldById.get(id)?.label ?? id;
	const announceTarget = (activeId: string, overId: string | null) => {
		const field = fieldLabel(activeId);
		if (!overId) return t("usageLayoutAnnounceNoTarget", { field });
		if (overId === "hidden-drawer") {
			return t("usageLayoutAnnounceHidden", { field });
		}
		const current = sessionRef.current;
		if (!current) return t("usageLayoutAnnounceMoved", { field });
		const slotMatch = /^slot:(?:window|stat):(\d+)$/.exec(overId);
		const position = slotMatch
			? Number(slotMatch[1]) + 1
			: shownIds(current.origin, current.type).length + 1;
		const before = shownIds(current.origin, current.type);
		const after = shownIds(
			projectLayout(
				current.origin,
				current.activeId,
				current.type,
				overId,
			),
			current.type,
		);
		const afterIds = new Set(after);
		const overflowed = before.find(
			(id) => id !== activeId && !afterIds.has(id),
		);
		return overflowed
			? t("usageLayoutAnnounceInsertOverflow", {
					field,
					position,
					overflowed: fieldLabel(overflowed),
				})
			: t("usageLayoutAnnouncePosition", { field, position });
	};
	const announcements: Announcements = {
		onDragStart: ({ active }) =>
			t("usageLayoutAnnouncePickedUp", {
				field: fieldLabel(String(active.id)),
			}),
		onDragOver: ({ active, over }) =>
			announceTarget(String(active.id), over ? String(over.id) : null),
		onDragEnd: ({ active, over }) =>
			over
				? t("usageLayoutAnnounceDropped", {
						field: fieldLabel(String(active.id)),
					})
				: t("usageLayoutAnnounceCancelled", {
						field: fieldLabel(String(active.id)),
					}),
		onDragCancel: ({ active }) =>
			t("usageLayoutAnnounceCancelled", {
				field: fieldLabel(String(active.id)),
			}),
	};

	return (
		<DndContext
			autoScroll={LAYOUT_AUTO_SCROLL}
			accessibility={{
				announcements,
				screenReaderInstructions: {
					draggable: t("usageLayoutDragInstructions"),
				},
			}}
			sensors={sensors}
			collisionDetection={detectCollision}
			onDragStart={startDrag}
			onDragOver={updateDrag}
			onDragEnd={endDrag}
			onDragCancel={cancelDrag}
		>
			<UsageLayoutCanvas
				windowFields={windowFields}
				statFields={statFields}
				fieldById={fieldById}
				shownWindows={shownWindows}
				shownStats={shownStats}
				windowCapacity={displayLayout.windowSlots.length}
				statCapacity={displayLayout.statSlots.length}
				drag={session}
				isDisabled={isDisabled}
				preview={preview}
				onNodeChange={registerFieldNode}
				onVisibilityChange={handleVisibilityChange}
			/>
		</DndContext>
	);
}
