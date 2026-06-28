import { ClipboardDocumentIcon } from "@heroicons/react/24/solid";
import { Button, Input, Label, Modal, TextField, toast } from "@heroui/react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import type { MarketMcpEnv, MarketMcpServer } from "../../generated/dto";
import type { InstallResult } from "../../lib/install-utils";
import { buildMarketMcpRequest } from "../../lib/mcp-market-utils";
import { serializeMcpImportJson } from "../../lib/mcp-utils";
import type { Project } from "../../lib/store";
import { cn } from "../../lib/utils";
import { AgentSelector } from "../agent-selector";
import { InstallTargetSelector } from "../install-target-selector";
import { ResultStatusItem } from "../result-status-item";
import type { useMcpInstall } from "./use-mcp-install";

interface McpInstallModalProps {
	isOpen: boolean;
	server: MarketMcpServer | null;
	selectedAgents: Set<string>;
	onSelectedAgentsChange: (agents: Set<string>) => void;
	fieldValues: Record<string, string>;
	onFieldChange: (name: string, value: string) => void;
	installResults: InstallResult[];
	isInstalling: boolean;
	mcpAgents: ReturnType<typeof useMcpInstall>["mcpAgents"];
	installToProject: boolean;
	canInstallToProject: boolean;
	onInstallToProjectChange: (value: boolean) => void;
	selectedProjectId: string | null;
	onSelectedProjectIdChange: (id: string | null) => void;
	projects: Project[];
	onClose: () => void;
	onInstall: () => void;
}

export function McpInstallModal({
	isOpen,
	server,
	selectedAgents,
	onSelectedAgentsChange,
	fieldValues,
	onFieldChange,
	installResults,
	isInstalling,
	mcpAgents,
	installToProject,
	canInstallToProject,
	onInstallToProjectChange,
	selectedProjectId,
	onSelectedProjectIdChange,
	projects,
	onClose,
	onInstall,
}: McpInstallModalProps) {
	const { t } = useTranslation();
	const [, setLocation] = useLocation();

	const fields: MarketMcpEnv[] = server
		? server.transport === "stdio"
			? server.env
			: server.headers
		: [];
	const fieldLabel =
		server?.transport === "stdio"
			? t("marketMcpEnvVars")
			: t("marketMcpHeaders");

	const request = server ? buildMarketMcpRequest(server, fieldValues) : null;
	const configJson = request
		? serializeMcpImportJson(request.name, request.transport)
		: "";

	const handleCopyConfig = async () => {
		if (!configJson) return;
		try {
			await writeText(configJson);
			toast.success(t("copyConfigSuccess"));
		} catch {
			toast.danger(t("copyConfigError"));
		}
	};

	return (
		<Modal.Backdrop isOpen={isOpen} onOpenChange={onClose}>
			<Modal.Container>
				<Modal.Dialog className="max-w-lg">
					<Modal.CloseTrigger />
					<Modal.Header>
						<Modal.Heading>
							{t("marketMcpInstallTitle")}
						</Modal.Heading>
					</Modal.Header>

					<Modal.Body className="p-2">
						{server && (
							<div className="mb-4 flex flex-col gap-3">
								<div className="flex items-start justify-between gap-2">
									<div className="min-w-0">
										<p className="truncate font-medium">
											{server.display_name}
										</p>
										<p className="truncate text-xs text-muted">
											{server.publisher}
										</p>
									</div>
									<span
										className={cn(
											"shrink-0 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider",
											server.transport === "stdio"
												? "bg-success/15 text-success"
												: "bg-accent/15 text-accent",
										)}
									>
										{server.transport}
									</span>
								</div>
							</div>
						)}

						{installResults.length === 0 && (
							<div className="space-y-4">
								{fields.length > 0 && (
									<div className="space-y-3">
										<Label className="text-sm font-medium">
											{fieldLabel}
										</Label>
										{fields.map((field) => (
											<TextField
												key={field.name}
												className="w-full"
												variant="secondary"
											>
												<Label className="text-xs">
													{field.name}
													{field.is_required && (
														<span className="ml-0.5 text-danger">
															*
														</span>
													)}
												</Label>
												<Input
													value={
														fieldValues[
															field.name
														] ?? ""
													}
													onChange={(e) =>
														onFieldChange(
															field.name,
															e.target.value,
														)
													}
													placeholder={
														field.is_secret
															? t(
																	"marketMcpSecretPlaceholder",
																)
															: undefined
													}
													variant="secondary"
												/>
												{field.description && (
													<span className="text-xs text-muted">
														{field.description}
													</span>
												)}
											</TextField>
										))}
									</div>
								)}

								<p className="text-sm text-muted">
									{t("marketMcpSelectAgents")}
								</p>
								<AgentSelector
									agents={mcpAgents}
									selectedKeys={selectedAgents}
									onSelectionChange={onSelectedAgentsChange}
									emptyMessage={t("noTargetAgents")}
									showSelectedIcon
									variant="secondary"
								/>

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

								{configJson && (
									<div className="space-y-2">
										<div className="flex items-center justify-between">
											<Label className="text-sm font-medium">
												{t("marketMcpConfigPreview")}
											</Label>
											<Button
												isIconOnly
												variant="ghost"
												size="sm"
												className="size-7 text-muted"
												aria-label={t("copyConfig")}
												onPress={handleCopyConfig}
											>
												<ClipboardDocumentIcon className="size-3.5" />
											</Button>
										</div>
										<pre className="max-h-48 overflow-auto rounded-md bg-surface-secondary p-2 text-xs text-muted">
											<code>{configJson}</code>
										</pre>
									</div>
								)}
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
						{installResults.length === 0 ? (
							<>
								<Button slot="close" variant="secondary">
									{t("cancel")}
								</Button>
								<Button
									onPress={onInstall}
									isDisabled={
										selectedAgents.size === 0 ||
										isInstalling ||
										(installToProject && !selectedProjectId)
									}
								>
									{isInstalling
										? t("installing")
										: t("install")}
								</Button>
							</>
						) : (
							<>
								<Button
									variant="secondary"
									onPress={() => {
										onClose();
										setLocation("/mcp");
									}}
								>
									{t("marketMcpGoToPage")}
								</Button>
								<Button slot="close">{t("done")}</Button>
							</>
						)}
					</Modal.Footer>
				</Modal.Dialog>
			</Modal.Container>
		</Modal.Backdrop>
	);
}
