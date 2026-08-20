import {
	ArrowPathIcon,
	CheckCircleIcon,
	XCircleIcon,
} from "@heroicons/react/24/solid";
import { Checkbox, CheckboxGroup, Description, Label } from "@heroui/react";
import { useTranslation } from "react-i18next";
import type { AvailableAgent } from "../contexts/agent-availability";
import { AgentIcon } from "../lib/agent-icons";
import { UNIVERSAL_SKILL_TARGET_ID } from "../lib/skill-targets";
import { cn } from "../lib/utils";
import { UniversalSkillTargetIcon } from "./universal-skill-target-icon";

type AgentStatus = "idle" | "pending" | "success" | "error";
type AgentDiffLabel =
	"adding" | "removing" | "installed" | "partial" | "unconfigured";

interface AgentState {
	status: AgentStatus;
	error?: string;
}

interface SkillsAgentListProps {
	agents: AvailableAgent[];
	selectedKeys: string[];
	indeterminateKeys?: Set<string>;
	onSelectionChange: (keys: string[]) => void;
	agentStates?: Record<string, AgentState>;
	diffLabels?: Record<string, AgentDiffLabel>;
	disabled?: boolean;
	disabledAgents?: Set<string>;
	label?: string;
}

function DiffLabelDisplay({ diffLabel }: { diffLabel: AgentDiffLabel }) {
	const { t } = useTranslation();

	if (diffLabel === "adding") {
		return (
			<Description className="text-xs text-success">
				+ {t("adding")}
			</Description>
		);
	}
	if (diffLabel === "removing") {
		return (
			<Description className="text-xs text-danger">
				− {t("removing")}
			</Description>
		);
	}
	if (diffLabel === "installed") {
		return (
			<Description className="text-xs text-muted">
				{t("alreadyAdded")}
			</Description>
		);
	}
	if (diffLabel === "partial") {
		return (
			<Description className="text-xs text-muted">
				{t("installedOnSome")}
			</Description>
		);
	}
	if (diffLabel === "unconfigured") {
		return (
			<Description className="text-xs text-muted">
				{t("unconfigured")}
			</Description>
		);
	}
	return null;
}

const EMPTY_SET = new Set<string>();

export function SkillsAgentList({
	agents,
	selectedKeys,
	indeterminateKeys = EMPTY_SET,
	onSelectionChange,
	agentStates = {},
	diffLabels = {},
	disabled = false,
	disabledAgents = EMPTY_SET,
	label,
}: SkillsAgentListProps) {
	const { t } = useTranslation();
	const targets = [
		{
			id: UNIVERSAL_SKILL_TARGET_ID,
			displayName: t("universalAgentTarget"),
			universal: true,
		},
		...agents.map((agent) => ({
			id: agent.id,
			displayName: agent.display_name,
			universal: false,
		})),
	];

	return (
		<CheckboxGroup
			value={selectedKeys}
			onChange={(values) => onSelectionChange(values as string[])}
			isDisabled={disabled}
			className="items-stretch"
		>
			{label && <Label className="sr-only">{label}</Label>}
			<div className="flex flex-col gap-1">
				{targets.map((target) => {
					const state = agentStates[target.id];
					const diffLabel = diffLabels[target.id];
					const isDisabled = disabledAgents.has(target.id);

					return (
						<Checkbox
							key={target.id}
							value={target.id}
							isIndeterminate={indeterminateKeys.has(target.id)}
							isDisabled={isDisabled}
							variant="secondary"
							className={cn(
								"group relative flex w-full flex-col items-stretch gap-2 rounded-2xl bg-surface px-3 py-2.5 transition-colors",
								"data-[selected=true]:bg-accent/10",
							)}
						>
							<Checkbox.Control className="absolute top-1/2 right-3 -translate-y-1/2 rounded-full before:rounded-full">
								<Checkbox.Indicator />
							</Checkbox.Control>
							<Checkbox.Content className="flex flex-row items-start justify-start gap-3">
								{target.universal ? (
									<UniversalSkillTargetIcon />
								) : (
									<AgentIcon
										id={target.id}
										name={target.displayName}
										size="sm"
										variant="ghost"
									/>
								)}
								<div className="min-w-0 flex flex-1 flex-col gap-0.5">
									<Label className="truncate whitespace-nowrap text-sm">
										{target.displayName}
									</Label>
									{state?.status === "pending" && (
										<span
											aria-live="polite"
											className="flex items-center gap-1"
										>
											<ArrowPathIcon
												className="size-3.5 animate-spin text-muted"
												aria-hidden="true"
											/>
											<span className="sr-only">
												{t("processing")}
											</span>
										</span>
									)}
									{state?.status === "success" && (
										<span
											aria-live="polite"
											className="flex items-center gap-1"
										>
											<CheckCircleIcon
												className="size-3.5 text-success"
												aria-hidden="true"
											/>
											<span className="sr-only">
												{t("success")}
											</span>
										</span>
									)}
									{state?.status === "error" && (
										<span
											aria-live="assertive"
											className="flex items-center gap-1"
										>
											<XCircleIcon
												className="size-3.5 text-danger"
												aria-hidden="true"
											/>
											<span className="sr-only">
												{t("failed")}
											</span>
										</span>
									)}
									{state?.status === "error" &&
										state.error && (
											<Description
												className="text-xs text-danger"
												role="alert"
												aria-live="assertive"
											>
												{state.error}
											</Description>
										)}
									{!state && diffLabel && (
										<DiffLabelDisplay
											diffLabel={diffLabel}
										/>
									)}
									{!state && isDisabled && !diffLabel && (
										<Description className="text-xs text-muted">
											{t("alreadyAdded")}
										</Description>
									)}
								</div>
							</Checkbox.Content>
						</Checkbox>
					);
				})}
			</div>
		</CheckboxGroup>
	);
}

export type { AgentState, AgentStatus, AgentDiffLabel };
