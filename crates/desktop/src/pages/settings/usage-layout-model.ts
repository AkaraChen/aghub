export interface CardLayoutModel {
	windowSlots: (string | null)[];
	statSlots: (string | null)[];
}

export type LayoutSlotType = "window" | "stat";

export function compactLayout(
	layout: CardLayoutModel,
	windowIds: ReadonlySet<string>,
	statIds: ReadonlySet<string>,
): CardLayoutModel {
	return {
		windowSlots: compactSlots(layout.windowSlots, windowIds),
		statSlots: compactSlots(layout.statSlots, statIds),
	};
}

export function shownIds(
	layout: CardLayoutModel,
	type: LayoutSlotType,
): string[] {
	return slotsFor(layout, type).filter((id): id is string => id !== null);
}

export function projectLayout(
	origin: CardLayoutModel,
	activeId: string,
	type: LayoutSlotType,
	overId: string | null,
): CardLayoutModel {
	if (!overId) return origin;

	const slots = slotsFor(origin, type);
	const shown = shownIds(origin, type);
	const activeIsShown = shown.includes(activeId);

	if (overId === "hidden-drawer") {
		if (!activeIsShown) return origin;
		return withSlots(
			origin,
			type,
			fillSlots(
				slots.length,
				shown.filter((id) => id !== activeId),
			),
		);
	}

	const slotMatch = /^slot:(window|stat):(\d+)$/.exec(overId);
	const sectionMatch = /^section:(window|stat)$/.exec(overId);
	const targetType = slotMatch?.[1] ?? sectionMatch?.[1];
	if (targetType !== type) return origin;

	if (sectionMatch) {
		const rest = shown.filter((id) => id !== activeId);
		if (!activeIsShown && rest.length >= slots.length) return origin;
		return withSlots(
			origin,
			type,
			fillSlots(slots.length, [...rest, activeId]),
		);
	}

	const targetIndex = Math.min(Number(slotMatch?.[2]), slots.length - 1);
	const rest = shown.filter((id) => id !== activeId);
	const insertionIndex = Math.min(targetIndex, rest.length);
	const next = [
		...rest.slice(0, insertionIndex),
		activeId,
		...rest.slice(insertionIndex),
	];
	return withSlots(origin, type, fillSlots(slots.length, next));
}

export function layoutsEqual(
	left: CardLayoutModel,
	right: CardLayoutModel,
): boolean {
	return (
		slotsEqual(left.windowSlots, right.windowSlots) &&
		slotsEqual(left.statSlots, right.statSlots)
	);
}

function compactSlots(
	slots: (string | null)[],
	knownIds: ReadonlySet<string>,
): (string | null)[] {
	return fillSlots(
		slots.length,
		slots.filter((id): id is string => id !== null && knownIds.has(id)),
	);
}

function fillSlots(length: number, ids: string[]): (string | null)[] {
	return Array.from({ length }, (_, index) => ids[index] ?? null);
}

function slotsFor(
	layout: CardLayoutModel,
	type: LayoutSlotType,
): (string | null)[] {
	return type === "window" ? layout.windowSlots : layout.statSlots;
}

function withSlots(
	layout: CardLayoutModel,
	type: LayoutSlotType,
	slots: (string | null)[],
): CardLayoutModel {
	return type === "window"
		? { windowSlots: slots, statSlots: layout.statSlots }
		: { windowSlots: layout.windowSlots, statSlots: slots };
}

function slotsEqual(
	left: (string | null)[],
	right: (string | null)[],
): boolean {
	return (
		left.length === right.length &&
		left.every((value, index) => value === right[index])
	);
}
