import { DocumentTextIcon, PlusIcon } from "@heroicons/react/24/solid";
import { Button, toast } from "@heroui/react";
import {
	useMutation,
	useQueryClient,
	useSuspenseQuery,
} from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useQueryState } from "nuqs";
import { useTranslation } from "react-i18next";
import { PromptDetail } from "../components/prompts/prompt-detail";
import { PromptForm } from "../components/prompts/prompt-form";
import { PromptList } from "../components/prompts/prompt-list";
import { ResourcePageToolbar } from "../components/resource-page-toolbar";
import type {
	CreatePromptRequest,
	PromptResponse,
	UpdatePromptRequest,
} from "../generated/dto";
import { useApi } from "../hooks/use-api";
import {
	createPromptMutationOptions,
	deletePromptMutationOptions,
	promptListQueryOptions,
	updatePromptMutationOptions,
} from "../requests/prompts";

type Mode = "view" | "create" | "edit";

function matchesQuery(prompt: PromptResponse, query: string): boolean {
	const haystack = [prompt.title, prompt.description ?? "", ...prompt.tags]
		.join(" ")
		.toLowerCase();
	return haystack.includes(query);
}

export default function PromptsPage() {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();
	const [searchQuery, setSearchQuery] = useState("");
	const [selectedId, setSelectedId] = useQueryState("prompt");
	const [mode, setMode] = useState<Mode>("view");

	const { data: prompts } = useSuspenseQuery(promptListQueryOptions({ api }));

	const sortedPrompts = useMemo(
		() => [...prompts].sort((a, b) => b.updated_at - a.updated_at),
		[prompts],
	);

	const filteredPrompts = useMemo(() => {
		const q = searchQuery.trim().toLowerCase();
		if (!q) return sortedPrompts;
		return sortedPrompts.filter((prompt) => matchesQuery(prompt, q));
	}, [sortedPrompts, searchQuery]);

	const selectedPrompt = useMemo(
		() => prompts.find((prompt) => prompt.id === selectedId) ?? null,
		[prompts, selectedId],
	);

	const createMutation = useMutation({
		...createPromptMutationOptions({
			api,
			queryClient,
			onSuccess: async (data) => {
				toast.success(t("promptCreated"));
				await setSelectedId(data.id);
				setMode("view");
			},
		}),
		onError: (error) => {
			toast.danger(
				error instanceof Error ? error.message : t("createPromptError"),
			);
		},
	});

	const updateMutation = useMutation({
		...updatePromptMutationOptions({
			api,
			queryClient,
			onSuccess: () => {
				toast.success(t("promptUpdated"));
				setMode("view");
			},
		}),
		onError: (error) => {
			toast.danger(
				error instanceof Error ? error.message : t("updatePromptError"),
			);
		},
	});

	const deleteMutation = useMutation({
		...deletePromptMutationOptions({
			api,
			queryClient,
			onSuccess: async () => {
				toast.success(t("promptDeleted"));
				await setSelectedId(null);
				setMode("view");
			},
		}),
		onError: (error) => {
			toast.danger(
				error instanceof Error ? error.message : t("deletePromptError"),
			);
		},
	});

	const handleSelect = async (id: string) => {
		setMode("view");
		await setSelectedId(id);
	};

	const handleCreate = async () => {
		setMode("create");
		await setSelectedId(null);
	};

	const handleCancelForm = () => {
		setMode("view");
	};

	return (
		<div className="flex h-full flex-col">
			<ResourcePageToolbar
				searchValue={searchQuery}
				onSearchChange={setSearchQuery}
				searchPlaceholder={t("searchPrompts")}
				searchAriaLabel={t("searchPrompts")}
			>
				<Button
					isIconOnly
					variant="ghost"
					size="sm"
					className="shrink-0"
					onPress={handleCreate}
					aria-label={t("createPrompt")}
				>
					<PlusIcon className="size-4" />
				</Button>
			</ResourcePageToolbar>
			<div className="flex min-h-0 flex-1">
				<div className="relative flex w-80 shrink-0 flex-col border-r border-border">
					<div className="flex-1 overflow-y-auto">
						<PromptList
							prompts={filteredPrompts}
							selectedId={selectedId}
							hasSearch={Boolean(searchQuery.trim())}
							onSelect={(id) => void handleSelect(id)}
						/>
					</div>
				</div>

				<div className="relative flex-1 overflow-hidden">
					{mode === "create" && (
						<PromptForm
							title={t("createPrompt")}
							submitLabel={t("create")}
							pendingLabel={t("creating")}
							isPending={createMutation.isPending}
							onCancel={handleCancelForm}
							onSubmit={(values) => {
								const body: CreatePromptRequest = {
									title: values.title,
									description: values.description,
									content: values.content,
									tags: values.tags,
								};
								createMutation.mutate(body);
							}}
						/>
					)}

					{mode === "edit" && selectedPrompt && (
						<PromptForm
							key={selectedPrompt.id}
							title={t("editPrompt")}
							submitLabel={t("save")}
							pendingLabel={t("saving")}
							initial={selectedPrompt}
							isPending={updateMutation.isPending}
							onCancel={handleCancelForm}
							onSubmit={(values) => {
								const body: UpdatePromptRequest = {
									title: values.title,
									description: values.description,
									content: values.content,
									tags: values.tags,
								};
								updateMutation.mutate({
									id: selectedPrompt.id,
									body,
								});
							}}
						/>
					)}

					{mode === "view" && selectedPrompt && (
						<PromptDetail
							prompt={selectedPrompt}
							onEdit={() => setMode("edit")}
							onDelete={() =>
								deleteMutation.mutate(selectedPrompt.id)
							}
							isDeleting={deleteMutation.isPending}
						/>
					)}

					{mode === "view" && !selectedPrompt && (
						<div className="flex h-full flex-col items-center justify-center gap-4">
							<DocumentTextIcon className="size-8 text-muted" />
							<p className="text-center text-sm text-muted">
								{t("selectPrompt")}
							</p>
							<Button onPress={handleCreate}>
								<PlusIcon className="mr-2 size-4" />
								{t("createPrompt")}
							</Button>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
