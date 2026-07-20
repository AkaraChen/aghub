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

export interface LayoutDragPreview {
	activeId: string;
	type: LayoutSlotType;
	origin: CardLayoutModel;
}
