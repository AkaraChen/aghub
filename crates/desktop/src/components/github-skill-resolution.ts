import type { TFunction } from "i18next";
import * as pathe from "pathe";
import { useEffect, useMemo } from "react";
import type { SkillCopyStorageModeRequest } from "../generated/dto";
import {
	buildSkillCopyResolutionTargets,
	skillCopyVersionLocation,
	type SkillCopyVersion,
} from "./skill-copy-versions";
import {
	formatAgentName,
	type SkillSourceLocation,
} from "./skill-detail-helpers";
import type { SkillVersionChoice } from "./skill-resolution-controls";

export interface GithubSkillResolutionChoice {
	kind: "repository" | "local";
	reference:
		| {
				kind: "installed";
				source_path: string;
		  }
		| {
				kind: "git_scan";
				session_id: string;
				skill_path: string;
		  };
	expectedReferenceHash: string;
	storageMode: SkillCopyStorageModeRequest;
	targets: Array<{ source_path: string; expected_hash: string }>;
	locationCount: number;
	canResolve: boolean;
}

export function useSynchronizedGithubSelection({
	selection,
	selectedVersion,
	repositoryVersion,
	versions,
	sessionId,
	skillPath,
	storageMode,
	locationCount,
	canResolve,
	onSelectionChange,
}: {
	selection: GithubSkillResolutionChoice | null;
	selectedVersion?: SkillCopyVersion;
	repositoryVersion?: SkillCopyVersion;
	versions: SkillCopyVersion[];
	sessionId: string;
	skillPath: string;
	storageMode: SkillCopyStorageModeRequest;
	locationCount: number;
	canResolve: boolean;
	onSelectionChange: (selection: GithubSkillResolutionChoice | null) => void;
}) {
	const currentSelection = useMemo(
		() =>
			selectedVersion && repositoryVersion
				? githubResolutionChoice({
						version: selectedVersion,
						repositoryVersion,
						versions,
						sessionId,
						skillPath,
						storageMode,
						locationCount,
						canResolve,
					})
				: null,
		[
			canResolve,
			locationCount,
			repositoryVersion,
			selectedVersion,
			sessionId,
			skillPath,
			storageMode,
			versions,
		],
	);

	useEffect(() => {
		if (!selection) return;
		if (
			!currentSelection ||
			!resolutionChoiceContentMatches(selection, currentSelection)
		) {
			onSelectionChange(null);
			return;
		}
		if (selection.canResolve !== currentSelection.canResolve) {
			onSelectionChange(currentSelection);
		}
	}, [currentSelection, onSelectionChange, selection]);
}

export function githubResolutionChoice({
	version,
	repositoryVersion,
	versions,
	sessionId,
	skillPath,
	storageMode,
	locationCount,
	canResolve,
}: {
	version: SkillCopyVersion;
	repositoryVersion: SkillCopyVersion;
	versions: SkillCopyVersion[];
	sessionId: string;
	skillPath: string;
	storageMode: SkillCopyStorageModeRequest;
	locationCount: number;
	canResolve: boolean;
}): GithubSkillResolutionChoice | null {
	const repositorySelected = version === repositoryVersion;
	const sourcePath = repositorySelected
		? undefined
		: version.copies.find((copy) => copy.sourcePath)?.sourcePath;
	let reference: GithubSkillResolutionChoice["reference"];
	if (repositorySelected) {
		reference = {
			kind: "git_scan",
			session_id: sessionId,
			skill_path: skillPath,
		};
	} else {
		if (!sourcePath) return null;
		reference = {
			kind: "installed",
			source_path: sourcePath,
		};
	}

	return {
		kind: repositorySelected ? "repository" : "local",
		reference,
		expectedReferenceHash: version.hash,
		storageMode,
		targets: buildSkillCopyResolutionTargets(
			versions,
			sourcePath,
			storageMode,
		),
		locationCount,
		canResolve,
	};
}

export function githubRepositoryChoice(
	version: SkillCopyVersion,
	t: TFunction,
	skillPath: string,
): SkillVersionChoice {
	const matchingLocalCount = version.copies.filter(
		(copy) => copy.sourcePath,
	).length;
	return {
		id: version.hash,
		locations: [
			{
				source: "GitHub",
				path: skillPath,
				kind: "repository",
				target: version.hash.slice(0, 8),
			},
			...version.copies.flatMap((copy) =>
				copy.sourcePath ? [skillCopyVersionLocation(copy)] : [],
			),
		],
		status:
			matchingLocalCount > 0
				? t("repositoryVersionLocations", {
						count: matchingLocalCount,
					})
				: t("repositoryVersionState"),
		ariaLabel: t("keepRepositoryVersion"),
	};
}

export function githubLocalChoice(
	version: SkillCopyVersion,
	t: TFunction,
): SkillVersionChoice {
	const location = version.copies[0]?.label ?? version.hash.slice(0, 8);
	return {
		id: version.hash,
		locations: version.copies.map(skillCopyVersionLocation),
		status: t("skillVersionLocationUsage", {
			count: version.copies.length,
		}),
		ariaLabel: t("keepVersionFrom", { location }),
	};
}

export function githubLocationSource(location: SkillSourceLocation): string {
	return location.agents.length > 0
		? location.agents.map(formatAgentName).join(", ")
		: pathe
				.basename(
					pathe.dirname(
						pathe.dirname(pathe.dirname(location.sourcePath)),
					),
				)
				.replace(/^\./, "");
}

function resolutionChoiceContentMatches(
	left: GithubSkillResolutionChoice,
	right: GithubSkillResolutionChoice,
): boolean {
	if (
		left.kind !== right.kind ||
		left.expectedReferenceHash !== right.expectedReferenceHash ||
		left.storageMode !== right.storageMode ||
		left.locationCount !== right.locationCount ||
		left.reference.kind !== right.reference.kind ||
		left.targets.length !== right.targets.length
	) {
		return false;
	}
	if (
		left.reference.kind === "installed" &&
		right.reference.kind === "installed" &&
		left.reference.source_path !== right.reference.source_path
	) {
		return false;
	}
	if (
		left.reference.kind === "git_scan" &&
		right.reference.kind === "git_scan" &&
		(left.reference.session_id !== right.reference.session_id ||
			left.reference.skill_path !== right.reference.skill_path)
	) {
		return false;
	}
	return left.targets.every(
		(target, index) =>
			target.source_path === right.targets[index]?.source_path &&
			target.expected_hash === right.targets[index]?.expected_hash,
	);
}
