import {
	ArrowsRightLeftIcon,
	BookOpenIcon,
	LinkIcon,
	ServerIcon,
	XMarkIcon,
} from "@heroicons/react/24/solid";
import { Button, Chip, Dropdown, Tooltip } from "@heroui/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useTranslation } from "react-i18next";
import type {
	ResourceActionIntents,
	ResourceKind,
} from "../hooks/use-resource-actions";
import { useResourceActions } from "../hooks/use-resource-actions";
import { cn } from "../lib/utils";
import { ACTION_ICONS } from "./action-icons";
import type { MatrixGroup } from "./agent-coverage-matrix";
import { AgentCoverageMatrix } from "./agent-coverage-matrix";

export interface BulkPanelItem {
	key: string;
	label: string;
	/** Where the item lives — its custom group or source */
	badge?: string;
}

export interface BulkSourceContext {
	title: string;
	url?: string | null;
}

interface BulkActionsPanelProps {
	kind: ResourceKind;
	items: BulkPanelItem[];
	intents: ResourceActionIntents;
	/** Present when the selection is exactly one source group (library) */
	sourceContext?: BulkSourceContext | null;
	onDeselectAll: () => void;
	/** Drop one item from the selection (not delete it) */
	onRemoveItem: (key: string) => void;
	/** Replace the selection with everything else */
	onInvertSelection: () => void;
	/** Per-item agent coverage, for the in-place matrix */
	matrixGroups: MatrixGroup[];
	projectPath?: string;
}

/**
 * A batch inspector for a multi-selection: a fixed header (count and
 * selection controls), a scrolling roster where each item can be dropped
 * from the selection, and a fixed action footer. The same action model as
 * the context menu, and when the selection is a whole source group it
 * doubles as the library detail with the source header on top.
 */
