import { PlusIcon } from "@heroicons/react/24/solid";
import { FieldError, Label, Tag, TagGroup } from "@heroui/react";
import type { Key } from "react";
import { useTranslation } from "react-i18next";
import type { AgentInfo } from "../generated/dto";
import { AgentIcon } from "../lib/agent-icons";
import { UNIVERSAL_SKILL_TARGET_ID } from "../lib/skill-targets";
import { cn } from "../lib/utils";
import { UniversalSkillTargetIcon } from "./universal-skill-target-icon";

interface SkillTargetSelectorProps {
	agents: Array<Pick<AgentInfo, "id" | "display_name">>;
	selectedKeys: Set<string>;
	onSelectionChange: (keys: Set<string>) => void;
	label?: string;
	showSelectedIcon?: boolean;
	variant?: "default" | "secondary";
	errorMessage?: string;
	isDisabled?: boolean;
}

export function SkillTargetSelector({
	agents,
	selectedKeys,
	onSelectionChange,
	label,
	showSelectedIcon = false,
	variant,
	errorMessage,
	isDisabled = false,
}: SkillTargetSelectorProps) {
	const { t } = useTranslation();
	const universalLabel = t("universalAgentTarget");
	const targetIds = [
		UNIVERSAL_SKILL_TARGET_ID,
		...agents.map((agent) => agent.id),
	];

	return (
		<div className="flex min-w-0 flex-col gap-2">
			<TagGroup
				selectionMode="multiple"
				selectedKeys={selectedKeys}
				onSelectionChange={(keys: "all" | Set<Key>) => {
					if (isDisabled) return;
					onSelectionChange(
						keys === "all"
							? new Set(targetIds)
							: new Set([...keys].map(String)),
					);
				}}
				variant="surface"
			>
				{label && <Label>{label}</Label>}
				<TagGroup.List className="flex min-w-0 flex-wrap">
					<Tag
						id={UNIVERSAL_SKILL_TARGET_ID}
						textValue={universalLabel}
						isDisabled={isDisabled}
						className={cn(
							variant === "secondary" && "bg-surface-secondary",
							errorMessage && "border border-danger",
						)}
					>
						<UniversalSkillTargetIcon size="xs" />
						<span>{universalLabel}</span>
						{showSelectedIcon &&
							selectedKeys.has(UNIVERSAL_SKILL_TARGET_ID) && (
								<PlusIcon
									className="size-3"
									aria-hidden="true"
								/>
							)}
					</Tag>
					{agents.map((agent) => {
						const isSelected = selectedKeys.has(agent.id);
						return (
							<Tag
								key={agent.id}
								id={agent.id}
								textValue={agent.display_name}
								isDisabled={isDisabled}
								className={cn(
									variant === "secondary" &&
										"bg-surface-secondary",
									errorMessage && "border border-danger",
								)}
							>
								<AgentIcon
									id={agent.id}
									name={agent.display_name}
									size="xs"
									variant="ghost"
								/>
								<span>{agent.display_name}</span>
								{showSelectedIcon && isSelected && (
									<PlusIcon
										className="size-3"
										aria-hidden="true"
									/>
								)}
							</Tag>
						);
					})}
				</TagGroup.List>
			</TagGroup>
			{errorMessage && <FieldError>{errorMessage}</FieldError>}
		</div>
	);
}
