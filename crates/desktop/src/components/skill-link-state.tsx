import { ExclamationTriangleIcon } from "@heroicons/react/24/solid";
import { useTranslation } from "react-i18next";
import type {
	SkillLinkResponse,
	SkillLinkStatusResponse,
} from "../generated/dto";
import { cn } from "../lib/utils";
import type { SkillLinkSummary as SkillLinkSummaryData } from "./skill-detail-helpers";

const STATUS_LABELS: Record<SkillLinkStatusResponse, string | null> = {
	valid: null,
	broken: "skillLinkBroken",
	outside_root: "skillLinkOutsideRoot",
	unreadable: "skillLinkUnreadable",
};

export function SkillLinkState({
	link,
	className,
}: {
	link: SkillLinkResponse;
	className?: string;
}) {
	const { t } = useTranslation();
	const statusLabel = STATUS_LABELS[link.status];
	const hasProblem = statusLabel !== null;

	return (
		<div
			data-skill-link-status={link.status}
			className={cn(
				"min-w-0 text-xs text-muted",
				hasProblem &&
					"grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3",
				className,
			)}
		>
			{link.target ? (
				<code
					className="min-w-0 truncate text-left"
					title={link.target}
				>
					{link.target}
				</code>
			) : (
				<span />
			)}
			{statusLabel && (
				<span className="flex shrink-0 items-center gap-1 text-warning">
					<ExclamationTriangleIcon className="size-3.5" />
					{t(statusLabel)}
				</span>
			)}
		</div>
	);
}

export function SkillLinkSummary({
	summary,
	className,
}: {
	summary: SkillLinkSummaryData;
	className?: string;
}) {
	const { t } = useTranslation();
	if (summary.problems === 0) return null;

	return (
		<div
			data-skill-link-summary="problem"
			className={cn(
				"flex min-w-0 items-center gap-1.5 text-xs text-muted",
				className,
			)}
		>
			<ExclamationTriangleIcon className="size-3.5 shrink-0 text-warning" />
			<span>{t("skillFileLinkCount", { count: summary.total })}</span>
			<span aria-hidden="true">·</span>
			<span className="text-warning">
				{t("skillLinkNeedsAttention", {
					count: summary.problems,
				})}
			</span>
		</div>
	);
}
