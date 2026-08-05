import { describe, expect, it } from "vitest";
import {
	sortLocationGroupsByBaselineAgent,
	type LocationGroup,
} from "./skill-detail-helpers";

function location(path: string, agent: string): LocationGroup {
	return {
		key: path,
		sourcePath: path,
		isSymlink: false,
		installations: [
			{
				id: `${agent}:global`,
				agent,
				source: "global",
			},
		],
	};
}

describe("sortLocationGroupsByBaselineAgent", () => {
	it("puts the preferred installed location first", () => {
		const locations = [
			location("~/.codex/skills/demo/SKILL.md", "codex"),
			location("~/.claude/skills/demo/SKILL.md", "claude"),
		];

		expect(sortLocationGroupsByBaselineAgent(locations, "claude")).toEqual([
			locations[1],
			locations[0],
		]);
	});

	it("keeps the discovery order when neither location matches", () => {
		const locations = [
			location("~/.cursor/skills/demo/SKILL.md", "cursor"),
			location("~/.agents/skills/demo/SKILL.md", "opencode"),
		];

		expect(sortLocationGroupsByBaselineAgent(locations, "claude")).toEqual(
			locations,
		);
	});
});
