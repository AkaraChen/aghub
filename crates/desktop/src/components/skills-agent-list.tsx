import {
	ArrowPathIcon,
	CheckCircleIcon,
	XCircleIcon,
} from "@heroicons/react/24/solid";
import { Checkbox, CheckboxGroup, Description, Label } from "@heroui/react";
import { useTranslation } from "react-i18next";
import type { AvailableAgent } from "../contexts/agent-availability";
import { AgentIcon } from "../lib/agent-icons";
import type { Scope } from "../lib/skills-path-group";
import { cn } from "../lib/utils";

type AgentStatus = "idle" | "pending" | "success" | "error";
type AgentDiffLabel = "adding" | "removing" | "installed" | "unconfigured";

interface AgentState {
	status: AgentStatus;
	error?: string;
}

interface SkillsAgentListProps {
	agents: AvailableAgent[];
	selectedKeys: string[];
	onSelectionChange: (keys: string[]) => void;
	scope: Scope;
	agentStates?: Record<string, AgentState>;
	diffLabels?: Record<string, AgentDiffLabel>;
	disabled?: boolean;
	disabledAgents?: Set<string>;
	label?: string;
	emptyMessage?: string;
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
	onSelectionChange,
	scope: _scope,
	agentStates = {},
	diffLabels = {},
	disabled = false,
	disabledAgents = EMPTY_SET,
	label,
	emptyMessage,
}: SkillsAgentListProps) {
	const { t } = useTranslation();

	if (agents.length === 0) {
		return (
			<p className="text-sm text-muted">
				{emptyMessage || t("noAgentsAvailable")}
			</p>
		);
	}

	return (
		<CheckboxGroup
			value={selectedKeys}
			onChange={(values) => onSelectionChange(values as string[])}
			isDisabled={disabled}
			className="items-stretch"
		>
			{label && <Label className="sr-only">{label}</Label>}
			<div className="flex flex-col gap-1">
				{agents.map((agent) => {
					const state = agentStates[agent.id];
					const diffLabel = diffLabels[agent.id];
					const isDisabled = disabledAgents.has(agent.id);

					return (
						<Checkbox
							key={agent.id}
							value={agent.id}
							isDisabled={isDisabled}
							variant="secondary"
							className={cn(
								"group relative flex w-full flex-col items-stretch gap-2 rounded-2xl bg-surface px-3 py-2.5 transition-all",
								"data-[selected=true]:bg-accent/10",
							)}
						>
							<Checkbox.Control className="absolute top-1/2 right-3 -translate-y-1/2 rounded-full before:rounded-full">
								<Checkbox.Indicator />
							</Checkbox.Control>
							<Checkbox.Content className="flex flex-row items-start justify-start gap-3">
								<AgentIcon
									id={agent.id}
									name={agent.display_name}
									size="sm"
									variant="ghost"
								/>
								<div className="flex flex-1 flex-col gap-0.5">
									<Label className="truncate text-sm">
										{agent.display_name}
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
