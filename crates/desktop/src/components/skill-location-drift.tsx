import { Accordion, Button, toast } from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import { isHTTPError } from "ky";
import * as pathe from "pathe";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SkillCopyStorageModeRequest } from "../generated/dto";
import { useApi } from "../hooks/use-api";
import {
	resolveSkillCopiesMutationOptions,
	skillDiffQueryOptions,
} from "../requests/skills";
import {
	buildSkillCopyResolutionTargets,
	groupSkillCopyVersions,
	skillCopyVersionLabel,
	skillCopyVersionLocation,
	skillDiffsContainLinks,
	type SkillCopyVersion,
} from "./skill-copy-versions";
import { formatAgentName, type LocationGroup } from "./skill-detail-helpers";
import type { SkillVersionChoice } from "./skill-resolution-controls";
import {
	SkillComparisonUnavailableAlert,
	SkillDriftHeading,
} from "./skill-drift-status";
import { SkillResolutionReview } from "./skill-version-diff-review";

interface SkillLocationDriftProps {
	locations: LocationGroup[];
	scope: "global" | "project" | "all";
	projectRoot?: string;
}

const LOCATION_DIFFERENCES_ID = "skill-location-differences";

export function SkillLocationDrift(props: SkillLocationDriftProps) {
	const { locations, scope, projectRoot } = props;
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();
	const [isExpanded, setIsExpanded] = useState(false);
	const [activeVersionHash, setActiveVersionHash] = useState<string | null>(
		null,
	);
	const [selectedVersionHash, setSelectedVersionHash] = useState<
		string | null
	>(null);
	const [storageMode, setStorageMode] =
		useState<SkillCopyStorageModeRequest>("preserve");
	const [showFileChanges, setShowFileChanges] = useState(false);
	const comparableLocations = locations;
	const baseline = comparableLocations[0];
	const targets = comparableLocations.slice(1);
	const result = useQuery(
		skillDiffQueryOptions({
			api,
			request:
				baseline && targets.length > 0
					? {
							reference: {
								kind: "installed",
								source_path: baseline.sourcePath,
							},
							installed_paths: targets.map(
								(target) => target.sourcePath,
							),
							scope,
							project_root: projectRoot ?? null,
						}
					: undefined,
			enabled: Boolean(baseline && targets.length > 0),
		}),
	);
	const comparisonResults = result.data?.results;
	const groupedVersions = useMemo(
		() =>
			baseline
				? groupSkillCopyVersions(
						{
							id: baseline.sourcePath,
							label: pathe.dirname(baseline.sourcePath),
							source: locationSource(baseline),
							sourceId: baseline.installations[0]?.agent,
							agents: baseline.installations.map(
								(installation) => installation.agent,
							),
							sourcePath: baseline.sourcePath,
							isSymlink: baseline.isSymlink,
						},
						targets.map((target) => ({
							id: target.sourcePath,
							label: pathe.dirname(target.sourcePath),
							source: locationSource(target),
							sourceId: target.installations[0]?.agent,
							agents: target.installations.map(
								(installation) => installation.agent,
							),
							sourcePath: target.sourcePath,
							isSymlink: target.isSymlink,
						})),
						comparisonResults ?? [],
					)
				: { versions: [], unavailable: [] },
		[baseline, comparisonResults, targets],
	);
	const versions = groupedVersions.versions;
	const baselineVersion = versions[0];
	const comparisonVersions = versions.slice(1);
	const unavailableCount = result.isError
		? targets.length
		: groupedVersions.unavailable.length;
	const activeVersion =
		comparisonVersions.find(
			(version) => version.hash === activeVersionHash,
		) ?? comparisonVersions[0];
	const selectedVersion = versions.find(
		(version) => version.hash === selectedVersionHash,
	);
	const reviewedVersion =
		selectedVersion && selectedVersion.hash !== baselineVersion?.hash
			? selectedVersion
			: activeVersion;
	const reverseReviewedDiff = selectedVersion?.hash === baselineVersion?.hash;
	const hasLinks =
		comparableLocations.some((location) => location.isSymlink) ||
		skillDiffsContainLinks(comparisonResults);
	const resolution = useMutation(
		resolveSkillCopiesMutationOptions({
			api,
			queryClient,
			onSuccess: () => {
				setSelectedVersionHash(null);
				setStorageMode("preserve");
				toast.success(t("skillCopiesUnified"));
			},
		}),
	);
	const isReviewing = result.isFetching || resolution.isPending;

	const handleResolve = () => {
		if (!selectedVersion || unavailableCount > 0 || result.isFetching)
			return;
		const sourcePath = selectedVersion.copies.find(
			(copy) => copy.sourcePath,
		)?.sourcePath;
		if (!sourcePath) return;

		resolution.mutate(
			{
				reference: {
					kind: "installed",
					source_path: sourcePath,
				},
				expected_reference_hash: selectedVersion.hash,
				storage_mode: storageMode,
				targets: buildSkillCopyResolutionTargets(
					versions,
					sourcePath,
					storageMode,
				),
				scope,
				project_root: projectRoot ?? null,
			},
			{
				onError: (error) => {
					setSelectedVersionHash(null);
					void result.refetch();
					toast.danger(
						t(
							isHTTPError(error) && error.response.status === 409
								? "skillCopiesChanged"
								: "skillCopiesResolveFailed",
							{
								error:
									error instanceof Error
										? error.message
										: String(error),
							},
						),
					);
				},
			},
		);
	};

	if (!baseline || targets.length === 0) return null;
	if (result.isPending) return null;
	if (versions.length <= 1 && unavailableCount === 0) return null;

	return (
		<div className="space-y-3">
			{unavailableCount > 0 && (
				<SkillComparisonUnavailableAlert
					title={t("skillComparisonUnavailable")}
					description={t("skillComparisonUnavailableDescription", {
						count: unavailableCount,
					})}
				/>
			)}

			{versions.length > 1 && (
				<Accordion
					variant="surface"
					expandedKeys={
						isExpanded
							? new Set([LOCATION_DIFFERENCES_ID])
							: new Set<string>()
					}
					onExpandedChange={(keys) => {
						const expanded = keys.has(LOCATION_DIFFERENCES_ID);
						setIsExpanded(expanded);
						setShowFileChanges(false);
						setStorageMode("preserve");
						setActiveVersionHash(
							expanded
								? (comparisonVersions[0]?.hash ?? null)
								: null,
						);
						if (!expanded) setSelectedVersionHash(null);
					}}
				>
					<Accordion.Item id={LOCATION_DIFFERENCES_ID}>
						<SkillDriftHeading
							title={t("skillLocationDifferences")}
							description={t(
								"skillLocationDifferencesDescription",
								{
									versionCount: versions.length,
									locationCount: comparableLocations.length,
								},
							)}
						/>
						<Accordion.Panel>
							<Accordion.Body>
								{isExpanded &&
									baselineVersion &&
									reviewedVersion && (
										<SkillResolutionReview
											choices={versions.map((version) =>
												versionChoice(version, t),
											)}
											selectedChoiceId={
												selectedVersion?.hash
											}
											onChoiceChange={(hash) => {
												setSelectedVersionHash(hash);
												if (
													hash !==
													baselineVersion.hash
												) {
													setActiveVersionHash(hash);
												}
											}}
											hasLinks={hasLinks}
											storageMode={storageMode}
											onStorageModeChange={setStorageMode}
											showFileChanges={showFileChanges}
											onShowFileChangesChange={
												setShowFileChanges
											}
											isDisabled={isReviewing}
											comparisonVersions={
												comparisonVersions
											}
											showVersionPicker={
												!selectedVersion ||
												selectedVersion.hash ===
													baselineVersion.hash
											}
											activeVersionHash={
												activeVersion?.hash ??
												reviewedVersion.hash
											}
											onActiveVersionChange={
												setActiveVersionHash
											}
											diff={reviewedVersion.comparison}
											diffKey={reviewedVersion.hash}
											baseLabel={
												reverseReviewedDiff
													? skillCopyVersionLabel(
															reviewedVersion,
														)
													: skillCopyVersionLabel(
															baselineVersion,
														)
											}
											targetLabel={
												reverseReviewedDiff
													? skillCopyVersionLabel(
															baselineVersion,
														)
													: skillCopyVersionLabel(
															reviewedVersion,
														)
											}
											reverse={reverseReviewedDiff}
										>
											<div className="flex justify-end border-t border-separator pt-4">
												<Button
													variant="primary"
													isPending={
														resolution.isPending
													}
													isDisabled={
														!selectedVersion ||
														result.isFetching ||
														unavailableCount > 0
													}
													onPress={handleResolve}
												>
													{resolution.isPending
														? t(
																"unifyingSkillCopies",
															)
														: t(
																"useSelectedSkillVersion",
																{
																	count: comparableLocations.length,
																},
															)}
												</Button>
											</div>
										</SkillResolutionReview>
									)}
							</Accordion.Body>
						</Accordion.Panel>
					</Accordion.Item>
				</Accordion>
			)}
		</div>
	);
}

function versionChoice(
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

function locationSource(location: LocationGroup): string {
	return location.installations
		.map((installation) => formatAgentName(installation.agent))
		.filter((agent, index, agents) => agents.indexOf(agent) === index)
		.join(", ");
}
