import { EyeSlashIcon } from "@heroicons/react/24/solid";
import { Button, Card, Switch, toast } from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useAuditAcknowledgements } from "../../hooks/use-audit-acknowledgements";
import {
	setSkillAuditPreferenceMutationOptions,
	skillAuditPreferenceQueryOptions,
} from "../../requests/preferences";

export default function SecurityPanel() {
	const { t } = useTranslation();
	const queryClient = useQueryClient();
	const { acknowledgedAssessments, setAssessmentAcknowledged } =
		useAuditAcknowledgements();
	const { data: skillAuditEnabled = true, isPending: isAuditPending } =
		useQuery(skillAuditPreferenceQueryOptions());
	const preferenceMutation = useMutation({
		...setSkillAuditPreferenceMutationOptions(queryClient, (enabled) => {
			toast.success(
				enabled ? t("skillAuditEnabled") : t("skillAuditDisabled"),
			);
		}),
		onError: () => toast.danger(t("skillAuditPreferenceError")),
	});
	const assessments = [...acknowledgedAssessments].sort(
		(a, b) =>
			a.name.localeCompare(b.name) ||
			a.assessment_digest.localeCompare(b.assessment_digest),
	);
	const restoreWarning = (name: string, assessmentDigest: string) => {
		void setAssessmentAcknowledged(name, assessmentDigest, false).catch(
			() => toast.danger(t("auditAcknowledgementError")),
		);
	};

	return (
		<Card>
			<Card.Content className="space-y-4 p-4">
				<div className="flex items-center justify-between gap-4">
					<div className="space-y-1">
						<h3 className="text-sm font-medium text-foreground">
							{t("automaticSkillAudit")}
						</h3>
						<p className="text-xs text-muted">
							{t("automaticSkillAuditDescription")}
						</p>
					</div>
					<Switch
						aria-label={t("automaticSkillAudit")}
						isDisabled={
							isAuditPending || preferenceMutation.isPending
						}
						isSelected={skillAuditEnabled}
						onChange={(checked) =>
							preferenceMutation.mutate(checked)
						}
					>
						<Switch.Content>
							<Switch.Control>
								<Switch.Thumb />
							</Switch.Control>
						</Switch.Content>
					</Switch>
				</div>

				{skillAuditEnabled && (
					<div className="space-y-1 border-t border-separator pt-4">
						<h3 className="text-sm font-medium text-foreground">
							{t("acknowledgedAudits")}
						</h3>
						<p className="text-xs text-muted">
							{t("acknowledgedAuditsDescription")}
						</p>
					</div>
				)}

				{skillAuditEnabled && assessments.length === 0 ? (
					<p className="py-6 text-center text-sm text-muted">
						{t("noAcknowledgedAudits")}
					</p>
				) : skillAuditEnabled ? (
					<ul className="space-y-2">
						{assessments.map((assessment) => (
							<li
								key={`${assessment.name}:${assessment.assessment_digest}`}
								className="flex items-center justify-between gap-3 rounded-lg border border-separator px-3 py-2"
							>
								<span className="flex min-w-0 items-center gap-2 text-sm text-foreground">
									<EyeSlashIcon
										aria-hidden
										className="size-4 shrink-0 text-muted"
									/>
									<span className="truncate">
										{assessment.name}
									</span>
								</span>
								<Button
									variant="ghost"
									size="sm"
									onPress={() =>
										restoreWarning(
											assessment.name,
											assessment.assessment_digest,
										)
									}
								>
									{t("restoreAuditWarning")}
								</Button>
							</li>
						))}
					</ul>
				) : null}
			</Card.Content>
		</Card>
	);
}
