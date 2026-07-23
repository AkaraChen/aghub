import { ShieldCheckIcon } from "@heroicons/react/24/solid";
import { Button, Card, Switch, toast } from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useTrustedSkills } from "../../hooks/use-trusted-skills";
import {
	setSkillAuditPreferenceMutationOptions,
	skillAuditPreferenceQueryOptions,
} from "../../requests/preferences";

export default function SecurityPanel() {
	const { t } = useTranslation();
	const queryClient = useQueryClient();
	const { trustedSkills, setSkillTrusted } = useTrustedSkills();
	const { data: skillAuditEnabled = true, isPending } = useQuery(
		skillAuditPreferenceQueryOptions(),
	);
	const preferenceMutation = useMutation({
		...setSkillAuditPreferenceMutationOptions(queryClient, (enabled) => {
			toast.success(
				enabled ? t("skillAuditEnabled") : t("skillAuditDisabled"),
			);
		}),
		onError: () => toast.danger(t("skillAuditPreferenceError")),
	});
	const skills = [...trustedSkills].sort(
		(a, b) =>
			a.name.localeCompare(b.name) ||
			a.assessment_digest.localeCompare(b.assessment_digest),
	);

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
						isDisabled={isPending || preferenceMutation.isPending}
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
							{t("trustedSkills")}
						</h3>
						<p className="text-xs text-muted">
							{t("trustedSkillsDescription")}
						</p>
					</div>
				)}

				{skillAuditEnabled && skills.length === 0 ? (
					<p className="py-6 text-center text-sm text-muted">
						{t("noTrustedSkills")}
					</p>
				) : skillAuditEnabled ? (
					<ul className="space-y-2">
						{skills.map((skill) => (
							<li
								key={`${skill.name}:${skill.assessment_digest}`}
								className="flex items-center justify-between gap-3 rounded-lg border border-separator px-3 py-2"
							>
								<span className="flex min-w-0 items-center gap-2 text-sm text-foreground">
									<ShieldCheckIcon
										aria-hidden
										className="size-4 shrink-0 text-success"
									/>
									<span className="truncate">
										{skill.name}
									</span>
								</span>
								<Button
									variant="ghost"
									size="sm"
									onPress={() =>
										setSkillTrusted(
											skill.name,
											skill.assessment_digest,
											false,
										)
									}
								>
									{t("untrustSkill")}
								</Button>
							</li>
						))}
					</ul>
				) : null}
			</Card.Content>
		</Card>
	);
}
