import { useDroppable } from "@dnd-kit/core";
import { Card, Meter } from "@heroui/react";
import type { HTMLAttributes, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { AgentIcon } from "../../lib/agent-icons";
import { cn } from "../../lib/utils";
import { layoutSlotId } from "./usage-layout-dnd";
import { LayoutDraggableField } from "./usage-layout-draggable-field";
import type { LayoutSlotType } from "./usage-layout-model";
import type {
	LayoutDragPreview,
	LayoutField,
	LayoutPreview,
} from "./usage-layout-types";

export const PREVIEW_BAR_PCT = [62, 38, 84];
const PREVIEW_STAT_VALUES: Readonly<Record<string, string>> = {
	totalTokens: "1.43M",
	cost: "$12.50",
	inputTokens: "400K",
	outputTokens: "120K",
	cacheRead: "900K",
	cacheCreation: "10K",
	reasoning: "84K",
	utilization5h: "42%",
	utilizationWeekly: "71%",
	utilizationOpus: "18%",
};

export function UsageLayoutCardPreview({
	fieldById,
	shownWindows,
	shownStats,
	drag,
	isDisabled,
	preview,
	onNodeChange,
}: {
	fieldById: ReadonlyMap<string, LayoutField>;
	shownWindows: string[];
	shownStats: string[];
	drag: LayoutDragPreview | null;
	isDisabled?: boolean;
	preview: LayoutPreview;
	onNodeChange: (id: string, node: HTMLElement | null) => void;
}) {
	const { t } = useTranslation();
	return (
		<div className="min-w-0 w-full max-w-[var(--usage-home-card-width)]">
			<Card
				data-testid="layout-card-replica"
				className="h-[var(--usage-home-card-height)] w-full p-3 !rounded-lg"
			>
				<Card.Header className="flex flex-row items-center gap-2 p-0">
					<AgentIcon
						id={preview.agentId}
						name={preview.agentName}
						size="xs"
					/>
					<Card.Title className="text-sm font-medium">
						{preview.agentName}
					</Card.Title>
				</Card.Header>
				<Card.Content className="flex flex-1 flex-col p-0 pt-2">
					<CardSection
						type="window"
						isDisabled={isDisabled}
						className="flex min-h-8 flex-col gap-1.5 rounded-md"
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
									<LayoutDraggableField
										field={field}
										type="window"
										isDisabled={isDisabled}
										isActive={drag?.activeId === field.id}
										onNodeChange={onNodeChange}
										data-testid={`layout-card-item-${field.id}`}
										className="flex items-center rounded-md px-1.5 py-1"
									>
										<PreviewBar
											label={field.label}
											pct={
												PREVIEW_BAR_PCT[
													index %
														PREVIEW_BAR_PCT.length
												]
											}
										/>
									</LayoutDraggableField>
								</CardDropSlot>
							);
						})}
					</CardSection>

					<CardSection
						type="stat"
						isDisabled={isDisabled}
						className={cn(
							"grid min-h-8 grid-cols-2 gap-x-3 gap-y-1 rounded-md",
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
									<LayoutDraggableField
										field={field}
										type="stat"
										isDisabled={isDisabled}
										isActive={drag?.activeId === field.id}
										onNodeChange={onNodeChange}
										data-testid={`layout-card-item-${field.id}`}
										data-layout-type="stat"
										className="flex min-w-0 items-center rounded-md px-1.5 py-1 text-[11px]"
									>
										<StatBody field={field} />
									</LayoutDraggableField>
								</CardDropSlot>
							);
						})}
					</CardSection>

					{shownWindows.length === 0 && shownStats.length === 0 && (
						<p className="py-3 text-center text-[11px] text-muted">
							{t("usageLayoutEmptyCard")}
						</p>
					)}
				</Card.Content>
			</Card>
		</div>
	);
}

export function LayoutDragGhost({
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
				<PreviewBar label={field.label} pct={barPct} />
			</div>
		);
	}
	return (
		<div className="w-36 cursor-grabbing truncate rounded-md border border-border bg-overlay px-1.5 py-1 text-[11px] text-muted shadow-[var(--overlay-shadow)]">
			{field.label}
		</div>
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
			className="scroll-m-8"
		>
			{children}
		</div>
	);
}

function PreviewBar({ label, pct }: { label: string; pct: number }) {
	return (
		<div className="flex min-w-0 flex-1 flex-col gap-0.5">
			<div className="flex items-baseline justify-between gap-2 text-[11px]">
				<span className="truncate text-muted">{label}</span>
				<span className="shrink-0 tabular-nums text-foreground">
					{pct}%
				</span>
			</div>
			<Meter aria-hidden aria-label={label} value={pct} size="sm">
				<Meter.Track>
					<Meter.Fill className="bg-foreground/25" />
				</Meter.Track>
			</Meter>
		</div>
	);
}

function StatBody({ field }: { field: LayoutField }) {
	return (
		<div className="flex min-w-0 flex-1 items-baseline justify-between gap-2">
			<span className="truncate text-muted">{field.label}</span>
			<span className="shrink-0 tabular-nums text-foreground">
				{PREVIEW_STAT_VALUES[field.id] ?? "—"}
			</span>
		</div>
	);
}
