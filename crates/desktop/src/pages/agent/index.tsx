import { FolderOpenIcon } from "@heroicons/react/24/solid";
import { Button, Surface, Tabs, toast } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { Suspense } from "react";
import { useTranslation } from "react-i18next";
import { Route, Switch, useLocation, useParams } from "wouter";
import { Redirect } from "../../components/redirect";
import { ErrorBoundary } from "../../components/ui/error-boundary";
import type { AvailableAgent } from "../../contexts/agent-availability";
import { useAgentAvailability } from "../../hooks/use-agent-availability";
import { resolveAgentConfigPath } from "../../lib/agent-config-paths";
import { supportsMcp, supportsSkill } from "../../lib/agent-capabilities";
import { AgentIcon } from "../../lib/agent-icons";
import InferenceProvidersPage from "../inference-providers";
import MCPServersPage from "../settings/mcp-servers";
import SkillsPage from "../settings/skills";
import SubAgentsPage from "../settings/sub-agents";

const CODING_AGENT_IDS = new Set(["claude", "codex", "opencode"]);

function AgentHeader({ agent }: { agent: AvailableAgent }) {
	const { t } = useTranslation();

	const { data: configPath } = useQuery({
		queryKey: ["agent-config-path", agent.id],
		queryFn: () => resolveAgentConfigPath(agent),
		staleTime: Infinity,
	});

	const handleOpenConfigFolder = async () => {
		if (!configPath) return;
		try {
			await revealItemInDir(configPath);
		} catch (error) {
			console.error(
				`Failed to reveal config folder for ${agent.id}:`,
				error,
			);
			toast.danger(
				t("openAgentConfigFolderFailed", {
					name: agent.display_name,
				}),
			);
		}
	};

	return (
		<div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-surface-secondary">
			<AgentIcon id={agent.id} name={agent.display_name} size="sm" />
			<div className="min-w-0 flex-1">
				<h1 className="truncate text-base font-semibold">
					{agent.display_name}
				</h1>
				<p className="truncate text-xs text-muted">
					{t("agentScopeHint", { name: agent.display_name })}
				</p>
			</div>
			{configPath && (
				<Button
					variant="primary"
					size="sm"
					onPress={handleOpenConfigFolder}
				>
					<FolderOpenIcon className="size-4" />
					{t("openConfigFolder")}
				</Button>
			)}
		</div>
	);
}

function ModelTab({ agent }: { agent: AvailableAgent }) {
	const { t } = useTranslation();
	if (!CODING_AGENT_IDS.has(agent.id)) {
		return (
			<div className="flex h-full items-center justify-center p-8">
				<div className="max-w-sm text-center">
					<h3 className="mb-2 text-base font-medium">
						{t("modelNotConfigurableTitle")}
					</h3>
					<p className="text-sm text-muted">
						{t("modelNotConfigurableHint", {
							name: agent.display_name,
						})}
					</p>
				</div>
			</div>
		);
	}
	return <InferenceProvidersPage />;
}

function TabFallback() {
	return <div className="h-full" />;
}

export default function AgentDetailPage() {
	const { t } = useTranslation();
	const { agentId } = useParams();
	const [pathname, setLocation] = useLocation();
	const { availableAgents } = useAgentAvailability();

	const agent = availableAgents.find((a) => a.id === agentId);

	if (!agent) {
		return <Redirect to="/" />;
	}

	const tabs: Array<{ id: string; labelKey: string; href: string }> = [];
	if (supportsSkill(agent)) {
		tabs.push({
			id: "skills",
			labelKey: "skills",
			href: `/agents/${agent.id}/skills`,
		});
	}
	if (supportsMcp(agent)) {
		tabs.push({
			id: "mcp",
			labelKey: "mcp",
			href: `/agents/${agent.id}/mcp`,
		});
	}
	tabs.push({
		id: "model",
		labelKey: "model",
		href: `/agents/${agent.id}/model`,
	});
	tabs.push({
		id: "sub-agents",
		labelKey: "subAgents",
		href: `/agents/${agent.id}/sub-agents`,
	});

	const activeTabId =
		tabs.find((tab) => pathname.startsWith(tab.href))?.id ??
		tabs[0]?.id ??
		"skills";

	const handleTabChange = (id: string) => {
		const tab = tabs.find((t) => t.id === id);
		if (tab) setLocation(tab.href);
	};

	const defaultTabHref = tabs[0]?.href ?? `/agents/${agent.id}/skills`;

	return (
		<div className="flex h-full flex-col">
			<AgentHeader agent={agent} />
			<Surface
				variant="secondary"
				className="border-b border-border px-4 py-2"
			>
				<Tabs
					selectedKey={activeTabId}
					onSelectionChange={(key) => handleTabChange(String(key))}
				>
					<Tabs.ListContainer>
						<Tabs.List
							aria-label={t("agentSections")}
							className="inline-flex w-auto"
						>
							{tabs.map((tab) => (
								<Tabs.Tab
									id={tab.id}
									key={tab.id}
									className="px-4 whitespace-nowrap"
								>
									{t(tab.labelKey)}
									<Tabs.Indicator />
								</Tabs.Tab>
							))}
						</Tabs.List>
					</Tabs.ListContainer>
				</Tabs>
			</Surface>

			<div className="min-h-0 flex-1 overflow-hidden">
				<Switch>
					<Route path="/agents/:agentId">
						<Redirect to={defaultTabHref} />
					</Route>
					<Route path="/agents/:agentId/skills">
						<ErrorBoundary>
							<Suspense fallback={<TabFallback />}>
								<SkillsPage />
							</Suspense>
						</ErrorBoundary>
					</Route>
					<Route path="/agents/:agentId/mcp">
						<ErrorBoundary>
							<Suspense fallback={<TabFallback />}>
								<MCPServersPage />
							</Suspense>
						</ErrorBoundary>
					</Route>
					<Route path="/agents/:agentId/model">
						<ErrorBoundary>
							<Suspense fallback={<TabFallback />}>
								<ModelTab agent={agent} />
							</Suspense>
						</ErrorBoundary>
					</Route>
					<Route path="/agents/:agentId/sub-agents">
						<ErrorBoundary>
							<Suspense fallback={<TabFallback />}>
								<SubAgentsPage />
							</Suspense>
						</ErrorBoundary>
					</Route>
				</Switch>
			</div>
		</div>
	);
}
