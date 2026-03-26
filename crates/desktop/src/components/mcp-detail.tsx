import {
	CheckCircleIcon,
	ChevronDownIcon,
	ChevronUpIcon,
	DocumentDuplicateIcon,
	ExclamationTriangleIcon,
	PencilIcon,
	PlusIcon,
	TrashIcon,
} from "@heroicons/react/24/solid";
import {
	Button,
	Card,
	Chip,
	Modal,
	Spinner,
	Tooltip,
	toast,
} from "@heroui/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAgentAvailability } from "../hooks/use-agent-availability";
import { useServer } from "../hooks/use-server";
import { AgentIcon, sortAgentObjects } from "../lib/agent-icons";
import { createApi } from "../lib/api";
import type { McpResponse, TransportDto } from "../lib/api-types";
import { ConfigSource } from "../lib/api-types";
import { cn } from "../lib/utils";
import { ManageAgentsDialog } from "./manage-agents-dialog";

export interface McpGroup {
	mergeKey: string;
	transport: TransportDto;
	items: McpResponse[];
}

interface McpDetailProps {
	group: McpGroup;
	onEdit: () => void;
	projectPath?: string;
}

function DetailRow({
	label,
	value,
	mono = false,
}: {
	label: string;
	value: string;
	mono?: boolean;
}) {
	// Truncate very long values to prevent overflow
	const displayValue =
		value.length > 200 ? `${value.slice(0, 200)}...` : value;

	return (
		<div className="flex items-start justify-between gap-4 py-2">
			<span className="shrink-0 text-sm text-muted">{label}</span>
			<span
				className={cn(
					"text-right text-sm break-all min-w-0 flex-1",
					mono && "font-mono text-xs",
				)}
				title={value.length > 200 ? value : undefined}
			>
				{displayValue}
			</span>
		</div>
	);
}

