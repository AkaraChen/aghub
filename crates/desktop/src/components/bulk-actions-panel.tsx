import { LinkIcon, XMarkIcon } from "@heroicons/react/24/solid";
import { Button, Dropdown, Tooltip } from "@heroui/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useRef } from "react";
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
	// Removing a pill unmounts the focused button; refocus its neighbour
	// so keyboard users can keep removing without re-tabbing in.
	const rosterRef = useRef<HTMLDivElement>(null);
	const pendingFocusRef = useRef<number | null>(null);
	useEffect(() => {
		const index = pendingFocusRef.current;
		if (index === null) return;
		pendingFocusRef.current = null;
		const pills =
			rosterRef.current?.querySelectorAll<HTMLButtonElement>(
				"[data-roster-pill]",
			);
		if (!pills || pills.length === 0) return;
		pills[Math.min(index, pills.length - 1)]?.focus();
	}, [items]);
	const removeAndRefocus = (key: string, target: HTMLElement) => {
		const pills = rosterRef.current?.querySelectorAll("[data-roster-pill]");
		if (pills) {
			pendingFocusRef.current = Array.prototype.indexOf.call(
				pills,
				target,
			);
		}
		onRemoveItem(key);
	};
	const actions = useResourceActions({
		kind,
		selectedKeys: new Set(items.map((item) => item.key)),
		intents,
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
		<div className="flex h-full flex-col">
			<header className="flex shrink-0 items-center justify-between gap-3 border-b border-separator px-4 py-3">
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

			<div className="flex-1 space-y-4 overflow-y-auto px-4 pt-3 pb-4">
				{/* Roster: one card per source (the Card surface, floating on
				 * the shell), members as accent pills. A pill is one button —
				 * clicking it drops the item from the selection, and it turns
				 * danger-tinted on hover to say so. */}
				<div
					ref={rosterRef}
					className="flex flex-wrap items-center gap-x-2 gap-y-1.5"
				>
					{rosterSections.map((section) => {
						const only =
							section.members.length === 1
								? section.members[0]
								: undefined;
						// A lone member collapses into one clickable chip —
						// group name as its prefix, no card-in-card framing
						if (only) {
							return (
								<button
									key={section.title}
									type="button"
									aria-label={t("removeFromSelection", {
										name: only.label,
									})}
									onClick={(event) =>
										removeAndRefocus(
											only.key,
											event.currentTarget,
										)
									}
									data-roster-pill
									className="group flex max-w-full items-center gap-1.5 rounded-lg border border-border bg-surface py-1.5 pr-1.5 pl-2.5 transition-colors duration-[var(--dur-fast)]"
								>
									<span className="shrink-0 text-[10px] font-medium text-muted">
										{section.title.split("/").pop()}
									</span>
									<span
										className="min-w-0 truncate rounded-full bg-accent/10 px-2 py-0.5 text-sm text-accent transition-colors duration-[var(--dur-fast)] group-hover:bg-danger/10 group-hover:text-danger"
										title={only.label}
									>
										{only.label}
									</span>
								</button>
							);
						}
						return (
							<div
								key={section.title}
								className="flex max-w-full grow flex-wrap items-center gap-x-1 gap-y-1 rounded-lg border border-border bg-surface py-1.5 pr-1.5 pl-2.5"
							>
								<span className="mr-1 text-[10px] font-medium text-muted">
									{section.title.split("/").pop()}
								</span>
								<span className="mr-0.5 text-[10px] tabular-nums text-muted/60">
									{section.members.length}
								</span>
								{section.members.map((item) => (
									<button
										key={item.key}
										type="button"
										aria-label={t("removeFromSelection", {
											name: item.label,
										})}
										onClick={(event) =>
											removeAndRefocus(
												item.key,
												event.currentTarget,
											)
										}
										data-roster-pill
										className="max-w-full min-w-0 truncate rounded-full bg-accent/10 px-2 py-0.5 text-left text-sm text-accent transition-colors duration-[var(--dur-fast)] hover:bg-danger/10 hover:text-danger"
										title={item.label}
									>
										{item.label}
									</button>
								))}
							</div>
						);
					})}
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
