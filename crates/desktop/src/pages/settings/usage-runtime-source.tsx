import { Button } from "@heroui/react";
import type { TFunction } from "i18next";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type {
	CcusageRuntimeCandidateDto,
	CcusageRuntimeDto,
	CcusageRuntimeSource,
} from "../../generated/dto";
import { shortCcusageVersion } from "../../lib/usage-format";
import { PathField, SettingRow, SettingSelect } from "./usage-setting-controls";

const MANAGED_SOURCES: ReadonlySet<CcusageRuntimeSource> = new Set([
	"bun",
	"npm",
	"download",
]);
const EXTERNAL_SOURCES: ReadonlySet<CcusageRuntimeSource> = new Set([
	"environment",
	"manual",
	"path",
]);
const SELECTABLE_SOURCES: CcusageRuntimeSource[] = [
	"auto",
	"path",
	"bun",
	"npm",
	"download",
	"bundled",
	"manual",
];

export function RuntimeSourceControls({
	runtime,
	isPending,
	onSelect,
	onInstall,
}: {
	runtime: CcusageRuntimeDto;
	isPending: boolean;
	onSelect: (source: CcusageRuntimeSource, path: string | null) => void;
	onInstall: (source: CcusageRuntimeSource) => void;
}) {
	const { t } = useTranslation();
	const [selectedSource, setSelectedSource] = useState<CcusageRuntimeSource>(
		runtime.preference,
	);
	const [manualPath, setManualPath] = useState("");
	const candidate = runtime.candidates.find(
		(item) => item.source === selectedSource,
	);
	const needsInstall =
		MANAGED_SOURCES.has(selectedSource) && candidate?.installed !== true;
	const hasChange =
		selectedSource !== runtime.preference ||
		(selectedSource === "manual" && manualPath.trim() !== "");
	const selectedSourceLabel = t(sourceLabelKey(selectedSource));
	const options = SELECTABLE_SOURCES.map((source) => {
		const sourceCandidate = runtime.candidates.find(
			(item) => item.source === source,
		);
		const label = t(sourceLabelKey(source));
		return {
			id: source,
			label: sourceCandidate?.version
				? `${label} · ${shortCcusageVersion(sourceCandidate.version)}`
				: label,
			isDisabled: !sourceCanBeChosen(source, runtime.candidates),
		};
	});
	const applySelection = () => {
		if (needsInstall) {
			onInstall(selectedSource);
			return;
		}
		onSelect(
			selectedSource,
			selectedSource === "manual" ? manualPath.trim() : null,
		);
	};

	return (
		<div className="space-y-3">
			<SettingRow
				title={t("usageRuntimeSource")}
				description={sourceDescription(
					selectedSource,
					candidate,
					runtime.active?.source,
					t,
				)}
				control={
					<div className="flex shrink-0 items-center gap-2">
						<SettingSelect
							value={selectedSource}
							onChange={(source) =>
								setSelectedSource(
									source as CcusageRuntimeSource,
								)
							}
							ariaLabel={t("usageRuntimeSource")}
							options={options}
							isDisabled={isPending}
						/>
						{hasChange && selectedSource !== "manual" && (
							<Button
								size="sm"
								variant="secondary"
								isPending={isPending}
								onPress={applySelection}
							>
								{needsInstall
									? t("usageRuntimeInstallSource", {
											source: selectedSourceLabel,
										})
									: t("usageRuntimeUseSource", {
											source: selectedSourceLabel,
										})}
							</Button>
						)}
					</div>
				}
			/>
			{selectedSource === "manual" && (
				<div className="space-y-2">
					<PathField
						label={t("usageRuntimeManualPath")}
						value={manualPath}
						onChange={setManualPath}
						placeholder={t("usageRuntimeManualPathPlaceholder")}
						hint={t("usageRuntimeManualDescription")}
					/>
					<div className="flex justify-end">
						<Button
							size="sm"
							variant="secondary"
							isPending={isPending}
							isDisabled={!manualPath.trim()}
							onPress={applySelection}
						>
							{t("usageRuntimeUseManual")}
						</Button>
					</div>
				</div>
			)}
			{runtime.active && EXTERNAL_SOURCES.has(runtime.active.source) && (
				<p className="text-xs text-muted">
					{t("usageRuntimeExternalManaged")}
				</p>
			)}
		</div>
	);
}

function sourceCanBeChosen(
	source: CcusageRuntimeSource,
	candidates: CcusageRuntimeCandidateDto[],
): boolean {
	if (source === "auto" || source === "manual") return true;
	const candidate = candidates.find((item) => item.source === source);
	return candidate?.installed === true || candidate?.can_install === true;
}

function sourceDescription(
	source: CcusageRuntimeSource,
	candidate: CcusageRuntimeCandidateDto | undefined,
	activeSource: CcusageRuntimeSource | undefined,
	t: TFunction,
): string {
	if (source === "auto") {
		return activeSource
			? t("usageRuntimeAutoActiveDescription", {
					source: t(sourceLabelKey(activeSource)),
				})
			: t("usageRuntimeAutoDescription");
	}
	if (activeSource && activeSource !== source) {
		return t("usageRuntimePreferenceActiveDescription", {
			preference: t(sourceLabelKey(source)),
			source: t(sourceLabelKey(activeSource)),
		});
	}
	if (EXTERNAL_SOURCES.has(source)) {
		return t("usageRuntimeExternalDescription");
	}
	if (source === "bundled") return t("usageRuntimeBundledDescription");
	return candidate?.installed
		? t("usageRuntimeManagedInstalledDescription")
		: t("usageRuntimeManagedInstallDescription");
}

function sourceLabelKey(source: CcusageRuntimeSource): string {
	switch (source) {
		case "auto":
			return "usageRuntimeSourceAuto";
		case "environment":
			return "usageRuntimeSourceEnvironment";
		case "manual":
			return "usageRuntimeSourceManual";
		case "path":
			return "usageRuntimeSourcePath";
		case "bun":
			return "usageRuntimeSourceBun";
		case "npm":
			return "usageRuntimeSourceNpm";
		case "download":
			return "usageRuntimeSourceDownload";
		case "bundled":
			return "usageRuntimeSourceBundled";
	}
}
