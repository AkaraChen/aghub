import ky from "ky"
import type { McpResponse, SkillResponse } from "./api-types"

export function createApi(baseUrl: string) {
  const client = ky.create({ prefixUrl: baseUrl })

  return {
    skills: {
      listAll(scope: "global" | "project" | "all" = "global"): Promise<SkillResponse[]> {
        return client.get("agents/all/skills", { searchParams: { scope } }).json()
      },
    },
    mcps: {
      listAll(scope: "global" | "project" | "all" = "global"): Promise<McpResponse[]> {
        return client.get("agents/all/mcps", { searchParams: { scope } }).json()
      },
      delete(name: string, agent: string, scope: "global" | "project"): Promise<void> {
        return client
          .delete(`agents/${agent}/mcps/${name}`, { searchParams: { scope } })
          .then(() => undefined)
      },
    },
  }
}

export type Api = ReturnType<typeof createApi>