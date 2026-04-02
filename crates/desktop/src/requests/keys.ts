export const queryKeys = {
	agents: {
		all: () => ["agents"] as const,
		list: () => ["agents", "list"] as const,
		availability: () => ["agents", "availability"] as const,
	},
	skills: {
		all: () => ["skills"] as const,
		list: (
			scope: "global" | "project" | "all" = "global",
			projectRoot?: string,
		) => ["skills", "list", scope, projectRoot ?? null] as const,
		content: (path: string) => ["skills", "content", path] as const,
		tree: (path: string) => ["skills", "tree", path] as const,
		lock: {
			all: () => ["skills", "lock"] as const,
			global: () => ["skills", "lock", "global"] as const,
			project: (projectPath?: string) =>
				["skills", "lock", "project", projectPath ?? null] as const,
		},
	},
	mcps: {
		all: () => ["mcps"] as const,
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
	credentials: {
		all: () => ["credentials"] as const,
		list: () => ["credentials", "list"] as const,
	},
	integrations: {
		all: () => ["integrations"] as const,
		codeEditors: () => ["integrations", "code-editors"] as const,
	},
	market: {
		all: () => ["market"] as const,
		search: (query: string) => ["market", "search", query] as const,
	},
};
