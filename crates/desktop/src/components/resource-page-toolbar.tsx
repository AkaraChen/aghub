import {
	ChevronDownIcon,
	FunnelIcon,
	XMarkIcon,
} from "@heroicons/react/24/solid";
import { Button, ButtonGroup, Dropdown, SearchField } from "@heroui/react";
import type { ReactNode } from "react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useAgentAvailability } from "../hooks/use-agent-availability";
import { AgentIcon } from "../lib/agent-icons";
import { cn } from "../lib/utils";

interface ResourcePageToolbarProps {
	/** Optional agent filter slot. Pass `undefined` (omit) on pages without filtering. */
	agentFilter?: {
		agentId: string | null;
		onChange: (agentId: string | null) => void;
	};
	searchValue: string;
	onSearchChange: (value: string) => void;
	searchPlaceholder?: string;
	searchAriaLabel?: string;
	/** Trailing icon buttons / dropdowns (multi-select toggle, add, refresh, …). */
	children?: ReactNode;
}

/**
 * Full-width toolbar that lives at the top of resource list pages
 * (Skills / MCP / Sub-agents). Replaces the previous in-pane
 * <ListSearchHeader> approach which was getting cramped at 280px.
 *
 * Layout: [agent filter] [search field, flex-1] [trailing actions]
 */
export function ResourcePageToolbar({
	agentFilter,
	searchValue,
	onSearchChange,
	searchPlaceholder,
	searchAriaLabel,
	children,
}: ResourcePageToolbarProps) {
	return (
		<div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2">
			{agentFilter && (
				<AgentFilterControl
					agentId={agentFilter.agentId}
					onChange={agentFilter.onChange}
				/>
			)}
			<SearchField
				value={searchValue}
				onChange={onSearchChange}
				aria-label={searchAriaLabel}
				className="min-w-0 flex-1"
			>
				<SearchField.Group>
					<SearchField.SearchIcon />
					<SearchField.Input placeholder={searchPlaceholder} />
					<SearchField.ClearButton />
				</SearchField.Group>
			</SearchField>
			{children && (
				<div className="flex shrink-0 items-center gap-1">
					{children}
				</div>
			)}
		</div>
	);
}

interface AgentFilterControlProps {
	agentId: string | null;
	onChange: (agentId: string | null) => void;
}

function AgentFilterControl({ agentId, onChange }: AgentFilterControlProps) {
	const { t } = useTranslation();
	const { availableAgents } = useAgentAvailability();

	// Only offer usable agents as filters; disabled agents are filtered back out
	// by the resource lists downstream, so selecting one would show an empty page.
	const installedAgents = useMemo(
		() =>
			[...availableAgents]
				.filter((agent) => agent.isConfigurable)
				.sort((a, b) => a.display_name.localeCompare(b.display_name)),
		[availableAgents],
	);

	const activeAgent = agentId
		? availableAgents.find((agent) => agent.id === agentId)
		: null;

	const handleAction = (key: React.Key) => {
		onChange(key === "__all__" ? null : String(key));
	};

	const dropdown = (
		<Dropdown>
			<Button
				size="sm"
				variant={activeAgent ? "secondary" : "ghost"}
				className="shrink-0 gap-1.5 px-2"
				aria-label={
					activeAgent
						? t("agentFilterChangeLabel")
						: t("agentFilterIdleLabel")
				}
			>
				{activeAgent ? (
					<>
						<AgentIcon
							id={activeAgent.id}
							name={activeAgent.display_name}
							size="xs"
							variant="ghost"
						/>
						<span className="max-w-32 truncate text-sm font-medium">
							{activeAgent.display_name}
						</span>
						<ChevronDownIcon className="size-3 text-muted" />
					</>
				) : (
					<>
						<FunnelIcon className="size-3.5" />
						<span className="text-sm">
							{t("agentFilterAllAgents")}
						</span>
						<ChevronDownIcon className="size-3 text-muted" />
					</>
				)}
			</Button>
			<Dropdown.Popover placement="bottom start">
				<Dropdown.Menu
					selectionMode="single"
					selectedKeys={agentId ? new Set([agentId]) : new Set()}
					onAction={handleAction}
				>
					<Dropdown.Item
						id="__all__"
						textValue={t("agentFilterAllAgents")}
					>
						{t("agentFilterAllAgents")}
					</Dropdown.Item>
					{installedAgents.map((agent) => (
						<Dropdown.Item
							key={agent.id}
							id={agent.id}
							textValue={agent.display_name}
						>
							<div className="flex items-center gap-2">
								<AgentIcon
									id={agent.id}
									name={agent.display_name}
									size="xs"
									variant="ghost"
								/>
								<span
									className={cn(
										agent.isDisabled && "text-muted",
									)}
								>
									{agent.display_name}
								</span>
							</div>
						</Dropdown.Item>
					))}
				</Dropdown.Menu>
			</Dropdown.Popover>
		</Dropdown>
	);

	if (!activeAgent) return dropdown;

	return (
		<ButtonGroup size="sm" variant="secondary">
			{dropdown}
			<Button
				isIconOnly
				aria-label={t("clearAgentFilter")}
				onPress={() => onChange(null)}
			>
				<XMarkIcon className="size-3.5" />
			</Button>
		</ButtonGroup>
	);
}
