import {
	ArrowPathIcon,
	CheckCircleIcon,
	GlobeAltIcon,
	QuestionMarkCircleIcon,
	XCircleIcon,
} from "@heroicons/react/24/solid";
import {
	Checkbox,
	CheckboxGroup,
	Description,
	Label,
	Tooltip,
} from "@heroui/react";
import { useTranslation } from "react-i18next";
import type { AvailableAgent } from "../contexts/agent-availability";
import { AgentIcon } from "../lib/agent-icons";
import type { AgentInfo } from "../lib/api";
import {
	UNIVERSAL_GROUP_ID,
	type Scope,
	getSkillsPathGroups,
} from "../lib/skills-path-group";
import { cn } from "../lib/utils";

type AgentStatus = "idle" | "pending" | "success" | "error";
type AgentDiffLabel = "adding" | "removing" | "installed" | "unconfigured";

interface AgentState {
	status: AgentStatus;
	error?: string;
}

interface SkillsAgentListProps {
	agents: AvailableAgent[];
	agentInfos: AgentInfo[];
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

export function SkillsAgentList({
	agents,
	agentInfos,
	selectedKeys,
	onSelectionChange,
	scope,
	agentStates = {},
	diffLabels = {},
	disabled = false,
	disabledAgents = new Set(),
	label,
	emptyMessage,
}: SkillsAgentListProps) {
	const { t } = useTranslation();

	const groups = getSkillsPathGroups(agentInfos, scope);
	const universalGroup = groups.find(
		(g) => g.isUniversal && g.agentIds.length > 1,
	);
	const universalAgentNames = universalGroup
		? universalGroup.agentIds
				.map((id) => agents.find((a) => a.id === id)?.display_name)
				.filter(Boolean)
				.join(", ")
		: "";
	const otherAgents = agents.filter((a) => {
		if (!universalGroup) return true;
		return !universalGroup.agentIds.includes(a.id);
	});

	const allUniversalAgentsSelected =
		universalGroup &&
		universalGroup.agentIds.every((id) => selectedKeys.includes(id));

	const displaySelectedKeys = allUniversalAgentsSelected
		? [UNIVERSAL_GROUP_ID, ...selectedKeys]
		: selectedKeys;

	const handleSelectionChange = (values: string[]) => {
		const hasUniversal = values.includes(UNIVERSAL_GROUP_ID);
		const hadUniversal = allUniversalAgentsSelected;

		if (hasUniversal && !hadUniversal && universalGroup) {
			const newSelection = new Set([
				...selectedKeys.filter(
					(id) => !universalGroup.agentIds.includes(id),
				),
				...universalGroup.agentIds,
			]);
			onSelectionChange([...newSelection]);
		} else if (!hasUniversal && hadUniversal && universalGroup) {
			const newSelection = selectedKeys.filter(
				(id) => !universalGroup.agentIds.includes(id),
			);
			onSelectionChange(newSelection);
		} else {
			onSelectionChange(values.filter((id) => id !== UNIVERSAL_GROUP_ID));
		}
	};

	if (agents.length === 0) {
		return (
			<p className="text-sm text-muted">
				{emptyMessage || "No agents available"}
			</p>
		);
	}

	return (
		<CheckboxGroup
			value={displaySelectedKeys}
			onChange={(values) => handleSelectionChange(values as string[])}
			isDisabled={disabled}
			className="items-stretch"
		>
			{label && <Label className="sr-only">{label}</Label>}
			<div className="flex flex-col gap-1">
				{universalGroup && universalGroup.agentIds.length > 1 && (
					<Checkbox
						key={UNIVERSAL_GROUP_ID}
						value={UNIVERSAL_GROUP_ID}
						isDisabled={disabled}
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
							<div className="flex size-8 shrink-0 items-center justify-center">
								<GlobeAltIcon className="size-5 text-muted" />
							</div>
							<div className="flex flex-1 flex-col gap-0.5">
								<div className="flex items-center gap-1.5">
									<Label className="truncate text-sm">
										{t("universalSkills")}
									</Label>
									<Tooltip delay={0}>
										<Tooltip.Trigger>
											<div className="flex size-4 cursor-help items-center justify-center">
												<QuestionMarkCircleIcon className="size-3.5 text-muted" />
											</div>
										</Tooltip.Trigger>
										<Tooltip.Content>
											{t("universalSkillsTooltip", {
												agents: universalAgentNames,
											})}
										</Tooltip.Content>
									</Tooltip>
								</div>
								<Description className="text-xs text-muted">
									{t("universalSkillsDescription", {
										count: universalGroup.agentIds.length,
									})}
								</Description>
							</div>
						</Checkbox.Content>
					</Checkbox>
				)}
				{otherAgents.map((agent) => {
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
												Processing
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
												Success
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
												Failed
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
											Already installed
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
