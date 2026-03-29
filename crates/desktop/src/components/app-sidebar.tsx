import {
	BookOpenIcon,
	Cog6ToothIcon,
	ServerIcon,
	SquaresPlusIcon,
} from "@heroicons/react/24/solid";
import { Surface } from "@heroui/react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "wouter";
import { cn } from "../lib/utils";
import { ProjectList } from "./project-list";

interface MenuItem {
	type: "link";
	labelKey: string;
	href: string;
	icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
}

const menuItems: MenuItem[] = [
	{
		type: "link",
		labelKey: "mcpServers",
		href: "/mcp",
		icon: ServerIcon,
	},
	{
		type: "link",
		labelKey: "skills",
		href: "/skills",
		icon: BookOpenIcon,
	},
	{
		type: "link",
		labelKey: "skillsSh",
		href: "/skills-sh",
		icon: SquaresPlusIcon,
	},
];

export function AppSidebar() {
	const { t } = useTranslation();
	const [pathname] = useLocation();

	return (
		<Surface
			variant="secondary"
			data-tour="sidebar"
			className="flex w-60 shrink-0 flex-col border-r border-border p-3"
		>
			<aside className="flex h-full flex-col">
				<nav className="flex flex-col gap-0.5">
					{menuItems.map((item) => {
						const Icon = item.icon;
						const isActive = pathname === item.href;

						return (
							<Link
								key={item.href}
								href={item.href}
								data-tour={
									item.href === "/mcp"
										? "nav-mcp"
										: item.href === "/skills"
											? "nav-skills"
											: "nav-market"
								}
								className={cn(
									`
           flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm
           transition-colors
         `,
									isActive
										? "bg-surface font-medium text-foreground"
										: `
            text-muted
            hover:bg-surface-secondary hover:text-foreground
          `,
								)}
							>
								<Icon className="size-4" />
								<span>{t(item.labelKey)}</span>
							</Link>
						);
					})}
				</nav>
				<div data-tour="project-section">
					<ProjectList />
				</div>

				<nav className="mt-auto">
					<Link
						href="/settings"
						data-tour="nav-settings"
						className={cn(
							`
         flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm
         transition-colors
       `,
							pathname === "/settings"
								? "bg-surface font-medium text-foreground"
								: `
          text-muted
          hover:bg-surface-secondary hover:text-foreground
        `,
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
