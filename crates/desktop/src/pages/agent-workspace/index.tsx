import {
	ChevronRightIcon,
	CommandLineIcon,
	FolderOpenIcon,
} from "@heroicons/react/24/solid";
import { homeDir, join } from "@tauri-apps/api/path";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { Button, Card, Label, ListBox, Spinner, toast } from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { getIconForFile } from "vscode-icons-ts";
import { JsonEditor } from "../../components/editors/json-editor";
import { MarkdownEditor } from "../../components/editors/markdown-editor";
import { TomlEditor } from "../../components/editors/toml-editor";
import { ResourceSectionHeader } from "../../components/resource-section-header";
import { useAgentAvailability } from "../../hooks/use-agent-availability";
import { useApi } from "../../hooks/use-api";
import type { ConfigFileNode } from "../../generated/dto";
import { AgentIcon } from "../../lib/agent-icons";
import { cn } from "../../lib/utils";
import {
	saveFileMutationOptions,
	workspaceFileContentQueryOptions,
	workspaceFilesQueryOptions,
} from "../../requests/workspace";

const ICON_BASE =
	"https://cdn.jsdelivr.net/npm/vscode-icons-ts@0.1.2/build/icons/";
const HOME_PREFIX_REGEX = /^~\//;

function VscFileIcon({ name }: { name: string }) {
	const icon = getIconForFile(name);
	if (!icon) return <span className="inline-block size-4 shrink-0" />;
	return (
		<img
			src={`${ICON_BASE}${icon}`}
			alt=""
			className="size-4 shrink-0 opacity-70"
		/>
	);
}

interface FlatNode {
	id: string;
	name: string;
	depth: number;
	isDir: boolean;
	filePath: string;
	linkTo?: string | null;
	hasChildren: boolean;
}

function flattenTree(
	nodes: ConfigFileNode[],
	expandedDirs: Set<string>,
	depth: number = 0,
): FlatNode[] {
	const result: FlatNode[] = [];

	for (const node of nodes) {
		const isDir = node.type === "directory";
		const hasChildren = isDir && node.children.length > 0;

		result.push({
			id: node.path,
			name: node.name,
			depth,
			isDir,
			filePath: node.path,
			linkTo: node.link_to,
			hasChildren,
		});

		if (isDir && hasChildren && expandedDirs.has(node.path)) {
			result.push(...flattenTree(node.children, expandedDirs, depth + 1));
		}
	}

	return result;
}

interface WorkspaceAgentOption {
	id: string;
	label: string;
}

const WORKSPACE_AGENT_OPTIONS: WorkspaceAgentOption[] = [
	{ id: "claude", label: "Claude Code" },
	{ id: "codex", label: "OpenAI Codex" },
	{ id: "openclaw", label: "OpenClaw" },
	{ id: "opencode", label: "OpenCode" },
	{ id: "gemini", label: "Gemini" },
];

