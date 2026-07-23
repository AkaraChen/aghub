export const queryKeys = {
	plugins: {
		all: () => ["plugins"] as const,
		list: () => ["plugins", "list"] as const,
		detail: (pluginId: string) => ["plugins", "detail", pluginId] as const,
		detailDisabled: () => ["plugins", "detail", "__no_plugin__"] as const,
		market: () => ["plugins", "market"] as const,
		marketplaces: () => ["plugins", "marketplaces"] as const,
		cliStatus: () => ["plugins", "cli-status"] as const,
	},
	agents: {
		all: () => ["agents"] as const,
		list: () => ["agents", "list"] as const,
		availability: () => ["agents", "availability"] as const,
	},
	skills: {
		all: () => ["skills"] as const,
		audits: () => ["skills", "audit"] as const,
		lists: () => ["skills", "list"] as const,
		list: (
			scope: "global" | "project" | "all" = "global",
			projectRoot?: string,
		) => ["skills", "list", scope, projectRoot ?? null] as const,
		content: (
			path: string,
			scope: "global" | "project" | "all" = "global",
			projectRoot?: string,
		) => ["skills", "content", path, scope, projectRoot ?? null] as const,
		tree: (
			path: string,
			scope: "global" | "project" | "all" = "global",
			projectRoot?: string,
		) => ["skills", "tree", path, scope, projectRoot ?? null] as const,
		audit: (paths: readonly string[]) =>
			["skills", "audit", [...paths].sort()] as const,
		lock: {
			all: () => ["skills", "lock"] as const,
			global: () => ["skills", "lock", "global"] as const,
			project: (projectPath?: string) =>
				["skills", "lock", "project", projectPath ?? null] as const,
		},
	},
	preferences: {
		all: () => ["preferences"] as const,
		skillAudit: () => ["preferences", "skill-audit"] as const,
	},
	mcps: {
		all: () => ["mcps"] as const,
		lists: () => ["mcps", "list"] as const,
		list: (
			scope: "global" | "project" | "all" = "global",
			projectRoot?: string,
		) => ["mcps", "list", scope, projectRoot ?? null] as const,
		detail: (
			name: string,
			agent: string,
			scope: "global" | "project" | "all",
		) => ["mcps", "detail", name, agent, scope] as const,
	},
	subAgents: {
		all: () => ["sub-agents"] as const,
		list: (
			scope: "global" | "project" | "all" = "global",
			projectRoot?: string,
		) => ["sub-agents", "list", scope, projectRoot ?? null] as const,
		detail: (
			name: string,
			agent: string,
			scope: "global" | "project" | "all",
		) => ["sub-agents", "detail", name, agent, scope] as const,
	},
	credentials: {
		all: () => ["credentials"] as const,
		list: () => ["credentials", "list"] as const,
	},
	inferenceProviders: {
		all: () => ["inference-providers"] as const,
		list: () => ["inference-providers", "list"] as const,
		presets: () => ["inference-providers", "presets"] as const,
		agent: (agentId: string) =>
			["inference-providers", "agent", agentId] as const,
		agentState: (agentId: string) =>
			["inference-providers", "agent", agentId, "state"] as const,
		password: (name: string) =>
			["inference-providers", "password", name] as const,
	},
	integrations: {
		all: () => ["integrations"] as const,
		codeEditors: () => ["integrations", "code-editors"] as const,
	},
	market: {
		all: () => ["market"] as const,
		search: (query: string) => ["market", "search", query] as const,
	},
	sidebar: {
		all: () => ["sidebar"] as const,
		items: () => ["sidebar", "items"] as const,
	},
	usage: {
		all: () => ["usage"] as const,
		summary: (
			since: string | null,
			until: string | null,
			timezone: string | null,
		) => ["usage", "summary", since, until, timezone] as const,
		limits: () => ["usage", "limits"] as const,
	},
	onboarding: {
		all: () => ["onboarding"] as const,
		bootstrap: () => ["onboarding", "bootstrap"] as const,
	},
	updates: {
		all: () => ["updates"] as const,
		autoCheck: () => ["updates", "auto-check"] as const,
		channel: () => ["updates", "channel"] as const,
		startup: () => ["updates", "startup"] as const,
	},
};
