import {
	CodeBracketIcon,
	DocumentIcon,
	ExclamationTriangleIcon,
	FolderIcon,
	LinkIcon,
	TrashIcon,
} from "@heroicons/react/24/solid";
import { Button, Tooltip } from "@heroui/react";
import * as pathe from "pathe";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { SkillTreeNodeResponse } from "../generated/dto";
import { cn } from "../lib/utils";
import {
	formatAgentName,
	getNodeChildren,
	type LocationGroup,
	summarizeSkillLinks,
} from "./skill-detail-helpers";
import { SkillLinkState, SkillLinkSummary } from "./skill-link-state";

export function SkillTree({ root }: { root: SkillTreeNodeResponse }) {
	const items = flattenTree(root);

	return (
		<div
			data-skill-tree
			role="list"
			className="divide-y divide-separator/60"
		>
			{items.map((node) => (
				<TreeNodeRow key={node.path} node={node} />
			))}
		</div>
	);
}

export function LocationRow({
	group,
	tree,
	treeUnavailable = false,
	onDelete,
	onOpenFolder,
	onEditFolder,
	editorAvailable,
}: {
	group: LocationGroup;
	tree?: SkillTreeNodeResponse;
	treeUnavailable?: boolean;
	onDelete: () => void;
	onOpenFolder: () => void;
	onEditFolder: () => void;
	editorAvailable: boolean;
}) {
	const { t } = useTranslation();
	const folderPath = useMemo(
		() => pathe.dirname(group.sourcePath),
		[group.sourcePath],
	);
	const linkSummary = useMemo(
		() => (tree ? summarizeSkillLinks(tree) : null),
		[tree],
	);
	const hasStorageStatus = group.isSymlink;
	const hasFileLinkStatus = Boolean(
		treeUnavailable || (linkSummary && linkSummary.total > 0),
	);

	return (
		<div
			data-skill-location={group.sourcePath}
			className="rounded-lg bg-surface-secondary px-3 py-2.5"
		>
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0 flex-1">
					<p
						tabIndex={0}
						className="cursor-default break-all rounded-sm font-mono text-xs text-foreground focus:ring-2 focus:ring-offset-2 focus:outline-none"
						title={group.sourcePath}
					>
						{folderPath}
					</p>
					<p className="mt-0.5 text-[11px] text-muted">
						{Array.from(
							new Set(
								group.installations.map((installation) =>
									formatAgentName(installation.agent),
								),
							),
						).join(", ")}
					</p>
				</div>
				<div className="flex shrink-0 items-center gap-1">
					<Tooltip delay={0}>
						<Button
							isIconOnly
							variant="ghost"
							size="sm"
							className="size-8 text-muted hover:text-danger"
							aria-label={t("delete")}
							onPress={onDelete}
						>
							<TrashIcon className="size-4" />
						</Button>
						<Tooltip.Content>{t("delete")}</Tooltip.Content>
					</Tooltip>
					<Tooltip delay={0}>
						<Button
							isIconOnly
							variant="ghost"
							size="sm"
							className="size-8 text-muted"
							aria-label={t("editInEditor")}
							isDisabled={!editorAvailable}
							onPress={onEditFolder}
						>
							<CodeBracketIcon className="size-4" />
						</Button>
						<Tooltip.Content>{t("editInEditor")}</Tooltip.Content>
					</Tooltip>
					<Tooltip delay={0}>
						<Button
							isIconOnly
							variant="ghost"
							size="sm"
							className="size-8 text-muted"
							aria-label={t("openFolder")}
							onPress={onOpenFolder}
						>
							<FolderIcon className="size-4" />
						</Button>
						<Tooltip.Content>{t("openFolder")}</Tooltip.Content>
					</Tooltip>
				</div>
			</div>
			{(hasStorageStatus || hasFileLinkStatus) && (
				<div className="mt-2 space-y-1.5 border-t border-separator/60 pt-2">
					{group.isSymlink && (
						<div
							data-skill-location-link="valid"
							className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-1.5 text-xs text-muted"
						>
							<LinkIcon className="size-3.5" />
							<span>{t("symlink")}</span>
							<span>{t("skillLinkValid")}</span>
						</div>
					)}
					{treeUnavailable ? (
						<div
							role="alert"
							data-skill-link-summary="unavailable"
							className="flex items-center gap-1.5 text-xs text-muted"
						>
							<ExclamationTriangleIcon className="size-3.5 shrink-0 text-warning" />
							<span className="text-foreground">
								{t("skillFilesUnavailable")}
							</span>
							<span aria-hidden="true">·</span>
							<span>{t("skillFilesUnavailableDescription")}</span>
						</div>
					) : (
						linkSummary && (
							<SkillLinkSummary summary={linkSummary} />
						)
					)}
				</div>
			)}
		</div>
	);
}

function flattenTree(
	root: SkillTreeNodeResponse,
): Array<SkillTreeNodeResponse & { depth?: number }> {
	const items: Array<SkillTreeNodeResponse & { depth?: number }> = [];

	function visit(node: SkillTreeNodeResponse, depth: number): void {
		for (const child of getNodeChildren(node)) {
			items.push({ ...child, depth });
			visit(child, depth + 1);
		}
	}

	visit(root, 0);

	return items;
}

function TreeNodeRow({
	node,
}: {
	node: SkillTreeNodeResponse & { depth?: number };
}) {
	const link = node.link;

	return (
		<div
			role="listitem"
			className="flex w-full items-stretch text-sm text-foreground"
			title={node.path}
		>
			<TreeIndent depth={node.depth ?? 0} />
			<div className="flex min-w-0 flex-1 items-start gap-2 py-2">
				{node.kind === "directory" ? (
					<FolderIcon className="mt-0.5 size-4 shrink-0 text-accent" />
				) : node.kind === "symlink" ? (
					<LinkIcon
						className={cn(
							"mt-0.5 size-4 shrink-0",
							link?.status === "valid"
								? "text-muted"
								: "text-warning",
						)}
					/>
				) : (
					<DocumentIcon className="mt-0.5 size-4 shrink-0 text-muted" />
				)}
				<div className="min-w-0 flex-1">
					<span className="block truncate">{node.name}</span>
					{link && <SkillLinkState link={link} />}
				</div>
			</div>
		</div>
	);
}

/** Indent guides: one hairline per depth level, running the row's full
 * height so consecutive rows read as connected branches. */
function TreeIndent({ depth }: { depth: number }) {
	if (depth <= 0) return null;
	return (
		<>
			{Array.from({ length: depth }, (_, level) => (
				<span
					key={level}
					className="ml-[7px] mr-2 w-px shrink-0 self-stretch bg-separator"
				/>
			))}
		</>
	);
}
