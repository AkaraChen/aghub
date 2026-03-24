# aghub

A desktop and CLI tool designed to observe, audit, and manage local AI coding tool configurations. It reads actual configuration files directly, tracks the exact source of every capability, detects configuration drift, and only writes changes after explicit user confirmation.

By remaining stateless, taking the single source of truth from file systems, and enforcing explicit opt-in for changes, aghub seamlessly supports a clean and safe workflow for local AI assistant tuning without "locking you in." If you uninstall aghub, all your applied settings will remain perfectly intact.

## Supported AI Agents & Configuration Paths

Here is a reference list of configuration paths utilized by various AI coding agents:

| Agent                      | Rules (Instructions) Path                      | MCP Server Config Path                | Skills Directory Path |
| -------------------------- | ---------------------------------------------- | ------------------------------------- | --------------------- |
| **GitHub Copilot**         | `AGENTS.md`                                    | `.vscode/mcp.json`                    | `.agents/skills/` (project)<br>`~/.copilot/skills/` (global) |
| **Claude Code**            | `CLAUDE.md`                                    | `.mcp.json`                           | `.claude/skills/`     |
| **OpenAI Codex CLI**       | `AGENTS.md`                                    | `.codex/config.toml`                  | `.codex/skills/`      |
| **Pi Coding Agent**        | `AGENTS.md`                                    | -                                     | `.pi/skills/`         |
| **Jules**                  | `AGENTS.md`                                    | -                                     | -                     |
| **Cursor**                 | `AGENTS.md`                                    | `.cursor/mcp.json`                    | `.cursor/skills/`     |
| **Windsurf**               | `AGENTS.md`                                    | `.windsurf/mcp_config.json`           | -                     |
| **Cline**                  | `.clinerules`                                  | `.cline/mcp.json`                     | -                     |
| **Crush**                  | `CRUSH.md`                                     | `.crush.json`                         | -                     |
| **Amp**                    | `AGENTS.md`                                    | -                                     | `.agents/skills/`     |
| **Antigravity**            | `.agent/rules/ruler.md`                        | `.gemini/antigravity/mcp_config.json` | `.agent/skills/`      |
| **Amazon Q CLI**           | `.amazonq/rules/ruler_q_rules.md`              | `.amazonq/mcp.json`                   | -                     |
| **Aider**                  | `AGENTS.md`, `.aider.conf.yml`                 | `.mcp.json`                           | -                     |
| **Firebase Studio**        | `.idx/airules.md`                              | `.idx/mcp.json`                       | -                     |
| **Open Hands**             | `.openhands/microagents/repo.md`               | `config.toml`                         | -                     |
| **Gemini CLI**             | `AGENTS.md`                                    | `.gemini/settings.json`               | `.gemini/skills/`     |
| **Junie**                  | `.junie/guidelines.md`                         | `.junie/mcp/mcp.json`                 | `.junie/skills/`      |
| **AugmentCode**            | `.augment/rules/ruler_augment_instructions.md` | -                                     | -                     |
| **Kilo Code**              | `AGENTS.md`                                    | `.kilocode/mcp.json`                  | `.claude/skills/`     |
| **OpenCode**               | `AGENTS.md`                                    | `opencode.json`                       | `.opencode/skills/`   |
| **Goose**                  | `.goosehints`                                  | -                                     | `.agents/skills/`     |
| **Qwen Code**              | `AGENTS.md`                                    | `.qwen/settings.json`                 | -                     |
| **RooCode**                | `AGENTS.md`                                    | `.roo/mcp.json`                       | `.roo/skills/`        |
| **Zed**                    | `AGENTS.md`                                    | `.zed/settings.json` (project root)   | -                     |
| **Trae AI**                | `.trae/rules/project_rules.md`                 | -                                     | -                     |
| **Warp**                   | `WARP.md`                                      | -                                     | -                     |
| **Kiro**                   | `.kiro/steering/ruler_kiro_instructions.md`    | `.kiro/settings/mcp.json`             | -                     |
| **Firebender**             | `firebender.json`                              | `firebender.json`                     | -                     |
| **Factory Droid**          | `AGENTS.md`                                    | `.factory/mcp.json`                   | `.factory/skills/`    |
| **Mistral Vibe**           | `AGENTS.md`                                    | `.vibe/config.toml`                   | `.vibe/skills/`       |
| **JetBrains AI Assistant** | `.aiassistant/rules/AGENTS.md`                 | -                                     | -                     |

_(Mapping sourced from Ruler configuration defaults)_
