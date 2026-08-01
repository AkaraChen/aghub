import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DEFAULT_SIDEBAR_ITEMS, type SidebarItemId } from "../lib/store";
import {
	normalizeSidebarItems,
	resolveSidebarSections,
} from "../lib/sidebar-navigation";
import {
	saveSidebarItemsMutationOptions,
	sidebarItemsQueryOptions,
} from "../requests/sidebar";

export function useSidebarNavigation() {
	const queryClient = useQueryClient();
	const { data, isPending } = useQuery(sidebarItemsQueryOptions());
	const saveMutation = useMutation(
		saveSidebarItemsMutationOptions({ queryClient }),
	);
	const resolvedSidebarSections = data ? resolveSidebarSections(data) : [];
	const visibleSidebarSections = resolvedSidebarSections
		.map((section) => ({
			...section,
			items: section.items.filter((item) => item.visible),
		}))
		.filter((section) => section.items.length > 0);

	async function setItemVisibility(id: SidebarItemId, visible: boolean) {
		const current = normalizeSidebarItems(
			await queryClient.ensureQueryData(sidebarItemsQueryOptions()),
		);
		const next = current.map((item) =>
			item.id === id ? { ...item, visible } : item,
		);

		await saveMutation.mutateAsync(next);
	}

	async function resetSidebarItems() {
		await saveMutation.mutateAsync(DEFAULT_SIDEBAR_ITEMS);
	}

	return {
		isHydrating: isPending,
		isSaving: saveMutation.isPending,
		resetSidebarItems,
		resolvedSidebarSections,
		setItemVisibility,
		visibleSidebarSections,
	};
}
