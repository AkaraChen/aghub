import {
	BuildingStorefrontIcon,
	CodeBracketIcon,
	PuzzlePieceIcon,
	ServerIcon,
	SparklesIcon,
} from "@heroicons/react/24/solid";
import { Button, Card, Spinner, Surface, Tabs } from "@heroui/react";
import { useQueryState } from "nuqs";
import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { cn } from "../lib/utils";
import SkillsShPage from "./skills-sh";

const PluginMarketContent = lazy(() =>
	import("../components/plugin-market-content").then((module) => ({
		default: module.PluginMarketContent,
	})),
);
const ImportGithubSkillPanel = lazy(() =>
	import("../components/import-github-skill-panel").then((module) => ({
		default: module.ImportGithubSkillPanel,
	})),
);

function TabFallback() {
	return (
		<div className="flex h-full items-center justify-center">
			<Spinner />
		</div>
	);
}

const MARKET_TAB_IDS = [
	"skills-sh",
	"mcp",
	"claude-plugins",
	"github",
] as const;
type MarketTabId = (typeof MARKET_TAB_IDS)[number];

interface McpMarketEntry {
	id: string;
	name: string;
	publisher: string;
	description: string;
	transport: "stdio" | "http";
	tags: string[];
}

const MOCK_MCP_SERVERS: McpMarketEntry[] = [
	{
		id: "filesystem",
		name: "Filesystem",
		publisher: "modelcontextprotocol",
		description:
			"Read, write, and search files on the local filesystem with scoped permissions.",
		transport: "stdio",
		tags: ["official", "core"],
	},
	{
		id: "github",
		name: "GitHub",
		publisher: "modelcontextprotocol",
		description:
			"Browse repositories, issues, and PRs. Authenticated via personal access token.",
		transport: "stdio",
		tags: ["official", "git"],
	},
	{
		id: "postgres",
		name: "Postgres",
		publisher: "modelcontextprotocol",
		description:
			"Query Postgres databases with read-only or read-write modes.",
		transport: "stdio",
		tags: ["official", "database"],
	},
	{
		id: "slack",
		name: "Slack",
		publisher: "modelcontextprotocol",
		description: "Read and post Slack messages, search threads.",
		transport: "stdio",
		tags: ["official", "communication"],
	},
	{
		id: "puppeteer",
		name: "Puppeteer",
		publisher: "modelcontextprotocol",
		description:
			"Headless browser automation: navigate, screenshot, scrape, and interact with pages.",
		transport: "stdio",
		tags: ["official", "browser"],
	},
	{
		id: "memory",
		name: "Memory",
		publisher: "modelcontextprotocol",
		description:
			"Persistent knowledge graph memory for cross-session context.",
		transport: "stdio",
		tags: ["official", "core"],
	},
	{
		id: "brave-search",
		name: "Brave Search",
		publisher: "modelcontextprotocol",
		description:
			"Web search via the Brave Search API. Free tier available.",
		transport: "stdio",
		tags: ["search"],
	},
	{
		id: "linear",
		name: "Linear",
		publisher: "linear",
		description:
			"Read and update Linear issues, projects, and cycles via API.",
		transport: "http",
		tags: ["productivity"],
	},
	{
		id: "notion",
		name: "Notion",
		publisher: "notion",
		description: "Browse and update Notion pages, databases, and comments.",
		transport: "http",
		tags: ["productivity"],
	},
	{
		id: "sentry",
		name: "Sentry",
		publisher: "sentry",
		description:
			"Read errors, releases, and performance metrics from Sentry projects.",
		transport: "http",
		tags: ["observability"],
	},
	{
		id: "stripe",
		name: "Stripe",
		publisher: "stripe",
		description:
			"Inspect Stripe charges, subscriptions, and customers (read-only).",
		transport: "http",
		tags: ["payments"],
	},
	{
		id: "google-drive",
		name: "Google Drive",
		publisher: "modelcontextprotocol",
		description:
			"List, search, and read files from Google Drive (OAuth required).",
		transport: "stdio",
		tags: ["files"],
	},
];

function isMarketTabId(value: string | null): value is MarketTabId {
	return MARKET_TAB_IDS.includes(value as MarketTabId);
}

