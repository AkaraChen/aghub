import { beforeEach, describe, expect, it, vi } from "vitest";

const storeState = vi.hoisted(() => ({
	values: new Map<string, unknown>(),
	set: vi.fn<(key: string, value: unknown) => Promise<void>>(),
	save: vi.fn<() => Promise<void>>(),
}));

vi.mock(".", () => ({
	getStore: vi.fn(async () => ({
		get: async (key: string) => storeState.values.get(key),
		set: storeState.set,
		save: storeState.save,
	})),
}));

import { addMcpRegistry, removeMcpRegistry } from "./mcp-registries";

describe("addMcpRegistry", () => {
	beforeEach(() => {
		storeState.values.clear();
		storeState.set.mockReset();
		storeState.set.mockImplementation(async (key, value) => {
			storeState.values.set(key, value);
		});
		storeState.save.mockReset();
		storeState.save.mockResolvedValue();
	});

	it("reuses an existing source with the same URL", async () => {
		const existing = {
			id: "registry-1",
			name: "Official mirror",
			url: "https://registry.example/",
		};
		storeState.values.set("mcpRegistries", [existing]);

		await expect(
			addMcpRegistry({
				name: "Duplicate",
				url: "https://registry.example/",
			}),
		).resolves.toEqual(existing);
		expect(storeState.set).not.toHaveBeenCalled();
		expect(storeState.save).not.toHaveBeenCalled();
	});

	it("preserves concurrent add and remove mutations", async () => {
		const existing = {
			id: "registry-1",
			name: "Old registry",
			url: "https://old.example/",
		};
		storeState.values.set("mcpRegistries", [existing]);

		const [, created] = await Promise.all([
			removeMcpRegistry(existing.id),
			addMcpRegistry({
				name: "New registry",
				url: "https://new.example/",
			}),
		]);

		expect(storeState.values.get("mcpRegistries")).toEqual([created]);
	});
});
