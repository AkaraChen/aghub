import { useDraggable, useDroppable } from "@dnd-kit/core";
import { CheckIcon } from "@heroicons/react/24/outline";
import { Checkbox, Separator, Surface } from "@heroui/react";
import type {
	KeyboardEvent as ReactKeyboardEvent,
	MouseEvent as ReactMouseEvent,
	PointerEvent as ReactPointerEvent,
} from "react";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "../../lib/utils";
import { LAYOUT_POINTER_DRAG_DISTANCE_PX } from "./usage-layout-dnd";
import type { LayoutSlotType } from "./usage-layout-model";
import type { LayoutField } from "./usage-layout-types";

const FIELD_LIBRARY_DRAG_ID_PREFIX = "field-library:";
const FIELD_LIBRARY_ITEM_LAYOUT =
	"grid min-h-7 touch-none select-none grid-cols-[minmax(0,1fr)_auto] items-center gap-1 rounded-md border px-1";
const FIELD_LIBRARY_ITEM_LABEL =
	"flex min-w-0 items-center rounded-md border border-transparent px-1 py-0.5 text-[11px]";

export function UsageLayoutFieldLibrary({
	active,
	activeSourceId,
	isDisabled,
	windowFields,
	statFields,
	shownWindows,
	shownStats,
	windowCapacity,
	statCapacity,
	activeId,
	onNodeChange,
	onVisibilityChange,
}: {
	active: boolean;
	activeSourceId: string | null;
	isDisabled?: boolean;
	windowFields: LayoutField[];
	statFields: LayoutField[];
	shownWindows: string[];
	shownStats: string[];
	windowCapacity: number;
	statCapacity: number;
	activeId: string | null;
	onNodeChange: (id: string, node: HTMLElement | null) => void;
	onVisibilityChange: (
		id: string,
		type: LayoutSlotType,
		isVisible: boolean,
	) => void;
}) {
	const { t } = useTranslation();
	const { setNodeRef, isOver } = useDroppable({
		id: "hidden-drawer",
		disabled: isDisabled,
		data: { kind: "drawer" },
	});
	return (
		<Surface
			variant="secondary"
			ref={setNodeRef}
			data-testid="layout-hidden-drawer"
			data-layout-field-library
			className={cn(
				"flex min-w-0 flex-col overflow-hidden rounded-lg border border-border outline -outline-offset-1 outline-transparent lg:min-h-[var(--usage-home-card-height)]",
				"transition-[background-color,outline-color] duration-[var(--dur-fast)] ease-[var(--ease-out)] motion-reduce:transition-none",
				active && isOver && "bg-accent/5 outline-accent",
			)}
		>
			<div className="flex min-w-0 shrink-0 items-baseline gap-2 px-3 py-2">
				<span className="shrink-0 text-xs font-medium text-foreground">
					{t("usageLayoutFields")}
				</span>
				<p className="min-w-0 truncate text-[11px] leading-4 text-muted">
					{t("usageLayoutFieldsDescription")}
				</p>
			</div>
			<Separator className="shrink-0" variant="secondary" />
			<div className="min-w-0 flex-1">
				<FieldGroup
					title={t("usageLayoutQuotaFields")}
					type="window"
					fields={windowFields}
					shown={shownWindows}
					capacity={windowCapacity}
					isDisabled={isDisabled}
					activeId={activeId}
					activeSourceId={activeSourceId}
					onNodeChange={onNodeChange}
					onVisibilityChange={onVisibilityChange}
				/>
				<Separator variant="secondary" />
				<FieldGroup
					title={t("usageLayoutStatFields")}
					type="stat"
					fields={statFields}
					shown={shownStats}
					capacity={statCapacity}
					isDisabled={isDisabled}
					activeId={activeId}
					activeSourceId={activeSourceId}
					onNodeChange={onNodeChange}
					onVisibilityChange={onVisibilityChange}
				/>
			</div>
		</Surface>
	);
}

