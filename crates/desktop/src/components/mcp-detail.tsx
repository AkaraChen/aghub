import {
	CheckCircleIcon,
	ChevronDownIcon,
	ChevronUpIcon,
	ClipboardDocumentIcon,
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
	Disclosure,
	Modal,
	Separator,
	Tooltip,
} from "@heroui/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useServer } from "../hooks/use-server";
import { AgentIcon } from "../lib/agent-icons";
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

function CopyButton({ text, label }: { text: string; label?: string }) {
	const [copied, setCopied] = useState(false);
	const { t } = useTranslation();

	const handleCopy = async () => {
		try {
			await navigator.clipboard.writeText(text);
			setCopied(true);
		} catch {
			setCopied(true);
		}
	};

	useEffect(() => {
		if (copied) {
			const timer = setTimeout(setCopied, 1500, false);
			return () => clearTimeout(timer);
		}
	}, [copied]);

	return (
		<Tooltip delay={0}>
			<Button
				isIconOnly
				variant="ghost"
				size="sm"
				className={cn("size-7", copied ? "text-success" : "text-muted")}
				aria-label={label ?? t("copy")}
				onPress={handleCopy}
			>
				{copied ? (
					<CheckCircleIcon className="size-3.5" />
				) : (
					<ClipboardDocumentIcon className="size-3.5" />
				)}
			</Button>
			<Tooltip.Content>
				{copied ? t("copied") : (label ?? t("copy"))}
			</Tooltip.Content>
		</Tooltip>
	);
}

function DetailRow({
	label,
	value,
	mono = false,
	copyable = false,
}: {
	label: string;
	value: string;
	mono?: boolean;
	copyable?: boolean;
}) {
	return (
		<div className="flex items-start justify-between gap-4 py-2">
			<span className="shrink-0 text-sm text-muted">{label}</span>
			<div className="flex items-center gap-1">
				<span
					className={cn(
						"text-right text-sm break-all",
						mono && "font-mono text-xs",
					)}
				>
					{value}
				</span>
				{copyable && <CopyButton text={value} />}
			</div>
		</div>
	);
}

function KeyValueSection({
	data,
	emptyMessage,
}: {
	data: Record<string, string> | undefined;
	emptyMessage: string;
}) {
	const entries = data ? Object.entries(data) : [];

	if (entries.length === 0) {
		return <p className="py-2 text-xs text-muted">{emptyMessage}</p>;
	}

	return (
		<div className="space-y-1 py-1">
			{entries.map(([key, value]) => (
				<div
					key={key}
					className="
       flex items-center justify-between gap-4 rounded-lg bg-surface-secondary
       px-3 py-1.5
     "
				>
					<span className="shrink-0 font-mono text-xs">{key}</span>
					<span className="truncate font-mono text-xs text-muted">
						{value}
					</span>
				</div>
			))}
		</div>
	);
}

export function McpDetail({ group, onEdit, projectPath }: McpDetailProps) {
	const { t } = useTranslation();
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
	const [manageDialogOpen, setManageDialogOpen] = useState(false);
	const [copyFeedback, setCopyFeedback] = useState(false);
	const [showAllHeaders, setShowAllHeaders] = useState(false);
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
		},
		onError: (error) => {
			console.error("Failed to delete MCP servers:", error);
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
		} catch {
			setCopyFeedback(true);
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

	return (
		<>
			<div className="h-full overflow-y-auto">
				<div className="max-w-2xl space-y-4 p-6">
					{/* Unified Detail Card */}
					<Card>
						{/* Header: Name + Actions */}
						<Card.Header className="flex flex-row items-start justify-between gap-3">
							<div className="min-w-0 flex-1">
								<h2 className="text-xl font-semibold text-foreground">
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
							<div className="flex items-center gap-1">
								<Tooltip delay={0}>
									<Button
										isIconOnly
										variant="ghost"
										size="sm"
										className="text-muted"
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
										size="sm"
										className="
            text-muted
            hover:text-danger
          "
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

						<Card.Content className="flex flex-col gap-5">
							{/* Agents Section */}
							<div>
								<p
									className="
           mb-2 text-xs font-medium tracking-wider text-muted uppercase
         "
								>
									{t("agents")}
								</p>
								<div className="flex flex-wrap gap-2">
									{group.items.map((item) => (
										<Chip
											key={item.agent ?? "default"}
											size="sm"
											variant={
												item.enabled
													? "soft"
													: "tertiary"
											}
											color="default"
											className="pr-3"
										>
											<span className="flex items-center gap-1.5">
												<AgentIcon
													id={item.agent ?? "default"}
													name={getAgentName(item)}
													size="sm"
													variant="ghost"
												/>
												<span>
													{getAgentName(item)}
												</span>
												{!item.enabled && (
													<span className="text-xs text-warning">
														({t("disabled")})
													</span>
												)}
											</span>
										</Chip>
									))}
								</div>
							</div>

							{/* Connection Details */}
							<div>
								<p
									className="
           mb-1 text-xs font-medium tracking-wider text-muted uppercase
         "
								>
									{t("connection")}
								</p>

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
											copyable
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
										copyable
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
									<div>
										<p
											className="
           mb-2 text-xs font-medium tracking-wider text-muted uppercase
         "
										>
											{t("headersCount", {
												count: headersCount,
											})}
										</p>
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
							{transport.type === "stdio" && (
								<Disclosure>
									<Disclosure.Heading>
										<Button
											slot="trigger"
											variant="ghost"
											size="sm"
											className="w-full justify-between text-muted"
										>
											{t("envCount", {
												count: envCount,
											})}
											<Disclosure.Indicator />
										</Button>
									</Disclosure.Heading>
									<Disclosure.Content>
										<Disclosure.Body>
											<KeyValueSection
												data={envVars}
												emptyMessage={t("noEnvVars")}
											/>
										</Disclosure.Body>
									</Disclosure.Content>
								</Disclosure>
							)}

							{/* Action Buttons */}
							<div className="flex gap-2">
								<Button
									variant="secondary"
									size="sm"
									onPress={handleCopyConfig}
								>
									{copyFeedback ? (
										<CheckCircleIcon className="size-4 text-success" />
									) : (
										<DocumentDuplicateIcon className="size-4" />
									)}
									{copyFeedback
										? t("copied")
										: t("copyConfig")}
								</Button>
								<Button
									variant="primary"
									size="sm"
									onPress={() => setManageDialogOpen(true)}
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
								onPress={() => setDeleteDialogOpen(false)}
							>
								{t("cancel")}
							</Button>
							<Button
								variant="danger"
								onPress={() => deleteMutation.mutate(group)}
								isDisabled={deleteMutation.isPending}
							>
								{deleteMutation.isPending
									? t("deleting")
									: t("deleteMcpServer")}
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
