import { LinkIcon, XMarkIcon } from "@heroicons/react/24/solid";
import { Button, Dropdown, Tooltip } from "@heroui/react";
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
	matrixGroups,
	projectPath,
}: BulkActionsPanelProps) {
	const { t } = useTranslation();
	const actions = useResourceActions({
		kind,
		selectedKeys: new Set(items.map((item) => item.key)),
		intents,
	});

	// Roster sections: items grouped by their source badge (sorted by the
	// repo name, matching the list), badge-less items last as "ungrouped".
	const rosterSections = (() => {
		const bySource = new Map<string, BulkPanelItem[]>();
		const loose: BulkPanelItem[] = [];
		for (const item of items) {
			if (!item.badge) {
				loose.push(item);
				continue;
			}
			const existing = bySource.get(item.badge) ?? [];
			existing.push(item);
			bySource.set(item.badge, existing);
		}
		const named = Array.from(bySource.entries()).sort(([a], [b]) => {
			const tail = (s: string) => s.split("/").pop() ?? s;
			return tail(a).localeCompare(tail(b));
		});
		return [
			...named.map(([title, members]) => ({ title, members })),
			...(loose.length > 0
				? [{ title: t("ungrouped"), members: loose }]
				: []),
		];
	})();

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
						label={t("deselectAll")}
						onPress={onDeselectAll}
					>
						<XMarkIcon className="size-5" />
					</IconButton>
				</div>
			</header>

			<div className="flex-1 space-y-4 overflow-y-auto p-4">
				{/* Roster: one outlined wrap per source — the group name and
				 * its members read as a single unit; members are plain text
				 * (no pills), the × only drops the item from the selection */}
				<div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
					{rosterSections.map((section) => (
						<div
							key={section.title}
							className="flex max-w-full flex-wrap items-center gap-x-0.5 gap-y-0.5 rounded-lg border border-border py-1 pr-1.5 pl-2.5"
						>
							<span className="mr-1 text-[10px] font-medium tracking-wider text-muted uppercase">
								{section.title.split("/").pop()}
							</span>
							<span className="mr-0.5 text-[10px] tabular-nums text-muted/60">
								{section.members.length}
							</span>
							{section.members.map((item) => (
								<div
									key={item.key}
									className="flex items-center gap-1 rounded-md px-1.5 py-0.5 transition-colors duration-[var(--dur-fast)] hover:bg-default/40"
								>
									<span className="text-sm text-foreground">
										{item.label}
									</span>
									<button
										type="button"
										aria-label={t("removeFromSelection", {
											name: item.label,
										})}
										onClick={() => onRemoveItem(item.key)}
										className="flex size-4 shrink-0 items-center justify-center rounded text-muted/40 transition-colors hover:text-foreground"
									>
										<XMarkIcon className="size-3" />
									</button>
								</div>
							))}
						</div>
					))}
				</div>

				<AgentCoverageMatrix
					kind={kind}
					groups={matrixGroups}
					projectPath={projectPath}
				/>
			</div>

			<footer className="shrink-0 border-t border-separator p-4">
				{/* Two-up grid: fixed footer height, echoes the matrix cells */}
				<div className="grid grid-cols-2 gap-2">
					<Button
						variant="secondary"
						className="w-full"
						onPress={actions.requestTransfer}
					>
						<ACTION_ICONS.transfer className="size-4" />
						{t("transfer")}
					</Button>
					<Button
						variant="secondary"
						className="w-full"
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
							<Button variant="secondary" className="w-full">
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
							className="w-full"
							onPress={actions.requestCreateGroup}
						>
							<ACTION_ICONS.createGroup className="size-4" />
							{t("createGroup")}
						</Button>
					)}
					{actions.canRemoveFromGroup && (
						<Button
							variant="secondary"
							className="w-full"
							onPress={() => void actions.removeFromGroup()}
						>
							<ACTION_ICONS.removeFromGroup className="size-4" />
							{t("removeFromGroup")}
						</Button>
					)}
					<Button
						variant="danger"
						className="col-start-2 w-full"
						onPress={actions.requestDelete}
					>
						<ACTION_ICONS.delete className="size-4" />
						{t("deleteCount", { count: items.length })}
					</Button>
				</div>
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
