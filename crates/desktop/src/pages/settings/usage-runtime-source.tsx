import { Button } from "@heroui/react";
import type { TFunction } from "i18next";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type {
	CcusageRuntimeCandidateDto,
	CcusageRuntimeDto,
	CcusageRuntimeExecutableDto,
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
	const describedActive =
		selectedSource === runtime.preference ? runtime.active : null;
	const executablePath = describedActive?.path ?? candidate?.path;
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
		return {
			id: source,
			label: t(sourceLabelKey(source)),
			description: sourceOptionDescription(source, sourceCandidate, t),
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
		<div className="space-y-3" data-testid="usage-runtime-source-controls">
			<SettingRow
				title={t("usageRuntimeSource")}
				description={
					<span className="block min-w-0">
						<span className="block">
							{sourceDescription(
								selectedSource,
								candidate,
								describedActive,
								t,
							)}
						</span>
						{executablePath && (
							<code
								dir="ltr"
								title={executablePath}
								data-testid="usage-runtime-path"
								className="mt-0.5 block max-w-full truncate font-mono text-[11px]"
							>
								{executablePath}
							</code>
						)}
					</span>
				}
				control={
					<div className="flex flex-wrap items-center justify-end gap-2">
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
		</div>
	);
}

function sourceOptionDescription(
	source: CcusageRuntimeSource,
	candidate: CcusageRuntimeCandidateDto | undefined,
	t: TFunction,
): string | undefined {
	if (candidate?.version) return shortCcusageVersion(candidate.version);
	if (candidate?.can_install) return t("usageRuntimeSourceInstallable");
	if (source !== "auto" && source !== "manual") {
		return t("usageRuntimeStatusUnavailable");
	}
	return undefined;
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
	active: CcusageRuntimeExecutableDto | null,
	t: TFunction,
): string {
	if (active && (source === "auto" || active.source !== source)) {
		return joinMetadata(
			t("usageRuntimeActiveSourceDescription", {
				source: t(sourceLabelKey(active.source)),
			}),
			shortCcusageVersion(active.version),
		);
	}
	if (source === "auto") return t("usageRuntimeAutoDescription");

	const version =
		active?.source === source
			? shortCcusageVersion(active.version)
			: candidate?.version
				? shortCcusageVersion(candidate.version)
				: undefined;
	const isInstalled =
		active?.source === source || candidate?.installed === true;
	if (source === "manual") {
		return joinMetadata(version, t("usageRuntimeExternalDescription"));
	}
	if (EXTERNAL_SOURCES.has(source)) {
		return isInstalled
			? joinMetadata(version, t("usageRuntimeExternalDescription"))
			: t("usageRuntimeStatusUnavailable");
	}
	if (source === "bundled") {
		return isInstalled
			? joinMetadata(version, t("usageRuntimeBundledDescription"))
			: t("usageRuntimeStatusUnavailable");
	}
	if (isInstalled) {
		return joinMetadata(
			version,
			t("usageRuntimeManagedInstalledDescription"),
		);
	}
	return candidate?.can_install
		? joinMetadata(
				t("usageRuntimeManagedInstallDescription"),
				t("usageRuntimeSourceInstallable"),
			)
		: t("usageRuntimeStatusUnavailable");
}

function joinMetadata(...parts: Array<string | undefined>): string {
	return parts.filter((part): part is string => Boolean(part)).join(" · ");
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