export function BulkActionsPanel({
	kind,
	items,
	intents,
	sourceContext,
	onDeselectAll,
	onRemoveItem,
	onInvertSelection,
	matrixGroups,
	projectPath,
}: BulkActionsPanelProps) {
	const { t } = useTranslation();
	const actions = useResourceActions({
		kind,
		selectedKeys: new Set(items.map((item) => item.key)),
		intents,
	});

	const ItemIcon = kind === "skill" ? BookOpenIcon : ServerIcon;
	const sourceCount = new Set(
		items.map((item) => item.badge).filter(Boolean),
	).size;

	return (
		<div className="flex h-full flex-col">
			<header className="flex shrink-0 items-start justify-between gap-3 border-b border-separator p-4">
				<div className="min-w-0 flex-1">
					{sourceContext ? (
						<>
							<h2 className="truncate text-lg font-semibold text-foreground">
								{sourceContext.title}
							</h2>
							<p className="mt-1 text-sm text-muted">
								{t("itemsSelected", { count: items.length })}
							</p>
						</>
					) : (
						<h2 className="truncate text-lg font-semibold text-foreground">
							{t("itemsSelected", { count: items.length })}
						</h2>
					)}
				</div>
				<div className="flex items-center gap-1">
					{sourceContext?.url && (
						<IconButton
							label={t("openInBrowser")}
							onPress={() => {
								if (sourceContext.url) {
									void openUrl(sourceContext.url);
								}
							}}
						>
							<LinkIcon className="size-5" />
						</IconButton>
					)}
					<IconButton
						label={t("invertSelection")}
						onPress={onInvertSelection}
					>
						<ArrowsRightLeftIcon className="size-5" />
					</IconButton>
					<IconButton label={t("deselectAll")} onPress={onDeselectAll}>
						<XMarkIcon className="size-5" />
					</IconButton>
				</div>
			</header>

			<div className="flex-1 space-y-4 overflow-y-auto p-4">
				<ul className="space-y-0.5">
					{items.map((item) => (
						<li
							key={item.key}
							className="group flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors duration-[var(--dur-fast)] hover:bg-default"
						>
							<ItemIcon className="size-4 shrink-0 text-muted" />
							<span className="min-w-0 flex-1 truncate">
								{item.label}
							</span>
							{item.badge && (
								<Chip size="sm" variant="soft">
									{item.badge}
								</Chip>
							)}
							<button
								type="button"
								aria-label={t("removeFromSelection")}
								onClick={() => onRemoveItem(item.key)}
								className="shrink-0 rounded p-0.5 text-muted opacity-0 transition-opacity duration-[var(--dur-fast)] hover:text-foreground focus:opacity-100 group-hover:opacity-100"
							>
								<XMarkIcon className="size-4" />
							</button>
						</li>
					))}
				</ul>

				{sourceCount > 0 && (
					<p className="px-2 text-xs text-muted">
						{t("fromSources", { count: sourceCount })}
					</p>
				)}

				<AgentCoverageMatrix
					kind={kind}
					groups={matrixGroups}
					projectPath={projectPath}
				/>
			</div>

			<footer className="shrink-0 space-y-2 border-t border-separator p-4">
				<div className="flex flex-wrap gap-2">
					<Button
						variant="secondary"
						onPress={actions.requestTransfer}
					>
						<ACTION_ICONS.transfer className="size-4" />
						{t("transfer")}
					</Button>
					<Button
						variant="secondary"
						onPress={() => void actions.toggleFavorite()}
					>
						{actions.allStarred ? (
							<ACTION_ICONS.unfavorite className="size-4" />
						) : (
							<ACTION_ICONS.favorite className="size-4 text-warning" />
						)}
						{actions.allStarred ? t("unfavorite") : t("favorite")}
					</Button>
					{actions.groups.length > 0 ? (
						<Dropdown>
							<Button variant="secondary">
								<ACTION_ICONS.moveToGroup className="size-4" />
								{t("moveToGroup")}
							</Button>
							<Dropdown.Popover placement="top start">
								<Dropdown.Menu
									onAction={(key) => {
										if (key === "create-group") {
											actions.requestCreateGroup();
										} else {
											void actions.moveToGroup(
												String(key),
											);
										}
									}}
								>
									{actions.groups.map((group) => (
										<Dropdown.Item
											key={group.id}
											id={group.id}
											textValue={group.name}
										>
											<div className="flex items-center gap-2">
												<ACTION_ICONS.moveToGroup className="size-4 text-muted" />
												<span className="truncate">
													{group.name}
												</span>
											</div>
										</Dropdown.Item>
									))}
									<Dropdown.Item
										id="create-group"
										textValue={t("createGroup")}
									>
										<div className="flex items-center gap-2">
											<ACTION_ICONS.createGroup className="size-4" />
											<span>{t("createGroup")}</span>
										</div>
									</Dropdown.Item>
								</Dropdown.Menu>
							</Dropdown.Popover>
						</Dropdown>
					) : (
						<Button
							variant="secondary"
							onPress={actions.requestCreateGroup}
						>
							<ACTION_ICONS.createGroup className="size-4" />
							{t("createGroup")}
						</Button>
					)}
					{actions.canRemoveFromGroup && (
						<Button
							variant="secondary"
							onPress={() => void actions.removeFromGroup()}
						>
							<ACTION_ICONS.removeFromGroup className="size-4" />
							{t("removeFromGroup")}
						</Button>
					)}
				</div>
				<Button
					variant="danger"
					className="w-full"
					onPress={actions.requestDelete}
				>
					<ACTION_ICONS.delete className="size-4" />
					{t("deleteCount", { count: items.length })}
				</Button>
			</footer>
		</div>
	);
}

function IconButton({
	label,
	onPress,
	children,
}: {
	label: string;
	onPress: () => void;
	children: React.ReactNode;
}) {
	return (
		<Tooltip delay={0}>
			<Button
				isIconOnly
				variant="ghost"
				size="md"
				className={cn(
					"min-h-[44px] min-w-[44px] text-muted hover:text-foreground",
				)}
				aria-label={label}
				onPress={onPress}
			>
				{children}
			</Button>
			<Tooltip.Content>{label}</Tooltip.Content>
		</Tooltip>
	);
}
