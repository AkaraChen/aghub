import {
	ArrowTopRightOnSquareIcon,
	ChevronRightIcon,
	EyeIcon,
	EyeSlashIcon,
} from "@heroicons/react/24/solid";
import { Button } from "@heroui/react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { cn } from "../../lib/utils";
import { RawEditor } from "./raw-editor";

interface SectionDef {
	id: string;
	label: string;
	keys: Set<string>;
	linkTo?: string;
	linkLabelKey?: string;
}

const SECTION_DEFS: SectionDef[] = [
	{
		id: "provider",
		label: "Provider",
		keys: new Set([
			"model",
			"baseUrl",
			"base_url",
			"apiBaseUrl",
			"api_base_url",
			"apiKey",
			"api_key",
			"primaryApiKey",
		]),
		linkTo: "/inference-providers",
		linkLabelKey: "inferenceProviders",
	},
	{
		id: "permissions",
		label: "Permissions",
		keys: new Set(["permissions"]),
	},
	{ id: "hooks", label: "Hooks", keys: new Set(["hooks"]) },
	{
		id: "plugins",
		label: "Plugins",
		keys: new Set(["enabledPlugins", "plugin", "pluginConfig"]),
		linkTo: "/plugins",
		linkLabelKey: "plugins",
	},
	{
		id: "mcp",
		label: "MCP",
		keys: new Set(["mcp", "mcp_servers", "mcpServers"]),
		linkTo: "/mcp",
		linkLabelKey: "mcpServers",
	},
	{
		id: "provider-config",
		label: "Provider Config",
		keys: new Set(["provider", "providers"]),
		linkTo: "/inference-providers",
		linkLabelKey: "inferenceProviders",
	},
];

interface Section {
	def: SectionDef | null;
	entries: [string, unknown][];
	startLine: number;
	endLine: number;
}

function findDefForKey(key: string): SectionDef | null {
	return SECTION_DEFS.find((def) => def.keys.has(key)) ?? null;
}

const TOP_LEVEL_KEY_REGEX = /^ {2}"([^"]+)"/;

/**
 * Build sections from pretty-printed JSON. Sections are ordered by the
 * actual key order in the JSON. Adjacent keys belonging to the same
 * SectionDef are merged into one section.
 */
function buildSections(
	formatted: string,
	obj: Record<string, unknown>,
): Section[] {
	const lines = formatted.split("\n");
	const totalLines = lines.length;

	// Step 1: find the 1-based start line of each top-level key
	const keyStartLines = new Map<string, number>();
	for (let i = 0; i < totalLines; i++) {
		const match = TOP_LEVEL_KEY_REGEX.exec(lines[i]);
		if (match) {
			keyStartLines.set(match[1], i + 1); // 1-based
		}
	}

	// Step 2: walk keys in JSON order, group adjacent same-def keys
	const keys = Object.keys(obj);
	const sections: Section[] = [];
	let currentDef: SectionDef | null | undefined;
	let currentEntries: [string, unknown][] = [];
	let currentStart = 1;

	for (const key of keys) {
		const def = findDefForKey(key);
		const defId = def?.id ?? null;
		const prevId =
			currentDef === undefined ? undefined : (currentDef?.id ?? null);

		if (defId !== prevId && currentEntries.length > 0) {
			// Flush previous section
			const nextKeyStart = keyStartLines.get(key) ?? totalLines;
			sections.push({
				def: currentDef === undefined ? null : currentDef,
				entries: currentEntries,
				startLine: currentStart,
				endLine: nextKeyStart - 1,
			});
			currentEntries = [];
			currentStart = nextKeyStart;
		}

		if (currentEntries.length === 0) {
			currentStart = keyStartLines.get(key) ?? currentStart;
		}
		currentDef = def;
		currentEntries.push([key, obj[key]]);
	}

	// Flush last section
	if (currentEntries.length > 0) {
		sections.push({
			def: currentDef === undefined ? null : currentDef,
			entries: currentEntries,
			startLine: currentStart,
			endLine: totalLines,
		});
	}

	return sections;
}

interface TreeNode {
	key: string;
	label: string;
	depth: number;
	type: "object" | "array" | "value";
	value?: unknown;
	childCount?: number;
}

