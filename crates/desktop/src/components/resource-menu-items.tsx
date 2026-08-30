import {
	CheckCircleIcon,
	LinkIcon,
	PencilIcon,
	TrashIcon,
} from "@heroicons/react/24/solid";
import { Header, Kbd, Menu } from "@heroui/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { TFunction } from "i18next";
import type { ReactNode } from "react";
import type { ResourceActionsModel } from "../hooks/use-resource-actions";
import type { ResourceGroup } from "../lib/store";
import { cn } from "../lib/utils";
import { ACTION_ICONS } from "./action-icons";

/**
 * The one items context menu, shared by the skill and mcp lists. Plain
 * functions returning JSX (not components) on purpose: react-aria's
 * static collections walk Menu children by element type, so the items
 * must be inlined, not wrapped in a component boundary.
 */
export function resourceItemsMenu({
	t,
	actions,
	sourceUrl,
}: {
	t: TFunction;
	actions: ResourceActionsModel;
	/** Present on source-cluster menus: a leading open-in-browser entry */
	sourceUrl?: string | null;
}): ReactNode {
	return (
		<>
			{sourceUrl && (
				<Menu.Item
					id="open-in-browser"
					textValue={t("openInBrowser")}
					onAction={() => void openUrl(sourceUrl)}
				>
					<div className="flex items-center gap-2">
						<LinkIcon className="size-4" />
						<span>{t("openInBrowser")}</span>
					</div>
				</Menu.Item>
			)}
			<Menu.Item
				id="toggle-favorite"
				textValue={actions.allStarred ? t("unfavorite") : t("favorite")}
				onAction={() => void actions.toggleFavorite()}
			>
				<div className="flex items-center gap-2">
					{actions.allStarred ? (
						<ACTION_ICONS.unfavorite className="size-4" />
					) : (
						<ACTION_ICONS.favorite className="size-4 text-warning" />
					)}
					<span>
						{actions.allStarred ? t("unfavorite") : t("favorite")}
					</span>
				</div>
			</Menu.Item>
			{actions.canWrite && (
				<>
					<Menu.Item
						id="add-to-agent"
						textValue={t("addToAgent")}
						onAction={actions.requestAddToAgent}
					>
						<div className="flex items-center gap-2">
							<ACTION_ICONS.addToAgent className="size-4" />
							<span>{t("addToAgent")}</span>
						</div>
					</Menu.Item>
					<Menu.Item
						id="transfer"
						textValue={t("transfer")}
						onAction={actions.requestTransfer}
					>
						<div className="flex items-center gap-2">
							<ACTION_ICONS.transfer className="size-4" />
							<span>{t("transfer")}</span>
						</div>
					</Menu.Item>
				</>
			)}
			{actions.groups.length > 0 ? (
				<Menu.Section>
					<Header className="px-2 py-1 text-xs font-medium text-muted">
						{t("moveToGroup")}
					</Header>
					{actions.groups.map((group) => (
						<Menu.Item
							key={group.id}
							id={`group:${group.id}`}
							textValue={group.name}
							onAction={() => void actions.moveToGroup(group.id)}
						>
							<div className="flex items-center gap-2">
								<ACTION_ICONS.moveToGroup
									className={cn(
										"size-4",
										actions.commonGroupId === group.id
											? "text-accent"
											: "text-muted",
									)}
								/>
								<span className="truncate">{group.name}</span>
							</div>
						</Menu.Item>
					))}
					<Menu.Item
						id="create-group"
						textValue={t("createGroup")}
						onAction={actions.requestCreateGroup}
					>
						<div className="flex items-center gap-2">
							<ACTION_ICONS.createGroup className="size-4" />
							<span>{t("createGroup")}</span>
						</div>
					</Menu.Item>
					<Menu.Item
						id="remove-from-group"
						textValue={t("removeFromGroup")}
						isDisabled={!actions.canRemoveFromGroup}
						onAction={() => void actions.removeFromGroup()}
					>
						<div className="flex items-center gap-2">
							<ACTION_ICONS.removeFromGroup className="size-4" />
							<span>{t("removeFromGroup")}</span>
						</div>
					</Menu.Item>
				</Menu.Section>
			) : (
				<Menu.Item
					id="create-group"
					textValue={t("createGroup")}
					onAction={actions.requestCreateGroup}
				>
					<div className="flex items-center gap-2">
						<ACTION_ICONS.createGroup className="size-4" />
						<span>{t("createGroup")}</span>
					</div>
				</Menu.Item>
			)}
			{actions.canWrite && (
				<Menu.Section>
					<Menu.Item
						id="delete"
						textValue={t("delete")}
						onAction={actions.requestDelete}
					>
						<div className="flex items-center gap-2 text-danger">
							<ACTION_ICONS.delete className="size-4" />
							<span>{t("delete")}</span>
						</div>
					</Menu.Item>
				</Menu.Section>
			)}
		</>
	);
}

/** The custom-group header menu, shared by both lists. */
export function customGroupMenu({
	t,
	group,
	memberKeys,
	onSelectMembers,
	onAddToAgent,
	onFavoriteAll,
	canWrite = true,
	onRename,
	onDelete,
}: {
	t: TFunction;
	group: ResourceGroup;
	memberKeys: string[];
	onSelectMembers: (memberKeys: string[]) => void;
	onAddToAgent: () => void;
	onFavoriteAll: (memberKeys: string[]) => void;
	canWrite?: boolean;
	onRename: (group: ResourceGroup) => void;
	onDelete: (group: ResourceGroup) => void;
}): ReactNode {
	return (
		<>
			<Menu.Item
				id="select-members"
				textValue={t("selectAllInGroup", { name: group.name })}
				onAction={() => onSelectMembers(memberKeys)}
			>
				<div className="flex items-center gap-2">
					<CheckCircleIcon className="size-4" />
					<span>{t("selectAllInGroup", { name: group.name })}</span>
				</div>
			</Menu.Item>
			{canWrite && (
				<Menu.Item
					id="group-add-to-agent"
					textValue={t("addToAgent")}
					onAction={() => {
						onSelectMembers(memberKeys);
						onAddToAgent();
					}}
				>
					<div className="flex items-center gap-2">
						<ACTION_ICONS.addToAgent className="size-4" />
						<span>{t("addToAgent")}</span>
					</div>
				</Menu.Item>
			)}
			<Menu.Item
				id="group-favorite-all"
				textValue={t("favoriteAll")}
				onAction={() => onFavoriteAll(memberKeys)}
			>
				<div className="flex items-center gap-2">
					<ACTION_ICONS.favorite className="size-4 text-warning" />
					<span>{t("favoriteAll")}</span>
				</div>
			</Menu.Item>
			<Menu.Section>
				<Menu.Item
					id="rename-group"
					textValue={t("renameGroup")}
					onAction={() => onRename(group)}
				>
					<div className="flex w-full items-center gap-2">
						<PencilIcon className="size-4" />
						<span className="flex-1">{t("renameGroup")}</span>
						<Kbd>F2</Kbd>
					</div>
				</Menu.Item>
				<Menu.Item
					id="delete-group"
					textValue={t("deleteGroup")}
					onAction={() => onDelete(group)}
				>
					<div className="flex items-center gap-2 text-danger">
						<TrashIcon className="size-4" />
						<span>{t("deleteGroup")}</span>
					</div>
				</Menu.Item>
			</Menu.Section>
		</>
	);
}
