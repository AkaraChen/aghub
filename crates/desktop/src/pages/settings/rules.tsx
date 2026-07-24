import { DocumentTextIcon } from "@heroicons/react/24/solid";
import { Chip, Description, Label, ListBox, Spinner } from "@heroui/react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useQueryState } from "nuqs";
import { Suspense, useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AgentIcons } from "../../components/agent-icons";
import { ResourcePageToolbar } from "../../components/resource-page-toolbar";
import { useApi } from "../../hooks/use-api";
import { ruleListQueryOptions } from "../../requests/rules";
import { RuleContentPanel, type RuleGroup } from "./rule-content-panel";

function basename(path: string): string {
	const segments = path.split(/[/\\]/);
	return segments[segments.length - 1] || path;
}

export default function RulesPage() {
	const { t } = useTranslation();
	const api = useApi();
	const { data: rules } = useSuspenseQuery({
		...ruleListQueryOptions({ api, scope: "global" }),
	});
	const [searchQuery, setSearchQuery] = useState("");
	const [selectedPath, setSelectedPath] = useQueryState("rule");
	const [drafts, setDrafts] = useState<Record<string, string>>({});
	const updateDraft = useCallback((path: string, value: string) => {
		setDrafts((current) => ({ ...current, [path]: value }));
	}, []);
	const clearDraft = useCallback((path: string) => {
		setDrafts((current) => {
			if (!(path in current)) return current;
			const next = { ...current };
			delete next[path];
			return next;
		});
	}, []);

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
		<div className="flex h-full flex-col">
			<ResourcePageToolbar
				searchValue={searchQuery}
				onSearchChange={setSearchQuery}
				searchPlaceholder={t("searchRules")}
				searchAriaLabel={t("searchRules")}
			/>
			<div className="flex min-h-0 flex-1">
				{/* List panel */}
				<div className="relative flex w-80 shrink-0 flex-col border-r border-border">
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
						) : filteredGroups.length === 0 ? (
							<p className="p-6 text-center text-sm text-muted">
								{t("noResults")}
							</p>
						) : (
							<ListBox
								aria-label={t("rules")}
								selectionMode="single"
								selectionBehavior="replace"
								selectedKeys={selectedListKey}
								onSelectionChange={(keys) => {
									if (keys === "all") return;
									const key = [...keys][0] as
										string | undefined;
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
												<Description className="truncate text-xs text-muted">
													{group.path}
												</Description>
											</div>
											<AgentIcons items={group.items} />
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

				{/* Detail / editor panel */}
				<div className="relative flex-1 overflow-hidden">
					{activeGroup ? (
						<Suspense
							fallback={
								<div className="flex h-full items-center justify-center">
									<Spinner />
								</div>
							}
						>
							<RuleContentPanel
								key={activeGroup.path}
								group={activeGroup}
								draft={drafts[activeGroup.path]}
								onDraftChange={updateDraft}
								onDraftSaved={clearDraft}
							/>
						</Suspense>
					) : (
						<div className="flex h-full flex-col items-center justify-center gap-4">
							<p className="text-center text-sm text-muted">
								{t("rulesSelectFile")}
							</p>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
