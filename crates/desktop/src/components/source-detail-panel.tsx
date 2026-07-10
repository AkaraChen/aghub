import {
	BookOpenIcon,
	CheckCircleIcon,
	ChevronRightIcon,
	LinkIcon,
} from "@heroicons/react/24/solid";
import { Button, Spinner, Tooltip } from "@heroui/react";
import githubIcon from "@lobehub/icons-static-svg/icons/github.svg?raw";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useApi } from "../hooks/use-api";
import { cn } from "../lib/utils";
import { skillTreeQueryOptions } from "../requests/skills";
import type { MatrixGroup } from "./agent-coverage-matrix";
import { AgentCoverageMatrix } from "./agent-coverage-matrix";
import { flattenTree, TreeIndent, TreeNodeRow } from "./skill-detail-views";

export interface SourceMember {
	name: string;
	/** The skill's on-disk location, for the structure tree */
	path: string | null;
	description: string | null;
}

interface SourceDetailPanelProps {
	/** The source id, e.g. github/AkaraChen/web-dev */
	title: string;
	url: string | null;
	sourceType: string | null;
	/** Member skills, in list order */
	members: SourceMember[];
	installedAt: string | null;
	updatedAt: string | null;
	/** Per-member agent coverage, for the in-place matrix */
	matrixGroups: MatrixGroup[];
	/** Selects the whole library (opens the batch inspector) */
	onSelectAll: () => void;
	/** Selects one member (jumps to its detail) */
	onSelectMember: (name: string) => void;
}

/**
 * The library page: shown when a source cluster row is clicked. One
 * repository tree — the source as the root, each member skill an
 * expandable branch (click the name to jump to its detail, the chevron
 * to reveal its files) — plus install dates and the agent coverage
 * matrix, with one primary action: select the whole library.
 */
export function SourceDetailPanel({
	title,
	url,
	sourceType,
	members,
	installedAt,
	updatedAt,
	matrixGroups,
	onSelectAll,
	onSelectMember,
}: SourceDetailPanelProps) {
	const { t } = useTranslation();
	const dates = [
		installedAt &&
			t("installedOn", {
				date: new Date(installedAt).toLocaleDateString(),
			}),
		updatedAt &&
			t("updatedOn", {
				date: new Date(updatedAt).toLocaleDateString(),
			}),
	].filter(Boolean);

	return (
		<div className="flex h-full flex-col">
			<header className="flex shrink-0 items-start justify-between gap-3 border-b border-separator p-4">
				<div className="min-w-0 flex-1">
					<h2 className="truncate text-lg font-semibold text-foreground">
						{title}
					</h2>
					<p className="mt-1 text-sm text-muted">
						{t("memberCount", { count: members.length })}
						{dates.length > 0 && ` · ${dates.join(" · ")}`}
					</p>
				</div>
				<div className="flex shrink-0 items-center gap-1">
					<Button variant="secondary" onPress={onSelectAll}>
						<CheckCircleIcon className="size-4" />
						{t("selectAll")}
					</Button>
					{url && (
						<Tooltip delay={0}>
							<Button
								isIconOnly
								variant="ghost"
								size="md"
								className="min-h-[44px] min-w-[44px] text-muted hover:text-foreground"
								aria-label={t("openInBrowser")}
								onPress={() => void openUrl(url)}
							>
								{sourceType === "github" ? (
									<span
										className="inline-flex size-5 shrink-0 items-center [&_svg]:size-full [&_svg]:fill-current"
										// eslint-disable-next-line @eslint-react/dom-no-dangerously-set-innerhtml
										dangerouslySetInnerHTML={{
											__html: githubIcon,
										}}
									/>
								) : (
									<LinkIcon className="size-5" />
								)}
							</Button>
							<Tooltip.Content>
								{t("openInBrowser")}
							</Tooltip.Content>
						</Tooltip>
					)}
				</div>
			</header>

			<div className="flex-1 space-y-4 overflow-y-auto p-4">
				{/* Member skills as top-level branches; files unfold beneath */}
				<div>
					{members.map((member) => (
						<MemberBranch
							key={member.name}
							member={member}
							onSelect={() => onSelectMember(member.name)}
						/>
					))}
				</div>

				<AgentCoverageMatrix kind="skill" groups={matrixGroups} />
			</div>
		</div>
	);
}

function MemberBranch({
	member,
	onSelect,
}: {
	member: SourceMember;
	onSelect: () => void;
}) {
	const { t } = useTranslation();
	const api = useApi();
	const [isOpen, setIsOpen] = useState(false);

	const { data: tree, isLoading } = useQuery({
		...skillTreeQueryOptions({
			api,
			path: member.path ?? undefined,
			enabled: isOpen && Boolean(member.path),
		}),
	});

	return (
		<>
			<div className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-foreground transition-colors duration-[var(--dur-fast)] hover:bg-default/40">
				{member.path ? (
					<button
						type="button"
						aria-label={t("viewStructure", {
							name: member.name,
						})}
						aria-expanded={isOpen}
						onClick={() => setIsOpen((prev) => !prev)}
						className="flex size-4 shrink-0 items-center justify-center rounded text-muted transition-colors hover:text-foreground"
					>
						<ChevronRightIcon
							className={cn(
								"size-3.5 transition-transform duration-[var(--dur-fast)] ease-[var(--ease-out)]",
								isOpen && "rotate-90",
							)}
						/>
					</button>
				) : (
					<span className="size-4 shrink-0" />
				)}
				<BookOpenIcon className="size-4 shrink-0 text-muted" />
				<button
					type="button"
					aria-label={member.name}
					onClick={onSelect}
					className="flex min-w-0 flex-1 items-baseline gap-2 text-left"
				>
					<span className="truncate">{member.name}</span>
					{member.description && (
						<span className="min-w-0 flex-1 truncate text-xs text-muted">
							{member.description}
						</span>
					)}
				</button>
			</div>
			{isOpen &&
				(isLoading ? (
					<div className="flex items-center px-2 py-1">
						<TreeIndent depth={1} />
						<Spinner size="sm" color="current" />
					</div>
				) : tree ? (
					flattenTree(tree).map((node) => (
						<TreeNodeRow key={node.path} node={node} />
					))
				) : null)}
		</>
	);
}
