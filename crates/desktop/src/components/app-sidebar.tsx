import {
	BookOpenIcon,
	Cog6ToothIcon,
	CpuChipIcon,
	EyeIcon,
	EyeSlashIcon,
	ServerIcon,
	SquaresPlusIcon,
} from "@heroicons/react/24/solid";
import {
	closestCenter,
	DndContext,
	DragOverlay,
	KeyboardSensor,
	PointerSensor,
	useDroppable,
	useSensor,
	useSensors,
	type DragEndEvent,
	type DragStartEvent,
} from "@dnd-kit/core";
import {
	SortableContext,
	sortableKeyboardCoordinates,
	useSortable,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button, Surface } from "@heroui/react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "wouter";
import {
	DEFAULT_ORDER,
	hideItem,
	showItem,
	getHiddenItems,
	getSidebarOrder,
	setSidebarOrder,
	type MenuItemId,
} from "../lib/store/sidebar";
import { cn } from "../lib/utils";
import { ProjectList } from "./project-list";

interface MenuItemDefinition {
	id: MenuItemId;
	labelKey: string;
	href: string;
	icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
}

const MENU_ITEM_MAP: Record<MenuItemId, MenuItemDefinition> = {
	mcp: {
		id: "mcp",
		labelKey: "mcpServers",
		href: "/mcp",
		icon: ServerIcon,
	},
	skills: {
		id: "skills",
		labelKey: "skills",
		href: "/skills",
		icon: BookOpenIcon,
	},
	"skills-sh": {
		id: "skills-sh",
		labelKey: "skillsSh",
		href: "/skills-sh",
		icon: SquaresPlusIcon,
	},
	"sub-agents": {
		id: "sub-agents",
		labelKey: "subAgents",
		href: "/sub-agents",
		icon: CpuChipIcon,
	},
};

interface SortableMenuItemProps {
	item: MenuItemDefinition;
	isActive: boolean;
	onHide: () => void;
}

