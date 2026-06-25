import {
	ArrowRightIcon,
	FolderOpenIcon,
	PlusIcon,
} from "@heroicons/react/24/solid";
import { Button, Card, toast } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import type { AvailableAgent } from "../contexts/agent-availability";
import { useAgentAvailability } from "../hooks/use-agent-availability";
import { useApi } from "../hooks/use-api";
import { resolveAgentConfigPath } from "../lib/agent-config-paths";
import { AgentIcon } from "../lib/agent-icons";
import { cn } from "../lib/utils";
import { mcpListQueryOptions } from "../requests/mcps";
import { skillListQueryOptions } from "../requests/skills";

type AgentStatus = "ready" | "missing" | "disabled";

function statusOf(agent: AvailableAgent): AgentStatus {
	if (agent.isDisabled) return "disabled";
	if (!agent.availability.is_available) return "missing";
	return "ready";
}

function StatusBadge({ status }: { status: AgentStatus }) {
	const { t } = useTranslation();
	const tone =
		status === "ready"
			? "bg-success/15 text-success"
			: status === "missing"
				? "bg-warning/15 text-warning"
				: "bg-muted/15 text-muted";
	const labelKey =
		status === "ready"
			? "agentStatusReady"
			: status === "missing"
				? "agentStatusMissing"
				: "agentStatusDisabled";
	return (
		<span
			className={cn(
				"inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium",
				tone,
			)}
		>
			<span className="size-1.5 rounded-full bg-current" />
			{t(labelKey)}
		</span>
	);
}

function AgentOverviewCard({ agent }: { agent: AvailableAgent }) {
	const { t } = useTranslation();
	const api = useApi();
	const [, setLocation] = useLocation();
	const status = statusOf(agent);

	const { data: skills = [] } = useQuery({
		...skillListQueryOptions({ api, scope: "global" }),
	});
	const { data: mcps = [] } = useQuery({
		...mcpListQueryOptions({ api, scope: "global" }),
	});
	const { data: configPath } = useQuery({
		queryKey: ["agent-config-path", agent.id],
		queryFn: () => resolveAgentConfigPath(agent),
		staleTime: Infinity,
	});

	const skillCount = useMemo(
		() => skills.filter((s) => !s.agent || s.agent === agent.id).length,
		[skills, agent.id],
	);
	const mcpCount = useMemo(
		() => mcps.filter((m) => !m.agent || m.agent === agent.id).length,
		[mcps, agent.id],
	);

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

	const handleOpen = () => {
		setLocation(`/skills?agent=${encodeURIComponent(agent.id)}`);
	};

	return (
		<Card variant="secondary" className="flex flex-col">
			<Card.Header className="flex flex-row items-start gap-3">
				<AgentIcon id={agent.id} name={agent.display_name} size="sm" />
				<div className="min-w-0 flex-1">
					<Card.Title className="truncate">
						{agent.display_name}
					</Card.Title>
					<div className="mt-1">
						<StatusBadge status={status} />
					</div>
				</div>
			</Card.Header>
			<Card.Content className="flex flex-1 flex-col gap-3">
				{status === "ready" ? (
					<dl className="grid grid-cols-2 gap-2 text-sm">
						<div className="rounded-md bg-surface p-2">
							<dt className="text-[11px] text-muted uppercase tracking-wider">
								{t("skills")}
							</dt>
							<dd className="mt-0.5 text-base font-medium">
								{skillCount}
							</dd>
						</div>
						<div className="rounded-md bg-surface p-2">
							<dt className="text-[11px] text-muted uppercase tracking-wider">
								{t("mcp")}
							</dt>
							<dd className="mt-0.5 text-base font-medium">
								{mcpCount}
							</dd>
						</div>
					</dl>
				) : (
					<p className="text-sm text-muted">
						{status === "missing"
							? t("agentMissingHint")
							: t("agentDisabledHint")}
					</p>
				)}
				<div className="mt-auto flex gap-2">
					<Button
						variant={status === "ready" ? "primary" : "tertiary"}
						size="sm"
						className="flex-1"
						onPress={handleOpen}
					>
						{status === "ready" ? t("open") : t("manage")}
						<ArrowRightIcon className="size-3.5" />
					</Button>
					{configPath && (
						<Button
							isIconOnly
							variant="tertiary"
							size="sm"
							aria-label={t("openAgentConfigFolder", {
								name: agent.display_name,
							})}
							onPress={handleOpenConfigFolder}
						>
							<FolderOpenIcon className="size-4" />
						</Button>
					)}
				</div>
			</Card.Content>
		</Card>
	);
}

export default function HomePage() {
	const { t } = useTranslation();
	const [, setLocation] = useLocation();
	const { availableAgents } = useAgentAvailability();

	const installedAgents = useMemo(
		() =>
			availableAgents.filter((agent) => agent.availability.is_available),
		[availableAgents],
	);

	const sortedAgents = useMemo(() => {
		const order = { ready: 0, missing: 1, disabled: 2 } as const;
		return [...installedAgents].sort((a, b) => {
			const sa = order[statusOf(a)];
			const sb = order[statusOf(b)];
			if (sa !== sb) return sa - sb;
			return a.display_name.localeCompare(b.display_name);
		});
	}, [installedAgents]);

	const readyCount = useMemo(
		() => installedAgents.filter((a) => statusOf(a) === "ready").length,
		[installedAgents],
	);

	return (
		<div className="h-full overflow-y-auto">
			<div className="mx-auto w-full max-w-6xl p-4 sm:p-6">
				<header className="mb-6 flex flex-col gap-1">
					<h1 className="text-2xl font-semibold tracking-tight">
						{t("homeTitle")}
					</h1>
					<p className="text-sm text-muted">
						{t("homeSubtitle", {
							ready: readyCount,
							total: installedAgents.length,
						})}
					</p>
				</header>

				<section
					aria-label={t("yourAgents")}
					className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
				>
					{sortedAgents.map((agent) => (
						<AgentOverviewCard key={agent.id} agent={agent} />
					))}
					<Card
						variant="secondary"
						className="border border-dashed border-border bg-transparent"
					>
						<Card.Content className="flex h-full flex-col items-center justify-center gap-2 py-8 text-center">
							<PlusIcon className="size-5 text-muted" />
							<p className="text-sm font-medium">
								{t("addAgent")}
							</p>
							<p className="text-xs text-muted">
								{t("addAgentHint")}
							</p>
							<Button
								variant="tertiary"
								size="sm"
								onPress={() =>
									setLocation("/settings?tab=agents")
								}
							>
								{t("manageAgents")}
							</Button>
						</Card.Content>
					</Card>
				</section>

				<section className="mt-8">
					<h2 className="mb-2 text-sm font-medium tracking-wider text-muted uppercase">
						{t("quickActions")}
					</h2>
					<div className="flex flex-wrap gap-2">
						<Button
							variant="secondary"
							onPress={() => setLocation("/market")}
						>
							{t("browseMarket")}
						</Button>
						<Button
							variant="tertiary"
							onPress={() => setLocation("/settings?tab=agents")}
						>
							{t("manageAgents")}
						</Button>
					</div>
				</section>
			</div>
		</div>
	);
}
