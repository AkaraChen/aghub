import { Button, Card, Checkbox, Label, Modal, Spinner } from "@heroui/react";
import { useTranslation } from "react-i18next";
import { InstallTargetSelector } from "../../../components/install-target-selector";
import { ResultStatusItem } from "../../../components/result-status-item";
import { SkillAudit } from "../../../components/skill-audit";
import { SkillInfoCard } from "../../../components/skill-info-card";
import { SkillTargetSelector } from "../../../components/skill-target-selector";
import type { AuditReportDto, MarketSkill } from "../../../generated/dto";
import type { InstallResult } from "../../../lib/install-utils";
import type { Project } from "../../../lib/store";
import type { InstallPhase } from "../hooks/use-skill-install";

interface InstallModalProps {
	isOpen: boolean;
	selectedSkill: MarketSkill | null;
	selectedAgents: Set<string>;
	onSelectedAgentsChange: (agents: Set<string>) => void;
	installResults: InstallResult[];
	phase: InstallPhase;
	skillAgents: ReturnType<
		typeof import("../hooks/use-skill-install").useSkillInstall
	>["skillAgents"];
	installAll: boolean;
	onInstallAllChange: (value: boolean) => void;
	installToProject: boolean;
	canInstallToProject: boolean;
	onInstallToProjectChange: (value: boolean) => void;
	selectedProjectId: string | null;
	onSelectedProjectIdChange: (id: string | null) => void;
	projects: Project[];
	skillAuditReady: boolean;
	audit: AuditReportDto | null;
	onClose: () => void;
	onInstall: () => void;
	onConfirmInstall: () => void;
}

export function InstallModal({
	isOpen,
	selectedSkill,
	selectedAgents,
	onSelectedAgentsChange,
	installResults,
	phase,
	skillAgents,
	installAll,
	onInstallAllChange,
	installToProject,
	canInstallToProject,
	onInstallToProjectChange,
	selectedProjectId,
	onSelectedProjectIdChange,
	projects,
	skillAuditReady,
	audit,
	onClose,
	onInstall,
	onConfirmInstall,
}: InstallModalProps) {
	const { t } = useTranslation();

	return (
		<Modal.Backdrop
			isOpen={isOpen}
			isDismissable={phase !== "installing"}
			isKeyboardDismissDisabled={phase === "installing"}
			onOpenChange={onClose}
		>
			<Modal.Container>
				<Modal.Dialog className="max-w-md">
					<Modal.CloseTrigger isDisabled={phase === "installing"} />
					<Modal.Header>
						<Modal.Heading>{t("installSkill")}</Modal.Heading>
					</Modal.Header>

					<Modal.Body className="p-2">
						{selectedSkill && (
							<SkillInfoCard
								name={
									installAll ? undefined : selectedSkill.name
								}
								source={selectedSkill.source}
								className="mb-4"
							/>
						)}

						{phase === "picker" && (
							<div className="space-y-4">
								<p className="text-sm text-muted">
									{t("selectAgentsForSkill")}
								</p>
								<SkillTargetSelector
									agents={skillAgents}
									selectedKeys={selectedAgents}
									onSelectionChange={onSelectedAgentsChange}
									showSelectedIcon
									variant="secondary"
								/>

								<Checkbox
									value="installAll"
									isSelected={installAll}
									onChange={(isSelected) =>
										onInstallAllChange(isSelected)
									}
									variant="secondary"
								>
									<Checkbox.Content>
										<Checkbox.Control>
											<Checkbox.Indicator />
										</Checkbox.Control>
										<span className="flex flex-col items-start gap-0.5">
											<Label className="text-sm font-medium">
												{t("installAllSkills")}
											</Label>
											<span className="text-xs text-muted">
												{t(
													"installAllSkillsDescription",
												)}
											</span>
										</span>
									</Checkbox.Content>
								</Checkbox>

								<InstallTargetSelector
									installToProject={installToProject}
									onInstallToProjectChange={
										onInstallToProjectChange
									}
									selectedProjectId={selectedProjectId}
									onSelectedProjectIdChange={
										onSelectedProjectIdChange
									}
									projects={projects}
									canInstallToProject={canInstallToProject}
								/>
							</div>
						)}

						{phase !== "picker" &&
							(phase === "auditing" || audit) && (
								<Card variant="secondary" className="mb-4">
									<Card.Content className="space-y-3">
										<p className="text-sm font-medium text-foreground">
											{t("securityAudit")}
										</p>
										{phase === "auditing" ? (
											<div className="flex items-center justify-center gap-3 py-6 text-sm text-muted">
												<Spinner size="sm" />
												{t("auditing")}
											</div>
										) : (
											audit && (
												<>
													{phase === "review" && (
														<p className="text-sm text-danger">
															{t(
																"auditBlockedHint",
															)}
														</p>
													)}
													<SkillAudit
														report={audit}
														embedded
													/>
												</>
											)
										)}
									</Card.Content>
								</Card>
							)}

						{(phase === "installing" || phase === "done") && (
							<Card variant="secondary">
								<Card.Content className="space-y-3">
									<p className="text-sm font-medium text-foreground">
										{phase === "done"
											? t("installComplete")
											: t("installingSkills")}
									</p>
									{installResults.map((result) => (
										<ResultStatusItem
											key={result.agentId}
											displayName={result.displayName}
											status={result.status}
											statusText={
												result.status === "pending"
													? t("installing")
													: result.status ===
														  "success"
														? t("installSuccess")
														: ""
											}
											error={result.error}
										/>
									))}
								</Card.Content>
							</Card>
						)}
					</Modal.Body>

					<Modal.Footer>
						{phase === "picker" && (
							<>
								<Button slot="close" variant="secondary">
									{t("cancel")}
								</Button>
								<Button
									onPress={onInstall}
									isDisabled={
										selectedAgents.size === 0 ||
										!skillAuditReady ||
										(installToProject && !selectedProjectId)
									}
								>
									{t("install")}
								</Button>
							</>
						)}
						{phase === "auditing" && (
							<>
								<Button slot="close" variant="secondary">
									{t("cancel")}
								</Button>
								<Button isDisabled>{t("auditing")}</Button>
							</>
						)}
						{phase === "review" && (
							<>
								<Button slot="close" variant="secondary">
									{t("cancel")}
								</Button>
								<Button
									variant="danger"
									onPress={onConfirmInstall}
								>
									{t("installAnyway")}
								</Button>
							</>
						)}
						{phase === "installing" && (
							<Button isDisabled>{t("installing")}</Button>
						)}
						{phase === "done" && (
							<Button slot="close" variant="secondary">
								{t("done")}
							</Button>
						)}
					</Modal.Footer>
				</Modal.Dialog>
			</Modal.Container>
		</Modal.Backdrop>
	);
}
