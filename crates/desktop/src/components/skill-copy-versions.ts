import * as pathe from "pathe";
import type {
	SkillCopyStorageModeRequest,
	SkillDirectoryDiffResponse,
} from "../generated/dto";

export interface SkillVersionChoiceLocation {
	source: string;
	sourceId?: string;
	agents?: string[];
	path: string;
	kind: "repository" | "symlink" | "copy";
	target?: string;
}

export interface SkillVersionCopy {
	id: string;
	label: string;
	source: string;
	sourceId?: string;
	agents?: string[];
	sourcePath?: string;
	canonicalPath?: string | null;
}

export interface SkillCopyVersion {
	hash: string;
	copies: SkillVersionCopy[];
	comparison?: SkillDirectoryDiffResponse;
}

export interface SkillCopyVersions {
	versions: SkillCopyVersion[];
	unavailable: SkillVersionCopy[];
}

export function buildSkillCopyResolutionTargets(
	versions: SkillCopyVersion[],
	referencePath: string | undefined,
	storageMode: SkillCopyStorageModeRequest,
) {
	const referenceCopy = versions
		.flatMap((version) => version.copies)
		.find((copy) => copy.sourcePath === referencePath);
	const referenceIdentity =
		referenceCopy?.canonicalPath ?? referenceCopy?.sourcePath;
	const seen = new Set<string>();

	return versions.flatMap((version) =>
		version.copies.flatMap((copy) => {
			if (!copy.sourcePath) return [];
			const identity =
				storageMode === "copy"
					? copy.sourcePath
					: (copy.canonicalPath ?? copy.sourcePath);
			const selectedPhysicalCopy =
				storageMode === "copy" &&
				copy.sourcePath === referencePath &&
				!copy.canonicalPath;
			const selectedPreservedLocation =
				storageMode === "preserve" && identity === referenceIdentity;
			if (
				selectedPhysicalCopy ||
				selectedPreservedLocation ||
				seen.has(identity)
			) {
				return [];
			}

			seen.add(identity);
			return [
				{
					source_path: copy.sourcePath,
					expected_hash: version.hash,
				},
			];
		}),
	);
}

export function skillCopyVersionLabel(version: SkillCopyVersion): string {
	const copy = version.copies[0];
	return copy ? `${copy.source} · ${copy.label}` : version.hash.slice(0, 8);
}

export function skillCopyVersionLocation(
	copy: SkillVersionCopy,
): SkillVersionChoiceLocation {
	return {
		source: copy.source,
		sourceId: copy.sourceId,
		agents: copy.agents,
		path: copy.label,
		kind: copy.canonicalPath ? "symlink" : "copy",
		target: copy.canonicalPath
			? pathe.dirname(copy.canonicalPath)
			: undefined,
	};
}

export function skillDiffsContainLinks(
	comparisons: Array<SkillDirectoryDiffResponse | null> | undefined,
): boolean {
	return Boolean(
		comparisons?.some((comparison) =>
			comparison?.files.some(
				(file) => file.before_link || file.after_link,
			),
		),
	);
}

export function groupSkillCopyVersions(
	reference: SkillVersionCopy,
	targets: SkillVersionCopy[],
	comparisons: Array<SkillDirectoryDiffResponse | null>,
): SkillCopyVersions {
	const firstComparison = comparisons.find(
		(comparison): comparison is SkillDirectoryDiffResponse =>
			comparison !== null,
	);
	if (!firstComparison) {
		return {
			versions: [],
			unavailable: targets,
		};
	}

	const baseline: SkillCopyVersion = {
		hash: firstComparison.base_hash,
		copies: [reference],
	};
	const versions = new Map<string, SkillCopyVersion>([
		[baseline.hash, baseline],
	]);
	const unavailable: SkillVersionCopy[] = [];

	for (const [index, target] of targets.entries()) {
		const comparison = comparisons[index];
		if (!comparison) {
			unavailable.push(target);
			continue;
		}

		const existing = versions.get(comparison.target_hash);
		if (existing) {
			existing.copies.push(target);
		} else {
			versions.set(comparison.target_hash, {
				hash: comparison.target_hash,
				copies: [target],
				comparison,
			});
		}

		if (!comparison.identical && !baseline.comparison) {
			baseline.comparison = comparison;
		}
	}

	return {
		versions: Array.from(versions.values()),
		unavailable,
	};
}
