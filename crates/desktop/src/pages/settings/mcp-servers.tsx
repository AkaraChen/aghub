import {
	ArrowPathIcon,
	PlusIcon,
} from "@heroicons/react/24/solid";
import {
	Button,
	SearchField,
} from "@heroui/react";
import { useQueryState } from "nuqs";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { CreateMcpPanel } from "../../components/create-mcp-panel";
import { EditMcpPanel } from "../../components/edit-mcp-panel";
import { McpDetail, type McpGroup } from "../../components/mcp-detail";
import { McpList } from "../../components/mcp-list";
import { useMcps } from "../../hooks/use-mcps";
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
	const [selectedKey, setSelectedKey] = useQueryState("server");

	const groupedMcps = useMemo(() => {
		const map = new Map<string, McpGroup>();

		for (const mcp of mcps) {
			const key = getMcpMergeKey(mcp.transport);
			const existing = map.get(key);
			if (existing) {
				existing.items.push(mcp);
			} else {
				map.set(key, {
					mergeKey: key,
					transport: mcp.transport,
					items: [mcp],
				});
			}
		}

		return Array.from(map.values());
	}, [mcps]);

	const handleSelect = (key: string) => {
		setSelectedKey(key);
		setPanel({ type: "detail", selectedKey: key });
	};

	const handleCreate = () => {
		setSelectedKey(null);
		setPanel({ type: "create" });
	};

	const handlePanelDone = () => {
		setPanel({ type: "empty" });
	};

	const handleEditDone = (mergeKey: string) => {
		setPanel({ type: "detail", selectedKey: mergeKey });
	};

	const selectedGroup = selectedKey
		? groupedMcps.find((g) => g.mergeKey === selectedKey)
		: null;

	const effectivePanel: RightPanel = selectedKey
		? { type: "detail", selectedKey }
		: panel;

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
				<McpList
					mcps={mcps}
					selectedKey={selectedKey}
					searchQuery={searchQuery}
					onSelect={handleSelect}
				/>
			</div>

			{/* Server Detail Panel */}
			<div className="flex-1 overflow-hidden">
				{effectivePanel.type === "detail" && selectedGroup && (
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
				{effectivePanel.type === "create" && (
					<CreateMcpPanel onDone={handlePanelDone} />
				)}
				{effectivePanel.type === "edit" && selectedGroup && (
					<EditMcpPanel
						key={selectedGroup.mergeKey}
						group={selectedGroup}
						onDone={() => handleEditDone(selectedGroup.mergeKey)}
					/>
				)}
				{(effectivePanel.type === "empty" ||
					(effectivePanel.type === "detail" && !selectedGroup)) && (
					<div className="flex items-center justify-center h-full">
						<p className="text-sm text-muted">
							{t("selectServer")}
						</p>
					</div>
				)}
			</div>
		</div>
	);
}
