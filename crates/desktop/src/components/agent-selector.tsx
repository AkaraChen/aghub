import { PlusIcon } from "@heroicons/react/24/solid";
import { FieldError, Label, Tag, TagGroup } from "@heroui/react";
import type { Key } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "../lib/utils";

interface AgentSelectorProps {
	agents: Array<{ id: string; display_name: string }>;
	selectedKeys: Set<string>;
	onSelectionChange: (keys: Set<string>) => void;
	label?: string;
	emptyMessage?: string;
	emptyHelpText?: string;
	showSelectedIcon?: boolean;
	variant?: "default" | "secondary";
	errorMessage?: string;
}

export function AgentSelector({
	agents,
	selectedKeys,
	onSelectionChange,
	label,
	emptyMessage,
	emptyHelpText,
	showSelectedIcon = false,
	variant,
	errorMessage,
}: AgentSelectorProps) {
	const { t } = useTranslation();

	if (agents.length === 0) {
		return (
			<div className="flex flex-col gap-2">
				{label && <Label>{label}</Label>}
				<div className="text-sm text-muted">
					<p className="mb-1 font-medium">
						{emptyMessage || t("noAgentsAvailable")}
					</p>
					{emptyHelpText && (
						<p className="text-xs">{emptyHelpText}</p>
					)}
				</div>
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-2">
			<TagGroup
				selectionMode="multiple"
				selectedKeys={selectedKeys}
				onSelectionChange={(keys: "all" | Set<Key>) =>
					onSelectionChange(keys as Set<string>)
				}
				variant="surface"
			>
				{label && <Label>{label}</Label>}
				<TagGroup.List className="flex-wrap">
					{agents.map((agent) => {
						const isSelected = selectedKeys.has(agent.id);
						return (
							<Tag
								key={agent.id}
								id={agent.id}
								className={cn(
									variant === "secondary" &&
										"bg-surface-secondary",
									errorMessage && "border border-danger",
								)}
							>
								{showSelectedIcon && isSelected ? (
									<div className="flex items-center gap-1.5">
										{agent.display_name}
										<PlusIcon
											className="size-3"
											aria-hidden="true"
										/>
									</div>
								) : (
									agent.display_name
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
