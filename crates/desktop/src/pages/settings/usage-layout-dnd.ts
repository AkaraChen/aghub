import {
	closestCenter,
	type Collision,
	type CollisionDetection,
	type KeyboardCoordinateGetter,
	pointerWithin,
	rectIntersection,
} from "@dnd-kit/core";
import type { LayoutSlotType } from "./usage-layout-model";

export function layoutCollisionDetection(
	args: Parameters<CollisionDetection>[0],
	keyboardTargetId: string | null,
): ReturnType<CollisionDetection> {
	if (!args.pointerCoordinates && keyboardTargetId) {
		return [{ id: keyboardTargetId }];
	}
	const activeType = dataSlotType(args.active.data.current?.type);
	if (!activeType) return [];

	const pointer = pointerWithin(args);
	if (args.pointerCoordinates && pointer.length > 0) {
		if (
			pointer.some(
				(collision) => collision.id === `section:${activeType}`,
			)
		) {
			const slot = closestSlotToPointer(
				args.pointerCoordinates,
				args.droppableRects,
				activeType,
			);
			if (slot) return [slot];
		}
		return prioritizeOverlapping(pointer, activeType);
	}

	const intersecting = rectIntersection(args);
	if (intersecting.length > 0) {
		return prioritizeOverlapping(intersecting, activeType);
	}

	return firstCompatible(closestCenter(args), activeType);
}

export function layoutKeyboardCoordinates(
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
	const cardSlots = keyboardTargets.filter(([id]) =>
		String(id).startsWith(`slot:${type}:`),
	);
	const trailingCardSlot = cardSlots[cardSlots.length - 1];
	const movesFromFieldLibraryToCard =
		direction.axis === "x" &&
		direction.sign === -1 &&
		context.activeNode?.closest("[data-layout-field-library]");
	const target =
		movesFromFieldLibraryToCard && trailingCardSlot
			? {
					id: trailingCardSlot[0],
					rect: trailingCardSlot[1],
					center: rectCenter(trailingCardSlot[1]),
				}
			: candidates[0];
	if (!target) return;
	// KeyboardSensor only scrolls along the pressed arrow's axis, while a
	// directional grid move can resolve to a slot on another row.
	context.droppableContainers.getNodeFor(target.id)?.scrollIntoView({
		block: "nearest",
		inline: "nearest",
		behavior: "auto",
	});
	const nextSourceCenter = rectCenter(sourceRect);
	const nextTargetCenter = rectCenter(target.rect);
	onTarget(String(target.id));
	return {
		x: currentCoordinates.x + nextTargetCenter.x - nextSourceCenter.x,
		y: currentCoordinates.y + nextTargetCenter.y - nextSourceCenter.y,
	};
}

export function layoutSlotId(type: LayoutSlotType, index: number): string {
	return `slot:${type}:${index}`;
}

export function dataSlotType(value: unknown): LayoutSlotType | null {
	return value === "window" || value === "stat" ? value : null;
}

export function prefersReducedMotion(): boolean {
	return (
		typeof window !== "undefined" &&
		typeof window.matchMedia === "function" &&
		window.matchMedia("(prefers-reduced-motion: reduce)").matches
	);
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

function closestSlotToPointer(
	pointer: { x: number; y: number },
	rects: Parameters<CollisionDetection>[0]["droppableRects"],
	type: LayoutSlotType,
): Collision | null {
	let closest: Collision | null = null;
	let closestDistance = Number.POSITIVE_INFINITY;
	for (const [id, rect] of rects) {
		if (!String(id).startsWith(`slot:${type}:`)) continue;
		if (
			pointer.x < rect.left ||
			pointer.x > rect.right ||
			pointer.y < rect.top ||
			pointer.y > rect.bottom
		) {
			continue;
		}
		const center = rectCenter(rect);
		const distance =
			(center.x - pointer.x) ** 2 + (center.y - pointer.y) ** 2;
		if (distance >= closestDistance) continue;
		closest = { id };
		closestDistance = distance;
	}
	return closest;
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
