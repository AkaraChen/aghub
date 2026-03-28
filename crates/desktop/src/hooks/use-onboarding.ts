import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getOnboardingCompleted, setOnboardingCompleted } from "../lib/store";

const ONBOARDING_QUERY_KEY = ["onboarding"];

export function useOnboardingStatus() {
	return useQuery<boolean>({
		queryKey: ONBOARDING_QUERY_KEY,
		queryFn: getOnboardingCompleted,
	});
}

export function useSetOnboardingCompleted() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: setOnboardingCompleted,
		onSuccess: (_data, completed) => {
			queryClient.setQueryData(ONBOARDING_QUERY_KEY, completed);
		},
	});
}
