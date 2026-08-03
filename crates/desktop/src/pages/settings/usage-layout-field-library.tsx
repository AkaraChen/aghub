import { useDroppable } from "@dnd-kit/core";
import { Checkbox, Separator, Surface } from "@heroui/react";
import { useTranslation } from "react-i18next";
import { cn } from "../../lib/utils";
import { LayoutDraggableField } from "./usage-layout-draggable-field";
import type { LayoutSlotType } from "./usage-layout-model";
import type { LayoutField } from "./usage-layout-types";

export function UsageLayoutFieldLibrary({
	active,
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
					onNodeChange={onNodeChange}
					onVisibilityChange={onVisibilityChange}
				/>
			</div>
		</Surface>
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
				{fields.map((field) => {
					const isVisible = shownSet.has(field.id);
					return (
						<div
							key={field.id}
							data-visibility={isVisible ? "shown" : "hidden"}
							className="grid min-h-7 grid-cols-[minmax(0,1fr)_auto] items-center gap-1 px-1"
						>
							{isVisible ? (
								<span
									title={field.hint}
									className="truncate px-1 text-[11px] text-foreground"
								>
									{field.label}
								</span>
							) : (
								<LayoutDraggableField
									field={field}
									type={type}
									isDisabled={isDisabled}
									isActive={activeId === field.id}
									onNodeChange={onNodeChange}
									data-testid={`layout-hidden-item-${field.id}`}
									data-layout-type={type}
									className="flex min-w-0 items-center rounded-md px-1 py-0.5 text-[11px]"
								>
									<span className="truncate text-muted">
										{field.label}
									</span>
								</LayoutDraggableField>
							)}
							<Checkbox
								variant="secondary"
								aria-label={field.label}
								isSelected={isVisible}
								isDisabled={
									isDisabled ||
									(!isVisible && shown.length >= capacity)
								}
								onChange={(isSelected) =>
									onVisibilityChange(
										field.id,
										type,
										isSelected,
									)
								}
							>
								<Checkbox.Content>
									<Checkbox.Control>
										<Checkbox.Indicator />
									</Checkbox.Control>
								</Checkbox.Content>
							</Checkbox>
						</div>
					);
				})}
			</div>
		</div>
	);
}
