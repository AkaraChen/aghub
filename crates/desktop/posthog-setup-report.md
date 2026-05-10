<wizard-report>
# PostHog post-wizard report

The wizard has completed a deep integration of the aghub desktop application with PostHog analytics. A new `src/lib/analytics.ts` module was created as a singleton wrapper around `posthog-js` (the browser-compatible SDK, appropriate for the Tauri WebView context). PostHog is initialized with the project key and host from environment variables (`VITE_POSTHOG_KEY`, `VITE_POSTHOG_HOST`) and silently no-ops when those are absent. Exception autocapture is enabled globally. Event captures were added across 9 files covering app startup, resource management (skills and MCPs), onboarding, deep-link imports, and error boundaries.

> **Note:** Run `bun install` to install the `posthog-js` dependency (already added to `package.json`).

| Event                  | Description                                                | File                                             |
| ---------------------- | ---------------------------------------------------------- | ------------------------------------------------ |
| `app started`          | Desktop app starts up and finishes initializing            | `src/main.tsx`                                   |
| `skill installed`      | User installs a skill from the marketplace                 | `src/pages/skills-sh/hooks/use-skill-install.ts` |
| `skill created`        | User manually creates a new skill                          | `src/components/create-skill-panel.tsx`          |
| `skill imported`       | User imports a skill from a local file or path             | `src/components/import-skill-panel.tsx`          |
| `skill deleted`        | User deletes one or more skills                            | `src/components/bulk-delete-dialog.tsx`          |
| `mcp server created`   | User creates a new MCP server                              | `src/components/create-mcp-panel.tsx`            |
| `mcp server updated`   | User updates an existing MCP server                        | `src/components/edit-mcp-panel.tsx`              |
| `mcp server deleted`   | User deletes one or more MCP servers                       | `src/components/bulk-delete-dialog.tsx`          |
| `deep link imported`   | User imports a skill or MCP via a deep link (aghub:// URL) | `src/components/deep-link-import-modal.tsx`      |
| `onboarding completed` | User dismisses the welcome screen and completes onboarding | `src/components/onboarding-controller.tsx`       |

Exception tracking was also added to `src/components/ui/error-boundary.tsx` via `captureException`.

## Next steps

We've built some insights and a dashboard for you to keep an eye on user behavior, based on the events we just instrumented:

- [Analytics basics dashboard](/dashboard/1565656)
- [Daily App Starts insight](/insights/XkHBauFc) — how often users launch the app
- [Skills Installed insight](/insights/lxjHHd9l) — marketplace skill install trend
- [MCP Servers Created insight](/insights/cho56OWa) — MCP server creation trend
- [Onboarding Completion Funnel](/insights/YdtqB3To) — conversion from app start to onboarding completed
- [Resource Creation Activity](/insights/Chywvg45) — weekly bar chart comparing skill installs, skill creation, and MCP creation

### Agent skill

We've left an agent skill folder in your project. You can use this context for further agent development when using Claude Code. This will help ensure the model provides the most up-to-date approaches for integrating PostHog.

</wizard-report>