function buildNodes(
	key: string,
	label: string,
	value: unknown,
	depth: number,
): TreeNode[] {
	const nodes: TreeNode[] = [];
	if (value !== null && typeof value === "object" && !Array.isArray(value)) {
		const entries = Object.entries(value as Record<string, unknown>);
		nodes.push({
			key,
			label,
			depth,
			type: "object",
			childCount: entries.length,
		});
		for (const [k, v] of entries) {
			nodes.push(...buildNodes(`${key}.${k}`, k, v, depth + 1));
		}
	} else if (Array.isArray(value)) {
		nodes.push({
			key,
			label,
			depth,
			type: "array",
			childCount: value.length,
		});
		for (let i = 0; i < value.length; i++) {
			nodes.push(
				...buildNodes(`${key}[${i}]`, `[${i}]`, value[i], depth + 1),
			);
		}
	} else {
		nodes.push({ key, label, depth, type: "value", value });
	}
	return nodes;
}

function isSecret(key: string): boolean {
	const lower = key.toLowerCase();
	return (
		lower.includes("key") ||
		lower.includes("token") ||
		lower.includes("secret")
	);
}

function maskString(str: string): string {
	const len = str.length;
	if (len <= 4) return "*".repeat(len);
	const visible = Math.min(Math.max(Math.floor(len / 6), 1), 6);
	return (
		str.slice(0, visible) +
		"*".repeat(len - visible * 2) +
		str.slice(-visible)
	);
}

function LineGutter({
	startLine,
	endLine,
}: {
	startLine: number;
	endLine: number;
}) {
	const isSingle = startLine === endLine;
	return (
		<div className="flex w-6 shrink-0 flex-col items-center py-1 font-mono text-[11px] leading-tight text-muted/50">
			<span>{startLine}</span>
			{!isSingle && (
				<>
					<div className="my-0.5 flex-1 border-l border-muted/20" />
					<span>{endLine}</span>
				</>
			)}
		</div>
	);
}

function SectionBlock({ section }: { section: Section }) {
	const { t } = useTranslation();
	const [, setLocation] = useLocation();
	const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
	const [showSecret, setShowSecret] = useState<Record<string, boolean>>({});

	const allNodes: TreeNode[] = [];
	for (const [k, v] of section.entries) {
		if (v !== null && typeof v === "object") {
			allNodes.push(...buildNodes(k, k, v, 0));
		} else {
			allNodes.push({
				key: k,
				label: k,
				depth: 0,
				type: "value",
				value: v,
			});
		}
	}

	const toggleCollapse = (key: string) => {
		setCollapsed((prev) => {
			const next = new Set(prev);
			if (next.has(key)) next.delete(key);
			else next.add(key);
			return next;
		});
	};

	const visible: TreeNode[] = [];
	const collapsedPrefixes: string[] = [];
	for (const node of allNodes) {
		const isHidden = collapsedPrefixes.some(
			(p) => node.key.startsWith(`${p}.`) || node.key.startsWith(`${p}[`),
		);
		if (isHidden) continue;
		visible.push(node);
		if (
			(node.type === "object" || node.type === "array") &&
			collapsed.has(node.key)
		) {
			collapsedPrefixes.push(node.key);
		}
	}

	const def = section.def;

	return (
		<div className="flex overflow-hidden rounded-lg border border-border bg-surface">
			<LineGutter
				startLine={section.startLine}
				endLine={section.endLine}
			/>
			<div className="min-w-0 flex-1 py-1">
				{visible.map((node) => {
					const isGroup =
						node.type === "object" || node.type === "array";
					const isCollapsed = collapsed.has(node.key);
					const secret =
						node.type === "value" && isSecret(node.label);
					const isShown = showSecret[node.key] ?? false;

					return (
						<div
							key={node.key}
							className={cn(
								"flex items-center gap-1 px-2 py-1 text-[13px] transition-colors",
								isGroup
									? "hover:bg-surface-secondary/60"
									: "hover:bg-surface-secondary/40",
							)}
							style={{
								paddingLeft: `${8 + node.depth * 16}px`,
							}}
						>
							{isGroup ? (
								<button
									type="button"
									onClick={() => toggleCollapse(node.key)}
									className="flex size-4 shrink-0 items-center justify-center text-muted"
								>
									<ChevronRightIcon
										className={cn(
											"size-3 transition-transform",
											!isCollapsed && "rotate-90",
										)}
									/>
								</button>
							) : (
								<span className="size-4 shrink-0" />
							)}

							<span
								className={cn(
									"shrink-0",
									isGroup
										? "font-medium text-foreground"
										: "text-muted",
								)}
							>
								{node.label}
							</span>

							{isGroup && (
								<span className="ml-1 text-xs text-muted/50">
									{node.type === "array"
										? `[${node.childCount}]`
										: `{${node.childCount}}`}
								</span>
							)}

							{node.type === "value" && (
								<>
									<span className="mx-1 text-muted/30">
										:
									</span>
									{typeof node.value === "boolean" ? (
										<span
											className={cn(
												"rounded-full px-2 py-0.5 font-mono text-xs font-medium",
												node.value
													? "bg-accent/15 text-accent"
													: "bg-surface-secondary text-muted",
											)}
										>
											{String(node.value)}
										</span>
									) : (
										<span
											className={cn(
												"min-w-0 flex-1 font-mono text-foreground/80",
												secret
													? "truncate"
													: "break-all",
											)}
											title={String(node.value)}
										>
											{secret &&
											!isShown &&
											typeof node.value === "string"
												? maskString(node.value)
												: typeof node.value === "string"
													? `"${node.value}"`
													: String(node.value)}
										</span>
									)}
									{secret && (
										<button
											type="button"
											onClick={() =>
												setShowSecret((prev) => ({
													...prev,
													[node.key]: !prev[node.key],
												}))
											}
											className="shrink-0 text-muted/50 hover:text-foreground"
										>
											{isShown ? (
												<EyeSlashIcon className="size-3.5" />
											) : (
												<EyeIcon className="size-3.5" />
											)}
										</button>
									)}
								</>
							)}
						</div>
					);
				})}
			</div>
			{def?.linkTo && def.linkLabelKey && (
				<div className="flex shrink-0 items-start px-1 pt-1">
					<Button
						variant="ghost"
						size="sm"
						onPress={() => setLocation(def.linkTo!)}
					>
						<ArrowTopRightOnSquareIcon className="size-3.5" />
						{t(def.linkLabelKey)}
					</Button>
				</div>
			)}
		</div>
	);
}

