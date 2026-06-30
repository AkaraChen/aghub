import {
	BookOpenIcon,
	Cog6ToothIcon,
	CpuChipIcon,
	KeyIcon,
	PuzzlePieceIcon,
	ServerIcon,
} from "@heroicons/react/24/solid";
import { Surface } from "@heroui/react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useSearch } from "wouter";
import { useSidebarNavigation } from "../hooks/use-sidebar-navigation";
import {
	setStickyAgentFilter,
	useStickyAgentFilter,
} from "../hooks/use-sticky-agent-filter";
import { isSidebarHrefActive } from "../lib/sidebar-navigation";
import { cn } from "../lib/utils";
import { GlobalSearch } from "./global-search";
import { ProjectList } from "./project-list";

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

const RESOURCE_HREFS = ["/skills", "/mcp", "/sub-agents"] as const;

function isOnResourcePage(pathname: string) {
	return RESOURCE_HREFS.some(
		(href) => pathname === href || pathname.startsWith(`${href}/`),
	);
}

function withAgent(href: string, agent: string | null) {
	if (!agent) return href;
	return `${href}?agent=${encodeURIComponent(agent)}`;
}

export function AppSidebar() {
	const { t } = useTranslation();
	const [pathname] = useLocation();
	const search = useSearch();
	const { visibleSidebarItems } = useSidebarNavigation();
	const stickyAgent = useStickyAgentFilter();

	// On a resource page, the URL is the source of truth for the active filter,
	// so mirror it into the sticky store. On non-resource pages we leave the
	// sticky value alone so it survives the round-trip.
	const onResource = isOnResourcePage(pathname);
	const urlAgent = new URLSearchParams(search).get("agent") || null;
	useEffect(() => {
		if (onResource) {
			setStickyAgentFilter(urlAgent);
		}
	}, [onResource, urlAgent]);

	// Sidebar resource links carry the sticky filter forward, even from
	// non-resource pages (so going to /inference-providers and back to /skills
	// restores ?agent=<last>). The chip's clear button on a resource page
	// resets both the URL and the sticky store.
	const carriedAgent = stickyAgent;

	const homeItem = visibleSidebarItems.find((item) => item.id === "home");
	const marketItem = visibleSidebarItems.find((item) => item.id === "market");

	return (
		<Surface
			variant="secondary"
			data-tour="sidebar"
			className="flex w-60 shrink-0 flex-col p-3"
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
						data-tour="resources-section"
					>
						<SectionLabel>{t("resources")}</SectionLabel>
						<nav className="flex flex-col gap-0.5">
							{(
								[
									{
										href: "/skills",
										labelKey: "skills",
										Icon: BookOpenIcon,
										carriesAgentFilter: true,
									},
									{
										href: "/mcp",
										labelKey: "mcpServers",
										Icon: ServerIcon,
										carriesAgentFilter: true,
									},
									{
										href: "/sub-agents",
										labelKey: "subAgents",
										Icon: CpuChipIcon,
										carriesAgentFilter: true,
									},
									{
										href: "/cc-plugins",
										labelKey: "claudeCodePlugins",
										Icon: PuzzlePieceIcon,
										carriesAgentFilter: false,
									},
								] as const
							).map(
								({
									href,
									labelKey,
									Icon,
									carriesAgentFilter,
								}) => (
									<Link
										key={href}
										href={
											carriesAgentFilter
												? withAgent(href, carriedAgent)
												: href
										}
										className={navItemClasses(
											isSidebarHrefActive(pathname, href),
										)}
									>
										<Icon className="size-4" />
										<span>{t(labelKey)}</span>
									</Link>
								),
							)}
						</nav>
					</section>

					<Separator />

					<nav className="flex flex-col gap-0.5">
						<Link
							href="/inference-providers"
							className={navItemClasses(
								isSidebarHrefActive(
									pathname,
									"/inference-providers",
								),
							)}
						>
							<KeyIcon className="size-4" />
							<span>{t("inferenceProviders")}</span>
						</Link>
					</nav>

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
