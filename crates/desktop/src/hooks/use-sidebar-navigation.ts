import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { DEFAULT_SIDEBAR_ITEMS, getSidebarItems } from "../lib/store";
import {
	getDefaultSidebarHref,
	normalizeSidebarItems,
	resolveSidebarItems,
} from "../lib/sidebar-navigation";

const SIDEBAR_NAVIGATION_QUERY_KEY = ["sidebar-navigation"];

export function useSidebarNavigation() {
	const { data, isLoading } = useQuery({
		queryKey: SIDEBAR_NAVIGATION_QUERY_KEY,
		queryFn: getSidebarItems,
	});

	const sidebarItems = useMemo(
		() => normalizeSidebarItems(data ?? DEFAULT_SIDEBAR_ITEMS),
		[data],
	);
	const resolvedSidebarItems = useMemo(
		() => resolveSidebarItems(sidebarItems),
		[sidebarItems],
	);
	const visibleSidebarItems = useMemo(
		() => resolvedSidebarItems.filter((item) => item.visible),
		[resolvedSidebarItems],
	);
	const defaultHref = useMemo(
		() => getDefaultSidebarHref(sidebarItems),
		[sidebarItems],
	);

	return {
		defaultHref,
		isLoading,
		resolvedSidebarItems,
		sidebarItems,
		visibleSidebarItems,
	};
}