function tryParseJsonObject(
	content: string,
):
	| { ok: true; value: Record<string, unknown> }
	| { ok: false; reason: "invalid" | "non-object" } {
	try {
		const parsed: unknown = JSON.parse(content);
		if (
			parsed === null ||
			typeof parsed !== "object" ||
			Array.isArray(parsed)
		) {
			return { ok: false, reason: "non-object" };
		}
		return { ok: true, value: parsed as Record<string, unknown> };
	} catch {
		return { ok: false, reason: "invalid" };
	}
}

function FormattedView({ content }: { content: string }) {
	const result = tryParseJsonObject(content);
	if (!result.ok) {
		return result.reason === "invalid" ? (
			<div className="p-3 text-sm text-danger">Invalid JSON</div>
		) : (
			<div className="p-3 text-sm text-muted">Non-object JSON</div>
		);
	}

	const formatted = JSON.stringify(result.value, null, 2);
	const sections = buildSections(formatted, result.value);

	return (
		<div className="space-y-3">
			{sections.map((section, i) => (
				<SectionBlock
					key={`${section.def?.id ?? "general"}-${i}`}
					section={section}
				/>
			))}
		</div>
	);
}

interface JsonEditorProps {
	content: string;
	onDirtyChange?: (dirty: boolean) => void;
}

export function JsonEditor({ content, onDirtyChange }: JsonEditorProps) {
	const { t } = useTranslation();
	const [mode, setMode] = useState<"formatted" | "raw">("formatted");
	const [currentContent, setCurrentContent] = useState(content);

	const handleChange = (value: string) => {
		setCurrentContent(value);
		onDirtyChange?.(value !== content);
	};

	const handleSwitchToFormatted = () => {
		try {
			const parsed = JSON.parse(currentContent);
			setCurrentContent(JSON.stringify(parsed, null, 2));
		} catch {
			/* keep as-is if invalid */
		}
		setMode("formatted");
	};

	return (
		<div className="flex h-full flex-col">
			<div className="mb-2 flex gap-1">
				<Button
					size="sm"
					variant={mode === "formatted" ? "secondary" : "ghost"}
					onPress={handleSwitchToFormatted}
				>
					{t("agentWorkspaceSections")}
				</Button>
				<Button
					size="sm"
					variant={mode === "raw" ? "secondary" : "ghost"}
					onPress={() => setMode("raw")}
				>
					{t("agentWorkspaceRawEditor")}
				</Button>
			</div>
			{mode === "raw" ? (
				<RawEditor
					language="json"
					value={currentContent}
					onChange={handleChange}
					options={{ folding: true, formatOnPaste: true }}
				/>
			) : (
				<div className="min-h-0 flex-1 overflow-y-auto">
					<FormattedView content={currentContent} />
				</div>
			)}
		</div>
	);
}
