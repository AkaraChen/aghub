import React from "react"
import { Link, useLocation } from "wouter"
import { Surface } from "@heroui/react"
import {
  BookOpenIcon,
  ServerIcon,
  Cog6ToothIcon,
} from "@heroicons/react/24/solid"
import { cn } from "../lib/utils"

type MenuItem =
  | { type: "link"; label: string; href: string; icon: React.ComponentType<React.SVGProps<SVGSVGElement>> }

const menuItems: MenuItem[] = [
  { type: "link", label: "Skills", href: "/settings/skills", icon: BookOpenIcon },
  { type: "link", label: "MCP Servers", href: "/settings/mcp-servers", icon: ServerIcon },
]

export function SettingsSidebar() {
  const [pathname] = useLocation()

  return (
    <Surface variant="default" className="w-60 shrink-0 border-r border-border p-3 rounded-none flex flex-col">
      <aside className="flex flex-col h-full">
        <nav className="flex flex-col gap-0.5 flex-1">
          {menuItems.map((item) => {
            const Icon = item.icon
            const isActive = pathname === item.href

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors",
                  isActive
                    ? "bg-accent/10 text-foreground font-medium"
                    : "text-muted hover:bg-surface-secondary hover:text-foreground"
                )}
              >
                <Icon className="size-4" />
                <span>{item.label}</span>
              </Link>
            )
          })}
        </nav>
        <nav className="mt-auto">
          <Link
            href="/settings"
            className={cn(
              "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors",
              pathname === "/settings"
                ? "bg-accent/10 text-foreground font-medium"
                : "text-muted hover:bg-surface-secondary hover:text-foreground"
            )}
          >
            <Cog6ToothIcon className="size-4" />
            <span>Settings</span>
          </Link>
        </nav>
      </aside>
    </Surface>
  )
}
