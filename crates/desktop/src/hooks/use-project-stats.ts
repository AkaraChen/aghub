import { useQuery } from "@tanstack/react-query";
import { createApi } from "../lib/api";
import type { McpResponse, SkillResponse } from "../lib/api-types";
import { ConfigSource } from "../lib/api-types";
import { useServer } from "../providers/server";

interface ProjectStats {
	skillsCount: number;
	mcpsCount: number;
}

export function useProjectStats(projectPath: string | undefined) {
	const { baseUrl } = useServer();
	const api = createApi(baseUrl);

	return useQuery<ProjectStats>({
		queryKey: ["project-stats", projectPath],
		queryFn: async () => {
			if (!projectPath) {
				return { skillsCount: 0, mcpsCount: 0 };
			}

			const [skills, mcps] = await Promise.all([
				api.skills.listAll("all", projectPath),
				api.mcps.listAll("all", projectPath),
			]);

			const skillsCount = skills.filter(
				(s: SkillResponse) => s.source === ConfigSource.Project,
			).length;
			const mcpsCount = mcps.filter(
				(m: McpResponse) => m.source === ConfigSource.Project,
			).length;

			return { skillsCount, mcpsCount };
		},
		enabled: !!projectPath,
	});
}
