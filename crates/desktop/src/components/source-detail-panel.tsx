import {
	ArrowPathIcon,
	BookOpenIcon,
	CheckCircleIcon,
	LinkIcon,
} from "@heroicons/react/24/solid";
import { Button, Tooltip } from "@heroui/react";
import githubIcon from "@lobehub/icons-static-svg/icons/github.svg?raw";
import { useTranslation } from "react-i18next";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { MatrixGroup } from "./agent-coverage-matrix";
import { AgentCoverageMatrix } from "./agent-coverage-matrix";

interface SourceMember {
	name: string;
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
	/** Opens the git import panel pre-filled with this source's URL */
	onUpdate: () => void;
}

/**
 * The library page: shown when a source cluster row is clicked. Member
 * skills as a two-up card grid (click a card to jump to its detail),
 * plus install dates and the agent coverage matrix, with one primary
 * action: select the whole library.
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
	onUpdate,
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
				<div className="min-w-0 flex-1 select-text">
					<h2 className="truncate text-lg font-semibold text-foreground">
						{title}
					</h2>
					<p className="mt-1 text-sm text-muted">
						{t("memberCount", { count: members.length })}
						{dates.length > 0 && ` · ${dates.join(" · ")}`}
					</p>
				</div>
				<div className="flex shrink-0 items-center gap-1">
					<Tooltip delay={0}>
						<Button
							isIconOnly
							variant="ghost"
							size="md"
							className="min-h-[44px] min-w-[44px] text-muted hover:text-foreground"
							aria-label={t("updateFromSource")}
							onPress={onUpdate}
						>
							<ArrowPathIcon className="size-5" />
						</Button>
						<Tooltip.Content>
							{t("updateFromSource")}
						</Tooltip.Content>
					</Tooltip>
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
				{/* Member skills as a two-up card grid */}
				<div className="grid grid-cols-2 gap-2">
					{members.map((member) => (
						<button
							key={member.name}
							type="button"
							aria-label={member.name}
							onClick={() => onSelectMember(member.name)}
							className="flex flex-col gap-1 rounded-lg border border-border bg-surface p-3 text-left transition-colors duration-[var(--dur-fast)] hover:bg-foreground/10"
						>
							<span className="flex w-full items-center gap-2 text-sm font-medium text-foreground">
								<BookOpenIcon className="size-4 shrink-0 text-muted" />
								<span className="truncate">{member.name}</span>
							</span>
							{member.description && (
								<span className="line-clamp-2 text-xs text-muted">
									{member.description}
								</span>
							)}
						</button>
					))}
				</div>

				<AgentCoverageMatrix kind="skill" groups={matrixGroups} />
			</div>
		</div>
	);
}
