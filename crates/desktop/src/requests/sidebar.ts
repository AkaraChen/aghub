import {
	mutationOptions,
	type QueryClient,
	queryOptions,
} from "@tanstack/react-query";
import {
	getSidebarItems,
	saveSidebarItems,
	type SidebarItemPreference,
} from "../lib/store";
import { normalizeSidebarItems } from "../lib/sidebar-navigation";
import { queryKeys } from "./keys";

export function sidebarItemsQueryOptions() {
	return queryOptions({
		queryKey: queryKeys.sidebar.items(),
		queryFn: getSidebarItems,
	});
}

interface SaveSidebarItemsMutationParams {
	queryClient: QueryClient;
}

export function saveSidebarItemsMutationOptions({
	queryClient,
}: SaveSidebarItemsMutationParams) {
	return mutationOptions({
		mutationFn: async (items: SidebarItemPreference[]) => {
			const normalized = normalizeSidebarItems(items);

			await saveSidebarItems(normalized);
			return normalized;
		},
		onMutate: async (items) => {
			await queryClient.cancelQueries({
				queryKey: queryKeys.sidebar.items(),
			});
			const previous = queryClient.getQueryData<SidebarItemPreference[]>(
				queryKeys.sidebar.items(),
			);

			queryClient.setQueryData(
				queryKeys.sidebar.items(),
				normalizeSidebarItems(items),
			);
			return { previous };
		},
		onError: async (_error, _items, context) => {
			if (context?.previous) {
				queryClient.setQueryData(
					queryKeys.sidebar.items(),
					context.previous,
				);
				return;
			}

			await queryClient.invalidateQueries({
				queryKey: queryKeys.sidebar.all(),
			});
		},
	});
}
