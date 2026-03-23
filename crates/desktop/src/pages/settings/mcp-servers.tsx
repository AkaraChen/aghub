import {
	ArrowPathIcon,
	CommandLineIcon,
	PlusIcon,
	WifiIcon,
} from "@heroicons/react/24/solid";
import {
	Button,
	Chip,
	Label,
	ListBox,
	SearchField,
	type Selection,
} from "@heroui/react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { CreateMcpPanel } from "../../components/create-mcp-panel";
import { EditMcpPanel } from "../../components/edit-mcp-panel";
import { McpDetail, type McpGroup } from "../../components/mcp-detail";
import { useMcps } from "../../hooks/use-mcps";
import type { McpResponse } from "../../lib/api-types";
import { getMcpMergeKey } from "../../lib/utils";

type RightPanel =
	| { type: "detail"; selectedKey: string }
	| { type: "create" }
	| { type: "edit"; selectedKey: string }
	| { type: "empty" };

export default function MCPServersPage() {
	const { t } = useTranslation();
	const { data: mcps, refetch } = useMcps();
	const [searchQuery, setSearchQuery] = useState("");
	const [panel, setPanel] = useState<RightPanel>({ type: "empty" });
	const [selectedKey, setSelectedKey] = useState<string | null>(null);

	const filteredServers = useMemo(
		() =>
			mcps.filter(
				(server) =>
					server.name
						.toLowerCase()
						.includes(searchQuery.toLowerCase()) ||
					(server.source ?? "")
						.toLowerCase()
						.includes(searchQuery.toLowerCase()) ||
					(server.agent ?? "")
						.toLowerCase()
						.includes(searchQuery.toLowerCase()),
			),
		[mcps, searchQuery],
	);

	const groupedMcps = useMemo(() => {
		const map = new Map<string, McpResponse[]>();

		for (const mcp of filteredServers) {
			const key = getMcpMergeKey(mcp.transport);
			const existing = map.get(key) ?? [];
			map.set(key, [...existing, mcp]);
		}

		return Array.from(map.entries()).map(([mergeKey, items]) => ({
			mergeKey,
			transport: items[0].transport,
			items,
		}));
	}, [filteredServers]);

	const handleSelectionChange = (keys: Selection) => {
		const key = [...(keys as Set<string>)][0];
		if (key) {
			setSelectedKey(key);
			setPanel({ type: "detail", selectedKey: key });
		} else {
			setSelectedKey(null);
			setPanel({ type: "empty" });
		}
	};

	const handleCreate = () => {
		setSelectedKey(null);
		setPanel({ type: "create" });
	};

	const selectedGroup = selectedKey
		? groupedMcps.find((g) => g.mergeKey === selectedKey)
		: null;

	const getTransportIcon = (transport: McpGroup["transport"]) => {
		if (transport.type === "stdio") {
			return <CommandLineIcon className="size-4 shrink-0" />;
		}
		return <WifiIcon className="size-4 shrink-0" />;
	};

	return (
		<div className="flex h-full">
			{/* Servers List Panel */}
			<div className="w-80 shrink-0 border-r border-border flex flex-col">
				{/* Search Header */}
				<div className="flex items-center gap-2 p-3 border-b border-border">
					<SearchField
						value={searchQuery}
						onChange={setSearchQuery}
						aria-label={t("searchServers")}
						variant="secondary"
						className="flex-1 min-w-0"
					>
						<SearchField.Group>
							<SearchField.SearchIcon />
							<SearchField.Input
								placeholder={t("searchServers")}
							/>
							<SearchField.ClearButton />
						</SearchField.Group>
					</SearchField>
					<Button
						isIconOnly
						variant="ghost"
						size="sm"
						className="shrink-0"
						aria-label={t("addMcpServer")}
						onPress={handleCreate}
					>
						<PlusIcon className="size-4" />
					</Button>
					<Button
						isIconOnly
						variant="ghost"
						size="sm"
						className="shrink-0"
						aria-label={t("refreshServers")}
						onPress={() => refetch()}
					>
						<ArrowPathIcon className="size-4" />
					</Button>
				</div>

				{/* Servers List */}
				<ListBox
					aria-label="MCP Servers"
					selectionMode="single"
					selectedKeys={selectedKey ? new Set([selectedKey]) : new Set()}
					onSelectionChange={handleSelectionChange}
					className="flex-1 overflow-y-auto p-2"
				>
					{groupedMcps.map((group) => (
						<ListBox.Item
							key={group.mergeKey}
							id={group.mergeKey}
							textValue={group.items[0].name}
							className="data-selected:bg-accent/10"
						>
							<div className="flex items-center gap-2 w-full">
								{getTransportIcon(group.transport)}
								<Label className="truncate flex-1">
									{group.items[0].name}
								</Label>
								{group.items.length > 1 && (
									<Chip
										size="sm"
										variant="soft"
										color="accent"
									>
										{group.items.length}
									</Chip>
								)}
							</div>
						</ListBox.Item>
					))}
				</ListBox>
				{groupedMcps.length === 0 && (
					<p className="px-3 py-6 text-sm text-muted text-center">
						{t("noServersMatch")} &ldquo;{searchQuery}&rdquo;
					</p>
				)}
			</div>

			{/* Server Detail Panel */}
			<div className="flex-1 overflow-hidden">
				{panel.type === "detail" && selectedGroup && (
					<McpDetail
						group={selectedGroup}
						onEdit={() =>
							setPanel({
								type: "edit",
								selectedKey: selectedGroup.mergeKey,
							})
						}
					/>
				)}
			{panel.type === "create" && (
				<CreateMcpPanel onDone={() => setPanel({ type: "empty" })} />
			)}
			{panel.type === "edit" && selectedGroup && (
				<EditMcpPanel
					group={selectedGroup}
					onDone={() => setPanel({ type: "detail", selectedKey: selectedGroup.mergeKey })}
				/>
			)}
				{(panel.type === "empty" || (panel.type === "detail" && !selectedGroup)) && (
					<div className="flex items-center justify-center h-full">
						<p className="text-sm text-muted">{t("selectServer")}</p>
					</div>
				)}
			</div>
		</div>
	);
}
