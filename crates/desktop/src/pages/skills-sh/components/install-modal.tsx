import { Button, Modal } from "@heroui/react";
import { useTranslation } from "react-i18next";
import { AgentSelector } from "../../../components/agent-selector";
import { ResultStatusItem } from "../../../components/result-status-item";
import { SkillInfoCard } from "../../../components/skill-info-card";
import type { MarketSkill } from "../../../lib/api-types";
import type { InstallResult } from "../hooks/use-skill-install";

interface InstallModalProps {
	isOpen: boolean;
	selectedSkill: MarketSkill | null;
	selectedAgents: Set<string>;
	onSelectedAgentsChange: (agents: Set<string>) => void;
	installResults: InstallResult[];
	isInstalling: boolean;
	skillAgents: ReturnType<
		typeof import("../hooks/use-skill-install").useSkillInstall
	>["skillAgents"];
	onClose: () => void;
	onInstall: () => void;
}

export function InstallModal({
	isOpen,
	selectedSkill,
	selectedAgents,
	onSelectedAgentsChange,
	installResults,
	isInstalling,
	skillAgents,
	onClose,
	onInstall,
}: InstallModalProps) {
	const { t } = useTranslation();

	return (
		<Modal.Backdrop isOpen={isOpen} onOpenChange={onClose}>
			<Modal.Container>
				<Modal.Dialog className="max-w-md">
					<Modal.CloseTrigger />
					<Modal.Header>
						<Modal.Heading>{t("installSkill")}</Modal.Heading>
					</Modal.Header>

					<Modal.Body className="p-2">
						{selectedSkill && (
							<SkillInfoCard
								name={selectedSkill.name}
								source={selectedSkill.source}
								className="mb-4"
							/>
						)}

						{installResults.length === 0 && (
							<div className="space-y-4">
								<p className="text-sm text-muted">
									{t("selectAgentsForSkill")}
								</p>
								<AgentSelector
									agents={skillAgents}
									selectedKeys={selectedAgents}
									onSelectionChange={onSelectedAgentsChange}
									emptyMessage={t("noTargetAgents")}
									showSelectedIcon
									variant="secondary"
								/>
							</div>
						)}

						{installResults.length > 0 && (
							<div className="space-y-3">
								{installResults.map((result) => (
									<ResultStatusItem
										key={result.agentId}
										displayName={result.displayName}
										status={result.status}
										statusText={
											result.status === "pending"
												? t("installing")
												: result.status === "success"
													? t("installSuccess")
													: ""
										}
										error={result.error}
									/>
								))}
							</div>
						)}
					</Modal.Body>

					<Modal.Footer>
						{installResults.length === 0 && (
							<>
								<Button slot="close" variant="secondary">
									{t("cancel")}
								</Button>
								<Button
									onPress={onInstall}
									isDisabled={
										selectedAgents.size === 0 ||
										isInstalling
									}
								>
									{isInstalling
										? t("installing")
										: t("install")}
								</Button>
							</>
						)}
						{installResults.length > 0 && (
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
