import {
	CheckCircleIcon,
	DocumentDuplicateIcon,
	LinkIcon,
} from "@heroicons/react/24/solid";
import { Radio, RadioGroup, Table } from "@heroui/react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { SkillCopyStorageModeRequest } from "../generated/dto";
import { cn } from "../lib/utils";
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
				<Table variant="secondary">
					<Table.ScrollContainer className="max-h-72 rounded-lg border border-border">
						<Table.Content
							aria-label={t("chooseVersionToKeep")}
							selectionMode="single"
							selectionBehavior="replace"
							disallowEmptySelection
							selectedKeys={
								selectedChoiceId
									? new Set([selectedChoiceId])
									: new Set<string>()
							}
							disabledKeys={
								isDisabled
									? new Set(
											choices.map((choice) => choice.id),
										)
									: undefined
							}
							onSelectionChange={(keys) => {
								if (keys === "all") return;
								const selected = keys.values().next().value;
								if (selected !== undefined) {
									onChoiceChange(String(selected));
								}
							}}
							className="w-full table-fixed"
						>
							<Table.Header>
								<Table.Column isRowHeader className="w-24 px-2">
									{t("skillVersionSource")}
								</Table.Column>
								<Table.Column>
									{t("skillVersionLocation")}
								</Table.Column>
								<Table.Column className="w-10 px-2 text-center">
									{t("keepThisVersion")}
								</Table.Column>
							</Table.Header>
							<Table.Body items={choices}>
								{(choice) => (
									<Table.Row
										id={choice.id}
										aria-label={choice.ariaLabel}
										data-skill-version-choice=""
										className={({
											isSelected,
											isDisabled: rowDisabled,
										}) =>
											cn(
												"cursor-pointer border-b border-separator/70 transition-colors last:border-b-0 hover:bg-default",
												isSelected &&
													"bg-accent/10 hover:bg-accent/15",
												rowDisabled &&
													"cursor-default opacity-50",
											)
										}
									>
										<Table.Cell className="min-w-0 px-2">
											<span className="sr-only">
												{choice.ariaLabel}
											</span>
											<SkillVersionSources
												locations={choice.locations}
											/>
										</Table.Cell>
										<Table.Cell className="min-w-0">
											<SkillVersionLocations
												locations={choice.locations}
											/>
											<span className="mt-0.5 block truncate text-[11px] text-muted">
												{choice.status}
											</span>
										</Table.Cell>
										<Table.Cell className="px-2 text-center">
											{({ isSelected }) => (
												<CheckCircleIcon
													aria-hidden
													className={cn(
														"mx-auto size-4",
														isSelected
															? "text-accent"
															: "text-muted/30",
													)}
												/>
											)}
										</Table.Cell>
									</Table.Row>
								)}
							</Table.Body>
						</Table.Content>
					</Table.ScrollContainer>
				</Table>
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