function SortableMenuItem({ item, isActive, onHide }: SortableMenuItemProps) {
	const { t } = useTranslation();
	const Icon = item.icon;

	const {
		attributes,
		listeners,
		setNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({
		id: item.id,
		data: { type: "menu-item", item },
	});

	const style = {
		transform: CSS.Translate.toString(transform),
		transition,
	};

	return (
		<div
			ref={setNodeRef}
			style={style}
			className={cn(
				"group relative flex items-center",
				isDragging && "z-50 opacity-50",
			)}
			{...attributes}
			{...listeners}
		>
			<Link
				href={item.href}
				data-tour={
					item.href === "/mcp"
						? "nav-mcp"
						: item.href === "/skills"
							? "nav-skills"
							: "nav-market"
				}
				className={cn(
					"flex flex-1 items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors",
					isActive
						? "bg-surface font-medium text-foreground"
						: "text-muted hover:bg-surface-secondary hover:text-foreground",
				)}
				onClick={(e) => e.stopPropagation()}
			>
				<Icon className="size-4" />
				<span>{t(item.labelKey)}</span>
			</Link>
		<Button
			isIconOnly
			size="sm"
			variant="ghost"
			className="absolute right-1 opacity-0 transition-opacity group-hover:opacity-100"
			onPress={onHide}
		>
			<EyeSlashIcon className="size-4 text-muted" />
		</Button>
		</div>
	);
}

interface HiddenItemProps {
	item: MenuItemDefinition;
	onShow: () => void;
}

function HiddenItem({ item, onShow }: HiddenItemProps) {
	const { t } = useTranslation();
	const Icon = item.icon;

	const { setNodeRef, isOver } = useDroppable({
		id: `show-${item.id}`,
		data: { type: "show-zone", itemId: item.id },
	});

	return (
		<div
			ref={setNodeRef}
			className={cn(
				"flex items-center justify-between rounded-md px-2.5 py-1.5 text-sm transition-colors",
				isOver ? "bg-surface" : "",
			)}
		>
			<div className="flex items-center gap-2.5 text-muted">
				<Icon className="size-4" />
				<span>{t(item.labelKey)}</span>
			</div>
			<Button
				isIconOnly
				size="sm"
				variant="ghost"
				onPress={onShow}
			>
				<EyeIcon className="size-4 text-muted" />
			</Button>
		</div>
	);
}

interface HiddenDropZoneProps {
	hasHiddenItems: boolean;
}

function HiddenDropZone({ hasHiddenItems }: HiddenDropZoneProps) {
	const { t } = useTranslation();
	const { setNodeRef, isOver } = useDroppable({
		id: "hidden-zone",
		data: { type: "hidden-zone" },
	});

	return (
		<div
			ref={setNodeRef}
			className={cn(
				"rounded-lg border-2 border-dashed p-3 transition-colors",
				isOver
					? "border-danger bg-danger/10"
					: "border-border bg-surface-secondary",
				!hasHiddenItems && "py-6",
			)}
		>
			{!hasHiddenItems && (
				<div className="text-center text-xs text-muted">
					{t("dragToHide")}
				</div>
			)}
		</div>
	);
}

export function AppSidebar() {
	const { t } = useTranslation();
	const [pathname] = useLocation();
	const [order, setOrder] = React.useState<MenuItemId[]>(DEFAULT_ORDER);
	const [hidden, setHidden] = React.useState<MenuItemId[]>([]);
	const [isLoading, setIsLoading] = React.useState(true);
	const [activeId, setActiveId] = React.useState<string | null>(null);

	React.useEffect(() => {
		Promise.all([getSidebarOrder(), getHiddenItems()]).then(
			([savedOrder, savedHidden]) => {
				setOrder(savedOrder);
				setHidden(savedHidden);
				setIsLoading(false);
			},
		);
	}, []);

	const sensors = useSensors(
		useSensor(PointerSensor, {
			activationConstraint: { distance: 5 },
		}),
		useSensor(KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
		}),
	);

	const visibleItems = React.useMemo(() => {
		return order.filter((id) => !hidden.includes(id));
	}, [order, hidden]);

	const visibleItemDefs = React.useMemo(() => {
		return visibleItems.map((id) => MENU_ITEM_MAP[id]);
	}, [visibleItems]);

	const hiddenItemDefs = React.useMemo(() => {
		return hidden.map((id) => MENU_ITEM_MAP[id]);
	}, [hidden]);

	const handleDragStart = (event: DragStartEvent) => {
		setActiveId(event.active.id as string);
	};

	const handleDragEnd = async (event: DragEndEvent) => {
		const { active, over } = event;
		setActiveId(null);

		if (!over) return;

		const activeId = active.id as MenuItemId;
		const overId = over.id as string;

		// Dropped on hidden zone
		if (overId === "hidden-zone") {
			await hideItem(activeId);
			const newHidden = [...hidden, activeId];
			setHidden(newHidden);
			return;
		}

		// Dropped on a specific show zone
		if (overId.startsWith("show-")) {
			const itemId = overId.replace("show-", "") as MenuItemId;
			await showItem(itemId);
			const newHidden = hidden.filter((id) => id !== itemId);
			setHidden(newHidden);
			return;
		}

		// Reordering within visible items
		if (activeId !== overId && visibleItems.includes(overId as MenuItemId)) {
			const oldIndex = visibleItems.indexOf(activeId);
			const newIndex = visibleItems.indexOf(overId as MenuItemId);

			const newVisible = [...visibleItems];
			newVisible.splice(oldIndex, 1);
			newVisible.splice(newIndex, 0, activeId);

			// Build new order: visible items first (in new order), then hidden items
			const newOrder = [...newVisible, ...hidden];

			await setSidebarOrder(newOrder);
			setOrder(newOrder);
		}
	};

	const handleHide = async (itemId: MenuItemId) => {
		await hideItem(itemId);
		setHidden([...hidden, itemId]);
	};

	const handleShow = async (itemId: MenuItemId) => {
		await showItem(itemId);
		setHidden(hidden.filter((id) => id !== itemId));
	};

	const activeItem = activeId ? MENU_ITEM_MAP[activeId as MenuItemId] : null;

	if (isLoading) {
		return (
			<Surface
				variant="secondary"
				data-tour="sidebar"
				className="flex w-60 shrink-0 flex-col border-r border-border p-3"
			>
				<aside className="flex h-full flex-col">
					<nav className="flex flex-col gap-0.5">
						{DEFAULT_ORDER.map((id) => {
							const item = MENU_ITEM_MAP[id];
							const Icon = item.icon;
							const isActive = pathname === item.href;
							return (
								<Link
									key={item.id}
									href={item.href}
									className={cn(
										"flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors",
										isActive
											? "bg-surface font-medium text-foreground"
											: "text-muted hover:bg-surface-secondary hover:text-foreground",
									)}
								>
									<Icon className="size-4" />
									<span>{t(item.labelKey)}</span>
								</Link>
							);
						})}
					</nav>
					<div data-tour="project-section">
						<ProjectList />
					</div>
					<nav className="mt-auto">
						<Link
							href="/settings"
							data-tour="nav-settings"
							className={cn(
								"flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors",
								pathname === "/settings"
									? "bg-surface font-medium text-foreground"
									: "text-muted hover:bg-surface-secondary hover:text-foreground",
							)}
						>
							<Cog6ToothIcon className="size-4" />
							<span>{t("settings")}</span>
						</Link>
					</nav>
				</aside>
			</Surface>
		);
	}

	return (
		<Surface
			variant="secondary"
			data-tour="sidebar"
			className="flex w-60 shrink-0 flex-col border-r border-border p-3"
		>
			<DndContext
				sensors={sensors}
				collisionDetection={closestCenter}
				onDragStart={handleDragStart}
				onDragEnd={handleDragEnd}
			>
				<aside className="flex h-full flex-col">
					<nav className="flex flex-col gap-0.5">
						<SortableContext
							items={visibleItems}
							strategy={verticalListSortingStrategy}
						>
							{visibleItemDefs.map((item) => (
								<SortableMenuItem
									key={item.id}
									item={item}
									isActive={pathname === item.href}
									onHide={() => handleHide(item.id)}
								/>
							))}
						</SortableContext>
					</nav>

					<div data-tour="project-section">
						<ProjectList />
					</div>

					{hidden.length > 0 && (
						<div className="mt-4">
							<div className="mb-2 px-2.5 text-xs font-medium uppercase tracking-wide text-muted">
								{t("hidden")}
							</div>
							<div className="flex flex-col gap-0.5">
								{hiddenItemDefs.map((item) => (
									<HiddenItem
										key={item.id}
										item={item}
										onShow={() => handleShow(item.id)}
									/>
								))}
							</div>
						</div>
					)}

					<HiddenDropZone hasHiddenItems={hidden.length > 0} />

					<nav className="mt-auto">
						<Link
							href="/settings"
							data-tour="nav-settings"
							className={cn(
								"flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors",
								pathname === "/settings"
									? "bg-surface font-medium text-foreground"
									: "text-muted hover:bg-surface-secondary hover:text-foreground",
							)}
						>
							<Cog6ToothIcon className="size-4" />
							<span>{t("settings")}</span>
						</Link>
					</nav>
				</aside>

				<DragOverlay>
					{activeItem ? (
						<div className="flex items-center gap-2.5 rounded-md bg-surface px-2.5 py-1.5 text-sm font-medium text-foreground shadow-lg">
							<activeItem.icon className="size-4" />
							<span>{t(activeItem.labelKey)}</span>
						</div>
					) : null}
				</DragOverlay>
			</DndContext>
		</Surface>
	);
}
