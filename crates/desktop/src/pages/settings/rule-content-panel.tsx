import { Alert, Button, TextArea, toast } from "@heroui/react";
import {
	useMutation,
	useQueryClient,
	useSuspenseQuery,
} from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { RuleFileResponse } from "../../generated/dto";
import { useApi } from "../../hooks/use-api";
import {
	ruleContentQueryOptions,
	updateRuleContentMutationOptions,
} from "../../requests/rules";

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
	const { data: content } = useSuspenseQuery(
		ruleContentQueryOptions({
			api,
			path: group.path,
			scope: "global",
		}),
	);

	return (
		<RuleEditor
			group={group}
			initialContent={content.content}
			draft={draft ?? content.content}
			onDraftChange={onDraftChange}
			onDraftSaved={onDraftSaved}
		/>
	);
}

function RuleEditor({
	group,
	initialContent,
	draft,
	onDraftChange,
	onDraftSaved,
}: {
	group: RuleGroup;
	initialContent: string;
	draft: string;
	onDraftChange: (path: string, value: string) => void;
	onDraftSaved: (path: string) => void;
}) {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();

	const saveMutation = useMutation({
		...updateRuleContentMutationOptions({
			api,
			queryClient,
			onSuccess: () => {
				onDraftSaved(group.path);
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
					isDisabled={draft === initialContent}
					isPending={saveMutation.isPending}
				>
					{t("save")}
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
					onChange={(event) =>
						onDraftChange(group.path, event.target.value)
					}
					variant="secondary"
					aria-label={group.fileName}
					className="min-h-0 flex-1 font-mono text-sm"
				/>
			</div>
		</div>
	);
}
