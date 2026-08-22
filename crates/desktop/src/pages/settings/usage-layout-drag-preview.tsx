import { CheckIcon } from "@heroicons/react/24/outline";
import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/utils";
import { UsageLayoutCardFieldContent } from "./usage-layout-card-preview";
import {
	LAYOUT_FIELD_SHELL,
	LAYOUT_FIELD_STATE_TRANSITION,
	LayoutFieldDragHandle,
} from "./usage-layout-draggable-field";
import type { LayoutSlotType } from "./usage-layout-model";
import type { LayoutDragSource, LayoutField } from "./usage-layout-types";

export type LayoutFieldPresentation = "card" | "library";

export function UsageLayoutDragPreview({
	field,
	type,
	source,
	presentation,
	isVisible,
}: {
	field: LayoutField;
	type: LayoutSlotType;
	source: LayoutDragSource;
	presentation: LayoutFieldPresentation;
	isVisible: boolean;
}) {
	return (
		<div
			aria-hidden
			data-testid="layout-field-drag-preview"
			data-layout-field-shell
			data-source={source}
			data-presentation={presentation}
			data-visibility={isVisible ? "shown" : "hidden"}
			className={cn(
				LAYOUT_FIELD_SHELL,
				LAYOUT_FIELD_STATE_TRANSITION,
				"relative h-full w-full max-w-[calc(100vw-2rem)] cursor-grabbing overflow-hidden border-border bg-overlay shadow-[var(--overlay-shadow)]",
			)}
		>
			<DragPresentation
				testId="layout-field-library-presentation"
				isActive={presentation === "library"}
			>
				<VisibilityState isVisible={isVisible} />
				<span className="min-w-0 truncate text-[11px] text-muted">
					{field.label}
				</span>
			</DragPresentation>
			<DragPresentation
				testId="layout-field-card-presentation"
				isActive={presentation === "card"}
				data-layout-type={type}
			>
				<LayoutFieldDragHandle />
				<UsageLayoutCardFieldContent field={field} type={type} />
			</DragPresentation>
		</div>
	);
}

function DragPresentation({
	testId,
	isActive,
	children,
	...props
}: {
	testId: string;
	isActive: boolean;
	children: ReactNode;
} & HTMLAttributes<HTMLDivElement>) {
	return (
		<div
			{...props}
			data-testid={testId}
			className={cn(
				"absolute inset-0 flex min-w-0 items-center px-1.5 py-1",
				"transform-gpu transition-[opacity,transform] duration-[var(--dur-fast)] ease-[var(--ease-out)] motion-reduce:transition-none",
				isActive
					? "scale-100 opacity-100"
					: "pointer-events-none scale-[0.985] opacity-0",
			)}
		>
			{children}
		</div>
	);
}

function VisibilityState({ isVisible }: { isVisible: boolean }) {
	return (
		<span
			data-testid="layout-field-visibility-state"
			className={cn(
				"mr-1.5 inline-flex size-4 shrink-0 items-center justify-center overflow-hidden rounded-md",
				isVisible ? "bg-accent-soft" : "bg-default",
			)}
		>
			{isVisible && (
				<CheckIcon className="size-3 stroke-[2.5] text-accent-soft-foreground" />
			)}
		</span>
	);
}
