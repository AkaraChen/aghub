import { DocumentDuplicateIcon, LinkIcon } from "@heroicons/react/24/solid";
import { Radio, RadioGroup } from "@heroui/react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { SkillCopyStorageModeRequest } from "../generated/dto";
import type { SkillVersionChoiceLocation } from "./skill-copy-versions";
import {
	SkillVersionLocations,
	SkillVersionSources,
} from "./skill-version-summary";

export interface SkillVersionChoice {
	id: string;
	locations: SkillVersionChoiceLocation[];
	status: string;
	ariaLabel: string;
}

export function SkillResolutionControls({
	choices,
	selectedChoiceId,
	onChoiceChange,
	hasLinks,
	storageMode,
	onStorageModeChange,
	isDisabled = false,
}: {
	choices: SkillVersionChoice[];
	selectedChoiceId?: string | null;
	onChoiceChange: (id: string) => void;
	hasLinks: boolean;
	storageMode: SkillCopyStorageModeRequest;
	onStorageModeChange: (mode: SkillCopyStorageModeRequest) => void;
	isDisabled?: boolean;
}) {
	const { t } = useTranslation();

	return (
		<div className="space-y-4">
			<div className="space-y-2">
				<p className="text-xs font-medium text-muted">
					{t("chooseVersionToKeep")}
				</p>
				<RadioGroup
					aria-label={t("chooseVersionToKeep")}
					variant="secondary"
					value={selectedChoiceId ?? ""}
					onChange={onChoiceChange}
					isDisabled={isDisabled}
					className="grid max-h-96 gap-2 overflow-y-auto rounded-lg border border-border p-2"
				>
					{choices.map((choice) => (
						<Radio
							key={choice.id}
							value={choice.id}
							aria-label={choice.ariaLabel}
							data-skill-version-choice=""
							className="w-full min-w-0"
						>
							<Radio.Content className="w-full min-w-0 items-start gap-3 rounded-lg border border-transparent p-2 transition-colors data-[hovered=true]:bg-default data-[selected=true]:border-accent/20 data-[selected=true]:bg-accent/10">
								<Radio.Control className="mt-0.5 shrink-0">
									<Radio.Indicator />
								</Radio.Control>
								<span className="min-w-0 flex-1">
									<span className="mb-2 flex min-w-0 flex-wrap items-center justify-between gap-2">
										<SkillVersionSources
											locations={choice.locations}
										/>
										<span className="text-[11px] text-muted">
											{choice.status}
										</span>
									</span>
									<SkillVersionLocations
										locations={choice.locations}
									/>
								</span>
							</Radio.Content>
						</Radio>
					))}
				</RadioGroup>
			</div>

			{hasLinks && (
				<div className="flex flex-wrap items-start justify-between gap-3 border-t border-separator pt-4">
					<div className="min-w-48 flex-1">
						<p className="text-xs font-medium text-foreground">
							{t("skillCopyStorage")}
						</p>
						<p className="mt-0.5 text-[11px] text-muted">
							{t("skillCopyStorageDescription")}
						</p>
					</div>
					<RadioGroup
						aria-label={t("skillCopyStorage")}
						orientation="horizontal"
						variant="secondary"
						value={storageMode}
						onChange={(value) => {
							if (value === "preserve" || value === "copy") {
								onStorageModeChange(value);
							}
						}}
						isDisabled={isDisabled}
						className="shrink-0"
					>
						<StorageChoice
							value="preserve"
							icon={<LinkIcon className="size-3.5" />}
							label={t("preserveSkillLinks")}
						/>
						<StorageChoice
							value="copy"
							icon={
								<DocumentDuplicateIcon className="size-3.5" />
							}
							label={t("convertSkillLinksToCopies")}
						/>
					</RadioGroup>
				</div>
			)}
		</div>
	);
}

function StorageChoice({
	value,
	icon,
	label,
}: {
	value: SkillCopyStorageModeRequest;
	icon: ReactNode;
	label: string;
}) {
	return (
		<Radio value={value}>
			<Radio.Content aria-label={label} className="gap-1.5 text-xs">
				<Radio.Control>
					<Radio.Indicator />
				</Radio.Control>
				<span className="text-muted">{icon}</span>
				<span>{label}</span>
			</Radio.Content>
		</Radio>
	);
}