export function LayoutFieldDragGhost({
	field,
	isVisible,
}: {
	field: LayoutField;
	isVisible: boolean;
}) {
	return (
		<div
			aria-hidden
			data-testid="layout-field-drag-ghost"
			data-visibility={isVisible ? "shown" : "hidden"}
			className={cn(
				FIELD_LIBRARY_ITEM_LAYOUT,
				"h-full w-full cursor-grabbing border-border bg-surface",
			)}
		>
			<div
				className={cn(
					FIELD_LIBRARY_ITEM_LABEL,
					isVisible ? "text-foreground" : "text-muted",
				)}
			>
				<span className="truncate">{field.label}</span>
			</div>
			<span
				data-testid="layout-field-drag-visibility"
				className="relative inline-flex size-4 shrink-0 items-center justify-center overflow-hidden rounded-md bg-default"
			>
				{isVisible && (
					<>
						<span className="absolute inset-0 bg-accent-soft" />
						<CheckIcon className="relative size-3 stroke-[2.5] text-accent-soft-foreground" />
					</>
				)}
			</span>
		</div>
	);
}

function FieldGroup({
	title,
	type,
	fields,
	shown,
	capacity,
	isDisabled,
	activeId,
	activeSourceId,
	onNodeChange,
	onVisibilityChange,
}: {
	title: string;
	type: LayoutSlotType;
	fields: LayoutField[];
	shown: string[];
	capacity: number;
	isDisabled?: boolean;
	activeId: string | null;
	activeSourceId: string | null;
	onNodeChange: (id: string, node: HTMLElement | null) => void;
	onVisibilityChange: (
		id: string,
		type: LayoutSlotType,
		isVisible: boolean,
	) => void;
}) {
	const shownSet = new Set(shown);
	const columns =
		type === "window"
			? "grid-cols-[repeat(auto-fit,minmax(10rem,1fr))]"
			: "grid-cols-[repeat(auto-fit,minmax(8rem,1fr))]";
	return (
		<div className="min-w-0">
			<div className="flex items-center justify-between gap-2 px-3 pb-1 pt-2 text-[11px] font-medium text-muted">
				<span>{title}</span>
				<span className="tabular-nums">
					{shown.length}/{capacity}
				</span>
			</div>
			<div className={cn("grid gap-x-1 px-2 pb-2", columns)}>
				{fields.map((field) => (
					<FieldLibraryItem
						key={field.id}
						field={field}
						type={type}
						isVisible={shownSet.has(field.id)}
						isDisabled={isDisabled}
						isVisibilityDisabled={
							shown.length >= capacity && !shownSet.has(field.id)
						}
						isActive={activeId === field.id}
						activeSourceId={activeSourceId}
						onNodeChange={onNodeChange}
						onVisibilityChange={onVisibilityChange}
					/>
				))}
			</div>
		</div>
	);
}