export default function CodingAgentsPage() {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();
	const { availableAgents } = useAgentAvailability();

	const workspaceAgents = useMemo(
		() =>
			availableAgents
				.filter((agent) => agent.isUsable)
				.flatMap((agent) => {
					const option = WORKSPACE_AGENT_OPTIONS.find(
						(candidate) => candidate.id === agent.id,
					);
					return option
						? [{ ...option, label: agent.display_name }]
						: [];
				}),
		[availableAgents],
	);

	const [selectedAgentId, setSelectedAgentId] = useState<string>(
		WORKSPACE_AGENT_OPTIONS[0].id,
	);
	const [selectedFilePath, setSelectedFilePath] = useState<string | null>(
		null,
	);
	const [expandedDirs, setExpandedDirs] = useState<Set<string>>(
		() => new Set(),
	);
	const [isDirty, setIsDirty] = useState(false);
	const [editorResetKey, setEditorResetKey] = useState(0);

	const { data: workspace, isLoading: isLoadingFiles } = useQuery({
		...workspaceFilesQueryOptions({ api, agentId: selectedAgentId }),
	});

	const flatNodes = useMemo(
		() => flattenTree(workspace?.files ?? [], expandedDirs),
		[workspace?.files, expandedDirs],
	);

	const selectedNode = useMemo(() => {
		if (!selectedFilePath || !workspace?.files) return null;
		const findNode = (nodes: ConfigFileNode[]): ConfigFileNode | null => {
			for (const node of nodes) {
				if (node.path === selectedFilePath) return node;
				if (node.type === "directory") {
					const found = findNode(node.children);
					if (found) return found;
				}
			}
			return null;
		};
		return findNode(workspace.files);
	}, [selectedFilePath, workspace?.files]);

	const isSelectedDir = selectedNode?.type === "directory";

	const { data: fileContent, isLoading: isLoadingContent } = useQuery({
		...workspaceFileContentQueryOptions({
			api,
			agentId: selectedAgentId,
			path: selectedFilePath ?? "",
			enabled: !!selectedFilePath && !isSelectedDir,
		}),
	});

	const saveMutation = useMutation({
		...saveFileMutationOptions({ api, queryClient }),
	});

	const findNodeByPath = (
		path: string,
		nodes: ConfigFileNode[] = workspace?.files ?? [],
	): ConfigFileNode | null => {
		for (const node of nodes) {
			if (node.path === path) return node;
			if (node.type === "directory") {
				const found = findNodeByPath(path, node.children);
				if (found) return found;
			}
		}
		return null;
	};

	const toggleDir = (id: string) => {
		const isExpanding = !expandedDirs.has(id);
		setExpandedDirs((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});

		// Auto-select if directory has exactly one non-directory child
		if (isExpanding) {
			const dirNode = findNodeByPath(id);
			if (dirNode) {
				const files = dirNode.children.filter(
					(c) => c.type !== "directory",
				);
				if (files.length === 1) {
					setSelectedFilePath(files[0].path);
					setIsDirty(false);
				}
			}
		}
	};

	const handleSave = () => {
		if (!selectedFilePath || !fileContent) return;
		saveMutation.mutate(
			{
				agentId: selectedAgentId,
				path: selectedFilePath,
				content: fileContent.content,
			},
			{
				onSuccess: () => {
					toast.success(t("agentWorkspaceSaved"));
					setIsDirty(false);
				},
				onError: () => {
					toast.danger(t("agentWorkspaceSaveFailed"));
				},
			},
		);
	};

	return (
		<div className="flex h-full">
			{/* Left: Agent list + file tree */}
			<div className="flex w-80 shrink-0 flex-col border-r border-border">
				<ResourceSectionHeader
					title={t("codingAgents")}
					count={workspaceAgents.length}
					icon={<CommandLineIcon className="size-3.5" />}
				/>
				<ListBox
					aria-label={t("codingAgents")}
					selectionMode="single"
					selectionBehavior="replace"
					selectedKeys={new Set([selectedAgentId])}
					onSelectionChange={(keys) => {
						if (keys === "all") return;
						const id = [...keys][0] as string | undefined;
						if (!id) return;
						setSelectedAgentId(id);
						setSelectedFilePath(null);
						setExpandedDirs(new Set());
						setIsDirty(false);
					}}
					className="p-2"
				>
					{workspaceAgents.map((agent) => (
						<ListBox.Item
							key={agent.id}
							id={agent.id}
							textValue={agent.label}
							className="data-selected:bg-surface"
						>
							<div className="flex min-w-0 items-center gap-2">
								<AgentIcon
									id={agent.id}
									name={agent.label}
									size="xs"
									variant="ghost"
								/>
								<div className="min-w-0 flex-1">
									<Label className="block truncate">
										{agent.label}
									</Label>
								</div>
							</div>
						</ListBox.Item>
					))}
				</ListBox>

				{/* File tree */}
				<div className="flex min-h-0 flex-1 flex-col overflow-y-auto border-t border-border">
					{workspace?.root_path && (
						<div className="flex items-center gap-1.5 px-3 py-2">
							<span className="font-mono text-xs font-medium text-accent">
								{workspace.root_path}
							</span>
							<button
								type="button"
								onClick={async () => {
									try {
										const home = await homeDir();
										const rel = workspace.root_path.replace(
											HOME_PREFIX_REGEX,
											"",
										);
										await revealItemInDir(
											await join(home, rel),
										);
									} catch {
										/* ignore */
									}
								}}
								className="text-muted hover:text-foreground"
							>
								<FolderOpenIcon className="size-3.5" />
							</button>
						</div>
					)}

					{isLoadingFiles ? (
						<div className="flex flex-1 items-center justify-center">
							<Spinner />
						</div>
					) : (
						flatNodes.map((node) => {
							const isSelected =
								!node.isDir &&
								node.filePath === selectedFilePath;
							const isSelectedDir2 =
								node.isDir &&
								node.filePath === selectedFilePath;
							const isExpanded = expandedDirs.has(node.id);

							return (
								<button
									key={node.id}
									type="button"
									onClick={() => {
										if (node.isDir && node.hasChildren) {
											toggleDir(node.id);
										}
										setSelectedFilePath(node.filePath);
										if (!node.isDir) setIsDirty(false);
									}}
									className={cn(
										"flex w-full items-center gap-1 py-1 pr-3 text-left text-[13px] transition-colors",
										isSelected || isSelectedDir2
											? "bg-surface text-foreground"
											: "text-muted hover:bg-surface-secondary/50 hover:text-foreground",
									)}
									style={{
										paddingLeft: `${node.depth * 16 + 12}px`,
									}}
								>
									{node.isDir && node.hasChildren ? (
										<ChevronRightIcon
											className={cn(
												"size-3 shrink-0 transition-transform",
												isExpanded && "rotate-90",
											)}
										/>
									) : (
										<span className="size-3 shrink-0" />
									)}
									{!node.isDir && (
										<VscFileIcon name={node.name} />
									)}
									<span className="truncate">
										{node.name}
									</span>
								</button>
							);
						})
					)}
				</div>
			</div>

			{/* Right: Editor */}
			<div className="flex flex-1 flex-col overflow-hidden">
				{selectedFilePath &&
				!isSelectedDir &&
				fileContent &&
				!isLoadingContent ? (
					<div className="flex h-full flex-col p-4">
						<Card className="flex h-full flex-col">
							<Card.Header className="flex flex-row items-center justify-between">
								<div className="flex min-w-0 items-center gap-2">
									<VscFileIcon name={fileContent.name} />
									<Card.Title className="truncate text-sm font-medium">
										{fileContent.name}
									</Card.Title>
								</div>
								<div
									className={cn(
										"flex shrink-0 gap-2 transition-opacity",
										isDirty
											? "opacity-100"
											: "pointer-events-none opacity-0",
									)}
								>
									<Button
										variant="tertiary"
										size="sm"
										onPress={() => {
											setEditorResetKey((k) => k + 1);
											setIsDirty(false);
										}}
									>
										{t("agentWorkspaceCancel")}
									</Button>
									<Button
										size="sm"
										isPending={saveMutation.isPending}
										onPress={handleSave}
									>
										{t("agentWorkspaceSave")}
									</Button>
								</div>
							</Card.Header>
							<Card.Content className="flex min-h-0 flex-1 flex-col">
								{fileContent.file_type === "json" ? (
									<JsonEditor
										key={`${selectedFilePath}-${editorResetKey}`}
										content={fileContent.content}
										onDirtyChange={setIsDirty}
									/>
								) : fileContent.file_type === "toml" ? (
									<TomlEditor
										key={`${selectedFilePath}-${editorResetKey}`}
										content={fileContent.content}
										onDirtyChange={setIsDirty}
									/>
								) : (
									<MarkdownEditor
										key={`${selectedFilePath}-${editorResetKey}`}
										content={fileContent.content}
										onDirtyChange={setIsDirty}
									/>
								)}
							</Card.Content>
						</Card>
					</div>
				) : isLoadingContent ? (
					<div className="flex h-full items-center justify-center">
						<Spinner />
					</div>
				) : (
					<div className="flex h-full items-center justify-center text-sm text-muted">
						{selectedAgentId
							? t("agentWorkspaceSelectFile")
							: t("agentWorkspaceSelectAgent")}
					</div>
				)}
			</div>
		</div>
	);
}
