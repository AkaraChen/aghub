import ky from "ky"
import type { McpResponse, SkillResponse, TransportDto } from "./api-types"

export interface UpdateMcpRequest {
  name?: string
  transport?: TransportDto
  enabled?: boolean
  timeout?: number
}

export interface AgentInfo {
  id: string
  display_name: string
  capabilities: {
    mcp_stdio: boolean
    mcp_remote: boolean
    mcp_enable_disable: boolean
    skills: boolean
    universal_skills: boolean
  }
}

export function createApi(baseUrl: string) {
  const client = ky.create({ prefixUrl: baseUrl })

  return {
    agents: {
      list(): Promise<AgentInfo[]> {
        return client.get("agents").json()
      },
    },
    skills: {
      listAll(scope: "global" | "project" | "all" = "global"): Promise<SkillResponse[]> {
        return client.get("agents/all/skills", { searchParams: { scope } }).json()
      },
    },
    mcps: {
      listAll(scope: "global" | "project" | "all" = "global"): Promise<McpResponse[]> {
        return client.get("agents/all/mcps", { searchParams: { scope } }).json()
      },
      get(name: string, agent: string, scope: "global" | "project" | "all"): Promise<McpResponse> {
        return client.get(`agents/${agent}/mcps/${name}`, { searchParams: { scope } }).json()
      },
      create(agent: string, scope: "global" | "project", body: { name: string; transport: TransportDto; timeout?: number }): Promise<McpResponse> {
        return client.post(`agents/${agent}/mcps`, { searchParams: { scope }, json: body }).json()
      },
      update(name: string, agent: string, scope: "global" | "project", body: UpdateMcpRequest): Promise<McpResponse> {
        return client.put(`agents/${agent}/mcps/${name}`, { searchParams: { scope }, json: body }).json()
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