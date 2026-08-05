import { describe, expect, it } from "vitest";
import type { SkillDirectoryDiffResponse } from "../generated/dto";
import { groupSkillCopyVersions } from "./skill-copy-versions";

function comparison(
	baseHash: string,
	targetHash: string,
): SkillDirectoryDiffResponse {
	return {
		base_hash: baseHash,
		target_hash: targetHash,
		identical: baseHash === targetHash,
		files: [],
		files_omitted: 0,
	};
}

const reference = { id: "claude", label: "Claude", source: "Claude" };
const targets = [
	{ id: "codex", label: "Codex", source: "Codex" },
	{ id: "cursor", label: "Cursor", source: "Cursor" },
];

describe("groupSkillCopyVersions", () => {
	it("groups locations with the same content hash", () => {
		const result = groupSkillCopyVersions(reference, targets, [
			comparison("same", "same"),
			comparison("same", "different"),
		]);

		expect(result.versions).toHaveLength(2);
		expect(result.versions[0].copies).toEqual([reference, targets[0]]);
	});

	it("keeps identical locations separate when grouping is disabled", () => {
		const result = groupSkillCopyVersions(
			reference,
			targets,
			[comparison("same", "same"), comparison("same", "different")],
			false,
		);

		expect(result.versions).toHaveLength(3);
		expect(result.versions.map((version) => version.copies)).toEqual([
			[reference],
			[targets[0]],
			[targets[1]],
		]);
	});
});
