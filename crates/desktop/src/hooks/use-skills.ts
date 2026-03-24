import {
	useMutation,
	useQueryClient,
	useSuspenseQuery,
} from "@tanstack/react-query";
import { createApi } from "../lib/api";
import type { CreateSkillRequest, SkillResponse } from "../lib/api-types";
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

export function useCreateSkill() {
	const { baseUrl } = useServer();
	const api = createApi(baseUrl);
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: ({
			agent,
			data,
			projectPath,
		}: {
			agent: string;
			data: CreateSkillRequest;
			projectPath?: string;
		}) => api.skills.create(agent, data, projectPath),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["skills"] });
			queryClient.invalidateQueries({ queryKey: ["project-skills"] });
		},
	});
}
