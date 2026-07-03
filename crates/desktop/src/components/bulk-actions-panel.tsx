import { StarIcon as StarIconOutline } from "@heroicons/react/24/outline";
import {
	BookOpenIcon,
	FolderIcon,
	FolderMinusIcon,
	FolderPlusIcon,
	LinkIcon,
	PlusIcon,
	ServerIcon,
	StarIcon as StarIconSolid,
	TrashIcon,
	XMarkIcon,
} from "@heroicons/react/24/solid";
import { Button, Card, Chip, Dropdown, Tooltip } from "@heroui/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useTranslation } from "react-i18next";
import type {
	ResourceActionIntents,
	ResourceKind,
} from "../hooks/use-resource-actions";
import { useResourceActions } from "../hooks/use-resource-actions";

export interface BulkPanelItem {
	key: string;
	label: string;
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
}

/**
 * Right-hand panel for a multi-selection: the same action model as the
 * context menu, rendered as buttons, plus the selected-items roster.
 * When the selection is a whole source group it doubles as the library
 * detail with the source header on top.
 */
export function BulkActionsPanel({
	kind,
	items,
	intents,
	sourceContext,
	onDeselectAll,
}: BulkActionsPanelProps) {
	const { t } = useTranslation();
	const actions = useResourceActions({
		kind,
		selectedKeys: new Set(items.map((item) => item.key)),
		intents,
	});

	const ItemIcon = kind === "skill" ? BookOpenIcon : ServerIcon;

	return (
		<div className="h-full overflow-y-auto">
			<div className="w-full space-y-4 p-4 sm:p-6">
				<Card>
					<Card.Header className="flex flex-row items-start justify-between gap-3">
						<div className="min-w-0 flex-1">
							{sourceContext ? (
								<>
									<h2 className="text-xl font-semibold text-foreground truncate">
										{sourceContext.title}
									</h2>
									<Card.Description className="mt-2">
										{t("itemsSelected", {
											count: items.length,
										})}
									</Card.Description>
								</>
							) : (
								<h2 className="text-xl font-semibold text-foreground truncate">
									{t("itemsSelected", {
										count: items.length,
									})}
								</h2>
							)}
						</div>
						<div className="flex items-center gap-2">
							{sourceContext?.url && (
								<Tooltip delay={0}>
									<Button
										isIconOnly
										variant="ghost"
										size="md"
										className="text-muted min-w-[44px] min-h-[44px] hover:text-foreground"
										aria-label={t("openInBrowser")}
										onPress={() => {
											if (sourceContext.url) {
												void openUrl(sourceContext.url);
											}
										}}
									>
										<LinkIcon className="size-5" />
									</Button>
									<Tooltip.Content>
										{t("openInBrowser")}
									</Tooltip.Content>
								</Tooltip>
							)}
							<Tooltip delay={0}>
								<Button
									isIconOnly
									variant="ghost"
									size="md"
									className="text-muted min-w-[44px] min-h-[44px] hover:text-foreground"
									aria-label={t("deselectAll")}
									onPress={onDeselectAll}
								>
									<XMarkIcon className="size-5" />
								</Button>
								<Tooltip.Content>
									{t("deselectAll")}
								</Tooltip.Content>
							</Tooltip>
						</div>
					</Card.Header>

					<Card.Content className="flex flex-col gap-6">
						<div className="flex flex-wrap gap-1.5">
							{items.map((item) => (
								<Chip key={item.key} size="sm" variant="soft">
									<ItemIcon className="size-3 text-muted" />
									{item.label}
								</Chip>
							))}
						</div>

						<Card.Footer className="pt-4 border-t border-separator flex flex-wrap gap-3">
							<Button
								variant="primary"
								onPress={actions.requestAddToAgent}
							>
								<PlusIcon className="size-4" />
								{t("addToAgent")}
							</Button>
							<Button
								variant="secondary"
								onPress={actions.requestTransfer}
							>
								<PlusIcon className="size-4" />
								{t("transfer")}
							</Button>
							<Button
								variant="secondary"
								onPress={() => void actions.toggleFavorite()}
							>
								{actions.allStarred ? (
									<StarIconSolid className="size-4 text-warning" />
								) : (
									<StarIconOutline className="size-4" />
								)}
								{actions.allStarred
									? t("unfavorite")
									: t("favorite")}
							</Button>
							{actions.groups.length > 0 ? (
								<Dropdown>
									<Button variant="secondary">
										<FolderIcon className="size-4" />
										{t("moveToGroup")}
									</Button>
									<Dropdown.Popover placement="bottom start">
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
														<FolderIcon className="size-4 text-muted" />
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
													<FolderPlusIcon className="size-4" />
													<span>
														{t("createGroup")}
													</span>
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
									<FolderPlusIcon className="size-4" />
									{t("createGroup")}
								</Button>
							)}
							{actions.canRemoveFromGroup && (
								<Button
									variant="secondary"
									onPress={() =>
										void actions.removeFromGroup()
									}
								>
									<FolderMinusIcon className="size-4" />
									{t("removeFromGroup")}
								</Button>
							)}
							<Button
								variant="danger"
								onPress={actions.requestDelete}
							>
								<TrashIcon className="size-4" />
								{t("delete")}
							</Button>
						</Card.Footer>
					</Card.Content>
				</Card>
			</div>
		</div>
	);
}
