import { Accordion } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import * as pathe from "pathe";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SkillCopyStorageModeRequest } from "../generated/dto";
import { useApi } from "../hooks/use-api";
import { skillDiffQueryOptions } from "../requests/skills";
import {
	groupSkillCopyVersions,
	skillCopyVersionLabel,
	skillDiffsContainLinks,
	type SkillCopyVersion,
} from "./skill-copy-versions";
import type { SkillSourceLocation } from "./skill-detail-helpers";
import {
	SkillComparisonLoading,
	SkillComparisonMatchAlert,
	SkillComparisonUnavailableAlert,
	SkillDriftHeading,
} from "./skill-drift-status";
import { SkillResolutionReview } from "./skill-version-diff-review";
import {
	githubLocalChoice,
	githubLocationSource,
	githubRepositoryChoice,
	githubResolutionChoice,
	type GithubSkillResolutionChoice,
	useSynchronizedGithubSelection,
} from "./github-skill-resolution";

interface GithubSkillDriftProps {
	sessionId: string;
	skillPath: string;
	locations: SkillSourceLocation[];
	scope: "global" | "project" | "all";
	projectRoot?: string;
	selection: GithubSkillResolutionChoice | null;
	isDisabled?: boolean;
	onSelectionChange: (selection: GithubSkillResolutionChoice | null) => void;
}

export type { GithubSkillResolutionChoice } from "./github-skill-resolution";

const REPOSITORY_DIFFERENCES_ID = "github-skill-differences";
const REPOSITORY_COPY_ID = "repository";

