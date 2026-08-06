import { useDraggable } from "@dnd-kit/core";
import { Bars3Icon } from "@heroicons/react/24/outline";
import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/utils";
import type { LayoutSlotType } from "./usage-layout-model";
import type { LayoutField } from "./usage-layout-types";

export const LAYOUT_FIELD_SHELL =
	"min-h-7 min-w-0 touch-none select-none rounded-md border";
export const LAYOUT_FIELD_STATE_TRANSITION =
	"transition-[background-color,border-color,box-shadow,opacity] duration-[var(--dur-fast)] ease-[var(--ease-out)] motion-reduce:transition-none";

export function LayoutDraggableField({
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
} & Omit<HTMLAttributes<HTMLDivElement>, "title">) {
	const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
		id: field.id,
		disabled: isDisabled,
		data: { kind: "field", source: "card", type },
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
			data-layout-field-shell
			className={cn(
				LAYOUT_FIELD_SHELL,
				LAYOUT_FIELD_STATE_TRANSITION,
				"border-transparent outline-none",
				isDisabled
					? "opacity-40"
					: "cursor-grab hover:border-border hover:bg-surface active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-surface",
				isDragging && isActive && "opacity-30",
				className,
			)}
		>
			<LayoutFieldDragHandle />
			{children}
		</div>
	);
}

export function LayoutFieldDragHandle() {
	return (
		<Bars3Icon
			data-testid="layout-field-drag-handle"
			className="mr-1.5 size-4 shrink-0 text-muted/60"
		/>
	);
}
