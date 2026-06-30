import {
	ChevronDownIcon,
	FunnelIcon,
	XMarkIcon,
} from "@heroicons/react/24/solid";
import { Button, Dropdown, SearchField } from "@heroui/react";
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

	const installedAgents = useMemo(
		() =>
			[...availableAgents]
				.filter((agent) => agent.availability.is_available)
				.sort((a, b) => {
					if (a.isDisabled !== b.isDisabled) {
						return a.isDisabled ? 1 : -1;
					}
					return a.display_name.localeCompare(b.display_name);
				}),
		[availableAgents],
	);

	const activeAgent = agentId
		? availableAgents.find((agent) => agent.id === agentId)
		: null;

	const handleAction = (key: React.Key) => {
		onChange(key === "__all__" ? null : String(key));
	};

	const handleClear = (event: React.MouseEvent | React.PointerEvent) => {
		event.preventDefault();
		event.stopPropagation();
		onChange(null);
	};

	return (
		<Dropdown>
			<Button
				size="sm"
				variant={activeAgent ? "secondary" : "ghost"}
				className={cn("shrink-0 gap-1.5 px-2", activeAgent && "pr-1")}
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
						<button
							type="button"
							onPointerDown={handleClear}
							aria-label={t("clearAgentFilter")}
							className="rounded-full p-0.5 text-muted transition-colors hover:bg-default hover:text-foreground focus:outline-none focus:ring-2 focus:ring-accent/40"
						>
							<XMarkIcon className="size-3.5" />
						</button>
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
}
