import { StarIcon as StarIconOutline } from "@heroicons/react/24/outline";
import {
	CheckCircleIcon,
	ChevronDownIcon,
	ChevronUpIcon,
	DocumentDuplicateIcon,
	ExclamationTriangleIcon,
	PencilIcon,
	PlusIcon,
	StarIcon as StarIconSolid,
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
import { useCallback, useReducer } from "react";
import { useTranslation } from "react-i18next";
import type { McpResponse, TransportDto } from "../generated/dto";
import { useAgentAvailability } from "../hooks/use-agent-availability";
import { useApi } from "../hooks/use-api";
import { useFavorites } from "../hooks/use-favorites";
import { AgentIcon } from "../lib/agent-icons";
import { cn, sortAgentObjects } from "../lib/utils";
import { invalidateMcpQueries } from "../requests/mcps";
import { ManageAgentsDialog } from "./manage-agents-dialog";
import { TransferDialog } from "./transfer-dialog";

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

function MetaRow({
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
		<div className="grid gap-1.5 py-1">
			<span className="text-[11px] font-medium tracking-wide text-muted uppercase">
				{label}
			</span>
			<span
				className={cn(
					"min-w-0 text-sm text-foreground",
					mono &&
						"overflow-x-auto rounded-md bg-surface-secondary px-3 py-2 font-mono text-xs leading-5 text-foreground",
				)}
				title={value.length > 200 ? value : undefined}
			>
				{displayValue}
			</span>
		</div>
	);
}

function CodeBlock({
	label,
	command,
	args,
}: {
	label: string;
	command: string;
	args?: string[];
}) {
	const commandLine =
		args && args.length > 0 ? `${command} ${args.join(" ")}` : command;

	return (
		<div className="grid gap-1.5">
			<span className="text-[11px] font-medium tracking-wide text-muted uppercase">
				{label}
			</span>
			<div className="overflow-x-auto rounded-lg border border-separator bg-surface-secondary px-3 py-2">
				<code className="block font-mono text-xs leading-5 text-foreground whitespace-pre-wrap break-words">
					{commandLine}
				</code>
			</div>
		</div>
	);
}

function KeyValueList({
	items,
	collapsedCount = 2,
	showAll,
	onToggle,
	showMoreLabel,
	showLessLabel,
}: {
	items: Array<[string, string]>;
	collapsedCount?: number;
	showAll: boolean;
	onToggle: () => void;
	showMoreLabel: (count: number) => string;
	showLessLabel: string;
}) {
	const displayedItems =
		showAll || items.length <= collapsedCount
			? items
			: items.slice(0, collapsedCount);
	const hiddenCount = Math.max(items.length - collapsedCount, 0);

	return (
		<div className="grid gap-1.5">
			<div className="space-y-2">
				{displayedItems.map(([key, value]) => (
					<div
						key={key}
						className="grid gap-1 rounded-lg border border-separator bg-surface-secondary px-3 py-2"
					>
						<span className="font-mono text-[11px] text-muted">
							{key}
						</span>
						<code className="font-mono text-xs leading-5 text-foreground break-words">
							{value}
						</code>
					</div>
				))}
			</div>
			{hiddenCount > 0 && (
				<button
					type="button"
					onClick={onToggle}
					className="flex items-center gap-1 text-xs text-muted transition-colors hover:text-foreground"
				>
					{showAll ? (
						<>
							<ChevronUpIcon className="size-3.5" />
							<span>{showLessLabel}</span>
						</>
					) : (
						<>
							<ChevronDownIcon className="size-3.5" />
							<span>{showMoreLabel(hiddenCount)}</span>
						</>
					)}
				</button>
			)}
		</div>
	);
}

interface McpDetailUiState {
	deleteDialogOpen: boolean;
	manageDialogOpen: boolean;
	transferDialogOpen: boolean;
	copyFeedback: boolean;
	showAllHeaders: boolean;
	showAllEnvVars: boolean;
}

type McpDetailUiAction =
	| { type: "set_delete_dialog"; value: boolean }
	| { type: "set_manage_dialog"; value: boolean }
	| { type: "set_transfer_dialog"; value: boolean }
	| { type: "show_copy_feedback" }
	| { type: "hide_copy_feedback" }
	| { type: "toggle_headers" }
	| { type: "toggle_env" };

function mcpDetailUiReducer(
	state: McpDetailUiState,
	action: McpDetailUiAction,
): McpDetailUiState {
	switch (action.type) {
		case "set_delete_dialog":
			return { ...state, deleteDialogOpen: action.value };
		case "set_manage_dialog":
			return { ...state, manageDialogOpen: action.value };
		case "set_transfer_dialog":
			return { ...state, transferDialogOpen: action.value };
		case "show_copy_feedback":
			return { ...state, copyFeedback: true };
		case "hide_copy_feedback":
			return { ...state, copyFeedback: false };
		case "toggle_headers":
			return { ...state, showAllHeaders: !state.showAllHeaders };
		case "toggle_env":
			return { ...state, showAllEnvVars: !state.showAllEnvVars };
	}
}

export function McpDetail({ group, onEdit, projectPath }: McpDetailProps) {
	const { t } = useTranslation();
	const { allAgents } = useAgentAvailability();
	const [uiState, dispatch] = useReducer(mcpDetailUiReducer, {
		deleteDialogOpen: false,
		manageDialogOpen: false,
		transferDialogOpen: false,
		copyFeedback: false,
		showAllHeaders: false,
		showAllEnvVars: false,
	});
	const api = useApi();
	const queryClient = useQueryClient();

	const deleteMutation = useMutation({
		mutationFn: (g: McpGroup) => {
			return Promise.all(
				g.items.map((item) => {
					const scope =
						item.source === "project" ? "project" : "global";
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
			void invalidateMcpQueries(queryClient);
			dispatch({ type: "set_delete_dialog", value: false });
			toast.success(t("deleteMcpSuccess"));
		},
		onError: (error) => {
			console.error("Failed to delete MCP servers:", error);
			toast.danger(
				error instanceof Error ? error.message : t("deleteMcpError"),
			);
		},
	});

	const { isMcpStarred, toggleMcpStar } = useFavorites();
	const isStarred = isMcpStarred(group.mergeKey);

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
			dispatch({ type: "show_copy_feedback" });
			setTimeout(() => {
				dispatch({ type: "hide_copy_feedback" });
			}, 2000);
			toast.success(t("copyConfigSuccess"));
		} catch (error) {
			console.error("Failed to copy config:", error);
			toast.danger(t("copyConfigError"));
		}
	};

	const transport = group.transport;
	const primarySource = group.items[0].source;
	const primaryItem = group.items[0];
	const primaryScope = primarySource === "project" ? "project" : "global";

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
	const headerEntries = headers ? Object.entries(headers) : [];
	const envEntries = envVars ? Object.entries(envVars) : [];
	const transportLabel =
		transport.type === "streamable_http"
			? "Streamable HTTP"
			: transport.type;

	return (
		<>
			<div className="h-full overflow-y-auto">
				<div className="w-full space-y-4 p-4 sm:p-6">
					{/* Unified Detail Card */}
					<Card>
						{/* Header: Name + Actions */}
						<Card.Header className="flex flex-row items-start justify-between gap-3">
							<div className="min-w-0 flex-1">
								<h2 className="text-xl font-semibold text-foreground truncate">
									{primaryItem.name}
								</h2>
							</div>
							<div className="flex items-center gap-2">
								<Tooltip delay={0}>
									<Button
										isIconOnly
										variant="ghost"
										size="md"
										className={cn(
											"text-muted min-w-[44px] min-h-[44px] hover:text-warning",
											isStarred && "text-warning",
										)}
										aria-label={
											isStarred
												? t("unstarServer")
												: t("starServer")
										}
										onPress={() =>
											toggleMcpStar(group.mergeKey)
										}
									>
										{isStarred ? (
											<StarIconSolid className="size-5" />
										) : (
											<StarIconOutline className="size-5" />
										)}
									</Button>
									<Tooltip.Content>
										{isStarred
											? t("unstarServer")
											: t("starServer")}
									</Tooltip.Content>
								</Tooltip>
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
											dispatch({
												type: "set_delete_dialog",
												value: true,
											})
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

							{/* Transport Details */}
							<div className="space-y-4">
								<div className="flex items-baseline gap-2">
									<h3 className="text-xs font-medium tracking-wider text-muted uppercase">
										{t("transport")}
									</h3>
									<span className="font-mono text-xs text-muted">
										({transportLabel})
									</span>
								</div>

								<div className="grid gap-4">
									{transport.type === "stdio" ? (
										<CodeBlock
											label={t("command")}
											command={transport.command}
											args={transport.args}
										/>
									) : (
										<MetaRow
											label={t("url")}
											value={transport.url}
											mono
										/>
									)}
									<div className="grid gap-4 md:grid-cols-2">
										{(primaryItem.timeout ||
											transport.timeout) && (
											<MetaRow
												label={t("timeout")}
												value={t("timeoutSeconds", {
													seconds:
														primaryItem.timeout ??
														transport.timeout,
												})}
											/>
										)}
									</div>
								</div>
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
										<KeyValueList
											items={headerEntries}
											showAll={uiState.showAllHeaders}
											onToggle={() =>
												dispatch({
													type: "toggle_headers",
												})
											}
											showMoreLabel={(count) =>
												t("showMore", { count })
											}
											showLessLabel={t("showLess")}
										/>
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
									<KeyValueList
										items={envEntries}
										showAll={uiState.showAllEnvVars}
										onToggle={() =>
											dispatch({ type: "toggle_env" })
										}
										showMoreLabel={(count) =>
											t("showMore", { count })
										}
										showLessLabel={t("showLess")}
									/>
								</div>
							)}

							{/* Action Buttons */}
							<Card.Footer className="pt-4 border-t border-separator flex flex-wrap gap-3">
								<Button
									variant="secondary"
									onPress={handleCopyConfig}
								>
									{uiState.copyFeedback ? (
										<CheckCircleIcon className="size-4 text-success" />
									) : (
										<DocumentDuplicateIcon className="size-4" />
									)}
									{uiState.copyFeedback
										? t("copied")
										: t("copyConfig")}
								</Button>
								<Button
									variant="secondary"
									onPress={() =>
										dispatch({
											type: "set_transfer_dialog",
											value: true,
										})
									}
								>
									<PlusIcon className="size-4" />
									{t("transfer")}
								</Button>
								<Button
									variant="primary"
									onPress={() =>
										dispatch({
											type: "set_manage_dialog",
											value: true,
										})
									}
								>
									<PlusIcon className="size-4" />
									{t("addToAgent")}
								</Button>
							</Card.Footer>
						</Card.Content>
					</Card>
				</div>
			</div>

			{/* Delete Confirmation Dialog */}
			<Modal.Backdrop
				isOpen={uiState.deleteDialogOpen}
				onOpenChange={(value) =>
					dispatch({
						type: "set_delete_dialog",
						value,
					})
				}
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
								onPress={() =>
									dispatch({
										type: "set_delete_dialog",
										value: false,
									})
								}
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
				isOpen={uiState.manageDialogOpen}
				onClose={() =>
					dispatch({
						type: "set_manage_dialog",
						value: false,
					})
				}
				projectPath={projectPath}
				requiredCapabilities={["mcp"]}
			/>
			{/* Transfer Dialog */}
			<TransferDialog
				isOpen={uiState.transferDialogOpen}
				onClose={() =>
					dispatch({
						type: "set_transfer_dialog",
						value: false,
					})
				}
				resourceType="mcp"
				name={primaryItem.name}
				sourceAgent={primaryItem.agent ?? "claude"}
				sourceScope={primaryScope}
				sourceProjectRoot={projectPath}
				transport={primaryItem.transport}
			/>
		</>
	);
}
