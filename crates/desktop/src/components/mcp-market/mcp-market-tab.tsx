import { MagnifyingGlassIcon } from "@heroicons/react/24/solid";
import { Button, Spinner, toast } from "@heroui/react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useApi } from "../../hooks/use-api";
import { mcpMarketSearchQueryOptions } from "../../requests/mcp-market";
import { ManageAgentsDialog } from "../manage-agents-dialog";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "../ui/empty";
import { McpInstallModal } from "./mcp-install-modal";
import { McpInstalledLocationModal } from "./mcp-installed-location-modal";
import { McpMarketCard } from "./mcp-market-card";
import { useMcpInstall } from "./use-mcp-install";

import {
	ALL_TYPES,
	McpMarketToolbar,
	type TransportFilter,
} from "./mcp-market-toolbar";

export function McpMarketTab() {
	const { t } = useTranslation();
	const api = useApi();
	const [committedQuery, setCommittedQuery] = useState("");
	const [typeFilter, setTypeFilter] = useState<TransportFilter>(ALL_TYPES);
	const [registryUrl, setRegistryUrl] = useState<string | null>(null);
	const install = useMcpInstall();
	const {
		data,
		isFetching,
		isError,
		isFetchNextPageError,
		isFetchingNextPage,
		hasNextPage,
		fetchNextPage,
		refetch,
	} = useInfiniteQuery(
		mcpMarketSearchQueryOptions({
			api,
			query: committedQuery,
			registryUrl,
		}),
	);

	const servers = data?.pages.flatMap((page) => page.servers) ?? [];
	const filteredServers =
		typeFilter === ALL_TYPES
			? servers
			: servers.filter((server) =>
					server.install_methods.some(
						(method) => method.transport.type === typeFilter,
					),
				);
	const visibleServers = filteredServers.map((server) => ({
		server,
		installed: install.isInstalled(server),
	}));
	const showInitialSpinner =
		(isFetching && !data) || install.isInventoryPending;

	return (
		<div className="flex flex-col gap-4">
			<McpMarketToolbar
				typeFilter={typeFilter}
				isFetching={isFetching}
				onSourceChange={setRegistryUrl}
				onSearch={setCommittedQuery}
				onTypeChange={setTypeFilter}
				onRefresh={() => {
					void refetch().then((result) => {
						if (result.isError) {
							toast.danger(t("marketMcpLoadError"));
						} else {
							toast.success(
								t("marketMcpRefreshed", {
									count:
										result.data?.pages.reduce(
											(count, page) =>
												count + page.servers.length,
											0,
										) ?? 0,
								}),
							);
						}
					});
				}}
			/>

			{isError && !data ? (
				<div className="flex flex-1 items-center justify-center py-12">
					<Empty className="border-0">
						<EmptyHeader>
							<EmptyTitle className="text-base">
								{t("marketMcpLoadErrorTitle")}
							</EmptyTitle>
							<EmptyDescription>
								{t("marketMcpLoadErrorDescription")}
							</EmptyDescription>
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
			) : install.isInventoryError ? (
				<div className="flex flex-1 items-center justify-center py-12">
					<Empty className="border-0">
						<EmptyHeader>
							<EmptyTitle className="text-base">
								{t("marketMcpInventoryErrorTitle")}
							</EmptyTitle>
							<EmptyDescription>
								{t("marketMcpInventoryErrorDescription")}
							</EmptyDescription>
						</EmptyHeader>
						<Button
							variant="secondary"
							size="sm"
							className="mt-2"
							onPress={() => void install.refetchInventory()}
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
								{t(
									hasNextPage
										? "marketMcpNoMatchesLoaded"
										: "noResults",
								)}
							</EmptyTitle>
						</EmptyHeader>
					</Empty>
				</div>
			) : (
				<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
					{visibleServers.map(({ server, installed }) => (
						<McpMarketCard
							key={`${server.name}:${server.version}`}
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

			{data &&
				!install.isInventoryPending &&
				!install.isInventoryError && (
					<div className="flex flex-wrap items-center justify-between gap-3">
						<p className="text-xs text-muted" role="status">
							{t("marketMcpSourceOrder", {
								count: visibleServers.length,
							})}
						</p>
						{hasNextPage && (
							<Button
								variant="secondary"
								size="sm"
								isPending={isFetchingNextPage}
								isDisabled={isFetching && !isFetchingNextPage}
								onPress={() => {
									void fetchNextPage().then((result) => {
										if (result.isFetchNextPageError)
											toast.danger(
												t("marketMcpLoadError"),
											);
									});
								}}
							>
								{isFetchingNextPage && (
									<Spinner size="sm" color="current" />
								)}
								{t(
									isFetchNextPageError
										? "marketMcpRetryPage"
										: "marketMcpLoadMore",
								)}
							</Button>
						)}
					</div>
				)}

			<McpInstallModal
				isOpen={install.installModalOpen}
				server={install.selectedServer}
				selectedMethod={install.selectedMethod}
				onMethodChange={install.setSelectedMethod}
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

			<McpInstalledLocationModal
				isOpen={install.isLocationPickerOpen}
				locations={install.manageLocations}
				onSelect={install.handleManageLocationSelect}
				onClose={install.handleCloseLocationPicker}
			/>

			<ManageAgentsDialog
				groups={install.manageGroup ? [install.manageGroup] : []}
				isOpen={install.isManageOpen}
				onClose={install.handleCloseManage}
				projectPath={install.manageProjectPath}
				requiredCapabilities={["mcp"]}
			/>
		</div>
	);
}
