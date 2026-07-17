import { Cog6ToothIcon } from "@heroicons/react/24/solid";
import { Surface } from "@heroui/react";
import { Fragment, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useSearch } from "wouter";
import { useSidebarNavigation } from "../hooks/use-sidebar-navigation";
import {
	setStickyAgentFilter,
	useStickyAgentFilter,
} from "../hooks/use-sticky-agent-filter";
import {
	isAgentFilterSidebarHref,
	isSidebarHrefActive,
} from "../lib/sidebar-navigation";
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

function withAgent(href: string, agent: string | null) {
	if (!agent) return href;
	return `${href}?agent=${encodeURIComponent(agent)}`;
}

export function AppSidebar() {
	const { t } = useTranslation();
	const [pathname] = useLocation();
	const search = useSearch();
	const { visibleSidebarSections } = useSidebarNavigation();
	const stickyAgent = useStickyAgentFilter();

	// On a resource page, the URL is the source of truth for the active filter,
	// so mirror it into the sticky store. On non-resource pages we leave the
	// sticky value alone so it survives the round-trip.
	const onResource = isAgentFilterSidebarHref(pathname);
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

	return (
		<Surface
			variant="secondary"
			data-tour="sidebar"
			className="flex w-60 shrink-0 flex-col p-3"
		>
			<aside className="flex h-full min-h-0 flex-col gap-3">
				<GlobalSearch />

				<div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-0.5">
					{visibleSidebarSections.map((section, index) => (
						<Fragment key={section.id}>
							{index > 0 ? <Separator /> : null}
							<section
								className="flex flex-col gap-1"
								data-tour={section.tour}
							>
								{section.navigationLabelKey ? (
									<SectionLabel>
										{t(section.navigationLabelKey)}
									</SectionLabel>
								) : null}
								<nav
									aria-label={t(section.labelKey)}
									className="flex flex-col gap-0.5"
								>
									{section.items.map((item) => {
										const Icon = item.icon;
										const href = item.carriesAgentFilter
											? withAgent(item.href, carriedAgent)
											: item.href;

										return (
											<Link
												key={item.id}
												href={href}
												data-tour={item.tour}
												className={navItemClasses(
													isSidebarHrefActive(
														pathname,
														item.href,
													),
												)}
											>
												<Icon className="size-4" />
												<span>{t(item.labelKey)}</span>
											</Link>
										);
									})}
								</nav>
							</section>
						</Fragment>
					))}
					{visibleSidebarSections.length > 0 ? <Separator /> : null}

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
