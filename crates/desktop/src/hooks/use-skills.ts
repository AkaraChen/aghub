import { useSuspenseQuery } from "@tanstack/react-query";
import { createApi } from "../lib/api";
import type { SkillResponse } from "../lib/api-types";
import { useServer } from "./use-server";

export function useSkills() {
	const { baseUrl } = useServer();
	const api = createApi(baseUrl);

	return useSuspenseQuery<SkillResponse[]>({
		queryKey: ["skills", "all", "global"],
		queryFn: () => api.skills.listAll("global"),
		staleTime: 30_000,
	});
}
