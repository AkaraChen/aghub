import {
	CheckCircleIcon,
	CommandLineIcon,
	GlobeAltIcon,
	LinkIcon,
} from "@heroicons/react/24/solid";
import { Button, Card, toast } from "@heroui/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useTranslation } from "react-i18next";
import { siGithub } from "simple-icons";
import type {
	MarketMcpInstallMethod,
	MarketMcpServer,
	MarketMcpTransport,
} from "../../generated/dto";
import { mcpTransportLabel } from "./mcp-transport";

interface McpMarketCardProps {
	server: MarketMcpServer;
	installed: boolean;
	onAction: () => void;
}

export function mcpMarketRepositoryKind(
	repositoryUrl: string,
): "github" | "other" {
	return new URL(repositoryUrl).hostname === "github.com"
		? "github"
		: "other";
}

export function mcpMarketTransportTypes(
	methods: MarketMcpInstallMethod[],
): MarketMcpTransport["type"][] {
	return methods
		.map((method) => method.transport.type)
		.filter((type, index, types) => types.indexOf(type) === index);
}

function McpTransport({ type }: { type: MarketMcpTransport["type"] }) {
	const Icon = type === "stdio" ? CommandLineIcon : GlobeAltIcon;
	return (
		<span className="inline-flex items-center gap-1 text-xs text-muted">
			<Icon aria-hidden="true" className="size-3.5 shrink-0" />
			{mcpTransportLabel(type)}
		</span>
	);
}

export function McpMarketCard({
	server,
	installed,
	onAction,
}: McpMarketCardProps) {
	const { t, i18n } = useTranslation();
	const repositoryUrl = server.repository_url;
	const firstMethod = server.install_methods[0];
	const transportTypes = mcpMarketTransportTypes(server.install_methods);
	const timestamp = server.updated_at ?? server.published_at;
	const date = timestamp ? new Date(timestamp) : null;
	const dateLabel =
		date && !Number.isNaN(date.getTime())
			? date.toLocaleDateString(i18n.language)
			: timestamp;

	return (
		<Card className="flex h-full min-w-0 flex-col gap-0 p-4 !rounded-lg">
			<Card.Header className="flex flex-row items-start gap-2 p-0">
				<div className="min-w-0 flex-1">
					<Card.Title className="text-sm font-semibold [overflow-wrap:anywhere]">
						{server.name}
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
						{mcpMarketRepositoryKind(repositoryUrl) === "github" ? (
							<svg
								aria-hidden="true"
								viewBox="0 0 24 24"
								fill="currentColor"
								className="size-4"
							>
								<path d={siGithub.path} />
							</svg>
						) : (
							<LinkIcon aria-hidden="true" className="size-4" />
						)}
					</Button>
				)}
			</Card.Header>
			<Card.Content className="flex flex-1 flex-col gap-3 p-0 pt-2.5">
				<div className="flex flex-wrap items-center gap-x-3 gap-y-1">
					{transportTypes.length > 0 ? (
						transportTypes.map((type) => (
							<McpTransport key={type} type={type} />
						))
					) : (
						<span className="text-xs text-muted">
							{t("marketMcpNoSupportedMethod")}
						</span>
					)}
				</div>
				<p className="flex-1 whitespace-pre-line text-xs leading-relaxed text-muted [overflow-wrap:anywhere]">
					{server.description}
				</p>
			</Card.Content>
			<Card.Footer className="flex w-full items-end justify-between gap-2 p-0 pt-5">
				<div className="flex min-w-0 flex-1 flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted [overflow-wrap:anywhere]">
					{server.version && <span>v{server.version}</span>}
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
				{firstMethod && (
					<Button
						variant={installed ? "secondary" : "tertiary"}
						size="sm"
						onPress={onAction}
					>
						{installed ? (
							<span className="flex items-center gap-1">
								<CheckCircleIcon
									aria-hidden="true"
									className="size-3.5 text-success"
								/>
								{t("marketMcpInstalled")}
							</span>
						) : (
							t("marketMcpAdd")
						)}
					</Button>
				)}
			</Card.Footer>
		</Card>
	);
}
