import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { getProjects, addProject, removeProject, updateProject, type Project } from "../lib/store"

export function useProjects() {
  return useQuery<Project[]>({
    queryKey: ["projects"],
    queryFn: getProjects,
  })
}

export function useAddProject() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: addProject,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["projects"] }),
  })
}

export function useRemoveProject() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: removeProject,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["projects"] }),
  })
}

export function useUpdateProject() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Partial<Omit<Project, "id">> }) =>
      updateProject(id, updates),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["projects"] }),
  })
}
