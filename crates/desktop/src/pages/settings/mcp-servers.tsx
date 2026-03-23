import {
	ArrowPathIcon,
	CommandLineIcon,
	DocumentDuplicateIcon,
	ExclamationTriangleIcon,
	PencilIcon,
	PlusIcon,
	TrashIcon,
	WifiIcon,
} from "@heroicons/react/24/solid";
import {
	Button,
	Chip,
	Label,
	ListBox,
	Modal,
	SearchField,
	type Selection,
	Table,
} from "@heroui/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { CreateMcpDialog } from "../../components/create-mcp-dialog";
import { EditMcpDialog } from "../../components/edit-mcp-dialog";
import { useMcps } from "../../hooks/use-mcps";
import { createApi } from "../../lib/api";
import type { McpResponse } from "../../lib/api-types";
import { useServer } from "../../providers/server";
import { getMcpMergeKey } from "../../lib/utils";

interface McpGroup {
	mergeKey: string;
	transport: McpResponse["transport"];
	items: McpResponse[];
}

export default function MCPServersPage() {
	const { t } = useTranslation();
	const { baseUrl } = useServer();
	const api = createApi(baseUrl);
	const queryClient = useQueryClient();
	const { data: mcps, refetch } = useMcps();
	const [searchQuery, setSearchQuery] = useState("");
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
	const [editDialogOpen, setEditDialogOpen] = useState(false);
	const [createDialogOpen, setCreateDialogOpen] = useState(false);
	const [groupToDelete, setGroupToDelete] = useState<McpGroup | null>(null);

	const filteredServers = useMemo(
		() =>
			mcps.filter(
				(server) =>
					server.name
						.toLowerCase()
						.includes(searchQuery.toLowerCase()) ||
					(server.source ?? "")
						.toLowerCase()
						.includes(searchQuery.toLowerCase()) ||
					(server.agent ?? "")
						.toLowerCase()
						.includes(searchQuery.toLowerCase()),
			),
		[mcps, searchQuery],
	);

	const groupedMcps = useMemo(() => {
		const map = new Map<string, McpResponse[]>();

		for (const mcp of filteredServers) {
			const key = getMcpMergeKey(mcp.transport);
			const existing = map.get(key) ?? [];
			map.set(key, [...existing, mcp]);
		}

		return Array.from(map.entries()).map(([mergeKey, items]) => ({
			mergeKey,
			transport: items[0].transport,
			items,
		}));
	}, [filteredServers]);

	const [selected, setSelected] = useState<Selection>(
		new Set(groupedMcps[0] ? [groupedMcps[0].mergeKey] : []),
	);

	const selectedKey = [...(selected as Set<string>)][0];
	const selectedGroup =
		groupedMcps.find((g) => g.mergeKey === selectedKey) ?? null;

	const getTransportIcon = (transport: McpGroup["transport"]) => {
		if (transport.type === "stdio") {
			return <CommandLineIcon className="size-4 shrink-0" />;
		}
		return <WifiIcon className="size-4 shrink-0" />;
	};

	const deleteMutation = useMutation({
		mutationFn: (group: McpGroup) => {
			return Promise.all(
				group.items.map((item) => {
					const scope = item.source === "Project" ? "project" : "global";
					return api.mcps.delete(
						item.name,
						item.agent ?? "default",
						scope,
					);
				}),
			);
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["mcps"] });
			setDeleteDialogOpen(false);
			setGroupToDelete(null);
			if (
				selectedGroup &&
				groupToDelete &&
				selectedGroup.mergeKey === groupToDelete.mergeKey
			) {
				setSelected(new Set());
			}
		},
		onError: (error) => {
			console.error("Failed to delete MCP servers:", error);
		},
	});

	const handleDeleteClick = (group: McpGroup) => {
		setGroupToDelete(group);
		setDeleteDialogOpen(true);
	};

	const handleConfirmDelete = () => {
		if (groupToDelete) {
			deleteMutation.mutate(groupToDelete);
		}
	};

	const handleCopy = (group: McpGroup) => {
		const primary = group.items[0];
		const config = {
			name: primary.name,
			transport: primary.transport,
			timeout: primary.timeout,
		};
		console.log("Copy config:", JSON.stringify(config, null, 2));
	};

	return (
		<div className="flex h-full">
			{/* Servers List Panel */}
			<div className="w-80 shrink-0 border-r border-border flex flex-col">
				{/* Search Header */}
				<div className="flex items-center gap-2 p-3 border-b border-border">
					<SearchField
						value={searchQuery}
						onChange={setSearchQuery}
						aria-label={t("searchServers")}
						variant="secondary"
						className="flex-1 min-w-0"
					>
						<SearchField.Group>
							<SearchField.SearchIcon />
							<SearchField.Input
								placeholder={t("searchServers")}
							/>
							<SearchField.ClearButton />
						</SearchField.Group>
					</SearchField>
					<Button
						isIconOnly
						variant="ghost"
						size="sm"
						className="shrink-0"
						aria-label={t("addMcpServer")}
						onPress={() => setCreateDialogOpen(true)}
					>
						<PlusIcon className="size-4" />
					</Button>
					<Button
						isIconOnly
						variant="ghost"
						size="sm"
						className="shrink-0"
						aria-label={t("refreshServers")}
						onPress={() => refetch()}
					>
						<ArrowPathIcon className="size-4" />
					</Button>
				</div>

				{/* Servers List */}
				<ListBox
					aria-label="MCP Servers"
					selectionMode="single"
					selectedKeys={selected}
					onSelectionChange={setSelected}
					className="flex-1 overflow-y-auto p-2"
				>
					{groupedMcps.map((group) => (
						<ListBox.Item
							key={group.mergeKey}
							id={group.mergeKey}
							textValue={group.items[0].name}
							className="data-[selected]:bg-accent/10"
						>
							<div className="flex items-center gap-2 w-full">
								{getTransportIcon(group.transport)}
								<Label className="truncate flex-1">
									{group.items[0].name}
								</Label>
								{group.items.length > 1 && (
									<Chip size="sm" variant="soft" color="accent">
										{group.items.length}
									</Chip>
								)}
							</div>
						</ListBox.Item>
					))}
				</ListBox>
				{groupedMcps.length === 0 && (
					<p className="px-3 py-6 text-sm text-muted text-center">
						{t("noServersMatch")} &ldquo;{searchQuery}&rdquo;
					</p>
				)}
			</div>

			{/* Server Detail Panel */}
			<div className="flex-1 overflow-hidden">
				{selectedGroup ? (
					<div className="h-full overflow-y-auto">
						<div className="p-6 max-w-3xl">
							{/* Header */}
							<div className="flex items-center justify-between gap-3 mb-2">
								<h2 className="text-xl font-semibold text-foreground truncate">
									{selectedGroup.items[0].name}
								</h2>
								<div className="flex items-center gap-1">
									<Button
										isIconOnly
										variant="ghost"
										size="sm"
										className="text-muted hover:text-foreground shrink-0"
										aria-label={t("copy")}
										onPress={() => handleCopy(selectedGroup)}
									>
										<DocumentDuplicateIcon className="size-4" />
									</Button>
									<Button
										isIconOnly
										variant="ghost"
										size="sm"
										className="text-muted hover:text-foreground shrink-0"
										aria-label={t("edit")}
										onPress={() => setEditDialogOpen(true)}
									>
										<PencilIcon className="size-4" />
									</Button>
									<Button
										isIconOnly
										variant="ghost"
										size="sm"
										className="text-muted hover:text-danger shrink-0"
										aria-label={t("remove")}
										onPress={() =>
											handleDeleteClick(selectedGroup)
										}
									>
										<TrashIcon className="size-4" />
									</Button>
								</div>
							</div>

							{/* Agents Section */}
							<div className="mb-6">
								<h3 className="text-xs font-medium text-muted uppercase tracking-wide mb-2">
									{t("agents")} ({selectedGroup.items.length})
								</h3>
								<div className="flex flex-wrap gap-1.5">
									{selectedGroup.items.map((item) => (
										<div key={item.agent ?? "default"} className="flex items-center gap-1">
											<Chip size="sm" variant="secondary">
												{item.agent ? item.agent.charAt(0).toUpperCase() + item.agent.slice(1).toLowerCase() : "Default"}
											</Chip>
											{!item.enabled && (
												<Chip size="sm" variant="soft" color="warning">
													{t("disabled")}
												</Chip>
											)}
										</div>
									))}
								</div>
							</div>

							{/* Connection / Transport */}
							<div className="mb-6">
								<h3 className="text-xs font-medium text-muted uppercase tracking-wide mb-3">
									{t("transport")}
								</h3>
								<Table>
									<Table.ScrollContainer>
										<Table.Content aria-label="Transport details">
											<Table.Header>
												<Table.Column
													isRowHeader
													className="w-24"
												>
													{t("type")}
												</Table.Column>
												<Table.Column>
													Value
												</Table.Column>
											</Table.Header>
											<Table.Body>
												<Table.Row>
													<Table.Cell>
														{t("type")}
													</Table.Cell>
													<Table.Cell>
														{
															selectedGroup
																.transport.type
														}
													</Table.Cell>
												</Table.Row>
												{selectedGroup.transport
													.type === "stdio" && (
													<>
														<Table.Row>
															<Table.Cell>
																{t("command")}
															</Table.Cell>
															<Table.Cell>
																{
																	selectedGroup
																		.transport
																		.command
																}
															</Table.Cell>
														</Table.Row>
														{selectedGroup
															.transport.args &&
															selectedGroup
																.transport.args
																.length > 0 && (
																<Table.Row>
																	<Table.Cell>
																		{t(
																			"args",
																		)}
																	</Table.Cell>
																	<Table.Cell>
																		<code className="font-mono text-xs break-all">
																			{selectedGroup.transport.args.join(
																				" ",
																			)}
																		</code>
																	</Table.Cell>
																</Table.Row>
															)}
													</>
												)}
												{(selectedGroup.transport
													.type === "sse" ||
													selectedGroup.transport
														.type ===
														"streamable_http") && (
													<Table.Row>
														<Table.Cell>
															{t("url")}
														</Table.Cell>
														<Table.Cell>
															<code className="font-mono text-xs break-all">
																{
																	selectedGroup
																		.transport
																		.url
																}
															</code>
														</Table.Cell>
													</Table.Row>
												)}
											</Table.Body>
										</Table.Content>
									</Table.ScrollContainer>
								</Table>
							</div>
						</div>
					</div>
				) : (
					<div className="flex items-center justify-center h-full">
						<p className="text-sm text-muted">
							{t("selectServer")}
						</p>
					</div>
				)}
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
								{groupToDelete && groupToDelete.items.length > 1
									? t("deleteMcpMultipleConfirm", {
											name: groupToDelete.items[0].name,
											count: groupToDelete.items.length,
											agents: groupToDelete.items.map(i =>
												i.agent ? i.agent.charAt(0).toUpperCase() + i.agent.slice(1).toLowerCase() : "Default"
											).join(", "),
										})
									: t("deleteMcpServerConfirm", {
											name: groupToDelete?.items[0]?.name,
										})
								}
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
								onPress={handleConfirmDelete}
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

			{/* Edit Dialog */}
			{selectedGroup && (
				<EditMcpDialog
					group={selectedGroup}
					isOpen={editDialogOpen}
					onClose={() => setEditDialogOpen(false)}
				/>
			)}

			{/* Create Dialog */}
			<CreateMcpDialog
				isOpen={createDialogOpen}
				onClose={() => setCreateDialogOpen(false)}
			/>
		</div>
	);
}
