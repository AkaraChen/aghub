import { QueryClient } from "@tanstack/react-query";
import { createInstance } from "i18next";
import { describe, expect, it, vi } from "vitest";
import { createApi } from "../lib/api";
import { prepareSkillSourceSyncMutationOptions } from "./skill-source-sync";

async function setup(paths: string[]) {
	const i18n = createInstance();
	await i18n.init({ lng: "en", resources: { en: { translation: {} } } });
	const api = createApi("http://localhost:45999", "test");
	vi.spyOn(api.skills, "gitScan").mockResolvedValue({
		session_id: "scan",
		branches: ["main"],
		current_branch: "main",
		skills: paths.map((path) => ({
			name: "example",
			path,
			description: "",
			author: null,
			version: null,
			audit: null,
		})),
	});
	const diff = vi.spyOn(api.skills, "diff").mockResolvedValue({
		results: [
			{
				identical: false,
				base_hash: "upstream",
				target_hash: "local",
				files: [],
				files_omitted: 0,
			},
		],
	});
	const options = prepareSkillSourceSyncMutationOptions({ api, t: i18n.t });
	const run = (skillPath: string | null, reference: string | null = null) =>
		options.mutationFn!(
			{
				url: "https://github.com/example/skills",
				reference,
				name: "example",
				skillPath,
				credentialId: null,
				paths: ["/tmp/skills/example/SKILL.md"],
				scope: "global",
				projectRoot: null,
				skipAudit: false,
			},
			{
				client: new QueryClient(),
				meta: undefined,
				mutationKey: undefined,
			},
		);
	return { run, diff, scan: api.skills.gitScan };
}

describe("source sync identity", () => {
	it("fetches the stored reference instead of the default branch", async () => {
		const { run, scan } = await setup(["skills/example"]);
		await run(null, "release/v1");
		expect(scan).toHaveBeenCalledWith(
			expect.objectContaining({ branch: "release/v1" }),
		);
	});
	it("matches the exact stored directory including Windows lock paths", async () => {
		const { run } = await setup([
			"skills/example",
			"skills/example/nested",
		]);
		const request = await run("skills\\example\\SKILL.md");
		expect(request.reference).toEqual({
			kind: "git_scan",
			session_id: "scan",
			skill_path: "skills/example",
		});
	});
	it("does not substitute an ancestor or descendant when the stored path is gone", async () => {
		const { run, diff } = await setup(["skills/example/nested"]);
		await expect(run("skills/example/SKILL.md")).rejects.toThrow(
			"skillNotFoundInRepo",
		);
		expect(diff).not.toHaveBeenCalled();
	});
	it("requires a unique name when an old lock has no directory", async () => {
		const { run, diff } = await setup(["first", "second"]);
		await expect(run(null)).rejects.toThrow("skillNotFoundInRepo");
		expect(diff).not.toHaveBeenCalled();
	});
	it("supports a Skill at the repository root", async () => {
		const { run } = await setup(["."]);
		expect((await run("SKILL.md")).reference).toMatchObject({
			skill_path: ".",
		});
	});
	it("rejects an incomplete comparison instead of omitting a target", async () => {
		const { run, diff } = await setup(["skills/example"]);
		diff.mockResolvedValue({ results: [null] });
		await expect(run(null)).rejects.toThrow("skillComparisonUnavailable");
	});
});
