import { homeDir, join } from "@tauri-apps/api/path";
import type { AgentInfo } from "../generated/dto";

const KNOWN_AGENT_RELATIVE_PATHS: Record<string, string[]> = {
	claude: [".claude.json"],
	codex: [".codex", "config.toml"],
	opencode: [".config", "opencode", "opencode.json"],
	cursor: [".cursor"],
	windsurf: [".codeium", "windsurf"],
	zed: [".config", "zed"],
	warp: [".warp"],
	copilot: [".copilot"],
	cline: [".cline"],
	gemini: [".gemini", "settings.json"],
	roocode: [".roo"],
	mistral: [".vibe"],
	amp: [".config", "amp"],
};

/**
 * Resolve a filesystem path that we can hand to revealItemInDir for an agent.
 *
 * Strategy:
 * 1. Look up a hardcoded relative-to-home path for known agents (most accurate
 *    — points at the actual config file or directory).
 * 2. Fall back to the agent's global skills write directory if it has one.
 * 3. Return null if neither is known (caller should hide the button).
 */
export async function resolveAgentConfigPath(
	agent: AgentInfo,
): Promise<string | null> {
	const known = KNOWN_AGENT_RELATIVE_PATHS[agent.id];
	if (known) {
		const home = await homeDir();
		return join(home, ...known);
	}

	if (agent.skills_paths.global_write) {
		return agent.skills_paths.global_write;
	}

	return null;
}
