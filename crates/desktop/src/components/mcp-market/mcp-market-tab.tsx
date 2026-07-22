import {
	ArrowPathIcon,
	MagnifyingGlassIcon,
	ServerIcon,
} from "@heroicons/react/24/solid";
import {
	Button,
	ListBox,
	SearchField,
	Select,
	Spinner,
	toast,
} from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { MarketMcpTransport } from "../../generated/dto";
import { useApi } from "../../hooks/use-api";
import { cn } from "../../lib/utils";
import { mcpMarketSearchQueryOptions } from "../../requests/mcp-market";
import { ManageAgentsDialog } from "../manage-agents-dialog";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { McpInstallModal } from "./mcp-install-modal";
import { McpMarketCard } from "./mcp-market-card";
import { McpSourceSelector } from "./mcp-source-selector";
import { mcpTransportLabel } from "./mcp-transport";
import { useMcpInstall } from "./use-mcp-install";

const ALL_TYPES = "__all__";
const TRANSPORT_TYPES: MarketMcpTransport["type"][] = [
	"stdio",
	"streamable_http",
	"sse",
];
type TransportFilter = MarketMcpTransport["type"] | typeof ALL_TYPES;

export function McpMarketTab() {
	const { t } = useTranslation();
	const api = useApi();
	const [input, setInput] = useState("");
	const [committedQuery, setCommittedQuery] = useState("");
	const [typeFilter, setTypeFilter] = useState<TransportFilter>(ALL_TYPES);
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
			: servers.filter((server) => server.transport.type === typeFilter);
	const visibleServers = filteredServers
		.map((server) => ({
			server,
			installed: install.isInstalled(server),
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
					onSelectionChange={(key) =>
						setTypeFilter(String(key) as TransportFilter)
					}
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
									: mcpTransportLabel(typeFilter)}
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
									textValue={mcpTransportLabel(transport)}
								>
									{mcpTransportLabel(transport)}
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
						void refetch().then((result) => {
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
							onPress={() => void refetch()}
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
					{visibleServers.map(({ server, installed }) => (
						<McpMarketCard
							key={server.name}
							server={server}
							installed={installed}
							onAction={() =>
								installed
									? install.handleManageClick(server)
									: install.handleInstallClick(server)
							}
						/>
					))}
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
				groups={install.manageGroup ? [install.manageGroup] : []}
				isOpen={install.isManageOpen}
				onClose={install.handleCloseManage}
				requiredCapabilities={["mcp"]}
			/>
		</div>
	);
}
