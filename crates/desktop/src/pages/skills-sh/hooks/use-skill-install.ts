import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { InstallSkillRequest, MarketSkill } from "../../../generated/dto";
import { auditDisposition } from "../../../hooks/audited-mutation";
import { useAgentAvailability } from "../../../hooks/use-agent-availability";
import { useApi } from "../../../hooks/use-api";
import { useAuditedMutation } from "../../../hooks/use-audited-mutation";
import { useInstallTarget } from "../../../hooks/use-install-target";
import { useSkillAuditPreference } from "../../../hooks/use-skill-audit-preference";
import { supportsIndividualSkillTarget } from "../../../lib/agent-capabilities";
import {
	buildPendingResults,
	type InstallResult,
} from "../../../lib/install-utils";
import { invalidateSkillQueries } from "../../../requests/skills";
import { capture, captureException } from "../../../lib/analytics";

export type InstallPhase =
	"picker" | "auditing" | "review" | "installing" | "done";

interface SkillInstallCandidate {
	readonly skill: Pick<MarketSkill, "name" | "source">;
	readonly agents: readonly string[];
	readonly installAll: boolean;
	readonly scope: "global" | "project";
	readonly projectPath: string | null;
	readonly pendingResults: readonly InstallResult[];
}

export function useSkillInstall() {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();
	const { availableAgents } = useAgentAvailability();
	const { skillAuditEnabled, skillAuditReady } = useSkillAuditPreference();
	const {
		projects,
		installToProject,
		setInstallToProject,
		selectedProjectId,
		selectedProject,
		canInstallToProject,
		setSelectedProjectId,
		resetInstallTarget,
	} = useInstallTarget();
	const [installModalOpen, setInstallModalOpen] = useState(false);
	const [selectedSkill, setSelectedSkill] = useState<MarketSkill | null>(
		null,
	);
	const [selectedAgents, setSelectedAgents] = useState<Set<string>>(
		() => new Set(["universal"]),
	);
	const [installAll, setInstallAll] = useState(false);

	const skillAgents = availableAgents.filter(
		(a) =>
			a.isConfigurable &&
			supportsIndividualSkillTarget(
				a,
				installToProject ? "project" : "global",
			),
	);

	const buildRequest = (
		candidate: SkillInstallCandidate,
		overrides: Partial<InstallSkillRequest>,
	): InstallSkillRequest => ({
		source: candidate.skill.source,
		agents: [...candidate.agents],
		skills: candidate.installAll ? [] : [candidate.skill.name],
		scope: candidate.scope,
		project_path: candidate.projectPath,
		install_all: candidate.installAll,
		expected_content_digest: null,
		confirmed_assessment_digest: null,
		session_id: null,
		audit_only: false,
		...overrides,
	});

	const errorResults = (candidate: SkillInstallCandidate, err: unknown) =>
		candidate.pendingResults.map((result) => ({
			...result,
			status: "error" as const,
			error: err instanceof Error ? err.message : String(err),
		}));

	const createCandidate = (skill: MarketSkill): SkillInstallCandidate => ({
		skill: { name: skill.name, source: skill.source },
		agents: Array.from(selectedAgents),
		installAll,
		scope: installToProject ? "project" : "global",
		projectPath: selectedProject?.path ?? null,
		pendingResults: buildPendingResults(
			selectedAgents,
			availableAgents,
			t("universalAgentTarget"),
		),
	});

	const install = useAuditedMutation<SkillInstallCandidate, InstallResult[]>({
		onFailure: (error) => captureException(error),
		audit: async (candidate, signal) => {
			const response = await api.skills.install(
				buildRequest(candidate, { audit_only: true }),
				signal,
			);
			if (!response.audit) throw new Error(t("auditFailed"));
			return auditDisposition(
				response.audit,
				response.session_id ?? null,
				response.audit_confirmation_required,
			);
		},
		write: async (
			{ candidate, report, sessionId, confirmedAssessmentDigest },
			signal,
		) => {
			const response = await api.skills.install(
				buildRequest(candidate, {
					expected_content_digest: report?.content_digest ?? null,
					confirmed_assessment_digest: confirmedAssessmentDigest,
					session_id: sessionId,
					audit_only: false,
				}),
				signal,
			);
			if (
				!response.success &&
				response.audit_confirmation_required &&
				response.audit
			) {
				const disposition = auditDisposition(
					response.audit,
					response.session_id ?? null,
					response.audit_confirmation_required,
				);
				if (disposition.kind !== "review") {
					throw new Error(t("auditFailed"));
				}
				return disposition;
			}
			await invalidateSkillQueries(queryClient);
			if (response.success) {
				capture("skill installed", {
					skill_source: candidate.skill.source,
					agents: [...candidate.agents],
					scope: candidate.scope,
					install_all: candidate.installAll,
				});
			}
			return {
				kind: "done",
				result: candidate.pendingResults.map((result) => ({
					...result,
					status: response.success
						? ("success" as const)
						: ("error" as const),
					error: response.success
						? undefined
						: t("skillInstallFailed"),
				})),
				report:
					skillAuditEnabled || response.audit_confirmation_required
						? (response.audit ?? null)
						: report,
				sessionId: response.session_id ?? sessionId,
			};
		},
	});

	const resetState = () => {
		install.reset();
		setSelectedAgents(new Set());
		setInstallAll(false);
	};

	const handleInstallClick = (skill: MarketSkill) => {
		setSelectedSkill(skill);
		resetState();
		resetInstallTarget();
		setInstallModalOpen(true);
	};

	const handleInstall = () => {
		if (!selectedSkill || selectedAgents.size === 0) return;
		if (installToProject && !selectedProjectId) return;
		if (!skillAuditReady) return;

		const candidate = createCandidate(selectedSkill);
		if (!skillAuditEnabled) {
			install.start(candidate, {
				kind: "allow",
				report: null,
				sessionId: null,
			});
			return;
		}
		install.start(candidate);
	};

	const handleConfirmInstall = () => {
		install.confirm();
	};

	const handleCloseInstallModal = () => {
		setInstallModalOpen(false);
		setSelectedSkill(null);
		resetState();
		resetInstallTarget();
	};

	const phase: InstallPhase =
		install.state.tag === "idle"
			? "picker"
			: install.state.tag === "auditing"
				? "auditing"
				: install.state.tag === "review"
					? "review"
					: install.state.tag === "writing"
						? "installing"
						: "done";
	const audit =
		install.state.tag === "review" ||
		install.state.tag === "writing" ||
		install.state.tag === "done"
			? install.state.report
			: null;
	const installResults =
		install.state.tag === "done"
			? install.state.result
			: install.state.tag === "writing"
				? [...install.state.candidate.pendingResults]
				: install.state.tag === "failed"
					? errorResults(
							install.state.candidate,
							install.state.error.message,
						)
					: [];

	return {
		installModalOpen,
		selectedSkill,
		selectedAgents,
		setSelectedAgents,
		installResults,
		phase,
		skillAgents,
		installAll,
		setInstallAll,
		installToProject,
		setInstallToProject,
		canInstallToProject,
		selectedProjectId,
		setSelectedProjectId,
		projects,
		skillAuditReady,
		audit,
		handleInstallClick,
		handleInstall,
		handleConfirmInstall,
		handleCloseInstallModal,
	};
}
