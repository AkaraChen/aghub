import {
	ArrowPathIcon,
	CheckCircleIcon,
	MagnifyingGlassIcon,
	ServerIcon,
} from "@heroicons/react/24/solid";
import {
	Button,
	Card,
	ListBox,
	SearchField,
	Select,
	Spinner,
	toast,
} from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { siGithub } from "simple-icons";
import { useApi } from "../../hooks/use-api";
import { marketMcpIdentityKey } from "../../lib/mcp-market-utils";
import { cn } from "../../lib/utils";
import { mcpMarketSearchQueryOptions } from "../../requests/mcp-market";
import type { McpGroup } from "../mcp-detail";
import { ManageAgentsDialog } from "../manage-agents-dialog";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { McpInstallModal } from "./mcp-install-modal";
import { McpSourceSelector } from "./mcp-source-selector";
import { useMcpInstall } from "./use-mcp-install";

const ALL_TYPES = "__all__";
const TRANSPORT_TYPES = ["stdio", "streamable_http", "sse"] as const;

// Friendlier display names for transport kinds (protocol names, locale-neutral).
const TRANSPORT_LABELS: Record<string, string> = {
	stdio: "stdio",
	streamable_http: "HTTP",
	sse: "SSE",
};
const transportLabel = (transport: string) =>
	TRANSPORT_LABELS[transport] ?? transport;

// Fallback while no entry is selected for management; the dialog is closed then.
const EMPTY_MANAGE_GROUP: McpGroup = {
	mergeKey: "",
	transport: {
		type: "stdio",
		command: "",
		args: [],
		env: null,
		timeout: null,
	},
	items: [],
};

