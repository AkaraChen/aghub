import {
	BookOpenIcon,
	BuildingStorefrontIcon,
	ChartBarIcon,
	CpuChipIcon,
	HomeIcon,
	KeyIcon,
	PuzzlePieceIcon,
	ServerIcon,
} from "@heroicons/react/24/solid";
import type { ComponentType, SVGProps } from "react";
import {
	DEFAULT_SIDEBAR_ITEMS,
	SIDEBAR_ITEM_IDS,
	type SidebarItemId,
	type SidebarItemPreference,
} from "./store/types";

export interface SidebarItemDefinition {
	id: SidebarItemId;
	section: SidebarSectionId;
	labelKey: string;
	href: string;
	icon: ComponentType<SVGProps<SVGSVGElement>>;
	tour?: string;
	carriesAgentFilter?: boolean;
}

export interface ResolvedSidebarItem
	extends SidebarItemDefinition, SidebarItemPreference {}

export type SidebarSectionId = "primary" | "resources" | "providers";

export interface SidebarSectionDefinition {
	id: SidebarSectionId;
	labelKey: string;
	navigationLabelKey?: string;
	tour?: string;
}

export interface ResolvedSidebarSection extends SidebarSectionDefinition {
	items: ResolvedSidebarItem[];
}

const SIDEBAR_ITEM_ID_SET = new Set<SidebarItemId>(SIDEBAR_ITEM_IDS);

const SIDEBAR_SECTION_DEFINITIONS: readonly SidebarSectionDefinition[] = [
	{
		id: "primary",
		labelKey: "sidebarPrimarySection",
	},
	{
		id: "resources",
		labelKey: "resources",
		navigationLabelKey: "resources",
		tour: "resources-section",
	},
	{
		id: "providers",
		labelKey: "sidebarProviderSection",
	},
];

const SIDEBAR_ITEM_DEFINITIONS: Record<SidebarItemId, SidebarItemDefinition> = {
	home: {
		id: "home",
		section: "primary",
		labelKey: "home",
		href: "/",
		icon: HomeIcon,
		tour: "nav-home",
	},
	market: {
		id: "market",
		section: "primary",
		labelKey: "market",
		href: "/market",
		icon: BuildingStorefrontIcon,
		tour: "nav-market",
	},
	usage: {
		id: "usage",
		section: "primary",
		labelKey: "usage",
		href: "/usage",
		icon: ChartBarIcon,
	},
	skills: {
		id: "skills",
		section: "resources",
		labelKey: "skills",
		href: "/skills",
		icon: BookOpenIcon,
		tour: "nav-skills",
		carriesAgentFilter: true,
	},
	mcp: {
		id: "mcp",
		section: "resources",
		labelKey: "mcpServers",
		href: "/mcp",
		icon: ServerIcon,
		carriesAgentFilter: true,
	},
	subAgents: {
		id: "subAgents",
		section: "resources",
		labelKey: "subAgents",
		href: "/sub-agents",
		icon: CpuChipIcon,
		carriesAgentFilter: true,
	},
	ccPlugins: {
		id: "ccPlugins",
		section: "resources",
		labelKey: "claudeCodePlugins",
		href: "/cc-plugins",
		icon: PuzzlePieceIcon,
	},
	inferenceProviders: {
		id: "inferenceProviders",
		section: "providers",
		labelKey: "inferenceProviders",
		href: "/inference-providers",
		icon: KeyIcon,
	},
};

export function normalizeSidebarItems(
	items?: SidebarItemPreference[],
): SidebarItemPreference[] {
	const visibility = new Map<SidebarItemId, boolean>();

	for (const item of items ?? []) {
		if (!SIDEBAR_ITEM_ID_SET.has(item.id) || visibility.has(item.id)) {
			continue;
		}

		visibility.set(
			item.id,
			typeof item.visible === "boolean" ? item.visible : true,
		);
	}

	return DEFAULT_SIDEBAR_ITEMS.map((item) => ({
		id: item.id,
		visible: visibility.get(item.id) ?? item.visible,
	}));
}

function resolveSidebarItems(
	items?: SidebarItemPreference[],
): ResolvedSidebarItem[] {
	return normalizeSidebarItems(items).map((item) => ({
		...SIDEBAR_ITEM_DEFINITIONS[item.id],
		visible: item.visible,
	}));
}

export function resolveSidebarSections(
	items?: SidebarItemPreference[],
): ResolvedSidebarSection[] {
	const resolvedItems = resolveSidebarItems(items);

	return SIDEBAR_SECTION_DEFINITIONS.map((section) => ({
		...section,
		items: resolvedItems.filter((item) => item.section === section.id),
	}));
}

export function isAgentFilterSidebarHref(pathname: string): boolean {
	return Object.values(SIDEBAR_ITEM_DEFINITIONS).some(
		(item) =>
			item.carriesAgentFilter && isSidebarHrefActive(pathname, item.href),
	);
}

export function isSidebarHrefActive(pathname: string, href: string): boolean {
	if (href === "/") {
		return pathname === "/";
	}
	return pathname === href || pathname.startsWith(`${href}/`);
}
