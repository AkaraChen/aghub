import { ArrowPathIcon } from "@heroicons/react/24/solid";
import {
	Button,
	Label,
	ListBox,
	Modal,
	Select,
	Spinner,
	toast,
	Tooltip,
} from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { SkillCopyResolutionRequest } from "../generated/dto";
import { auditDisposition } from "../hooks/audited-mutation";
import { useApi } from "../hooks/use-api";
import { useAuditedMutation } from "../hooks/use-audited-mutation";
import { useAuditedSkillRun } from "../hooks/use-audited-skill-run";
import { useSkillAuditPreference } from "../hooks/use-skill-audit-preference";
import { credentialsListQueryOptions } from "../requests/credentials";
import { prepareSkillSourceSyncMutationOptions } from "../requests/skill-source-sync";
import { invalidateSkillQueries } from "../requests/skills";
import { SkillAudit } from "./skill-audit";
import { type SkillGroup, uniqueSkillLocations } from "./skill-detail-helpers";

interface SyncGithubSkillButtonProps {
	group: SkillGroup;
	sourceUrl: string;
	reference: string | null;
	skillPath: string | null;
	projectPath?: string;
}

export function SyncGithubSkillButton({
	group,
	sourceUrl,
	reference,
	skillPath,
	projectPath,
}: SyncGithubSkillButtonProps) {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();
	const { skillAuditEnabled, skillAuditReady } = useSkillAuditPreference();
	const { beginAuditedSkillRun, invalidateAuditedSkillRun } =
		useAuditedSkillRun();
	const [recoveryOpen, setRecoveryOpen] = useState(false);
	const [credentialId, setCredentialId] = useState<string | null>(null);
	const { data: credentials = [] } = useQuery(
		credentialsListQueryOptions({ api, enabled: recoveryOpen }),
	);
	const preparation = useMutation(
		prepareSkillSourceSyncMutationOptions({ api, t }),
	);
	const sync = useAuditedMutation<SkillCopyResolutionRequest, true>({
		audit: async (candidate, signal) => {
			const response = await api.skills.resolveCopies(
				{
					...candidate,
					audit_only: true,
					expected_content_digest: null,
					confirmed_assessment_digest: null,
				},
				signal,
			);
			if (!response.audit) throw new Error(t("auditFailed"));
			return auditDisposition(
				response.audit,
				null,
				response.audit_confirmation_required,
			);
		},
		write: async (
			{ candidate, report, confirmedAssessmentDigest },
			signal,
		) => {
			const response = await api.skills.resolveCopies(
				{
					...candidate,
					audit_only: false,
					expected_content_digest: report?.content_digest ?? null,
					confirmed_assessment_digest: confirmedAssessmentDigest,
				},
				signal,
			);
			const sessionId =
				candidate.reference.kind === "git_scan"
					? candidate.reference.session_id
					: null;
			if (
				response.results.length === 0 &&
				response.audit_confirmation_required &&
				response.audit
			) {
				const disposition = auditDisposition(
					response.audit,
					sessionId,
					true,
				);
				if (disposition.kind !== "review")
					throw new Error(t("auditFailed"));
				return disposition;
			}
			// Never report a partial or empty result as a completed sync.
			if (response.results.length !== candidate.targets.length)
				throw new Error(t("skillComparisonUnavailable"));
			await invalidateSkillQueries(queryClient, sessionId ?? undefined);
			toast.success(t("skillSyncedSuccessfully"));
			return {
				kind: "done",
				result: true,
				report: response.audit ?? report,
				sessionId,
			};
		},
		onFailure: (error) =>
			toast.danger(
				t("skillSyncFailed", {
					error:
						error instanceof Error ? error.message : String(error),
				}),
			),
	});
	const paths = uniqueSkillLocations(group.items).map(
		(location) => location.sourcePath,
	);
	const busy = preparation.isPending || sync.isBusy;
	const report =
		sync.state.tag === "review" || sync.state.tag === "writing"
			? sync.state.report
			: null;
	const reviewOpen =
		sync.state.tag === "review" ||
		(report?.confirmation_required === true &&
			sync.state.tag === "writing");

	const handleSync = async () => {
		if (!skillAuditReady || busy) return;
		const run = beginAuditedSkillRun(null);
		sync.reset();
		let candidate: SkillCopyResolutionRequest;
		try {
			candidate = await preparation.mutateAsync({
				url: sourceUrl,
				reference,
				name: group.name,
				skillPath,
				credentialId,
				paths,
				scope:
					projectPath &&
					group.items.some((item) => item.source === "project")
						? "all"
						: "global",
				projectRoot: projectPath ?? null,
				skipAudit: !skillAuditEnabled,
			});
		} catch (error) {
			if (!run.isCurrent()) return;
			toast.danger(
				t("skillSyncFailed", {
					error:
						error instanceof Error ? error.message : String(error),
				}),
			);
			setRecoveryOpen(true);
			return;
		}
		if (!run.isCurrent()) return;
		setRecoveryOpen(false);
		await sync.start(
			candidate,
			skillAuditEnabled
				? undefined
				: { kind: "allow", report: null, sessionId: null },
		);
	};
	const handleClose = () => {
		if (busy) return;
		invalidateAuditedSkillRun();
		setRecoveryOpen(false);
		sync.reset();
	};

	return (
		<>
			<Tooltip delay={0}>
				<Button
					isIconOnly
					variant="ghost"
					size="sm"
					className="size-8 text-muted"
					aria-label={t("syncFromSource")}
					isDisabled={
						!skillAuditReady ||
						paths.length === 0 ||
						recoveryOpen ||
						reviewOpen
					}
					isPending={busy}
					onPress={() => void handleSync()}
				>
					{({ isPending }) =>
						isPending ? (
							<Spinner size="sm" color="current" />
						) : (
							<ArrowPathIcon className="size-4" />
						)
					}
				</Button>
				<Tooltip.Content>{t("syncFromSource")}</Tooltip.Content>
			</Tooltip>
			<Modal.Backdrop
				isOpen={recoveryOpen || reviewOpen}
				isDismissable={!busy}
				isKeyboardDismissDisabled={busy}
				onOpenChange={(open) => {
					if (!open) handleClose();
				}}
			>
				<Modal.Container size="lg">
					<Modal.Dialog>
						<Modal.CloseTrigger isDisabled={busy} />
						<Modal.Header>
							<Modal.Heading>{t("syncSkill")}</Modal.Heading>
						</Modal.Header>
						<Modal.Body>
							{report ? (
								<SkillAudit report={report} embedded />
							) : (
								<div className="space-y-3">
									<p className="break-all text-sm text-muted">
										{sourceUrl}
									</p>
									<p className="text-sm text-muted">
										{t("skillSyncCredentialHint")}
									</p>
									<Select
										selectedKey={credentialId}
										onSelectionChange={(key) =>
											setCredentialId(
												key === null
													? null
													: String(key),
											)
										}
										isDisabled={busy}
									>
										<Label>{t("credentials")}</Label>
										<Select.Trigger>
											<Select.Value />
											<Select.Indicator />
										</Select.Trigger>
										<Select.Popover>
											<ListBox items={credentials}>
												{(credential) => (
													<ListBox.Item
														id={credential.id}
														textValue={
															credential.name
														}
													>
														{credential.name}
													</ListBox.Item>
												)}
											</ListBox>
										</Select.Popover>
									</Select>
								</div>
							)}
						</Modal.Body>
						<Modal.Footer>
							<Button
								variant="secondary"
								isDisabled={busy}
								onPress={handleClose}
							>
								{t("cancel")}
							</Button>
							<Button
								variant={report ? "danger" : "primary"}
								isPending={busy}
								onPress={() => {
									if (report) {
										void sync.confirm();
									} else {
										void handleSync();
									}
								}}
							>
								{t(report ? "syncAnyway" : "syncFromSource")}
							</Button>
						</Modal.Footer>
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</>
	);
}
