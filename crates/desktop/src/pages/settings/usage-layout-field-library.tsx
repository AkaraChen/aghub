import { useDroppable } from "@dnd-kit/core";
import { EyeIcon, EyeSlashIcon } from "@heroicons/react/24/outline";
import { Button } from "@heroui/react";
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
		<div
			ref={setNodeRef}
			data-testid="layout-hidden-drawer"
			className={cn(
				"flex min-w-0 flex-col bg-surface-secondary/30 outline -outline-offset-1 outline-transparent",
				"transition-[background-color,outline-color] duration-[var(--dur-fast)] ease-[var(--ease-out)] motion-reduce:transition-none",
				active && isOver && "bg-accent/5 outline-accent",
			)}
		>
			<div className="border-b border-border px-3 py-3">
				<span className="text-xs font-medium text-foreground">
					{t("usageLayoutFields")}
				</span>
				<p className="mt-0.5 text-[11px] leading-4 text-muted">
					{t("usageLayoutFieldsDescription")}
				</p>
			</div>
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
	const { t } = useTranslation();
	const shownSet = new Set(shown);
	return (
		<div className="border-b border-border last:border-b-0">
			<div className="px-3 pb-1 pt-3 text-[10px] font-medium uppercase tracking-wide text-muted">
				{title}
			</div>
			<div className="pb-2">
				{fields.map((field) => {
					const isVisible = shownSet.has(field.id);
					return (
						<div
							key={field.id}
							data-visibility={isVisible ? "shown" : "hidden"}
							className="grid min-h-8 grid-cols-[minmax(0,1fr)_2rem] items-center px-2 hover:bg-surface-secondary"
						>
							{isVisible ? (
								<span
									title={field.hint}
									className="truncate px-1.5 text-xs text-foreground"
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
									className="flex min-w-0 items-center rounded-md px-1 py-0.5 text-xs"
								>
									<span className="truncate text-muted">
										{field.label}
									</span>
								</LayoutDraggableField>
							)}
							<Button
								type="button"
								isIconOnly
								variant="ghost"
								size="sm"
								className="size-7 min-w-7 text-muted"
								aria-label={t(
									isVisible
										? "usageLayoutHideField"
										: "usageLayoutShowField",
									{ field: field.label },
								)}
								isDisabled={
									isDisabled ||
									(!isVisible && shown.length >= capacity)
								}
								onPress={() =>
									onVisibilityChange(
										field.id,
										type,
										!isVisible,
									)
								}
							>
								{isVisible ? (
									<EyeIcon className="size-3.5" />
								) : (
									<EyeSlashIcon className="size-3.5" />
								)}
							</Button>
						</div>
					);
				})}
			</div>
		</div>
	);
}
