import {
	InformationCircleIcon,
	MagnifyingGlassIcon,
	ServerIcon,
} from "@heroicons/react/24/solid";
import { Button, Card, SearchField, Spinner } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { siGithub } from "simple-icons";
import { useApi } from "../../hooks/use-api";
import { cn } from "../../lib/utils";
import { mcpMarketSearchQueryOptions } from "../../requests/mcp-market";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { McpInstallModal } from "./mcp-install-modal";
import { useMcpInstall } from "./use-mcp-install";

export function McpMarketTab() {
	const { t } = useTranslation();
	const api = useApi();
	const [input, setInput] = useState("");
	const [committedQuery, setCommittedQuery] = useState("");
	const install = useMcpInstall();

	const {
		data: servers = [],
		isFetching,
		isError,
		refetch,
	} = useQuery(mcpMarketSearchQueryOptions({ api, query: committedQuery }));

	const showInitialSpinner = isFetching && servers.length === 0;

	return (
		<div className="flex flex-col gap-4">
			<SearchField
				value={input}
				onChange={(value) => {
					setInput(value);
					if (value === "") setCommittedQuery("");
				}}
				onSubmit={(value) => setCommittedQuery(value.trim())}
				aria-label={t("marketMcpSearchLabel")}
				variant="secondary"
				className="w-full max-w-md"
			>
				<SearchField.Group>
					<SearchField.SearchIcon />
					<SearchField.Input
						placeholder={t("marketMcpSearchPlaceholder")}
					/>
					<SearchField.ClearButton />
				</SearchField.Group>
			</SearchField>

			<div className="flex items-start gap-2 text-xs text-muted">
				<InformationCircleIcon className="mt-0.5 size-4 shrink-0" />
				<p>{t("marketMcpSourceNote")}</p>
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
			) : servers.length === 0 ? (
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
				<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
					{servers.map((server) => {
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
									<div className="flex flex-wrap gap-1">
										<span
											className={cn(
												"rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider",
												server.transport === "stdio"
													? "bg-success/15 text-success"
													: "bg-accent/15 text-accent",
											)}
										>
											{server.transport}
										</span>
									</div>
									<Button
										variant="tertiary"
										size="sm"
										className="mt-auto self-start"
										onPress={() =>
											install.handleInstallClick(server)
										}
									>
										{t("marketMcpAdd")}
									</Button>
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
		</div>
	);
}
