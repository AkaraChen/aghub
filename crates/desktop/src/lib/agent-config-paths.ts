import { invoke } from "@tauri-apps/api/core";
import type { AgentInfo } from "../generated/dto";

/**
 * Resolve the absolute, OS-correct config directory for an agent's "open config
 * folder" button.
 *
 * The backend is the single source of truth: the `agent_config_dir` Tauri
 * command reads the first configuration path declared by the agent's runtime
 * surfaces and returns a platform-correct absolute path, so the renderer hands
 * the result straight to `revealItemInDir` — no `~` expansion or path
 * reconstruction here. Returns `null` when the agent has no config dir, so the
 * caller hides the button.
 */
export async function resolveAgentConfigPath(
	agent: AgentInfo,
): Promise<string | null> {
	return invoke<string | null>("agent_config_dir", { agentId: agent.id });
}