function FieldLibraryItem({
	field,
	type,
	isVisible,
	isDisabled,
	isVisibilityDisabled,
	isActive,
	activeSourceId,
	onNodeChange,
	onVisibilityChange,
}: {
	field: LayoutField;
	type: LayoutSlotType;
	isVisible: boolean;
	isDisabled?: boolean;
	isVisibilityDisabled: boolean;
	isActive: boolean;
	activeSourceId: string | null;
	onNodeChange: (id: string, node: HTMLElement | null) => void;
	onVisibilityChange: (
		id: string,
		type: LayoutSlotType,
		isVisible: boolean,
	) => void;
}) {
	const shownDragId = `${FIELD_LIBRARY_DRAG_ID_PREFIX}${field.id}`;
	const dragId =
		isActive && activeSourceId === shownDragId
			? shownDragId
			: isVisible
				? shownDragId
				: field.id;
	const {
		attributes,
		listeners,
		setActivatorNodeRef,
		setNodeRef,
		isDragging,
	} = useDraggable({
		id: dragId,
		disabled: isDisabled,
		data: {
			kind: "field",
			source: "library",
			type,
			fieldId: field.id,
		},
	});
	const { onKeyDown, onPointerDown, ...pointerListeners } = listeners ?? {};
	const pointerGestureRef = useRef<{
		pointerId: number;
		x: number;
		y: number;
		didDrag: boolean;
	} | null>(null);
	const checkboxDisabled = isDisabled || isVisibilityDisabled;
	const setKeyboardNodeRef = (node: HTMLDivElement | null) => {
		setActivatorNodeRef(node);
		onNodeChange(dragId, node);
	};
	const handleDragKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
		onKeyDown?.(event);
	};
	const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
		pointerGestureRef.current = {
			pointerId: event.pointerId,
			x: event.clientX,
			y: event.clientY,
			didDrag: false,
		};
		onPointerDown?.(event);
	};
	const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
		const gesture = pointerGestureRef.current;
		if (
			!gesture ||
			gesture.pointerId !== event.pointerId ||
			gesture.didDrag
		) {
			return;
		}
		gesture.didDrag =
			Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) >=
			LAYOUT_POINTER_DRAG_DISTANCE_PX;
	};
	const handleItemClickCapture = (event: ReactMouseEvent<HTMLDivElement>) => {
		if (event.detail > 0 && pointerGestureRef.current?.didDrag) {
			event.preventDefault();
			event.stopPropagation();
			pointerGestureRef.current = null;
		}
	};
	const handleItemClick = (event: ReactMouseEvent<HTMLDivElement>) => {
		pointerGestureRef.current = null;
		if (checkboxDisabled) return;
		if (
			event.target instanceof Element &&
			event.target.closest('[data-slot="checkbox-content"]')
		) {
			return;
		}
		onVisibilityChange(field.id, type, !isVisible);
	};

	return (
		<div
			ref={setNodeRef}
			{...pointerListeners}
			onPointerDownCapture={handlePointerDown}
			onPointerMoveCapture={handlePointerMove}
			data-testid={`layout-field-item-${field.id}`}
			data-visibility={isVisible ? "shown" : "hidden"}
			onClickCapture={handleItemClickCapture}
			onClick={handleItemClick}
			className={cn(
				FIELD_LIBRARY_ITEM_LAYOUT,
				"border-transparent",
				"transition-[background-color,border-color,opacity] duration-[var(--dur-fast)] ease-[var(--ease-out)] motion-reduce:transition-none",
				!isDisabled &&
					"cursor-grab hover:border-border hover:bg-surface",
				isDragging && isActive && "opacity-45",
			)}
		>
			<div
				{...attributes}
				ref={setKeyboardNodeRef}
				onKeyDown={handleDragKeyDown}
				title={field.hint}
				aria-label={field.label}
				data-testid={`${isVisible ? "layout-shown-item" : "layout-hidden-item"}-${field.id}`}
				data-layout-type={type}
				className={cn(
					FIELD_LIBRARY_ITEM_LABEL,
					"outline-none",
					isDisabled
						? "opacity-40"
						: "cursor-grab active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-surface",
					isVisible ? "text-foreground" : "text-muted",
				)}
			>
				<span className="truncate">{field.label}</span>
			</div>
			<Checkbox
				variant="secondary"
				aria-label={field.label}
				isSelected={isVisible}
				isDisabled={checkboxDisabled}
				onChange={(isSelected) =>
					onVisibilityChange(field.id, type, isSelected)
				}
			>
				<Checkbox.Content>
					<Checkbox.Control className="before:bg-accent-soft hover:before:bg-accent-soft-hover">
						<Checkbox.Indicator className="**:data-[slot=checkbox-default-indicator--checkmark]:text-accent-soft-foreground" />
					</Checkbox.Control>
				</Checkbox.Content>
			</Checkbox>
		</div>
	);
}
