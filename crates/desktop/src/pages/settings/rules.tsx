import { DocumentTextIcon } from "@heroicons/react/24/solid";
import {
	Alert,
	Button,
	Chip,
	Label,
	ListBox,
	Spinner,
	TextArea,
	Tooltip,
	toast,
} from "@heroui/react";
import {
	useMutation,
	useQuery,
	useQueryClient,
	useSuspenseQuery,
} from "@tanstack/react-query";
import { useQueryState } from "nuqs";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ListSearchHeader } from "../../components/list-search-header";
import type { RuleFileResponse } from "../../generated/dto";
import { useAgentAvailability } from "../../hooks/use-agent-availability";
import { useApi } from "../../hooks/use-api";
import { AgentIcon } from "../../lib/agent-icons";
import { cn, filterItemsByAgentIds, sortAgents } from "../../lib/utils";
import {
	ruleContentQueryOptions,
	ruleListQueryOptions,
	updateRuleContentMutationOptions,
} from "../../requests/rules";

interface RuleGroup {
	path: string;
	fileName: string;
	exists: boolean;
	items: RuleFileResponse[];
}

function basename(path: string): string {
	const segments = path.split(/[/\\]/);
	return segments[segments.length - 1] || path;
}

function formatAgentName(agent: string): string {
	return agent.charAt(0).toUpperCase() + agent.slice(1).toLowerCase();
}

function RuleAgentIcons({ items }: { items: RuleFileResponse[] }) {
	const { allAgents, availableAgents } = useAgentAvailability();
	const enabledAgentIds = useMemo(
		() =>
			new Set(
				availableAgents
					.filter((agent) => !agent.isDisabled)
					.map((agent) => agent.id),
			),
		[availableAgents],
	);
	const agents = useMemo(() => {
		const set = new Set<string>();
		for (const item of filterItemsByAgentIds(items, enabledAgentIds)) {
			if (item.agent) set.add(item.agent);
		}
		return sortAgents(Array.from(set), allAgents);
	}, [items, enabledAgentIds, allAgents]);

	if (agents.length === 0) return null;

	return (
		<div className="flex shrink-0 items-center -space-x-1">
			{agents.slice(0, 3).map((agentId, idx) => (
				<Tooltip key={agentId} delay={0}>
					<Tooltip.Trigger>
						<div
							className="relative rounded-full bg-surface ring-1 ring-surface transition-transform hover:scale-110"
							style={{ zIndex: 3 - idx }}
						>
							<AgentIcon
								id={agentId}
								name={formatAgentName(agentId)}
								size="xs"
								variant="ghost"
							/>
						</div>
					</Tooltip.Trigger>
					<Tooltip.Content>
						{formatAgentName(agentId)}
					</Tooltip.Content>
				</Tooltip>
			))}
			{agents.length > 3 && (
				<div className="relative z-0 flex size-5 items-center justify-center rounded-full bg-default text-[10px] font-medium text-muted ring-1 ring-surface">
					+{agents.length - 3}
				</div>
			)}
		</div>
	);
}

