import {
	ArrowTopRightOnSquareIcon,
	CheckCircleIcon,
	ServerIcon,
} from "@heroicons/react/24/solid";
import { Button, Card, toast } from "@heroui/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useTranslation } from "react-i18next";
import type { MarketMcpServer } from "../../generated/dto";
import { mcpTransportLabel } from "./mcp-transport";

interface McpMarketCardProps {
	server: MarketMcpServer;
	installed: boolean;
	onAction: () => void;
}

export function McpMarketCard({
	server,
	installed,
	onAction,
}: McpMarketCardProps) {
	const { t, i18n } = useTranslation();
	const repositoryUrl = server.repository_url;
	const firstMethod = server.install_methods[0];
	const timestamp = server.updated_at ?? server.published_at;
	const date = timestamp ? new Date(timestamp) : null;
	const dateLabel =
		date && !Number.isNaN(date.getTime())
			? date.toLocaleDateString(i18n.language)
			: timestamp;

	return (
		<Card className="flex h-full min-w-0 flex-col gap-0 p-3 !rounded-lg">
			<Card.Header className="flex flex-row items-start gap-2 p-0">
				<div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-surface">
					<ServerIcon className="size-4 text-muted" />
				</div>
				<div className="min-w-0 flex-1">
					<Card.Title className="text-sm font-medium [overflow-wrap:anywhere]">
						{server.display_name}
					</Card.Title>
				</div>
				{repositoryUrl && (
					<Button
						isIconOnly
						variant="ghost"
						size="sm"
						className="size-7 shrink-0 text-muted"
						aria-label={t("marketMcpViewSource")}
						onPress={() => {
							void openUrl(repositoryUrl).catch(() =>
								toast.danger(t("marketMcpOpenSourceError")),
							);
						}}
					>
						<ArrowTopRightOnSquareIcon className="size-4" />
					</Button>
				)}
			</Card.Header>
			<Card.Content className="flex flex-1 flex-col gap-2 p-0 pt-2">
				<p className="text-xs text-muted [overflow-wrap:anywhere]">
					{server.name}
				</p>
				<div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-muted [overflow-wrap:anywhere]">
					{server.version && (
						<span className="min-w-0">v{server.version}</span>
					)}
					{timestamp && (
						<span>
							{t(
								server.updated_at
									? "marketMcpUpdated"
									: "marketMcpPublished",
							)}{" "}
							<time dateTime={timestamp}>{dateLabel}</time>
						</span>
					)}
				</div>
				<p className="whitespace-pre-line text-xs leading-relaxed text-muted [overflow-wrap:anywhere]">
					{server.description}
				</p>
				<div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-1">
					<span className="text-xs text-muted">
						{server.install_methods.length > 1
							? t("marketMcpMethodCount", {
									count: server.install_methods.length,
								})
							: firstMethod
								? mcpTransportLabel(firstMethod.transport.type)
								: t("marketMcpNoSupportedMethod")}
					</span>
					{firstMethod && (
						<Button
							variant={installed ? "secondary" : "tertiary"}
							size="sm"
							onPress={onAction}
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
					)}
				</div>
			</Card.Content>
		</Card>
	);
}
