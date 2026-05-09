import { BuildingStorefrontIcon, HomeIcon } from "@heroicons/react/24/solid";
import type { ComponentType, SVGProps } from "react";
import {
	DEFAULT_SIDEBAR_ITEMS,
	SIDEBAR_ITEM_IDS,
	type SidebarItemId,
	type SidebarItemPreference,
} from "./store/types";

export interface SidebarItemDefinition {
	id: SidebarItemId;
	labelKey: string;
	href: string;
	icon: ComponentType<SVGProps<SVGSVGElement>>;
	tour?: string;
}

export interface ResolvedSidebarItem
	extends SidebarItemDefinition, SidebarItemPreference {}

const SIDEBAR_ITEM_ID_SET = new Set<SidebarItemId>(SIDEBAR_ITEM_IDS);

const SIDEBAR_ITEM_DEFINITIONS: Record<SidebarItemId, SidebarItemDefinition> = {
	home: {
		id: "home",
		labelKey: "home",
		href: "/",
		icon: HomeIcon,
		tour: "nav-home",
	},
	market: {
		id: "market",
		labelKey: "market",
		href: "/market",
		icon: BuildingStorefrontIcon,
		tour: "nav-market",
	},
};

export function normalizeSidebarItems(
	items?: SidebarItemPreference[],
): SidebarItemPreference[] {
	const normalized: SidebarItemPreference[] = [];
	const seen = new Set<SidebarItemId>();

	for (const item of items ?? DEFAULT_SIDEBAR_ITEMS) {
		if (!SIDEBAR_ITEM_ID_SET.has(item.id) || seen.has(item.id)) {
			continue;
		}

		normalized.push({
			id: item.id,
			visible: typeof item.visible === "boolean" ? item.visible : true,
		});
		seen.add(item.id);
	}

	for (const item of DEFAULT_SIDEBAR_ITEMS) {
		if (seen.has(item.id)) {
			continue;
		}

		normalized.push(item);
	}

	return normalized;
}

export function resolveSidebarItems(
	items?: SidebarItemPreference[],
): ResolvedSidebarItem[] {
	return normalizeSidebarItems(items).map((item) => ({
		...SIDEBAR_ITEM_DEFINITIONS[item.id],
		visible: item.visible,
	}));
}

export function getDefaultSidebarHref(items?: SidebarItemPreference[]): string {
	return resolveSidebarItems(items).find((item) => item.visible)?.href ?? "/";
}

export function isSidebarHrefActive(pathname: string, href: string): boolean {
	if (href === "/") {
		return pathname === "/";
	}
	return pathname === href || pathname.startsWith(`${href}/`);
}
