import type { CardLayoutModel, LayoutSlotType } from "./usage-layout-model";

export interface LayoutField {
	id: string;
	label: string;
	hint?: string;
}

export interface LayoutPreview {
	agentId: string;
	agentName: string;
}

export type LayoutDragSource = "card" | "library";

export interface LayoutDragPreview {
	activeId: string;
	overId: string | null;
	sourceNodeId: string;
	source: LayoutDragSource;
	type: LayoutSlotType;
	origin: CardLayoutModel;
}
