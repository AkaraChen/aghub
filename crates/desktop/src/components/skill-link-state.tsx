import { ExclamationTriangleIcon } from "@heroicons/react/24/solid";
import { useTranslation } from "react-i18next";
import type {
	SkillLinkResponse,
	SkillLinkStatusResponse,
} from "../generated/dto";
import { cn } from "../lib/utils";
import type { SkillLinkSummary as SkillLinkSummaryData } from "./skill-detail-helpers";

const STATUS_LABELS: Record<SkillLinkStatusResponse, string> = {
	valid: "skillLinkValid",
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
	const hasProblem = link.status !== "valid";

	return (
		<div
			data-skill-link-status={link.status}
			className={cn(
				"grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 text-xs text-muted",
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
			<span
				className={cn(
					"flex shrink-0 items-center gap-1",
					hasProblem && "text-warning",
				)}
			>
				{hasProblem && <ExclamationTriangleIcon className="size-3.5" />}
				{t(STATUS_LABELS[link.status])}
			</span>
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
