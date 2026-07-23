import { ShieldCheckIcon } from "@heroicons/react/24/solid";
import { Card, Chip, Disclosure } from "@heroui/react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type {
	AuditReportDto,
	CategoryDto,
	SeverityDto,
	VerdictDto,
} from "../generated/dto";
import { cn } from "../lib/utils";

type ChipColor = "success" | "warning" | "danger" | "default";

const VERDICT_COLOR: Record<VerdictDto, ChipColor> = {
	benign: "success",
	suspicious: "warning",
	malicious: "danger",
};

const VERDICT_LABEL_KEY: Record<VerdictDto, string> = {
	benign: "auditVerdictBenign",
	suspicious: "auditVerdictSuspicious",
	malicious: "auditVerdictMalicious",
};

const VERDICT_SUMMARY_KEY: Record<VerdictDto, string> = {
	benign: "auditSummaryBenign",
	suspicious: "auditSummarySuspicious",
	malicious: "auditSummaryMalicious",
};

const SEVERITY_COLOR: Record<SeverityDto, ChipColor> = {
	info: "default",
	low: "default",
	medium: "warning",
	high: "danger",
	critical: "danger",
};

const SEVERITY_RANK: Record<SeverityDto, number> = {
	critical: 4,
	high: 3,
	medium: 2,
	low: 1,
	info: 0,
};

const SEVERITY_LABEL_KEY: Record<SeverityDto, string> = {
	info: "auditSeverityInfo",
	low: "auditSeverityLow",
	medium: "auditSeverityMedium",
	high: "auditSeverityHigh",
	critical: "auditSeverityCritical",
};

const CATEGORY_LABEL_KEY: Record<CategoryDto, string> = {
	credential_exfil: "auditCategoryCredentialExfil",
	data_exfil: "auditCategoryDataExfil",
	command_injection: "auditCategoryCommandInjection",
	prompt_injection: "auditCategoryPromptInjection",
	tool_chaining: "auditCategoryToolChaining",
	persistence: "auditCategoryPersistence",
	host_tamper: "auditCategoryHostTamper",
	obfuscation: "auditCategoryObfuscation",
	other: "auditCategoryOther",
};

const VERDICT_SUMMARY_INSTALLED_KEY: Record<VerdictDto, string> = {
	benign: "auditSummaryBenign",
	suspicious: "auditSummarySuspiciousInstalled",
	malicious: "auditSummaryMaliciousInstalled",
};

interface SkillAuditProps {
	report: AuditReportDto;
	className?: string;
	embedded?: boolean;
	/** Use present-tense summaries for an installed skill. */
	installed?: boolean;
}

export function SkillAudit({
	report,
	className,
	embedded,
	installed,
}: SkillAuditProps) {
	const { t } = useTranslation();
	const findingCount = report.findings.length;
	const hasFindings = findingCount > 0;
	const reportIdentity = report.assessment_digest;
	const [expansion, setExpansion] = useState({
		reportIdentity,
		isExpanded: report.verdict !== "benign",
	});
	const expanded =
		expansion.reportIdentity === reportIdentity
			? expansion.isExpanded
			: report.verdict !== "benign";

	const sortedFindings = [...report.findings].sort(
		(a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity],
	);
	const summaryKey = installed
		? VERDICT_SUMMARY_INSTALLED_KEY[report.verdict]
		: VERDICT_SUMMARY_KEY[report.verdict];
	const summary = (
		<>
			<ShieldCheckIcon
				className="size-4 shrink-0 text-muted"
				aria-hidden
			/>
			<Chip
				color={VERDICT_COLOR[report.verdict]}
				variant="soft"
				size="sm"
			>
				{t(VERDICT_LABEL_KEY[report.verdict])}
			</Chip>
			<span className="min-w-0 flex-1 truncate text-sm text-muted">
				{t(summaryKey)}
			</span>
			{hasFindings && (
				<span className="shrink-0 text-xs tabular-nums text-muted">
					{t("auditFindingCount", { count: findingCount })}
				</span>
			)}
		</>
	);

	return (
		<Card
			variant={embedded ? "transparent" : "secondary"}
			className={cn(embedded && "p-0", className)}
		>
			<Card.Content className="space-y-3">
				{hasFindings ? (
					<Disclosure
						isExpanded={expanded}
						onExpandedChange={(isExpanded) =>
							setExpansion({ reportIdentity, isExpanded })
						}
					>
						<Disclosure.Heading>
							<Disclosure.Trigger className="flex w-full items-center gap-2 text-left">
								{summary}
								<Disclosure.Indicator className="text-muted" />
							</Disclosure.Trigger>
						</Disclosure.Heading>
						<Disclosure.Content>
							<ul className="space-y-2.5 border-t border-separator pt-3">
								{sortedFindings.map((f) => (
									<li
										key={`${f.rule_id}:${f.file}:${f.line ?? 0}`}
										className="flex items-start gap-2.5"
									>
										<Chip
											color={SEVERITY_COLOR[f.severity]}
											variant="soft"
											size="sm"
											className="mt-0.5 shrink-0"
										>
											{t(SEVERITY_LABEL_KEY[f.severity])}
										</Chip>
										<div className="min-w-0 flex-1 space-y-0.5">
											<p className="text-sm text-foreground">
												{t(
													`auditEvidence_${f.rule_id}`,
													{
														defaultValue:
															f.evidence,
													},
												)}
											</p>
											<p className="text-[11px] text-muted">
												{t(
													CATEGORY_LABEL_KEY[
														f.category
													],
												)}
												{" · "}
												<span className="font-mono">
													{f.file}
													{f.line != null
														? `:${f.line}`
														: ""}
												</span>
											</p>
										</div>
									</li>
								))}
							</ul>
						</Disclosure.Content>
					</Disclosure>
				) : (
					<div className="flex w-full items-center gap-2">
						{summary}
					</div>
				)}
			</Card.Content>
		</Card>
	);
}

interface SkillAuditBadgeProps {
	report: AuditReportDto;
}

export function SkillAuditBadge({ report }: SkillAuditBadgeProps) {
	const { t } = useTranslation();
	const verdict = report.verdict;
	return (
		<Chip
			aria-label={`${t(VERDICT_LABEL_KEY[verdict])} · ${t(
				VERDICT_SUMMARY_KEY[verdict],
			)}`}
			color={VERDICT_COLOR[verdict]}
			variant="soft"
			size="sm"
		>
			<span className="inline-flex items-center gap-1">
				<ShieldCheckIcon className="size-3.5 shrink-0" aria-hidden />
				{t(VERDICT_LABEL_KEY[verdict])}
			</span>
		</Chip>
	);
}
