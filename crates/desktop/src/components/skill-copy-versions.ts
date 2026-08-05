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
	isSymlink?: boolean;
}

export interface SkillCopyVersion {
	id: string;
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
	const seen = new Set<string>();

	return versions.flatMap((version) =>
		version.copies.flatMap((copy) => {
			if (!copy.sourcePath) return [];
			const selectedPreservedLocation =
				storageMode === "preserve" && copy.sourcePath === referencePath;
			if (selectedPreservedLocation || seen.has(copy.sourcePath)) {
				return [];
			}

			seen.add(copy.sourcePath);
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
		kind: copy.isSymlink ? "symlink" : "copy",
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
	groupIdenticalCopies = true,
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
		id: groupIdenticalCopies ? firstComparison.base_hash : reference.id,
		hash: firstComparison.base_hash,
		copies: [reference],
	};
	const versions = [baseline];
	const versionsByHash = new Map<string, SkillCopyVersion>();
	if (groupIdenticalCopies) {
		versionsByHash.set(baseline.hash, baseline);
	}
	const unavailable: SkillVersionCopy[] = [];

	for (const [index, target] of targets.entries()) {
		const comparison = comparisons[index];
		if (!comparison) {
			unavailable.push(target);
			continue;
		}

		const existing = versionsByHash.get(comparison.target_hash);
		if (existing) {
			existing.copies.push(target);
		} else {
			const version = {
				id: groupIdenticalCopies ? comparison.target_hash : target.id,
				hash: comparison.target_hash,
				copies: [target],
				comparison,
			};
			versions.push(version);
			if (groupIdenticalCopies) {
				versionsByHash.set(comparison.target_hash, version);
			}
		}

		if (!comparison.identical && !baseline.comparison) {
			baseline.comparison = comparison;
		}
	}

	return {
		versions,
		unavailable,
	};
}
