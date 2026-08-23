import { Alert, Button, TextArea, toast } from "@heroui/react";
import {
	useMutation,
	useQueryClient,
	useSuspenseQuery,
} from "@tanstack/react-query";
import { isHTTPError } from "ky";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type {
	RuleFileContentResponse,
	RuleFileResponse,
} from "../../generated/dto";
import { useApi } from "../../hooks/use-api";
import {
	ruleContentQueryOptions,
	updateRuleContentMutationOptions,
} from "../../requests/rules";
import { RuleVersionDialog } from "./rule-version-dialog";

export interface RuleGroup {
	path: string;
	fileName: string;
	exists: boolean;
	items: RuleFileResponse[];
}

interface RuleContentPanelProps {
	group: RuleGroup;
	draft: string | undefined;
	onDraftChange: (path: string, value: string) => void;
	onDraftSaved: (path: string) => void;
}

export function RuleContentPanel({
	group,
	draft,
	onDraftChange,
	onDraftSaved,
}: RuleContentPanelProps) {
	const api = useApi();
	const { data: content, refetch } = useSuspenseQuery(
		ruleContentQueryOptions({
			api,
			path: group.path,
			scope: "global",
		}),
	);
	const refreshContent = async (): Promise<RuleFileContentResponse> => {
		const result = await refetch();
		if (result.error) throw result.error;
		if (!result.data) throw new Error("Rule file response was empty");
		return result.data;
	};

	return (
		<RuleEditor
			group={group}
			initialContent={content.content}
			revision={content.revision}
			draft={draft ?? content.content}
			refreshContent={refreshContent}
			onDraftChange={onDraftChange}
			onDraftSaved={onDraftSaved}
		/>
	);
}

function RuleEditor({
	group,
	initialContent,
	revision,
	draft,
	refreshContent,
	onDraftChange,
	onDraftSaved,
}: {
	group: RuleGroup;
	initialContent: string;
	revision: string;
	draft: string;
	refreshContent: () => Promise<RuleFileContentResponse>;
	onDraftChange: (path: string, value: string) => void;
	onDraftSaved: (path: string) => void;
}) {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();
	const [hasConflict, setHasConflict] = useState(false);
	const [conflictAction, setConflictAction] = useState<
		"reload" | "overwrite" | null
	>(null);
	const [historyOpen, setHistoryOpen] = useState(false);

	const saveMutation = useMutation({
		...updateRuleContentMutationOptions({
			api,
			queryClient,
			onSuccess: () => {
				setHasConflict(false);
				onDraftSaved(group.path);
				toast.success(t("rulesSaved"));
			},
		}),
		onError: (error) => {
			if (isRuleFileChanged(error)) {
				setHasConflict(true);
				return;
			}
			toast.danger(
				error instanceof Error ? error.message : t("rulesSaveFailed"),
			);
		},
	});

	const handleSave = () => {
		saveMutation.mutate({
			path: group.path,
			content: draft,
			expected_revision: revision,
			scope: "global",
			project_root: null,
		});
	};

	const handleReload = async () => {
		setConflictAction("reload");
		try {
			await refreshContent();
			onDraftSaved(group.path);
			setHasConflict(false);
		} catch (error) {
			toast.danger(
				error instanceof Error ? error.message : t("rulesSaveFailed"),
			);
		} finally {
			setConflictAction(null);
		}
	};

	const handleOverwrite = async () => {
		setConflictAction("overwrite");
		let latest: RuleFileContentResponse;
		try {
			latest = await refreshContent();
		} catch (error) {
			toast.danger(
				error instanceof Error ? error.message : t("rulesSaveFailed"),
			);
			setConflictAction(null);
			return;
		}

		await saveMutation
			.mutateAsync({
				path: group.path,
				content: draft,
				expected_revision: latest.revision,
				scope: "global",
				project_root: null,
			})
			.catch(() => undefined);
		setConflictAction(null);
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
				<div className="flex items-center">
					<Button
						onPress={handleSave}
						isDisabled={draft === initialContent || hasConflict}
						isPending={saveMutation.isPending}
					>
						{t("save")}
					</Button>
				</div>
			</div>

			<div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden p-4">
				<RuleVersionDialog
					path={group.path}
					isOpen={historyOpen}
					onOpenChange={setHistoryOpen}
					onRestore={(version) => {
						onDraftChange(group.path, version.content);
						setHistoryOpen(false);
					}}
				/>

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

				{hasConflict && (
					<Alert status="warning">
						<Alert.Indicator />
						<Alert.Content>
							<Alert.Description>
								{t("rulesChangedOnDisk")}
							</Alert.Description>
							<div className="mt-3 flex flex-wrap gap-2">
								<Button
									size="sm"
									variant="secondary"
									onPress={handleReload}
									isDisabled={conflictAction !== null}
									isPending={conflictAction === "reload"}
								>
									{t("rulesReloadFromDisk")}
								</Button>
								<Button
									size="sm"
									variant="secondary"
									onPress={handleOverwrite}
									isDisabled={conflictAction !== null}
									isPending={conflictAction === "overwrite"}
								>
									{t("rulesOverwriteDisk")}
								</Button>
							</div>
						</Alert.Content>
					</Alert>
				)}

				<TextArea
					fullWidth
					value={draft}
					onChange={(event) =>
						onDraftChange(group.path, event.target.value)
					}
					variant="secondary"
					aria-label={group.fileName}
					className="min-h-0 flex-1 resize-none overflow-auto font-mono text-sm"
				/>
			</div>
		</div>
	);
}

function isRuleFileChanged(error: unknown) {
	if (!isHTTPError(error) || !error.data || typeof error.data !== "object") {
		return false;
	}

	return (error.data as { code?: unknown }).code === "RULE_FILE_CHANGED";
}
