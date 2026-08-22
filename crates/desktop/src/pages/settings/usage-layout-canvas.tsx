import { DragOverlay } from "@dnd-kit/core";
import type { CSSProperties } from "react";
import { cn } from "../../lib/utils";
import { UsageLayoutCardPreview } from "./usage-layout-card-preview";
import {
	type LayoutFieldPresentation,
	UsageLayoutDragPreview,
} from "./usage-layout-drag-preview";
import { UsageLayoutFieldLibrary } from "./usage-layout-field-library";
import { shownIds, type LayoutSlotType } from "./usage-layout-model";
import type {
	LayoutDragPreview,
	LayoutField,
	LayoutPreview,
} from "./usage-layout-types";

interface UsageLayoutStyle extends CSSProperties {
	"--usage-home-card-height": string;
	"--usage-home-card-width": string;
}

// The home grid's 72rem container has 3rem horizontal padding and three
// 0.625rem gaps at four columns. Tall usage cards span two 6.5rem rows and the
// row gap.
const USAGE_LAYOUT_STYLE: UsageLayoutStyle = {
	"--usage-home-card-height": "13.625rem",
	"--usage-home-card-width": "16.78125rem",
};

function dragFieldPresentation(
	drag: LayoutDragPreview | null,
): LayoutFieldPresentation | null {
	if (!drag) return null;
	if (drag.overId === "hidden-drawer") return "library";
	if (
		drag.overId?.startsWith("slot:") ||
		drag.overId?.startsWith("section:")
	) {
		return "card";
	}
	return drag.source;
}

interface UsageLayoutCanvasProps {
	windowFields: LayoutField[];
	statFields: LayoutField[];
	fieldById: ReadonlyMap<string, LayoutField>;
	shownWindows: string[];
	shownStats: string[];
	windowCapacity: number;
	statCapacity: number;
	drag: LayoutDragPreview | null;
	isDisabled?: boolean;
	preview: LayoutPreview;
	onNodeChange: (id: string, node: HTMLElement | null) => void;
	onVisibilityChange: (
		id: string,
		type: LayoutSlotType,
		isVisible: boolean,
	) => void;
}

export function UsageLayoutCanvas({
	windowFields,
	statFields,
	fieldById,
	shownWindows,
	shownStats,
	windowCapacity,
	statCapacity,
	drag,
	isDisabled,
	preview,
	onNodeChange,
	onVisibilityChange,
}: UsageLayoutCanvasProps) {
	const activeField = drag ? fieldById.get(drag.activeId) : undefined;
	const activeStartedOnCard = drag?.source === "card";
	const activeWasVisible = drag
		? shownIds(drag.origin, drag.type).includes(drag.activeId)
		: false;
	const dragPresentation = dragFieldPresentation(drag);
	return (
		<>
			<div
				data-testid="usage-layout-editor"
				aria-disabled={isDisabled || undefined}
				inert={isDisabled || undefined}
				style={USAGE_LAYOUT_STYLE}
				className={cn(
					"grid w-full grid-cols-1 items-start gap-3 lg:grid-cols-[var(--usage-home-card-width)_minmax(0,1fr)]",
					"transition-opacity duration-[var(--dur-fast)] ease-[var(--ease-out)] motion-reduce:transition-none",
					isDisabled && "opacity-55",
				)}
			>
				<UsageLayoutCardPreview
					fieldById={fieldById}
					shownWindows={shownWindows}
					shownStats={shownStats}
					drag={drag}
					isDisabled={isDisabled}
					preview={preview}
					onNodeChange={onNodeChange}
				/>
				<UsageLayoutFieldLibrary
					active={activeStartedOnCard}
					activeSourceId={drag?.sourceNodeId ?? null}
					isDisabled={isDisabled}
					windowFields={windowFields}
					statFields={statFields}
					shownWindows={shownWindows}
					shownStats={shownStats}
					windowCapacity={windowCapacity}
					statCapacity={statCapacity}
					activeId={drag?.activeId ?? null}
					onNodeChange={onNodeChange}
					onVisibilityChange={onVisibilityChange}
				/>
			</div>

			<DragOverlay adjustScale={false} dropAnimation={null}>
				{activeField && drag && dragPresentation ? (
					<UsageLayoutDragPreview
						field={activeField}
						type={drag.type}
						source={drag.source}
						presentation={dragPresentation}
						isVisible={activeWasVisible}
					/>
				) : null}
			</DragOverlay>
		</>
	);
}
