import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Project } from "../lib/store";
import { addProject, getProjects, removeProject } from "../lib/store";

export function useProjects() {
	return useQuery<Project[]>({
		queryKey: ["projects"],
		queryFn: getProjects,
	});
}

export function useAddProject() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: addProject,
		onSuccess: () =>
			queryClient.invalidateQueries({ queryKey: ["projects"] }),
	});
}

export function useRemoveProject() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: removeProject,
		onSuccess: () =>
			queryClient.invalidateQueries({ queryKey: ["projects"] }),
	});
}