export function McpMarketTab() {
	const { t } = useTranslation();
	const api = useApi();
	const [input, setInput] = useState("");
	const [committedQuery, setCommittedQuery] = useState("");
	const [typeFilter, setTypeFilter] = useState<string>(ALL_TYPES);
	const [registryUrl, setRegistryUrl] = useState<string | null>(null);
	const install = useMcpInstall();

	const {
		data: servers = [],
		isFetching,
		isError,
		refetch,
	} = useQuery(
		mcpMarketSearchQueryOptions({
			api,
			query: committedQuery,
			registryUrl,
		}),
	);

	const filteredServers =
		typeFilter === ALL_TYPES
			? servers
			: servers.filter((server) => server.transport === typeFilter);
	// Installed entries sink to the bottom; a freshly installed card moves down
	// reactively as install.installedKeys updates after the create mutation.
	const visibleServers = filteredServers
		.map((server) => ({
			server,
			installed: install.installedKeys.has(marketMcpIdentityKey(server)),
		}))
		.sort((a, b) => Number(a.installed) - Number(b.installed));
	const showInitialSpinner = isFetching && servers.length === 0;

	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-wrap items-center gap-2">
				<McpSourceSelector onChange={setRegistryUrl} />
				<SearchField
					value={input}
					onChange={(value) => {
						setInput(value);
						if (value === "") setCommittedQuery("");
					}}
					onSubmit={(value) => setCommittedQuery(value.trim())}
					aria-label={t("marketMcpSearchLabel")}
					variant="secondary"
					className="min-w-0 flex-1"
				>
					<SearchField.Group>
						<SearchField.SearchIcon />
						<SearchField.Input
							placeholder={t("marketMcpSearchPlaceholder")}
						/>
						<SearchField.ClearButton />
					</SearchField.Group>
				</SearchField>
				<Select
					variant="secondary"
					aria-label={t("marketMcpTypeFilter")}
					selectedKey={typeFilter}
					onSelectionChange={(key) => setTypeFilter(String(key))}
					className="min-w-32 max-w-40 shrink-0"
				>
					<Select.Trigger>
						<Select.Value>
							<span className="truncate">
								<span className="text-muted">
									{t("marketMcpTypePrefix")}
								</span>
								{typeFilter === ALL_TYPES
									? t("all")
									: transportLabel(typeFilter)}
							</span>
						</Select.Value>
						<Select.Indicator />
					</Select.Trigger>
					<Select.Popover>
						<ListBox>
							<ListBox.Item id={ALL_TYPES} textValue={t("all")}>
								{t("all")}
							</ListBox.Item>
							{TRANSPORT_TYPES.map((transport) => (
								<ListBox.Item
									key={transport}
									id={transport}
									textValue={transportLabel(transport)}
								>
									{transportLabel(transport)}
								</ListBox.Item>
							))}
						</ListBox>
					</Select.Popover>
				</Select>
				<Button
					isIconOnly
					variant="ghost"
					size="sm"
					className="size-9 shrink-0"
					aria-label={t("refresh")}
					onPress={() => {
						refetch().then((result) => {
							if (result.isError) {
								toast.danger(t("marketMcpLoadError"));
							} else {
								toast.success(
									t("marketMcpRefreshed", {
										count: result.data?.length ?? 0,
									}),
								);
							}
						});
					}}
				>
					<ArrowPathIcon
						className={cn("size-4", isFetching && "animate-spin")}
					/>
				</Button>
			</div>

			{isError ? (
				<div className="flex flex-1 items-center justify-center py-12">
					<Empty className="border-0">
						<EmptyHeader>
							<EmptyMedia>
								<ServerIcon className="size-8 text-muted" />
							</EmptyMedia>
							<EmptyTitle className="text-sm font-normal text-muted">
								{t("marketMcpLoadError")}
							</EmptyTitle>
						</EmptyHeader>
						<Button
							variant="secondary"
							size="sm"
							className="mt-2"
							onPress={() => refetch()}
						>
							{t("retry")}
						</Button>
					</Empty>
				</div>
			) : showInitialSpinner ? (
				<div className="flex items-center justify-center py-12">
					<Spinner size="lg" />
				</div>
			) : filteredServers.length === 0 ? (
				<div className="flex flex-1 items-center justify-center py-12">
					<Empty className="border-0">
						<EmptyHeader>
							<EmptyMedia>
								<MagnifyingGlassIcon className="size-8 text-muted" />
							</EmptyMedia>
							<EmptyTitle className="text-sm font-normal text-muted">
								{t("noResults")}
							</EmptyTitle>
						</EmptyHeader>
					</Empty>
				</div>
			) : (
				<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
					{visibleServers.map(({ server, installed }) => {
						const repoUrl = server.repository_url;
						return (
							<Card
								key={server.name}
								variant="secondary"
								className="flex h-full flex-col gap-0 overflow-hidden p-3 dark:shadow-[0_2px_4px_0_#0000004d,0_1px_2px_0_#00000066,0_0_1px_0_#00000066]"
							>
								<Card.Header className="flex flex-row items-center gap-2 p-0">
									<div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-surface">
										<ServerIcon className="size-4 text-muted" />
									</div>
									<div className="min-w-0 flex-1">
										<Card.Title className="truncate text-sm font-medium">
											{server.display_name}
										</Card.Title>
										<p className="truncate text-xs text-muted">
											{server.publisher}
										</p>
									</div>
									{repoUrl && (
										<Button
											isIconOnly
											variant="ghost"
											size="sm"
											className="size-7 shrink-0 text-muted"
											aria-label={t(
												"marketMcpViewSource",
											)}
											onPress={() => openUrl(repoUrl)}
										>
											<svg
												viewBox="0 0 24 24"
												fill="currentColor"
												className="size-4"
												aria-hidden="true"
											>
												<path d={siGithub.path} />
											</svg>
										</Button>
									)}
								</Card.Header>
								<Card.Content className="flex flex-1 flex-col gap-2 p-0 pt-2">
									<p className="line-clamp-2 text-xs text-muted">
										{server.description}
									</p>
									<div className="mt-auto flex items-center justify-between gap-2 pt-1">
										<span
											className={cn(
												"shrink-0 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider",
												server.transport === "stdio"
													? "bg-success/15 text-success"
													: "bg-accent/15 text-accent",
											)}
										>
											{transportLabel(server.transport)}
										</span>
										<Button
											variant={
												installed
													? "secondary"
													: "tertiary"
											}
											size="sm"
											onPress={() =>
												installed
													? install.handleManageClick(
															server,
														)
													: install.handleInstallClick(
															server,
														)
											}
										>
											{installed ? (
												<span className="flex items-center gap-1">
													<CheckCircleIcon className="size-3.5 text-success" />
													{t("marketMcpInstalled")}
												</span>
											) : (
												t("marketMcpAdd")
											)}
										</Button>
									</div>
								</Card.Content>
							</Card>
						);
					})}
				</div>
			)}

			<McpInstallModal
				isOpen={install.installModalOpen}
				server={install.selectedServer}
				selectedAgents={install.selectedAgents}
				onSelectedAgentsChange={install.setSelectedAgents}
				fieldValues={install.fieldValues}
				onFieldChange={install.setFieldValue}
				installResults={install.installResults}
				isInstalling={install.isInstalling}
				mcpAgents={install.mcpAgents}
				installToProject={install.installToProject}
				canInstallToProject={install.canInstallToProject}
				onInstallToProjectChange={install.setInstallToProject}
				selectedProjectId={install.selectedProjectId}
				onSelectedProjectIdChange={install.setSelectedProjectId}
				projects={install.projects}
				onClose={install.handleCloseInstallModal}
				onInstall={install.handleInstall}
			/>

			<ManageAgentsDialog
				group={install.manageGroup ?? EMPTY_MANAGE_GROUP}
				isOpen={install.isManageOpen}
				onClose={install.handleCloseManage}
				requiredCapabilities={["mcp"]}
			/>
		</div>
	);
}
