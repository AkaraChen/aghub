import { EyeIcon } from "@heroicons/react/24/solid";
import { Button, ToggleButton, ToggleButtonGroup } from "@heroui/react";
import { useId, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type {
	SkillCopyStorageModeRequest,
	SkillDirectoryDiffResponse,
} from "../generated/dto";
import { cn } from "../lib/utils";
import {
	skillCopyVersionLabel,
	type SkillCopyVersion,
} from "./skill-copy-versions";
import { SkillFileDiffView } from "./skill-file-diff";
import {
	SkillResolutionControls,
	type SkillVersionChoice,
} from "./skill-resolution-controls";

export function SkillResolutionReview({
	choices,
	selectedChoiceId,
	onChoiceChange,
	hasLinks,
	storageMode,
	onStorageModeChange,
	children,
	...diffReview
}: {
	choices: SkillVersionChoice[];
	selectedChoiceId?: string;
	onChoiceChange: (hash: string) => void;
	hasLinks: boolean;
	storageMode: SkillCopyStorageModeRequest;
	onStorageModeChange: (mode: SkillCopyStorageModeRequest) => void;
	children?: ReactNode;
} & SkillVersionDiffReviewProps) {
	return (
		<div className="space-y-4">
			<SkillResolutionControls
				choices={choices}
				selectedChoiceId={selectedChoiceId}
				onChoiceChange={onChoiceChange}
				hasLinks={hasLinks}
				storageMode={storageMode}
				onStorageModeChange={onStorageModeChange}
				isDisabled={diffReview.isDisabled}
			/>
			<SkillVersionDiffReview {...diffReview} />
			{children}
		</div>
	);
}

interface SkillVersionDiffReviewProps {
	showFileChanges: boolean;
	onShowFileChangesChange: (visible: boolean) => void;
	isDisabled: boolean;
	comparisonVersions: SkillCopyVersion[];
	showVersionPicker: boolean;
	activeVersionId: string;
	onActiveVersionChange: (id: string) => void;
	diff?: SkillDirectoryDiffResponse;
	diffKey: string;
	baseLabel: string;
	targetLabel: string;
	reverse: boolean;
}

export function SkillVersionDiffReview({
	showFileChanges,
	onShowFileChangesChange,
	isDisabled,
	comparisonVersions,
	showVersionPicker,
	activeVersionId,
	onActiveVersionChange,
	diff,
	diffKey,
	baseLabel,
	targetLabel,
	reverse,
}: SkillVersionDiffReviewProps) {
	const { t } = useTranslation();
	const fileChangesId = useId();

	return (
		<>
			<div className="border-t border-separator pt-4">
				<Button
					variant="ghost"
					size="sm"
					className="text-foreground"
					aria-expanded={showFileChanges}
					aria-controls={fileChangesId}
					isDisabled={isDisabled}
					onPress={() => onShowFileChangesChange(!showFileChanges)}
				>
					<EyeIcon className="size-4" />
					{t(
						showFileChanges
							? "hideFileChanges"
							: "reviewFileChanges",
					)}
				</Button>
			</div>

			{showFileChanges && diff && (
				<div id={fileChangesId} className="space-y-3">
					{showVersionPicker && comparisonVersions.length > 1 && (
						<ToggleButtonGroup
							aria-label={t("chooseVersionToCompare")}
							selectionMode="single"
							disallowEmptySelection
							isDetached
							size="sm"
							isDisabled={isDisabled}
							selectedKeys={[activeVersionId]}
							onSelectionChange={(keys) => {
								const key = keys.values().next().value;
								if (key !== undefined) {
									onActiveVersionChange(String(key));
								}
							}}
							className="w-full max-w-full overflow-x-auto pb-1"
						>
							{comparisonVersions.map((version) => (
								<ToggleButton
									key={version.id}
									id={version.id}
									size="sm"
									variant="ghost"
									className={({ isSelected }) =>
										cn(
											"shrink-0",
											isSelected &&
												"bg-surface-secondary",
										)
									}
								>
									{skillCopyVersionLabel(version)}
								</ToggleButton>
							))}
						</ToggleButtonGroup>
					)}
					<SkillFileDiffView
						key={diffKey}
						diff={diff}
						baseLabel={baseLabel}
						targetLabel={targetLabel}
						reverse={reverse}
					/>
				</div>
			)}
		</>
	);
}