export default function RulesPage() {
	const { t } = useTranslation();
	const api = useApi();
	const { data: rules } = useSuspenseQuery({
		...ruleListQueryOptions({ api, scope: "global" }),
	});
	const [searchQuery, setSearchQuery] = useState("");
	const [selectedPath, setSelectedPath] = useQueryState("rule");

	const groups = useMemo(() => {
		const map = new Map<string, RuleGroup>();
		for (const rule of rules) {
			const existing = map.get(rule.path);
			if (existing) {
				existing.items.push(rule);
				existing.exists = existing.exists || rule.exists;
			} else {
				map.set(rule.path, {
					path: rule.path,
					fileName: basename(rule.path),
					exists: rule.exists,
					items: [rule],
				});
			}
		}
		return Array.from(map.values());
	}, [rules]);

	const filteredGroups = useMemo(() => {
		if (!searchQuery) return groups;
		const q = searchQuery.toLowerCase();
		return groups.filter(
			(group) =>
				group.fileName.toLowerCase().includes(q) ||
				group.path.toLowerCase().includes(q),
		);
	}, [groups, searchQuery]);

	const activeGroup = useMemo(
		() => groups.find((group) => group.path === selectedPath) ?? null,
		[groups, selectedPath],
	);

	const selectedListKey = useMemo(
		() => (selectedPath ? new Set([selectedPath]) : new Set<string>()),
		[selectedPath],
	);

	return (
		<div className="flex h-full">
			<div className="relative flex w-80 shrink-0 flex-col border-r border-border">
				<ListSearchHeader
					searchValue={searchQuery}
					onSearchChange={setSearchQuery}
					placeholder={t("rules")}
					ariaLabel={t("rules")}
				/>

				<div className="flex-1 overflow-y-auto">
					{groups.length === 0 ? (
						<div className="flex h-full flex-col items-center justify-center gap-3 p-6">
							<DocumentTextIcon className="size-8 text-muted" />
							<p className="text-center text-sm font-medium text-foreground">
								{t("rulesEmptyTitle")}
							</p>
							<p className="text-center text-sm text-muted">
								{t("rulesEmptyDescription")}
							</p>
						</div>
					) : (
						<ListBox
							aria-label={t("rules")}
							selectionMode="single"
							selectionBehavior="replace"
							selectedKeys={selectedListKey}
							onSelectionChange={(keys) => {
								if (keys === "all") return;
								const key = [...keys][0] as string | undefined;
								if (!key) return;
								setSelectedPath(key);
							}}
							className="p-2"
						>
							{filteredGroups.map((group) => (
								<ListBox.Item
									key={group.path}
									id={group.path}
									textValue={group.fileName}
									className="data-selected:bg-surface"
								>
									<div className="flex w-full items-center gap-2">
										<DocumentTextIcon className="size-4 shrink-0 text-muted" />
										<div className="flex min-w-0 flex-1 flex-col">
											<Label className="truncate">
												{group.fileName}
											</Label>
											<span className="truncate text-xs text-muted">
												{group.path}
											</span>
										</div>
										<RuleAgentIcons items={group.items} />
										<Chip
											size="sm"
											color={
												group.exists
													? "success"
													: "default"
											}
										>
											{group.exists
												? t("rulesFileExists")
												: t("rulesFileMissing")}
										</Chip>
									</div>
								</ListBox.Item>
							))}
						</ListBox>
					)}
				</div>
			</div>

			<div className="relative flex-1 overflow-hidden">
				{activeGroup ? (
					<RuleContentPanel group={activeGroup} />
				) : (
					<div className="flex h-full flex-col items-center justify-center gap-4">
						<p className="text-center text-sm text-muted">
							{t("rulesSelectFile")}
						</p>
					</div>
				)}
			</div>
		</div>
	);
}

function RuleContentPanel({ group }: { group: RuleGroup }) {
	const api = useApi();
	const { data: content, isLoading } = useQuery(
		ruleContentQueryOptions({
			api,
			path: group.path,
			scope: "global",
			enabled: Boolean(group.path),
		}),
	);

	if (isLoading || !content) {
		return (
			<div className="flex h-full items-center justify-center">
				<Spinner />
			</div>
		);
	}

	return (
		<RuleEditor
			key={group.path}
			group={group}
			initialContent={content.content}
		/>
	);
}

function RuleEditor({
	group,
	initialContent,
}: {
	group: RuleGroup;
	initialContent: string;
}) {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();
	const [draft, setDraft] = useState(() => initialContent);

	const saveMutation = useMutation({
		...updateRuleContentMutationOptions({
			api,
			queryClient,
			onSuccess: () => {
				toast.success(t("rulesSaved"));
			},
		}),
		onError: (error) => {
			toast.danger(
				error instanceof Error ? error.message : t("rulesSaveFailed"),
			);
		},
	});

	const handleSave = () => {
		saveMutation.mutate({
			path: group.path,
			content: draft,
			scope: "global",
			project_root: null,
		});
	};

	return (
		<div className="flex h-full flex-col">
			<div className="flex items-start justify-between gap-4 border-b border-border p-4">
				<div className="min-w-0">
					<h2 className="truncate text-lg font-semibold text-foreground">
						{group.fileName}
					</h2>
					<p className="truncate text-sm text-muted">{group.path}</p>
				</div>
				<Button
					onPress={handleSave}
					isDisabled={saveMutation.isPending}
				>
					{saveMutation.isPending ? t("saving") : t("save")}
				</Button>
			</div>

			<div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
				{!group.exists && (
					<Alert status="accent">
						<Alert.Indicator />
						<Alert.Content>
							<Alert.Description>
								{t("rulesCreateOnSave")}
							</Alert.Description>
						</Alert.Content>
					</Alert>
				)}

				<TextArea
					value={draft}
					onChange={(event) => setDraft(event.target.value)}
					variant="secondary"
					aria-label={group.fileName}
					className={cn("flex-1 min-h-0 font-mono text-sm")}
				/>
			</div>
		</div>
	);
}
