import { DragOverlay, useDraggable, useDroppable } from "@dnd-kit/core";
import { Meter } from "@heroui/react";
import type { HTMLAttributes, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { AgentIcon } from "../../lib/agent-icons";
import { cn } from "../../lib/utils";
import { layoutSlotId } from "./usage-layout-dnd";
import { shownIds, type LayoutSlotType } from "./usage-layout-model";
import type {
	LayoutDragPreview,
	LayoutField,
	LayoutPreview,
} from "./usage-layout-types";

const PREVIEW_BAR_PCT = [62, 38, 84];

interface UsageLayoutCanvasProps {
	windowFields: LayoutField[];
	statFields: LayoutField[];
	fieldById: ReadonlyMap<string, LayoutField>;
	shownWindows: string[];
	shownStats: string[];
	drag: LayoutDragPreview | null;
	isDisabled?: boolean;
	preview: LayoutPreview;
	onNodeChange: (id: string, node: HTMLElement | null) => void;
}

export function UsageLayoutCanvas({
	windowFields,
	statFields,
	fieldById,
	shownWindows,
	shownStats,
	drag,
	isDisabled,
	preview,
	onNodeChange,
}: UsageLayoutCanvasProps) {
	const { t } = useTranslation();
	const hiddenWindows = hiddenFields(windowFields, shownWindows);
	const hiddenStats = hiddenFields(statFields, shownStats);
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
				aria-disabled={isDisabled || undefined}
				inert={isDisabled || undefined}
				className={cn(
					"grid w-full grid-cols-1 gap-5 lg:grid-cols-[20rem_minmax(0,1fr)] lg:items-start",
					"transition-opacity duration-[var(--dur-fast)] ease-[var(--ease-out)] motion-reduce:transition-none",
					isDisabled && "opacity-55",
				)}
			>
				<div
					data-testid="layout-card-replica"
					className="w-full rounded-lg border border-border bg-surface p-3"
				>
					<div className="flex items-center gap-2 pb-2">
						<AgentIcon
							id={preview.agentId}
							name={preview.agentName}
							size="xs"
						/>
						<span className="text-sm font-medium text-foreground">
							{preview.agentName}
						</span>
					</div>

					<CardSection
						type="window"
						isDisabled={isDisabled}
						className="flex min-h-7 flex-col gap-1.5 rounded-md"
						data-testid="layout-window-section"
					>
						{shownWindows.map((id, index) => {
							const field = fieldById.get(id);
							if (!field) return null;
							return (
								<CardDropSlot
									key={layoutSlotId("window", index)}
									type="window"
									index={index}
									isDisabled={isDisabled}
								>
									<DraggableFieldRow
										field={field}
										type="window"
										isDisabled={isDisabled}
										isActive={drag?.activeId === field.id}
										onNodeChange={onNodeChange}
										data-testid={`layout-card-item-${field.id}`}
										className="-mx-1 flex items-center rounded-md px-1 py-0.5"
									>
										<BarBody
											label={field.label}
											pct={
												PREVIEW_BAR_PCT[
													index %
														PREVIEW_BAR_PCT.length
												]
											}
										/>
									</DraggableFieldRow>
								</CardDropSlot>
							);
						})}
					</CardSection>

					<CardSection
						type="stat"
						isDisabled={isDisabled}
						className={cn(
							"grid min-h-5 grid-cols-2 gap-x-3 gap-y-1 rounded",
							shownWindows.length > 0 && "mt-2",
						)}
						data-testid="layout-stat-section"
					>
						{shownStats.map((id, index) => {
							const field = fieldById.get(id);
							if (!field) return null;
							return (
								<CardDropSlot
									key={layoutSlotId("stat", index)}
									type="stat"
									index={index}
									isDisabled={isDisabled}
								>
									<DraggableFieldRow
										field={field}
										type="stat"
										isDisabled={isDisabled}
										isActive={drag?.activeId === field.id}
										onNodeChange={onNodeChange}
										data-testid={`layout-card-item-${field.id}`}
										data-layout-type="stat"
										className="-mx-1 flex min-w-0 items-center rounded px-1 py-0.5 text-[11px]"
									>
										<span className="truncate text-muted">
											{field.label}
										</span>
									</DraggableFieldRow>
								</CardDropSlot>
							);
						})}
					</CardSection>

					{shownWindows.length === 0 && shownStats.length === 0 && (
						<p className="py-3 text-center text-[11px] text-muted">
							{t("usageLayoutEmptyCard")}
						</p>
					)}
				</div>

				<HiddenDrawer
					active={activeStartedOnCard}
					isDisabled={isDisabled}
					windows={hiddenWindows}
					stats={hiddenStats}
					activeId={drag?.activeId ?? null}
					onNodeChange={onNodeChange}
				/>
			</div>

			<DragOverlay adjustScale={false} dropAnimation={null}>
				{activeField && drag ? (
					<DragGhost
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

function CardSection({
	type,
	isDisabled,
	className,
	children,
	...props
}: {
	type: LayoutSlotType;
	isDisabled?: boolean;
	className?: string;
	children: ReactNode;
} & HTMLAttributes<HTMLDivElement>) {
	const { setNodeRef, isOver } = useDroppable({
		id: `section:${type}`,
		disabled: isDisabled,
		data: { kind: "section", type },
	});
	return (
		<div
			{...props}
			ref={setNodeRef}
			className={cn(
				className,
				isOver && "bg-accent/5",
				"transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)] motion-reduce:transition-none",
			)}
		>
			{children}
		</div>
	);
}

function CardDropSlot({
	type,
	index,
	isDisabled,
	children,
}: {
	type: LayoutSlotType;
	index: number;
	isDisabled?: boolean;
	children: ReactNode;
}) {
	const { setNodeRef } = useDroppable({
		id: `slot:${type}:${index}`,
		disabled: isDisabled,
		data: { kind: "slot", type, index },
	});
	return (
		<div
			ref={setNodeRef}
			data-testid={`layout-slot-${type}-${index}`}
			data-layout-slot={`${type}:${index}`}
		>
			{children}
		</div>
	);
}

function DraggableFieldRow({
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
		data: { kind: "field", type },
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
			className={cn(
				"min-w-0 touch-none select-none outline-none",
				"transition-[background-color,box-shadow,opacity] duration-[var(--dur-fast)] ease-[var(--ease-out)] motion-reduce:transition-none",
				isDisabled
					? "opacity-40"
					: "cursor-grab hover:bg-surface-secondary active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-surface",
				isDragging && isActive && "opacity-45",
				className,
			)}
		>
			{children}
		</div>
	);
}

function HiddenDrawer({
	active,
	isDisabled,
	windows,
	stats,
	activeId,
	onNodeChange,
}: {
	active: boolean;
	isDisabled?: boolean;
	windows: LayoutField[];
	stats: LayoutField[];
	activeId: string | null;
	onNodeChange: (id: string, node: HTMLElement | null) => void;
}) {
	const { t } = useTranslation();
	const { setNodeRef, isOver } = useDroppable({
		id: "hidden-drawer",
		disabled: isDisabled,
		data: { kind: "drawer" },
	});
	const empty = windows.length === 0 && stats.length === 0;
	return (
		<div
			ref={setNodeRef}
			data-testid="layout-hidden-drawer"
			className={cn(
				"flex min-w-0 flex-col gap-1.5 rounded-lg border border-border p-3 outline -outline-offset-1 outline-transparent",
				"transition-[background-color,border-color,outline-color] duration-[var(--dur-fast)] ease-[var(--ease-out)] motion-reduce:transition-none",
				active && isOver && "border-accent bg-accent/5 outline-accent",
			)}
		>
			<span className="pb-0.5 text-[11px] font-medium text-muted">
				{t("usageLayoutHiddenDrawer")}
			</span>
			{empty ? (
				<p className="py-3 text-center text-[11px] text-foreground/40">
					{t("usageLayoutDrawerEmpty")}
				</p>
			) : (
				<>
					{windows.map((field) => (
						<DraggableFieldRow
							key={field.id}
							field={field}
							type="window"
							isDisabled={isDisabled}
							isActive={activeId === field.id}
							onNodeChange={onNodeChange}
							data-testid={`layout-hidden-item-${field.id}`}
							className="-mx-1 flex items-center rounded-md px-1 py-0.5"
						>
							<BarBody
								label={field.label}
								pct={0}
								className="lg:max-w-72"
							/>
						</DraggableFieldRow>
					))}
					{stats.length > 0 && (
						<div className="grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-x-3 gap-y-1">
							{stats.map((field) => (
								<DraggableFieldRow
									key={field.id}
									field={field}
									type="stat"
									isDisabled={isDisabled}
									isActive={activeId === field.id}
									onNodeChange={onNodeChange}
									data-testid={`layout-hidden-item-${field.id}`}
									data-layout-type="stat"
									className="-mx-1 flex min-w-0 items-center rounded px-1 py-0.5 text-[11px]"
								>
									<span className="truncate text-muted">
										{field.label}
									</span>
								</DraggableFieldRow>
							))}
						</div>
					)}
				</>
			)}
		</div>
	);
}

function DragGhost({
	field,
	type,
	barPct,
}: {
	field: LayoutField;
	type: LayoutSlotType;
	barPct: number;
}) {
	if (type === "window") {
		return (
			<div className="w-72 max-w-[calc(100vw-2rem)] cursor-grabbing rounded-md border border-border bg-overlay p-1 shadow-[var(--overlay-shadow)]">
				<BarBody label={field.label} pct={barPct} />
			</div>
		);
	}
	return (
		<div className="w-36 cursor-grabbing truncate rounded-md border border-border bg-overlay px-1.5 py-1 text-[11px] text-muted shadow-[var(--overlay-shadow)]">
			{field.label}
		</div>
	);
}

function BarBody({
	label,
	pct,
	className,
}: {
	label: string;
	pct: number;
	className?: string;
}) {
	return (
		<div className={cn("flex min-w-0 flex-1 flex-col gap-0.5", className)}>
			<span className="truncate text-[11px] text-muted">{label}</span>
			<Meter aria-hidden aria-label={label} value={pct} size="sm">
				<Meter.Track>
					<Meter.Fill className="bg-foreground/25" />
				</Meter.Track>
			</Meter>
		</div>
	);
}

function hiddenFields(fields: LayoutField[], shown: string[]): LayoutField[] {
	const shownSet = new Set(shown);
	return fields.filter((field) => !shownSet.has(field.id));
}