function McpMarketTab() {
	const { t } = useTranslation();
	const [, setLocation] = useLocation();

	return (
		<div className="flex flex-col gap-4">
			<Card variant="secondary" className="border border-dashed">
				<Card.Content className="flex items-start gap-3 py-3">
					<SparklesIcon className="size-5 shrink-0 text-warning" />
					<div className="text-sm">
						<p className="font-medium">
							{t("marketMcpComingSoonTitle")}
						</p>
						<p className="mt-0.5 text-xs text-muted">
							{t("marketMcpComingSoonHint")}
						</p>
					</div>
				</Card.Content>
			</Card>

			<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
				{MOCK_MCP_SERVERS.map((server) => (
					<Card key={server.id} variant="secondary">
						<Card.Header className="gap-1">
							<div className="flex items-start gap-2">
								<div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-surface">
									<ServerIcon className="size-4 text-muted" />
								</div>
								<div className="min-w-0 flex-1">
									<Card.Title className="truncate">
										{server.name}
									</Card.Title>
									<p className="truncate text-xs text-muted">
										{server.publisher}
									</p>
								</div>
							</div>
						</Card.Header>
						<Card.Content className="flex flex-col gap-3">
							<p className="line-clamp-3 text-sm text-muted">
								{server.description}
							</p>
							<div className="flex flex-wrap gap-1">
								{server.tags.map((tag) => (
									<span
										key={tag}
										className="rounded-full bg-surface px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted"
									>
										{tag}
									</span>
								))}
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
								onPress={() => setLocation("/mcp")}
							>
								{t("marketMcpAddManually")}
							</Button>
						</Card.Content>
					</Card>
				))}
			</div>
		</div>
	);
}

function ClaudePluginsTab() {
	return <PluginMarketContent enabled variant="page" />;
}

export default function MarketPage() {
	const { t } = useTranslation();
	const [tabParam, setTabParam] = useQueryState("tab", {
		defaultValue: "skills-sh",
	});
	const activeTab: MarketTabId = isMarketTabId(tabParam)
		? tabParam
		: "skills-sh";

	return (
		<div className="flex h-full flex-col">
			<header className="flex items-center gap-3 border-b border-border bg-surface-secondary px-4 py-3">
				<div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-surface">
					<BuildingStorefrontIcon className="size-5 text-muted" />
				</div>
				<div className="min-w-0 flex-1">
					<h1 className="truncate text-base font-semibold">
						{t("market")}
					</h1>
					<p className="truncate text-xs text-muted">
						{t("marketSubtitle")}
					</p>
				</div>
			</header>

			<Surface
				variant="secondary"
				className="border-b border-border px-4 py-2"
			>
				<Tabs
					selectedKey={activeTab}
					onSelectionChange={(key) =>
						setTabParam(String(key) as MarketTabId)
					}
				>
					<Tabs.ListContainer>
						<Tabs.List
							aria-label={t("marketSections")}
							className="inline-flex w-auto"
						>
							<Tabs.Tab
								id="skills-sh"
								className="px-4 whitespace-nowrap"
							>
								<span className="flex items-center gap-1.5">
									<SparklesIcon className="size-3.5" />
									{t("marketTabSkillsSh")}
								</span>
								<Tabs.Indicator />
							</Tabs.Tab>
							<Tabs.Tab
								id="mcp"
								className="px-4 whitespace-nowrap"
							>
								<span className="flex items-center gap-1.5">
									<ServerIcon className="size-3.5" />
									{t("marketTabMcp")}
								</span>
								<Tabs.Indicator />
							</Tabs.Tab>
							<Tabs.Tab
								id="claude-plugins"
								className="px-4 whitespace-nowrap"
							>
								<span className="flex items-center gap-1.5">
									<PuzzlePieceIcon className="size-3.5" />
									{t("marketTabClaudePlugins")}
								</span>
								<Tabs.Indicator />
							</Tabs.Tab>
							<Tabs.Tab
								id="github"
								className="px-4 whitespace-nowrap"
							>
								<span className="flex items-center gap-1.5">
									<CodeBracketIcon className="size-3.5" />
									{t("marketTabGithub")}
								</span>
								<Tabs.Indicator />
							</Tabs.Tab>
						</Tabs.List>
					</Tabs.ListContainer>
				</Tabs>
			</Surface>

			<div className="min-h-0 flex-1 overflow-y-auto">
				{activeTab === "skills-sh" && <SkillsShPage />}
				{activeTab === "mcp" && (
					<div className="p-4 sm:p-6">
						<McpMarketTab />
					</div>
				)}
				{activeTab === "claude-plugins" && (
					<Suspense fallback={<TabFallback />}>
						<ClaudePluginsTab />
					</Suspense>
				)}
				{activeTab === "github" && (
					<Suspense fallback={<TabFallback />}>
						<ImportGithubSkillPanel onDone={() => {}} />
					</Suspense>
				)}
			</div>
		</div>
	);
}
