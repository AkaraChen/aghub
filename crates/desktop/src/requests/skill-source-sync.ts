import { mutationOptions } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import type { SkillCopyResolutionRequest } from "../generated/dto";
import type { ApiClient } from "./client";

interface SourceSyncInput {
	url: string;
	reference: string | null;
	name: string;
	skillPath: string | null;
	credentialId: string | null;
	paths: string[];
	scope: "global" | "all";
	projectRoot: string | null;
	skipAudit: boolean;
}

function repositoryDirectory(path: string): string {
	return (
		path
			.replace(/\\/g, "/")
			.replace(/(^|\/)skill\.md$/i, "")
			.replace(/^\.\//, "")
			.replace(/\/$/, "") || "."
	);
}

export function prepareSkillSourceSyncMutationOptions({
	api,
	t,
}: {
	api: ApiClient;
	t: TFunction;
}) {
	return mutationOptions({
		mutationFn: async (
			input: SourceSyncInput,
		): Promise<SkillCopyResolutionRequest> => {
			if (input.paths.length === 0)
				throw new Error(t("skillComparisonUnavailable"));
			const scan = await api.skills.gitScan({
				url: input.url,
				credential_id: input.credentialId,
				branch: input.reference,
				session_id: null,
				skip_audit: input.skipAudit,
			});
			const matches = scan.skills.filter(
				(skill) =>
					skill.name === input.name &&
					(!input.skillPath ||
						repositoryDirectory(skill.path) ===
							repositoryDirectory(input.skillPath)),
			);
			// An ambiguous name must never select a different nested Skill.
			if (matches.length !== 1) throw new Error(t("skillNotFoundInRepo"));
			const reference = {
				kind: "git_scan",
				session_id: scan.session_id,
				skill_path: matches[0].path,
			} as const;
			const comparison = await api.skills.diff({
				reference,
				installed_paths: input.paths,
				scope: input.scope,
				project_root: input.projectRoot,
			});
			const referenceHash = comparison.results[0]?.base_hash;
			if (
				!referenceHash ||
				comparison.results.length !== input.paths.length ||
				comparison.results.some(
					(diff) => !diff || diff.base_hash !== referenceHash,
				)
			) {
				throw new Error(t("skillComparisonUnavailable"));
			}
			return {
				reference,
				expected_reference_hash: referenceHash,
				storage_mode: "preserve",
				targets: comparison.results.map((diff, index) => ({
					source_path: input.paths[index],
					expected_hash: diff!.target_hash,
				})),
				scope: input.scope,
				project_root: input.projectRoot,
			};
		},
	});
}
