import {
	BuildingStorefrontIcon,
	CodeBracketIcon,
	PuzzlePieceIcon,
	ServerIcon,
	SparklesIcon,
} from "@heroicons/react/24/solid";
import { Spinner, Surface, Tabs } from "@heroui/react";
import { useQueryState } from "nuqs";
import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { LazyImportGithubSkillPanel } from "../components/lazy-import-github-skill-panel";
import { McpMarketTab } from "../components/mcp-market/mcp-market-tab";
import SkillsShPage from "./skills-sh";

const PluginMarketContent = lazy(() =>
	import("../components/plugin-market-content").then((module) => ({
		default: module.PluginMarketContent,
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

function isMarketTabId(value: string | null): value is MarketTabId {
	return MARKET_TAB_IDS.includes(value as MarketTabId);
}

function ClaudePluginsTab({
	installScope,
}: {
	installScope: "global" | "project" | "local";
}) {
	return (
		<PluginMarketContent
			enabled
			variant="page"
			installScope={installScope}
		/>
	);
}

export default function MarketPage() {
	const { t } = useTranslation();
	const [tabParam, setTabParam] = useQueryState("tab", {
		defaultValue: "skills-sh",
	});
	const activeTab: MarketTabId = isMarketTabId(tabParam)
		? tabParam
		: "skills-sh";
	const [scopeParam] = useQueryState("scope", { defaultValue: "global" });
	const pluginInstallScope: "global" | "project" | "local" =
		scopeParam === "project" || scopeParam === "local"
			? scopeParam
			: "global";

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
						<ClaudePluginsTab installScope={pluginInstallScope} />
					</Suspense>
				)}
				{activeTab === "github" && (
					<LazyImportGithubSkillPanel onDone={() => {}} />
				)}
			</div>
		</div>
	);
}
