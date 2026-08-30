import { ClipboardDocumentIcon } from "@heroicons/react/24/solid";
import { Button, Form, Modal, toast } from "@heroui/react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import type {
	MarketMcpInstallMethod,
	MarketMcpServer,
} from "../../generated/dto";
import type { InstallResult } from "../../lib/install-utils";
import {
	buildMarketMcpRequest,
	invalidMcpInputIds,
	redactedMcpFieldValues,
} from "../../lib/mcp-market-utils";
import { serializeMcpImportJson } from "../../lib/mcp-utils";
import type { Project } from "../../lib/store";
import { AgentSelector } from "../agent-selector";
import { InstallTargetSelector } from "../install-target-selector";
import { ResultStatusItem } from "../result-status-item";
import { McpInstallFields } from "./mcp-install-fields";
import { McpInstallMethodSelector } from "./mcp-install-method-selector";
import { mcpTransportLabel } from "./mcp-transport";
import type { useMcpInstall } from "./use-mcp-install";

interface McpInstallModalProps {
	isOpen: boolean;
	server: MarketMcpServer | null;
	selectedMethod: MarketMcpInstallMethod | null;
	onMethodChange: (method: MarketMcpInstallMethod) => void;
	selectedAgents: Set<string>;
	onSelectedAgentsChange: (agents: Set<string>) => void;
	fieldValues: Record<string, string>;
	onFieldChange: (id: string, value: string) => void;
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
	selectedMethod,
	onMethodChange,
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
	const invalidInputIds = selectedMethod
		? invalidMcpInputIds(selectedMethod, fieldValues)
		: new Set<string>();
	const request =
		server && selectedMethod
			? buildMarketMcpRequest(server, selectedMethod, fieldValues)
			: null;
	const previewRequest =
		server && selectedMethod
			? buildMarketMcpRequest(
					server,
					selectedMethod,
					redactedMcpFieldValues(selectedMethod, fieldValues),
				)
			: null;
	const configJson = request
		? serializeMcpImportJson(request.name, request.transport)
		: "";
	const previewConfigJson = previewRequest
		? serializeMcpImportJson(previewRequest.name, previewRequest.transport)
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
		<Modal.Backdrop
			isOpen={isOpen}
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<Modal.Container>
				<Modal.Dialog className="max-w-lg">
					<Modal.CloseTrigger isDisabled={isInstalling} />
					<Form
						className="contents"
						validationBehavior="aria"
						onSubmit={(event) => {
							event.preventDefault();
							onInstall();
						}}
					>
						<Modal.Header>
							<Modal.Heading>
								{t("marketMcpInstallTitle")}
							</Modal.Heading>
						</Modal.Header>

						<Modal.Body className="p-2">
							{server && selectedMethod && (
								<div className="mb-4 flex items-start justify-between gap-2">
									<div className="min-w-0">
										<p className="truncate font-medium">
											{server.display_name}
										</p>
										<p className="truncate text-xs text-muted">
											{server.publisher}
										</p>
									</div>
									<span className="shrink-0 text-xs text-muted">
										{mcpTransportLabel(
											selectedMethod.transport.type,
										)}
									</span>
								</div>
							)}

							{installResults.length === 0 &&
								server &&
								selectedMethod && (
									<div className="space-y-4">
										{server.install_methods.length > 1 && (
											<McpInstallMethodSelector
												methods={server.install_methods}
												selected={selectedMethod}
												onChange={onMethodChange}
											/>
										)}

										{selectedMethod.inputs.length > 0 && (
											<McpInstallFields
												inputs={selectedMethod.inputs}
												values={fieldValues}
												invalidIds={invalidInputIds}
												onChange={onFieldChange}
											/>
										)}

										<AgentSelector
											agents={mcpAgents}
											selectedKeys={selectedAgents}
											onSelectionChange={
												onSelectedAgentsChange
											}
											emptyMessage={t("noTargetAgents")}
											label={t("marketMcpSelectAgents")}
											showSelectedIcon
											variant="secondary"
										/>

										<InstallTargetSelector
											installToProject={installToProject}
											onInstallToProjectChange={
												onInstallToProjectChange
											}
											selectedProjectId={
												selectedProjectId
											}
											onSelectedProjectIdChange={
												onSelectedProjectIdChange
											}
											projects={projects}
											canInstallToProject={
												canInstallToProject
											}
										/>

										{previewConfigJson && (
											<div className="space-y-2">
												<div className="flex items-center justify-between">
													<p className="text-sm font-medium">
														{t(
															"marketMcpConfigPreview",
														)}
													</p>
													<Button
														isIconOnly
														type="button"
														variant="ghost"
														size="sm"
														className="size-7 text-muted"
														aria-label={t(
															"copyConfig",
														)}
														onPress={
															handleCopyConfig
														}
													>
														<ClipboardDocumentIcon className="size-3.5" />
													</Button>
												</div>
												<pre className="max-h-48 overflow-auto rounded-md bg-surface-secondary p-2 text-xs text-muted">
													<code>
														{previewConfigJson}
													</code>
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
													: result.status ===
														  "success"
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
									<Button
										type="button"
										slot="close"
										variant="secondary"
										isDisabled={isInstalling}
									>
										{t("cancel")}
									</Button>
									<Button
										type="submit"
										isPending={isInstalling}
										isDisabled={
											selectedAgents.size === 0 ||
											invalidInputIds.size > 0 ||
											(installToProject &&
												!selectedProjectId)
										}
									>
										{t("install")}
									</Button>
								</>
							) : (
								<>
									<Button
										type="button"
										variant="secondary"
										isDisabled={isInstalling}
										onPress={() => {
											onClose();
											setLocation("/mcp");
										}}
									>
										{t("marketMcpGoToPage")}
									</Button>
									<Button
										type="button"
										slot="close"
										isDisabled={isInstalling}
									>
										{t("done")}
									</Button>
								</>
							)}
						</Modal.Footer>
					</Form>
				</Modal.Dialog>
			</Modal.Container>
		</Modal.Backdrop>
	);
}
