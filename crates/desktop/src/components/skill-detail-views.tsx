import {
	CodeBracketIcon,
	DocumentIcon,
	FolderIcon,
	LinkIcon,
	TrashIcon,
} from "@heroicons/react/24/solid";
import { Button, Tooltip } from "@heroui/react";
import * as pathe from "pathe";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { SkillTreeNodeResponse } from "../generated/dto/SkillTreeNodeResponse";
import {
	formatAgentName,
	getNodeChildren,
	type LocationGroup,
} from "./skill-detail-helpers";

export function SkillTree({ root }: { root: SkillTreeNodeResponse }) {
	const items = flattenTree(root);

	return (
		<div className="rounded-xl border border-separator/60 bg-surface-secondary/60 p-2">
			{items.map((node) => (
				<TreeNodeRow key={node.path} node={node} />
			))}
		</div>
	);
}

export function LocationRow({
	group,
	onDelete,
	onOpenFolder,
	onEditFolder,
}: {
	group: LocationGroup;
	onDelete: () => void;
	onOpenFolder: () => void;
	onEditFolder: () => void;
}) {
	const { t } = useTranslation();
	const folderPath = useMemo(
		() => pathe.dirname(group.sourcePath),
		[group.sourcePath],
	);

	return (
		<div className="flex items-center justify-between gap-3 rounded-lg bg-surface-secondary px-3 py-2">
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-2">
					<p
						tabIndex={0}
						className="cursor-default break-all rounded-sm font-mono text-xs text-foreground focus:ring-2 focus:ring-offset-2 focus:outline-none"
						title={group.sourcePath}
					>
						{folderPath}
					</p>
					{group.canonicalPath && (
						<Tooltip delay={0}>
							<Button
								isIconOnly
								variant="ghost"
								size="sm"
								className="size-6 text-muted"
								aria-label={t("symlink")}
							>
								<LinkIcon className="size-3" />
							</Button>
							<Tooltip.Content>
								<div className="max-w-[80vw]">
									<p className="mb-1 font-medium">
										{t("symlink")}
									</p>
									<p className="font-mono text-xs">
										{pathe.dirname(group.canonicalPath)}
									</p>
								</div>
							</Tooltip.Content>
						</Tooltip>
					)}
				</div>
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

	visit(root, 1);

	return items;
}

function TreeNodeRow({
	node,
}: {
	node: SkillTreeNodeResponse & { depth?: number };
}) {
	return (
		<div
			className="
				flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm
				text-foreground
			"
			style={{ paddingLeft: `${(node.depth ?? 0) * 16 + 8}px` }}
			title={node.path}
		>
			{node.kind === "directory" ? (
				<FolderIcon className="size-4 shrink-0 text-accent" />
			) : (
				<DocumentIcon className="size-4 shrink-0 text-muted" />
			)}
			<span className="min-w-0 flex-1 truncate">{node.name}</span>
		</div>
	);
}
