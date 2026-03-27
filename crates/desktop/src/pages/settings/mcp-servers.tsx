import {
	ArrowDownTrayIcon,
	ArrowPathIcon,
	PlusIcon,
	ServerIcon,
} from "@heroicons/react/24/solid";
import { Button, Dropdown } from "@heroui/react";
import { useQueryState } from "nuqs";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { CreateMcpPanel } from "../../components/create-mcp-panel";
import { EditMcpPanel } from "../../components/edit-mcp-panel";
import { ImportMcpPanel } from "../../components/import-mcp-panel";
import { ListSearchHeader } from "../../components/list-search-header";
import type { McpGroup } from "../../components/mcp-detail";
import { McpDetail } from "../../components/mcp-detail";
import { McpList } from "../../components/mcp-list";
import { useMcps } from "../../hooks/use-mcps";
import { cn, getMcpMergeKey } from "../../lib/utils";

type RightPanel =
	| { type: "detail"; selectedKey: string }
	| { type: "create" }
	| { type: "import" }
	| { type: "edit"; selectedKey: string }
	| { type: "empty" };

export default function MCPServersPage() {
	const { t } = useTranslation();
	const { data: mcps, refetch, isFetching } = useMcps();
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

	const handleImport = () => {
		setSelectedKey(null);
		setPanel({ type: "import" });
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

	const effectivePanel: RightPanel =
		panel.type !== "empty"
			? panel
			: selectedKey
				? { type: "detail", selectedKey }
				: { type: "empty" };

	return (
		<div className="flex h-full">
			{/* Servers List Panel */}
			<div className="flex w-80 shrink-0 flex-col border-r border-border">
				<ListSearchHeader
					searchValue={searchQuery}
					onSearchChange={setSearchQuery}
					placeholder={t("searchServers")}
					ariaLabel={t("searchServers")}
				>
					<Dropdown>
						<Button
							isIconOnly
							variant="ghost"
							size="sm"
							className="shrink-0"
							aria-label={t("addMcpServer")}
						>
							<PlusIcon className="size-4" />
						</Button>
						<Dropdown.Popover placement="bottom end">
							<Dropdown.Menu
								onAction={(key) => {
									if (key === "manual") {
										handleCreate();
									} else if (key === "import") {
										handleImport();
									}
								}}
							>
								<Dropdown.Item
									id="manual"
									textValue={t("manualCreation")}
								>
									<div className="flex items-center gap-2">
										<ServerIcon className="size-4" />
										<span>{t("manualCreation")}</span>
									</div>
								</Dropdown.Item>
								<Dropdown.Item
									id="import"
									textValue={t("importFromJson")}
								>
									<div className="flex items-center gap-2">
										<ArrowDownTrayIcon className="size-4" />
										<span>{t("importFromJson")}</span>
									</div>
								</Dropdown.Item>
							</Dropdown.Menu>
						</Dropdown.Popover>
					</Dropdown>
					<Button
						isIconOnly
						variant="ghost"
						size="sm"
						className="shrink-0"
						aria-label={t("refreshServers")}
						onPress={() => refetch()}
					>
						<ArrowPathIcon
							className={cn(
								"size-4",
								isFetching && "animate-spin",
							)}
						/>
					</Button>
				</ListSearchHeader>

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
				{effectivePanel.type === "import" && (
					<ImportMcpPanel onDone={handlePanelDone} />
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
					<div className="flex h-full flex-col items-center justify-center gap-4">
						<div className="text-center">
							<p className="mb-2 text-sm text-muted">
								{t("selectServer")}
							</p>
							<p className="text-xs text-muted">
								{t("orCreateNew")}
							</p>
						</div>
						<Button onPress={handleCreate}>
							<PlusIcon className="mr-2 size-4" />
							{t("addMcpServer")}
						</Button>
					</div>
				)}
			</div>
		</div>
	);
}
