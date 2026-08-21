import { LinkIcon, XMarkIcon } from "@heroicons/react/24/solid";
import { Button, Card, Dropdown, Tag, TagGroup, Tooltip } from "@heroui/react";
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

interface BulkPanelItem {
	key: string;
	label: string;
	/** Where the item lives — its custom group or source */
	badge?: string;
}

interface BulkSourceContext {
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
	/** False when the selection contains an Agent-managed Skill. */
	canWrite?: boolean;
}

/**
 * A batch inspector for a multi-selection, laid out like the detail
 * panels: one Card with the selection count as its header, a roster
 * where each item can be dropped from the selection, the agent coverage
 * matrix, and the actions in the Card footer. The same action model as
 * the context menu; a whole-library selection adds an open-in-browser
 * shortcut next to the header.
 */
export function BulkActionsPanel({
	kind,
	items,
	intents,
	sourceContext,
	onDeselectAll,
	onRemoveItem,
	matrixGroups,
	canWrite = true,
}: BulkActionsPanelProps) {
	const { t } = useTranslation();
	const actions = useResourceActions({
		kind,
		selectedKeys: new Set(items.map((item) => item.key)),
		intents,
		canWrite,
	});

	// Roster sections: items grouped by their source badge. A source with
	// a single selected member has no grouping value here — its member
	// joins the ungrouped card instead of echoing "name name" in its own
	// frame. Ungrouped leads; sources follow smallest-first, ties by name.
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
		const tail = (s: string) => s.split("/").pop() ?? s;
		const named: { title: string; members: BulkPanelItem[] }[] = [];
		for (const [title, members] of bySource) {
			if (members.length === 1 && members[0]) loose.push(members[0]);
			else named.push({ title, members });
		}
		named.sort(
			(a, b) =>
				a.members.length - b.members.length ||
				tail(a.title).localeCompare(tail(b.title)),
		);
		loose.sort((a, b) => a.label.localeCompare(b.label));
		return [
			...(loose.length > 0
				? [{ title: t("ungrouped"), members: loose }]
				: []),
			...named,
		];
	})();

	return (
		<div className="h-full overflow-y-auto">
			<div className="w-full space-y-4 p-4 sm:p-6">
				<Card>
					<Card.Header className="flex flex-row items-start justify-between gap-3">
						{/* The panel is a selection inspector: the count is the
						 * title, whatever the selection is — a whole-library
						 * selection keeps only its open-in-browser shortcut. */}
						<div className="min-w-0 flex-1">
							<h2 className="truncate text-lg font-semibold text-foreground">
								{t("itemsSelected", { count: items.length })}
							</h2>
						</div>
						<div className="flex items-center gap-2">
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
					</Card.Header>

					<Card.Content className="flex flex-col gap-6">
						{/* Roster: one block per source — a section header in
						 * the detail panels' uppercase voice over a TagGroup
						 * of members. Each tag carries an explicit ×;
						 * react-aria moves focus to a neighbouring tag after
						 * a removal. */}
						<div className="flex flex-col gap-4">
							{rosterSections.map((section) => (
								<section key={section.title}>
									<div className="mb-2 flex items-baseline gap-1.5">
										<h3 className="text-xs font-medium tracking-wider text-muted uppercase">
											{section.title.split("/").pop()}
										</h3>
										<span className="text-xs tabular-nums text-muted/60">
											{section.members.length}
										</span>
									</div>
									<TagGroup
										aria-label={section.title}
										onRemove={(keys) => {
											for (const key of keys)
												onRemoveItem(String(key));
										}}
									>
										<TagGroup.List items={section.members}>
											{(item) => (
												<Tag
													id={item.key}
													textValue={item.label}
												>
													{({ allowsRemoving }) => (
														<>
															<span
																className="max-w-44 truncate"
																title={
																	item.label
																}
															>
																{item.label}
															</span>
															{!!allowsRemoving && (
																<Tag.RemoveButton
																	aria-label={t(
																		"removeFromSelection",
																		{
																			name: item.label,
																		},
																	)}
																/>
															)}
														</>
													)}
												</Tag>
											)}
										</TagGroup.List>
									</TagGroup>
								</section>
							))}
						</div>

						{actions.canWrite && (
							<AgentCoverageMatrix
								kind={kind}
								groups={matrixGroups}
								onManage={actions.requestAddToAgent}
							/>
						)}

						<Card.Footer className="pt-4 border-t border-separator flex flex-wrap gap-3">
							{actions.canWrite && (
								<Button
									variant="secondary"
									onPress={actions.requestTransfer}
								>
									<ACTION_ICONS.transfer className="size-4" />
									{t("transfer")}
								</Button>
							)}
							<Button
								variant="secondary"
								onPress={() => void actions.toggleFavorite()}
							>
								{actions.allStarred ? (
									<ACTION_ICONS.unfavorite className="size-4" />
								) : (
									<ACTION_ICONS.favorite className="size-4 text-warning" />
								)}
								{actions.allStarred
									? t("unfavorite")
									: t("favorite")}
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
									<ACTION_ICONS.createGroup className="size-4" />
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
									<ACTION_ICONS.removeFromGroup className="size-4" />
									{t("removeFromGroup")}
								</Button>
							)}
							{actions.canWrite && (
								<Button
									variant="danger"
									onPress={actions.requestDelete}
								>
									<ACTION_ICONS.delete className="size-4" />
									{t("deleteCount", {
										count: items.length,
									})}
								</Button>
							)}
						</Card.Footer>
					</Card.Content>
				</Card>
			</div>
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