export function GithubSkillDrift({
	sessionId,
	skillPath,
	locations,
	scope,
	projectRoot,
	selection,
	isDisabled = false,
	onSelectionChange,
}: GithubSkillDriftProps) {
	const { t } = useTranslation();
	const api = useApi();
	const [isExpanded, setIsExpanded] = useState(false);
	const [activeVersionHash, setActiveVersionHash] = useState<string | null>(
		null,
	);
	const [storageMode, setStorageMode] =
		useState<SkillCopyStorageModeRequest>("preserve");
	const [showFileChanges, setShowFileChanges] = useState(false);
	const sourcePaths = useMemo(
		() => locations.map((location) => location.sourcePath),
		[locations],
	);
	const result = useQuery(
		skillDiffQueryOptions({
			api,
			request:
				sourcePaths.length > 0
					? {
							reference: {
								kind: "git_scan",
								session_id: sessionId,
								skill_path: skillPath,
							},
							installed_paths: sourcePaths,
							scope,
							project_root: projectRoot ?? null,
						}
					: undefined,
			enabled: sourcePaths.length > 0,
		}),
	);
	const comparisonResults = result.data?.results;
	const groupedVersions = useMemo(
		() =>
			groupSkillCopyVersions(
				{
					id: REPOSITORY_COPY_ID,
					label: t("repositoryVersion"),
					source: "GitHub",
				},
				locations.map((location) => ({
					id: location.sourcePath,
					label: pathe.dirname(location.sourcePath),
					source: githubLocationSource(location),
					sourceId: location.agents[0],
					agents: location.agents,
					sourcePath: location.sourcePath,
					isSymlink: location.isSymlink,
				})),
				comparisonResults ?? [],
			),
		[comparisonResults, locations, t],
	);
	const versions = groupedVersions.versions;
	const repositoryVersion = versions[0];
	const localVersions = versions.slice(1);
	const unavailableCount = result.isError
		? sourcePaths.length
		: groupedVersions.unavailable.length;
	const activeVersion =
		localVersions.find((version) => version.hash === activeVersionHash) ??
		localVersions[0];
	const selectedVersion = selection
		? versions.find(
				(version) => version.hash === selection.expectedReferenceHash,
			)
		: undefined;
	const reviewedLocalVersion =
		selectedVersion && selectedVersion.hash !== repositoryVersion?.hash
			? selectedVersion
			: activeVersion;
	const reverseReviewedDiff =
		selectedVersion?.hash === repositoryVersion?.hash;
	const controlsDisabled = isDisabled || result.isFetching;
	const hasLinks =
		locations.some((location) => location.isSymlink) ||
		skillDiffsContainLinks(comparisonResults);
	const localCopiesUseOneNonRepositoryVersion =
		unavailableCount === 0 &&
		localVersions.length === 1 &&
		(repositoryVersion?.copies.some((copy) => copy.sourcePath) ?? false) ===
			false;
	useSynchronizedGithubSelection({
		selection,
		selectedVersion,
		repositoryVersion,
		versions,
		sessionId,
		skillPath,
		storageMode,
		locationCount: sourcePaths.length,
		canResolve: unavailableCount === 0 && !result.isFetching,
		onSelectionChange,
	});

	if (sourcePaths.length === 0) return null;
	if (result.isPending) {
		return (
			<SkillComparisonLoading label={t("comparingRepositoryContent")} />
		);
	}

	if (versions.length === 1 && unavailableCount === 0) {
		return (
			<SkillComparisonMatchAlert
				title={t("repositoryContentMatches")}
				description={t("repositoryContentMatchesDescription")}
			/>
		);
	}

	const handleVersionSelection = (version: SkillCopyVersion) => {
		if (!repositoryVersion || controlsDisabled) return;
		const nextSelection = githubResolutionChoice({
			version,
			repositoryVersion,
			versions,
			sessionId,
			skillPath,
			storageMode,
			locationCount: sourcePaths.length,
			canResolve: unavailableCount === 0 && !result.isFetching,
		});
		if (nextSelection) onSelectionChange(nextSelection);
	};

	const handleStorageModeChange = (
		nextStorageMode: SkillCopyStorageModeRequest,
	) => {
		setStorageMode(nextStorageMode);
		if (!selectedVersion || !repositoryVersion || controlsDisabled) return;
		const nextSelection = githubResolutionChoice({
			version: selectedVersion,
			repositoryVersion,
			versions,
			sessionId,
			skillPath,
			storageMode: nextStorageMode,
			locationCount: sourcePaths.length,
			canResolve: unavailableCount === 0 && !result.isFetching,
		});
		if (nextSelection) onSelectionChange(nextSelection);
	};

	return (
		<div className="space-y-3">
			{unavailableCount > 0 && (
				<SkillComparisonUnavailableAlert
					title={t("repositoryComparisonUnavailable")}
					description={t(
						"repositoryComparisonUnavailableDescription",
						{ count: unavailableCount },
					)}
				/>
			)}

			{versions.length > 1 && (
				<Accordion
					variant="surface"
					expandedKeys={
						isExpanded
							? new Set([REPOSITORY_DIFFERENCES_ID])
							: new Set<string>()
					}
					onExpandedChange={(keys) => {
						const expanded = keys.has(REPOSITORY_DIFFERENCES_ID);
						setIsExpanded(expanded);
						setShowFileChanges(false);
						setStorageMode("preserve");
						setActiveVersionHash(
							expanded ? (localVersions[0]?.hash ?? null) : null,
						);
						if (!expanded) {
							onSelectionChange(null);
						}
					}}
				>
					<Accordion.Item id={REPOSITORY_DIFFERENCES_ID}>
						<SkillDriftHeading
							title={t(
								localCopiesUseOneNonRepositoryVersion
									? "localCopiesUseLocalVersion"
									: "repositoryDifferences",
							)}
							description={
								localCopiesUseOneNonRepositoryVersion
									? t("localCopiesUseLocalVersionSummary")
									: t("repositoryDifferencesDescription", {
											versionCount: versions.length,
											locationCount: sourcePaths.length,
										})
							}
						/>
						<Accordion.Panel>
							<Accordion.Body>
								{isExpanded &&
									repositoryVersion &&
									reviewedLocalVersion && (
										<SkillResolutionReview
											choices={versions.map((version) =>
												version === repositoryVersion
													? githubRepositoryChoice(
															version,
															t,
															skillPath,
														)
													: githubLocalChoice(
															version,
															t,
														),
											)}
											selectedChoiceId={
												selectedVersion?.hash
											}
											onChoiceChange={(hash) => {
												const version = versions.find(
													(candidate) =>
														candidate.hash === hash,
												);
												if (version) {
													if (
														version.hash !==
														repositoryVersion.hash
													) {
														setActiveVersionHash(
															version.hash,
														);
													}
													handleVersionSelection(
														version,
													);
												}
											}}
											hasLinks={hasLinks}
											storageMode={storageMode}
											onStorageModeChange={
												handleStorageModeChange
											}
											showFileChanges={showFileChanges}
											onShowFileChangesChange={
												setShowFileChanges
											}
											isDisabled={controlsDisabled}
											comparisonVersions={localVersions}
											showVersionPicker={
												!selectedVersion ||
												selectedVersion.hash ===
													repositoryVersion.hash
											}
											activeVersionHash={
												activeVersion?.hash ??
												reviewedLocalVersion.hash
											}
											onActiveVersionChange={
												setActiveVersionHash
											}
											diff={
												reviewedLocalVersion.comparison
											}
											diffKey={reviewedLocalVersion.hash}
											baseLabel={
												reverseReviewedDiff
													? skillCopyVersionLabel(
															reviewedLocalVersion,
														)
													: t("repositoryVersion")
											}
											targetLabel={
												reverseReviewedDiff
													? t("repositoryVersion")
													: skillCopyVersionLabel(
															reviewedLocalVersion,
														)
											}
											reverse={reverseReviewedDiff}
										/>
									)}
							</Accordion.Body>
						</Accordion.Panel>
					</Accordion.Item>
				</Accordion>
			)}
		</div>
	);
}
