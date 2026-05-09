import {
	BookOpenIcon,
	ChevronDownIcon,
	Cog6ToothIcon,
	CpuChipIcon,
	KeyIcon,
	ServerIcon,
} from "@heroicons/react/24/solid";
import { Surface } from "@heroui/react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "wouter";
import { useAgentAvailability } from "../hooks/use-agent-availability";
import { useSidebarNavigation } from "../hooks/use-sidebar-navigation";
import { AgentIcon } from "../lib/agent-icons";
import { isSidebarHrefActive } from "../lib/sidebar-navigation";
import { cn } from "../lib/utils";
import { GlobalSearch } from "./global-search";
import { ProjectList } from "./project-list";

const COLLAPSED_AGENT_COUNT = 5;

function navItemClasses(isActive: boolean) {
	return cn(
		"flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors",
		isActive
			? "bg-surface font-medium text-foreground"
			: "text-muted hover:bg-surface-secondary hover:text-foreground",
	);
}

function Separator() {
	return <hr className="border-t border-border" aria-hidden="true" />;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
	return (
		<h2 className="px-2 text-xs font-medium tracking-wider text-muted uppercase">
			{children}
		</h2>
	);
}

export function AppSidebar() {
	const { t } = useTranslation();
	const [pathname] = useLocation();
	const { visibleSidebarItems } = useSidebarNavigation();
	const { availableAgents } = useAgentAvailability();

	const sortedAgents = useMemo(() => {
		const installed = availableAgents.filter(
			(agent) => agent.availability.is_available,
		);
		return installed.sort((a, b) => {
			if (a.isDisabled !== b.isDisabled) {
				return a.isDisabled ? 1 : -1;
			}
			return a.display_name.localeCompare(b.display_name);
		});
	}, [availableAgents]);

	const [agentsExpanded, setAgentsExpanded] = useState(false);

	const visibleAgents = useMemo(() => {
		if (agentsExpanded || sortedAgents.length <= COLLAPSED_AGENT_COUNT) {
			return sortedAgents;
		}
		const baseSlice = sortedAgents.slice(0, COLLAPSED_AGENT_COUNT);
		const activeAgent = sortedAgents.find((agent) =>
			isSidebarHrefActive(pathname, `/agents/${agent.id}`),
		);
		if (
			activeAgent &&
			!baseSlice.some((agent) => agent.id === activeAgent.id)
		) {
			return [...baseSlice, activeAgent];
		}
		return baseSlice;
	}, [sortedAgents, agentsExpanded, pathname]);

	const hiddenAgentCount = sortedAgents.length - visibleAgents.length;
	const showAgentToggle =
		sortedAgents.length > COLLAPSED_AGENT_COUNT &&
		(hiddenAgentCount > 0 || agentsExpanded);

	const homeItem = visibleSidebarItems.find((item) => item.id === "home");
	const marketItem = visibleSidebarItems.find((item) => item.id === "market");

	return (
		<Surface
			variant="secondary"
			data-tour="sidebar"
			className="flex w-60 shrink-0 flex-col border-r border-border p-3"
		>
			<aside className="flex h-full min-h-0 flex-col gap-3">
				<GlobalSearch />

				<div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-0.5">
					<nav className="flex flex-col gap-0.5">
						{homeItem && (
							<Link
								key={homeItem.id}
								href={homeItem.href}
								data-tour={homeItem.tour}
								className={navItemClasses(
									isSidebarHrefActive(
										pathname,
										homeItem.href,
									),
								)}
							>
								<homeItem.icon className="size-4" />
								<span>{t(homeItem.labelKey)}</span>
							</Link>
						)}
						{marketItem && (
							<Link
								key={marketItem.id}
								href={marketItem.href}
								data-tour={marketItem.tour}
								className={navItemClasses(
									isSidebarHrefActive(
										pathname,
										marketItem.href,
									),
								)}
							>
								<marketItem.icon className="size-4" />
								<span>{t(marketItem.labelKey)}</span>
							</Link>
						)}
					</nav>

					<Separator />

					<section
						className="flex flex-col gap-1"
						data-tour="all-resources-section"
					>
						<SectionLabel>{t("allResources")}</SectionLabel>
						<nav className="flex flex-col gap-0.5">
							{(
								[
									{
										href: "/skills",
										labelKey: "skills",
										Icon: BookOpenIcon,
									},
									{
										href: "/mcp",
										labelKey: "mcpServers",
										Icon: ServerIcon,
									},
									{
										href: "/sub-agents",
										labelKey: "subAgents",
										Icon: CpuChipIcon,
									},
									{
										href: "/inference-providers",
										labelKey: "inferenceProviders",
										Icon: KeyIcon,
									},
								] as const
							).map(({ href, labelKey, Icon }) => (
								<Link
									key={href}
									href={href}
									className={navItemClasses(
										isSidebarHrefActive(pathname, href),
									)}
								>
									<Icon className="size-4" />
									<span>{t(labelKey)}</span>
								</Link>
							))}
						</nav>
					</section>

					<Separator />

					<section
						className="flex flex-col gap-1"
						data-tour="agents-section"
					>
						<SectionLabel>{t("allAgents")}</SectionLabel>
						<nav className="flex flex-col gap-0.5">
							{sortedAgents.length === 0 ? (
								<p className="px-2 py-2 text-xs text-muted">
									{t("noAgentsAvailable")}
								</p>
							) : (
								visibleAgents.map((agent) => {
									const href = `/agents/${agent.id}`;
									const isActive = isSidebarHrefActive(
										pathname,
										href,
									);
									return (
										<Link
											key={agent.id}
											href={href}
											className={cn(
												navItemClasses(isActive),
												agent.isDisabled &&
													"opacity-60",
											)}
										>
											<AgentIcon
												id={agent.id}
												name={agent.display_name}
												size="xs"
												variant="ghost"
											/>
											<span className="min-w-0 flex-1 truncate">
												{agent.display_name}
											</span>
										</Link>
									);
								})
							)}
							{showAgentToggle && (
								<button
									type="button"
									onClick={() => setAgentsExpanded((v) => !v)}
									aria-expanded={agentsExpanded}
									className={cn(
										"mt-0.5 flex items-center gap-2 rounded-md px-2.5 py-1 text-xs font-medium text-muted transition-colors",
										"hover:bg-surface-secondary hover:text-foreground focus:bg-surface-secondary focus:outline-none",
									)}
								>
									<ChevronDownIcon
										className={cn(
											"size-3.5 transition-transform",
											agentsExpanded && "rotate-180",
										)}
									/>
									{agentsExpanded
										? t("sidebarShowLess")
										: t("sidebarShowMoreAgents", {
												count: hiddenAgentCount,
											})}
								</button>
							)}
						</nav>
					</section>

					<Separator />

					<div data-tour="project-section">
						<ProjectList />
					</div>
				</div>

				<nav>
					<Link
						href="/settings"
						data-tour="nav-settings"
						className={navItemClasses(
							isSidebarHrefActive(pathname, "/settings"),
						)}
					>
						<Cog6ToothIcon className="size-4" />
						<span>{t("settings")}</span>
					</Link>
				</nav>
			</aside>
		</Surface>
	);
}
