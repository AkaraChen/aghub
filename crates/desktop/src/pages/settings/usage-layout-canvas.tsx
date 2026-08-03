import { DragOverlay } from "@dnd-kit/core";
import { cn } from "../../lib/utils";
import {
	LayoutDragGhost,
	PREVIEW_BAR_PCT,
	UsageLayoutCardPreview,
} from "./usage-layout-card-preview";
import { UsageLayoutFieldLibrary } from "./usage-layout-field-library";
import { shownIds, type LayoutSlotType } from "./usage-layout-model";
import type {
	LayoutDragPreview,
	LayoutField,
	LayoutPreview,
} from "./usage-layout-types";

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
	const activeStartedOnCard = drag
		? shownIds(drag.origin, drag.type).includes(drag.activeId)
		: false;
	const activeBarIndex =
		drag?.type === "window"
			? shownIds(drag.origin, "window").indexOf(drag.activeId)
			: -1;

	return (
		<>
			<div
				data-testid="usage-layout-editor"
				aria-disabled={isDisabled || undefined}
				inert={isDisabled || undefined}
				className={cn(
					"grid w-full grid-cols-1 items-start gap-3 lg:grid-cols-[minmax(0,1fr)_16rem]",
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
				{activeField && drag ? (
					<LayoutDragGhost
						field={activeField}
						type={drag.type}
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
		</>
	);
}
