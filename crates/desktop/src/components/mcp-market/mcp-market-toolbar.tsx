import { ArrowPathIcon } from "@heroicons/react/24/solid";
import { Button, ListBox, SearchField, Select } from "@heroui/react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { MarketMcpTransport } from "../../generated/dto";
import { cn } from "../../lib/utils";
import { McpSourceSelector } from "./mcp-source-selector";
import { mcpTransportLabel } from "./mcp-transport";

export const ALL_TYPES = "__all__";
const TRANSPORT_TYPES: MarketMcpTransport["type"][] = [
	"stdio",
	"streamable_http",
	"sse",
];
export type TransportFilter = MarketMcpTransport["type"] | typeof ALL_TYPES;

interface McpMarketToolbarProps {
	typeFilter: TransportFilter;
	isFetching: boolean;
	onSourceChange: (url: string | null) => void;
	onSearch: (query: string) => void;
	onTypeChange: (type: TransportFilter) => void;
	onRefresh: () => void;
}

export function McpMarketToolbar({
	typeFilter,
	isFetching,
	onSourceChange,
	onSearch,
	onTypeChange,
	onRefresh,
}: McpMarketToolbarProps) {
	const { t } = useTranslation();
	const [input, setInput] = useState("");
	return (
		<div className="flex flex-wrap items-center gap-2">
			<McpSourceSelector onChange={onSourceChange} />
			<SearchField
				value={input}
				onChange={(value) => {
					setInput(value);
					if (value === "") onSearch("");
				}}
				onSubmit={(value) => onSearch(value.trim())}
				aria-label={t("marketMcpSearchLabel")}
				variant="secondary"
				className="min-w-0 flex-1"
			>
				<SearchField.Group>
					<SearchField.SearchIcon />
					<SearchField.Input
						placeholder={t("marketMcpSearchPlaceholder")}
					/>
					<SearchField.ClearButton />
				</SearchField.Group>
			</SearchField>
			<Select
				variant="secondary"
				aria-label={t("marketMcpTypeFilter")}
				selectedKey={typeFilter}
				onSelectionChange={(key) =>
					onTypeChange(String(key) as TransportFilter)
				}
				className="min-w-32 max-w-40 shrink-0"
			>
				<Select.Trigger>
					<Select.Value>
						<span className="truncate">
							<span className="text-muted">
								{t("marketMcpTypePrefix")}
							</span>
							{typeFilter === ALL_TYPES
								? t("all")
								: mcpTransportLabel(typeFilter)}
						</span>
					</Select.Value>
					<Select.Indicator />
				</Select.Trigger>
				<Select.Popover>
					<ListBox>
						<ListBox.Item id={ALL_TYPES} textValue={t("all")}>
							{t("all")}
						</ListBox.Item>
						{TRANSPORT_TYPES.map((transport) => (
							<ListBox.Item
								key={transport}
								id={transport}
								textValue={mcpTransportLabel(transport)}
							>
								{mcpTransportLabel(transport)}
							</ListBox.Item>
						))}
					</ListBox>
				</Select.Popover>
			</Select>
			<Button
				isIconOnly
				variant="ghost"
				size="sm"
				className="size-9 shrink-0"
				aria-label={t("refresh")}
				onPress={onRefresh}
				isDisabled={isFetching}
			>
				<ArrowPathIcon
					className={cn("size-4", isFetching && "animate-spin")}
				/>
			</Button>
		</div>
	);
}
