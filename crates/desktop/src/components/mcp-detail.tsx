import {
	CheckCircleIcon,
	DocumentDuplicateIcon,
	ExclamationTriangleIcon,
	PencilIcon,
	TrashIcon,
	UserGroupIcon,
} from "@heroicons/react/24/solid";
import { Button, Card, Chip, Modal, Table, Tooltip } from "@heroui/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { createApi } from "../lib/api";
import type { McpResponse, TransportDto } from "../lib/api-types";
import { ConfigSource } from "../lib/api-types";
import { useServer } from "../hooks/use-server";
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

export function McpDetail({ group, onEdit, projectPath }: McpDetailProps) {
	const { t } = useTranslation();
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
	const [manageDialogOpen, setManageDialogOpen] = useState(false);
	const [copyFeedback, setCopyFeedback] = useState(false);
	const { baseUrl } = useServer();
	const api = createApi(baseUrl);
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

	const handleCopy = async () => {
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
			// Fallback: still show feedback even if clipboard fails
			setCopyFeedback(true);
		}
	};

	// Clear copy feedback after 2 seconds
	useEffect(() => {
		if (copyFeedback) {
			const timer = setTimeout(setCopyFeedback, 2000, false);
			return () => clearTimeout(timer);
		}
	}, [copyFeedback]);

	return (
		<>
			<div className="h-full overflow-y-auto">
				<div className="max-w-3xl p-6">
					{/* Header */}
					<div className="mb-2 flex items-center justify-between gap-3">
						<h2 className="truncate text-xl font-semibold text-foreground">
							{group.items[0].name}
						</h2>
						<div className="flex items-center gap-1">
							<Tooltip delay={0}>
								<Button
									isIconOnly
									variant="tertiary"
									size="sm"
									className={copyFeedback ? "text-success" : "text-muted"}
									aria-label={copyFeedback ? t("copied") : t("copy")}
									onPress={handleCopy}
								>
									{copyFeedback ? (
										<CheckCircleIcon className="size-4" />
									) : (
										<DocumentDuplicateIcon className="size-4" />
									)}
								</Button>
								<Tooltip.Content>
									{copyFeedback ? t("copied") : t("copyTooltip")}
								</Tooltip.Content>
							</Tooltip>
							<Tooltip delay={0}>
								<Button
									isIconOnly
									variant="tertiary"
									size="sm"
									className="
           shrink-0 text-muted
           hover:text-foreground
         "
									aria-label={t("edit")}
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
									variant="tertiary"
									size="sm"
									className="
           shrink-0 text-muted
           hover:text-danger
         "
									aria-label={t("remove")}
									onPress={() => setDeleteDialogOpen(true)}
								>
									<TrashIcon className="size-4" />
								</Button>
								<Tooltip.Content>
									{t("deleteTooltip")}
								</Tooltip.Content>
							</Tooltip>
														<Tooltip delay={0}>
								<Button
									isIconOnly
									variant="primary"
									size="sm"
									className="
           shrink-0 text-muted
           hover:text-foreground
         "
									aria-label={t("manageAgents")}
									onPress={() => setManageDialogOpen(true)}
								>
									<UserGroupIcon className="size-4 text-surface" />
								</Button>
								<Tooltip.Content>
									{t("manageAgentsTooltip")}
								</Tooltip.Content>
							</Tooltip>
						</div>
					</div>

					{/* Agents Section */}
					<Card variant="default" className="mb-6">
						<Card.Header>
							<Card.Title>
								{t("agents")} ({group.items.length})
							</Card.Title>
						</Card.Header>
						<Card.Content>
							<div className="flex flex-wrap gap-1.5">
								{group.items.map((item) => (
									<div
										key={item.agent ?? "default"}
										className="flex items-center gap-1"
									>
										<Chip size="sm" variant="secondary">
											{item.agent
												? item.agent
														.charAt(0)
														.toUpperCase() +
													item.agent
														.slice(1)
														.toLowerCase()
												: "Default"}
										</Chip>
										{!item.enabled && (
											<Chip
												size="sm"
												variant="soft"
												color="warning"
											>
												{t("disabled")}
											</Chip>
										)}
									</div>
								))}
							</div>
						</Card.Content>
					</Card>

					{/* Connection / Transport */}
					<Card variant="default" className="mb-6">
						<Card.Header>
							<Card.Title>{t("transport")}</Card.Title>
						</Card.Header>
						<Card.Content>
							<Table>
								<Table.ScrollContainer>
									<Table.Content aria-label="Transport details">
										<Table.Header>
											<Table.Column isRowHeader className="w-24">
												{t("type")}
											</Table.Column>
											<Table.Column>
												{t("details")}
											</Table.Column>
										</Table.Header>
										<Table.Body>
											<Table.Row>
												<Table.Cell>{t("type")}</Table.Cell>
												<Table.Cell>{group.transport.type}</Table.Cell>
											</Table.Row>
											{group.transport.type === "stdio" && (
												<>
													<Table.Row>
														<Table.Cell>{t("command")}</Table.Cell>
														<Table.Cell>{group.transport.command}</Table.Cell>
													</Table.Row>
													{group.transport.args && group.transport.args.length > 0 && (
														<Table.Row>
															<Table.Cell>{t("args")}</Table.Cell>
															<Table.Cell>
																<code className="font-mono text-xs break-all">
																	{group.transport.args.join(" ")}
																</code>
															</Table.Cell>
														</Table.Row>
													)}
												</>
											)}
											{(group.transport.type === "sse" || group.transport.type === "streamable_http") && (
												<Table.Row>
													<Table.Cell>{t("url")}</Table.Cell>
													<Table.Cell>
														<code className="font-mono text-xs break-all">
															{group.transport.url}
														</code>
													</Table.Cell>
												</Table.Row>
											)}
										</Table.Body>
									</Table.Content>
								</Table.ScrollContainer>
							</Table>
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
												.map((i) =>
													i.agent
														? i.agent
																.charAt(0)
																.toUpperCase() +
															i.agent
																.slice(1)
																.toLowerCase()
														: "Default",
												)
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
									: t("remove")}
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