export function McpDetail({ group, onEdit, projectPath }: McpDetailProps) {
	const { t } = useTranslation();
	const { allAgents } = useAgentAvailability();
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
	const [manageDialogOpen, setManageDialogOpen] = useState(false);
	const [copyFeedback, setCopyFeedback] = useState(false);
	const [showAllHeaders, setShowAllHeaders] = useState(false);
	const [showAllEnvVars, setShowAllEnvVars] = useState(false);
	const { baseUrl } = useServer();
	const api = useMemo(() => createApi(baseUrl), [baseUrl]);
	const queryClient = useQueryClient();

	const deleteMutation = useMutation({
		mutationFn: (g: McpGroup) => {
			return Promise.all(
				g.items.map((item) => {
					const scope =
						item.source === ConfigSource.Project
							? "project"
							: "global";
					return api.mcps.delete(
						item.name,
						item.agent ?? "default",
						scope,
						projectPath,
					);
				}),
			);
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["mcps"] });
			queryClient.invalidateQueries({ queryKey: ["project-mcps"] });
			setDeleteDialogOpen(false);
			toast.success(t("deleteMcpSuccess"));
		},
		onError: (error) => {
			console.error("Failed to delete MCP servers:", error);
			toast.danger(
				error instanceof Error ? error.message : t("deleteMcpError"),
			);
		},
	});

	const handleCopyConfig = async () => {
		const primary = group.items[0];
		const config = {
			name: primary.name,
			transport: primary.transport,
			timeout: primary.timeout,
		};
		const configJson = JSON.stringify(config, null, 2);

		try {
			await navigator.clipboard.writeText(configJson);
			setCopyFeedback(true);
			toast.success(t("copyConfigSuccess"));
		} catch (error) {
			console.error("Failed to copy config:", error);
			toast.danger(t("copyConfigError"));
		}
	};

	useEffect(() => {
		if (copyFeedback) {
			const timer = setTimeout(setCopyFeedback, 2000, false);
			return () => clearTimeout(timer);
		}
	}, [copyFeedback]);

	const transport = group.transport;
	const primarySource = group.items[0].source;

	const getAgentName = useCallback(
		(item: McpResponse) =>
			item.agent
				? item.agent.charAt(0).toUpperCase() +
					item.agent.slice(1).toLowerCase()
				: t("default"),
		[t],
	);

	// Get headers or env based on transport type
	const headers =
		transport.type === "sse" || transport.type === "streamable_http"
			? transport.headers
			: undefined;
	const envVars = transport.type === "stdio" ? transport.env : undefined;
	const headersCount = headers ? Object.keys(headers).length : 0;
	const envCount = envVars ? Object.keys(envVars).length : 0;

	// Headers display logic
	const headerEntries = headers ? Object.entries(headers) : [];
	const displayedHeaders =
		showAllHeaders || headerEntries.length <= 2
			? headerEntries
			: headerEntries.slice(0, 2);
	const hasMoreHeaders = headerEntries.length > 2;
	const hiddenHeaderCount = headerEntries.length - 2;

	// Environment variables display logic
	const envEntries = envVars ? Object.entries(envVars) : [];
	const displayedEnvVars =
		showAllEnvVars || envEntries.length <= 2
			? envEntries
			: envEntries.slice(0, 2);
	const hasMoreEnvVars = envEntries.length > 2;
	const hiddenEnvVarCount = envEntries.length - 2;

	return (
		<>
			<div className="h-full overflow-y-auto">
				<div className="w-full max-w-2xl space-y-4 p-4 sm:p-6">
					{/* Unified Detail Card */}
					<Card>
						{/* Header: Name + Actions */}
						<Card.Header className="flex flex-row items-start justify-between gap-3">
							<div className="min-w-0 flex-1">
								<h2 className="text-xl font-semibold text-foreground truncate">
									{group.items[0].name}
								</h2>
								<Card.Description className="mt-1 flex items-center gap-2">
									{primarySource && (
										<Chip
											size="sm"
											variant="soft"
											color={
												primarySource ===
												ConfigSource.Project
													? "accent"
													: "default"
											}
										>
											{primarySource ===
											ConfigSource.Project
												? t("project")
												: t("global")}
										</Chip>
									)}
								</Card.Description>
							</div>
							<div className="flex items-center gap-2">
								<Tooltip delay={0}>
									<Button
										isIconOnly
										variant="ghost"
										size="md"
										className="text-muted min-w-[44px] min-h-[44px]"
										aria-label={t("editTooltip")}
										onPress={onEdit}
									>
										<PencilIcon className="size-4" />
									</Button>
									<Tooltip.Content>
										{t("editTooltip")}
									</Tooltip.Content>
								</Tooltip>
								<Tooltip delay={0}>
									<Button
										isIconOnly
										variant="ghost"
										size="md"
										className="text-muted hover:text-danger min-w-[44px] min-h-[44px]"
										aria-label={t("deleteTooltip")}
										onPress={() =>
											setDeleteDialogOpen(true)
										}
									>
										<TrashIcon className="size-4" />
									</Button>
									<Tooltip.Content>
										{t("deleteTooltip")}
									</Tooltip.Content>
								</Tooltip>
							</div>
						</Card.Header>

						<Card.Content className="flex flex-col gap-6">
							{/* Agents Section */}
							<div className="space-y-3">
								<h3 className="text-xs font-medium tracking-wider text-muted uppercase">
									{t("agents")}
								</h3>
								<div className="flex flex-wrap gap-2">
									{sortAgentObjects(
										group.items,
										allAgents,
									).map((item) => (
										<Chip
											key={item.agent ?? "default"}
											size="sm"
											variant={
												item.enabled
													? "soft"
													: "tertiary"
											}
											color="default"
											className="pr-3 max-w-full"
										>
											<span className="flex items-center gap-1.5 truncate">
												<AgentIcon
													id={item.agent ?? "default"}
													name={getAgentName(item)}
													size="sm"
													variant="ghost"
												/>
												<span className="truncate">
													{getAgentName(item)}
												</span>
												{!item.enabled && (
													<span className="shrink-0 text-xs text-warning">
														({t("disabled")})
													</span>
												)}
											</span>
										</Chip>
									))}
								</div>
							</div>

							{/* Connection Details */}
							<div className="space-y-3">
								<h3 className="text-xs font-medium tracking-wider text-muted uppercase">
									{t("connection")}
								</h3>

								{/* Type row */}
								<DetailRow
									label={t("type")}
									value={transport.type}
								/>

								{/* Stdio-specific fields */}
								{transport.type === "stdio" && (
									<>
										<DetailRow
											label={t("command")}
											value={transport.command}
											mono
										/>
										{transport.args &&
											transport.args.length > 0 && (
												<DetailRow
													label={t("args")}
													value={transport.args.join(
														" ",
													)}
													mono
												/>
											)}
									</>
								)}

								{/* HTTP-based transport fields */}
								{(transport.type === "sse" ||
									transport.type === "streamable_http") && (
									<DetailRow
										label={t("url")}
										value={transport.url}
										mono
									/>
								)}

								{/* Timeout */}
								{(group.items[0].timeout ||
									transport.timeout) && (
									<DetailRow
										label={t("timeout")}
										value={t("timeoutSeconds", {
											seconds:
												group.items[0].timeout ??
												transport.timeout,
										})}
									/>
								)}
							</div>

							{/* Headers (HTTP transports) */}
							{(transport.type === "sse" ||
								transport.type === "streamable_http") &&
								headersCount > 0 && (
									<div className="space-y-3">
										<h3 className="text-xs font-medium tracking-wider text-muted uppercase">
											{t("headersCount", {
												count: headersCount,
											})}
										</h3>
										<div className="space-y-1">
											{displayedHeaders.map(
												([key, value]) => (
													<div
														key={key}
														className="
                   flex items-center justify-between gap-4 rounded-lg
                   bg-surface-secondary px-3 py-1.5
                 "
													>
														<span className="shrink-0 font-mono text-xs">
															{key}
														</span>
														<span className="truncate font-mono text-xs text-muted">
															{value}
														</span>
													</div>
												),
											)}
										</div>
										{hasMoreHeaders && (
											<button
												type="button"
												onClick={() =>
													setShowAllHeaders(
														!showAllHeaders,
													)
												}
												className="
                 mt-2 flex items-center gap-1 text-xs text-muted transition-colors
                 hover:text-foreground
               "
											>
												{showAllHeaders ? (
													<>
														<ChevronUpIcon className="size-3.5" />
														<span>
															{t("showLess")}
														</span>
													</>
												) : (
													<>
														<ChevronDownIcon className="size-3.5" />
														<span>
															{t("showMore", {
																count: hiddenHeaderCount,
															})}
														</span>
													</>
												)}
											</button>
										)}
									</div>
								)}

							{/* Environment Variables (stdio) */}
							{transport.type === "stdio" && envCount > 0 && (
								<div className="space-y-3">
									<h3 className="text-xs font-medium tracking-wider text-muted uppercase">
										{t("envCount", {
											count: envCount,
										})}
									</h3>
									<div className="space-y-1">
										{displayedEnvVars.map(
											([key, value]) => (
												<div
													key={key}
													className="
                   flex items-center justify-between gap-4 rounded-lg
                   bg-surface-secondary px-3 py-1.5
                 "
												>
													<span className="shrink-0 font-mono text-xs">
														{key}
													</span>
													<span className="truncate font-mono text-xs text-muted">
														{value}
													</span>
												</div>
											),
										)}
									</div>
									{hasMoreEnvVars && (
										<button
											type="button"
											onClick={() =>
												setShowAllEnvVars(
													!showAllEnvVars,
												)
											}
											className="
                 mt-2 flex items-center gap-1 text-xs text-muted transition-colors
                 hover:text-foreground
               "
										>
											{showAllEnvVars ? (
												<>
													<ChevronUpIcon className="size-3.5" />
													<span>{t("showLess")}</span>
												</>
											) : (
												<>
													<ChevronDownIcon className="size-3.5" />
													<span>
														{t("showMore", {
															count: hiddenEnvVarCount,
														})}
													</span>
												</>
											)}
										</button>
									)}
								</div>
							)}

							{/* Action Buttons */}
							<div className="pt-4 border-t border-default-200 flex flex-col sm:flex-row gap-3">
								<Button
									variant="secondary"
									size="sm"
									onPress={handleCopyConfig}
									className="min-h-[44px]"
								>
									{copyFeedback ? (
										<CheckCircleIcon className="size-4 text-success" />
									) : (
										<DocumentDuplicateIcon className="size-4" />
									)}
									<span aria-live="polite">
										{copyFeedback
											? t("copied")
											: t("copyConfig")}
									</span>
								</Button>
								<Button
									variant="primary"
									size="sm"
									onPress={() => setManageDialogOpen(true)}
									className="min-h-[44px]"
								>
									<PlusIcon className="size-4" />
									{t("addToAgent")}
								</Button>
							</div>
						</Card.Content>
					</Card>
				</div>
			</div>

			{/* Delete Confirmation Dialog */}
			<Modal.Backdrop
				isOpen={deleteDialogOpen}
				onOpenChange={setDeleteDialogOpen}
			>
				<Modal.Container>
					<Modal.Dialog>
						<Modal.CloseTrigger />
						<Modal.Header>
							<div className="flex items-center gap-2">
								<ExclamationTriangleIcon className="size-5 text-warning" />
								<Modal.Heading>
									{t("deleteMcpServer")}
								</Modal.Heading>
							</div>
						</Modal.Header>
						<Modal.Body>
							<p className="text-sm text-muted">
								{group.items.length > 1
									? t("deleteMcpMultipleConfirm", {
											name: group.items[0].name,
											count: group.items.length,
											agents: group.items
												.map((i) => getAgentName(i))
												.join(", "),
										})
									: t("deleteMcpServerConfirm", {
											name: group.items[0].name,
										})}
							</p>
						</Modal.Body>
						<Modal.Footer>
							<Button
								slot="close"
								variant="secondary"
								size="md"
								onPress={() => setDeleteDialogOpen(false)}
								isDisabled={deleteMutation.isPending}
								className="min-h-[44px]"
							>
								{t("cancel")}
							</Button>
							<Button
								variant="danger"
								size="md"
								onPress={() => deleteMutation.mutate(group)}
								isDisabled={deleteMutation.isPending}
								className="min-h-[44px] min-w-[120px]"
							>
								{deleteMutation.isPending ? (
									<Spinner size="sm" />
								) : (
									t("deleteMcpServer")
								)}
							</Button>
						</Modal.Footer>
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>

			{/* Manage Agents Dialog */}
			<ManageAgentsDialog
				group={group}
				isOpen={manageDialogOpen}
				onClose={() => setManageDialogOpen(false)}
				projectPath={projectPath}
			/>
		</>
	);
}
