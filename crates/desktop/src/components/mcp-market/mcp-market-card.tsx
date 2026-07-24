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
	const { t } = useTranslation();
	const repositoryUrl = server.repository_url;
	const firstMethod = server.install_methods[0];

	return (
		<Card
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
				<p className="line-clamp-2 text-xs text-muted">
					{server.description}
				</p>
				<div className="mt-auto flex items-center justify-between gap-2 pt-1">
					<span className="text-xs text-muted">
						{server.install_methods.length > 1
							? t("marketMcpMethodCount", {
									count: server.install_methods.length,
								})
							: firstMethod
								? mcpTransportLabel(firstMethod.transport.type)
								: null}
					</span>
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
				</div>
			</Card.Content>
		</Card>
	);
}
