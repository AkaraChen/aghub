import {
	ChevronDownIcon,
	ChevronRightIcon,
	PlusIcon,
} from "@heroicons/react/24/solid";
import { Chip } from "@heroui/react";
import type { ReactNode } from "react";
import { useDrag } from "react-aria";
import type { DropItem } from "react-aria-components";
import { DropZone } from "react-aria-components";
import { useTranslation } from "react-i18next";
import { cn } from "../lib/utils";

/**
 * Extracts the member keys carried by a list drag (item drag, header
 * drag or selection drag — they all serialize a key array under the
 * list's drag type).
 */
export async function readDraggedKeys(
	items: DropItem[],
	dragType: string,
): Promise<string[]> {
	for (const item of items) {
		if (item.kind === "text" && item.types.has(dragType)) {
			try {
				const parsed: unknown = JSON.parse(
					await item.getText(dragType),
				);
				if (
					Array.isArray(parsed) &&
					parsed.every((k) => typeof k === "string")
				) {
					return parsed;
				}
			} catch {
				return [];
			}
		}
	}
	return [];
}

interface ResourceGroupSectionProps {
	title: string;
	count: number;
	icon?: ReactNode;
	isExpanded: boolean;
	/** Highlights the header while the whole group is selected */
	isSelected: boolean;
	onToggleExpanded: () => void;
	/** Header click selects the whole group */
	onSelectAll: () => void;
	onContextMenu?: (event: React.MouseEvent) => void;
	/** MIME type namespacing this list's drags (skill vs mcp) */
	dragType: string;
	/** Member keys carried when the header itself is dragged */
	dragKeys?: string[];
	/** Accept dropped member keys; omit to reject drops (source groups) */
	onDropKeys?: (keys: string[]) => void;
	/** Header drag lifecycle, so the list can show drop targets */
	onHeaderDragChange?: (isDragging: boolean) => void;
	children?: ReactNode;
}

/**
 * Collapsible section header acting as a compound unit: the whole row
 * selects every member on click (and highlights on hover), the chevron
 * alone toggles expansion, dragging the header drags the whole group,
 * and custom groups accept member drops.
 */
export function ResourceGroupSection({
	title,
	count,
	icon,
	isExpanded,
	isSelected,
	onToggleExpanded,
	onSelectAll,
	onContextMenu,
	dragType,
	dragKeys,
	onDropKeys,
	onHeaderDragChange,
	children,
}: ResourceGroupSectionProps) {
	const { t } = useTranslation();

	const { dragProps } = useDrag({
		getItems: () => [{ [dragType]: JSON.stringify(dragKeys ?? []) }],
		onDragStart: () => onHeaderDragChange?.(true),
		onDragEnd: () => onHeaderDragChange?.(false),
	});
	const headerDragProps = dragKeys && dragKeys.length > 0 ? dragProps : {};

	return (
		<DropZone
			data-testid={`group-section-${title}`}
			getDropOperation={(types) =>
				onDropKeys && types.has(dragType) ? "move" : "cancel"
			}
			onDrop={(e) => {
				void readDraggedKeys(e.items, dragType).then((keys) => {
					if (keys.length > 0) onDropKeys?.(keys);
				});
			}}
			className={({ isDropTarget }) =>
				cn(
					"border-y border-separator",
					isDropTarget &&
						"bg-accent/10 ring-1 ring-inset ring-accent",
				)
			}
		>
			<div
				role="button"
				tabIndex={0}
				{...headerDragProps}
				onClick={onSelectAll}
				onKeyDown={(event) => {
					if (event.key === "Enter" || event.key === " ") {
						event.preventDefault();
						onSelectAll();
					}
				}}
				onContextMenu={onContextMenu}
				aria-label={t("selectAllInGroup", { name: title })}
				className={cn(
					"flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left transition-colors",
					// Match the list items: subtle surface on hover, an
					// elevated surface when the whole group is selected.
					isSelected ? "bg-surface" : "hover:bg-default",
				)}
			>
				<button
					type="button"
					onClick={(event) => {
						event.stopPropagation();
						onToggleExpanded();
					}}
					className="flex size-6 shrink-0 items-center justify-center rounded text-muted transition-colors hover:bg-default hover:text-foreground"
					aria-label={title}
					aria-expanded={isExpanded}
				>
					{isExpanded ? (
						<ChevronDownIcon className="size-4" />
					) : (
						<ChevronRightIcon className="size-4" />
					)}
				</button>
				{icon}
				<p className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
					{title}
				</p>
				<Chip size="sm" variant="secondary">
					{count}
				</Chip>
			</div>
			{isExpanded && children}
		</DropZone>
	);
}

interface NewGroupDropZoneProps {
	dragType: string;
	onDropKeys: (keys: string[]) => void;
}

/** Drop target shown while dragging: dropping creates a new group. */
export function NewGroupDropZone({
	dragType,
	onDropKeys,
}: NewGroupDropZoneProps) {
	const { t } = useTranslation();

	return (
		<DropZone
			data-testid="new-group-dropzone"
			getDropOperation={(types) =>
				types.has(dragType) ? "move" : "cancel"
			}
			onDrop={(e) => {
				void readDraggedKeys(e.items, dragType).then((keys) => {
					if (keys.length > 0) onDropKeys(keys);
				});
			}}
			className={({ isDropTarget }) =>
				cn(
					"mx-2 my-2 flex items-center justify-center gap-2 rounded-lg border border-dashed border-separator px-3 py-3 text-xs text-muted",
					isDropTarget && "border-accent bg-accent/10 text-accent",
				)
			}
		>
			<PlusIcon className="size-4" />
			{t("dragToNewGroup")}
		</DropZone>
	);
}
