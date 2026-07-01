import {
	DocumentDuplicateIcon,
	DocumentTextIcon,
	ExclamationTriangleIcon,
	PencilIcon,
	PlusIcon,
	TrashIcon,
} from "@heroicons/react/24/solid";
import {
	Button,
	Card,
	Chip,
	FieldError,
	Fieldset,
	Form,
	Input,
	Label,
	ListBox,
	Modal,
	Spinner,
	TextArea,
	TextField,
	Tooltip,
	toast,
} from "@heroui/react";
import {
	useMutation,
	useQueryClient,
	useSuspenseQuery,
} from "@tanstack/react-query";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useMemo, useState } from "react";
import { useQueryState } from "nuqs";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
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
	const haystack = [prompt.title, ...prompt.tags].join(" ").toLowerCase();
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
		if (!searchQuery) return sortedPrompts;
		const q = searchQuery.toLowerCase();
		return sortedPrompts.filter((prompt) => matchesQuery(prompt, q));
	}, [sortedPrompts, searchQuery]);

	const selectedPrompt = useMemo(
		() => prompts.find((prompt) => prompt.id === selectedId) ?? null,
		[prompts, selectedId],
	);

	const selectedListKey = useMemo(
		() =>
			selectedPrompt ? new Set([selectedPrompt.id]) : new Set<string>(),
		[selectedPrompt],
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
						{filteredPrompts.length === 0 ? (
							<div className="flex h-full flex-col items-center justify-center gap-3 p-6">
								<DocumentTextIcon className="size-8 text-muted" />
								<p className="text-center text-sm font-medium text-foreground">
									{t("noPrompts")}
								</p>
								<p className="text-center text-sm text-muted">
									{t("noPromptsDescription")}
								</p>
							</div>
						) : (
							<ListBox
								aria-label={t("prompts")}
								selectionMode="single"
								selectionBehavior="replace"
								selectedKeys={selectedListKey}
								onSelectionChange={(keys) => {
									if (keys === "all") return;
									const key = [...keys][0] as
										string | undefined;
									if (!key) return;
									void handleSelect(key);
								}}
								className="p-2"
							>
								{filteredPrompts.map((prompt) => (
									<ListBox.Item
										key={prompt.id}
										id={prompt.id}
										textValue={prompt.title}
										className="data-selected:bg-surface"
									>
										<div className="flex w-full flex-col gap-1 overflow-hidden">
											<Label className="truncate font-medium">
												{prompt.title}
											</Label>
											{prompt.description && (
												<p className="truncate text-xs text-muted">
													{prompt.description}
												</p>
											)}
											{prompt.tags.length > 0 && (
												<div className="flex flex-wrap gap-1">
													{prompt.tags
														.slice(0, 3)
														.map((tag) => (
															<Chip
																key={tag}
																size="sm"
																variant="soft"
																color="default"
															>
																{tag}
															</Chip>
														))}
												</div>
											)}
										</div>
									</ListBox.Item>
								))}
							</ListBox>
						)}
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

interface PromptDetailProps {
	prompt: PromptResponse;
	onEdit: () => void;
	onDelete: () => void;
	isDeleting: boolean;
}

function PromptDetail({
	prompt,
	onEdit,
	onDelete,
	isDeleting,
}: PromptDetailProps) {
	const { t } = useTranslation();
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

	const handleCopy = async () => {
		await writeText(prompt.content);
		toast.success(t("promptContentCopied"));
	};

	return (
		<>
			<div className="h-full overflow-y-auto">
				<div className="w-full space-y-4 p-4 sm:p-6">
					<Card>
						<Card.Header className="flex flex-row items-start justify-between gap-3">
							<div className="min-w-0 flex-1">
								<h2 className="truncate text-xl font-semibold text-foreground">
									{prompt.title}
								</h2>
								{prompt.description && (
									<p className="mt-1 text-sm text-muted">
										{prompt.description}
									</p>
								)}
							</div>
							<div className="flex items-center gap-2">
								<Tooltip delay={0}>
									<Button
										isIconOnly
										variant="ghost"
										size="md"
										className="text-muted"
										aria-label={t("copy")}
										onPress={() => void handleCopy()}
									>
										<DocumentDuplicateIcon className="size-4" />
									</Button>
									<Tooltip.Content>
										{t("copy")}
									</Tooltip.Content>
								</Tooltip>
								<Tooltip delay={0}>
									<Button
										isIconOnly
										variant="ghost"
										size="md"
										className="text-muted"
										aria-label={t("editPrompt")}
										onPress={onEdit}
									>
										<PencilIcon className="size-4" />
									</Button>
									<Tooltip.Content>
										{t("editPrompt")}
									</Tooltip.Content>
								</Tooltip>
								<Tooltip delay={0}>
									<Button
										isIconOnly
										variant="ghost"
										size="md"
										className="text-muted hover:text-danger"
										aria-label={t("deletePrompt")}
										onPress={() =>
											setDeleteDialogOpen(true)
										}
									>
										<TrashIcon className="size-4" />
									</Button>
									<Tooltip.Content>
										{t("deletePrompt")}
									</Tooltip.Content>
								</Tooltip>
							</div>
						</Card.Header>

						<Card.Content className="flex flex-col gap-6">
							{prompt.tags.length > 0 && (
								<div className="space-y-3">
									<h3 className="text-xs font-medium uppercase tracking-wider text-muted">
										{t("promptTags")}
									</h3>
									<div className="flex flex-wrap gap-2">
										{prompt.tags.map((tag) => (
											<Chip
												key={tag}
												size="sm"
												variant="soft"
												color="default"
											>
												{tag}
											</Chip>
										))}
									</div>
								</div>
							)}

							<div className="space-y-3">
								<h3 className="text-xs font-medium uppercase tracking-wider text-muted">
									{t("promptContent")}
								</h3>
								<pre className="overflow-x-auto rounded-md bg-surface-secondary p-3 font-mono text-xs whitespace-pre-wrap text-foreground">
									{prompt.content}
								</pre>
							</div>

							{prompt.variables.length > 0 && (
								<div className="space-y-3">
									<h3 className="text-xs font-medium uppercase tracking-wider text-muted">
										{t("promptVariables")}
									</h3>
									<div className="flex flex-wrap gap-2">
										{prompt.variables.map((variable) => (
											<Chip
												key={variable}
												size="sm"
												variant="soft"
												color="accent"
											>
												{variable}
											</Chip>
										))}
									</div>
									<p className="text-xs text-muted">
										{t("promptVariablesHint")}
									</p>
								</div>
							)}
						</Card.Content>

						<Card.Footer className="pt-4 border-t border-separator flex flex-wrap gap-3">
							<Button
								variant="secondary"
								onPress={() => void handleCopy()}
							>
								<DocumentDuplicateIcon className="size-4" />
								{t("copy")}
							</Button>
							<Button variant="secondary" onPress={onEdit}>
								<PencilIcon className="size-4" />
								{t("edit")}
							</Button>
						</Card.Footer>
					</Card>
				</div>
			</div>

			<Modal.Backdrop
				isOpen={deleteDialogOpen}
				onOpenChange={setDeleteDialogOpen}
			>
				<Modal.Container>
					<Modal.Dialog>
						<Modal.CloseTrigger />
						<Modal.Header>
							<div className="flex items-center gap-2">
								<ExclamationTriangleIcon className="size-5 text-warning" />
								<Modal.Heading>
									{t("deletePrompt")}
								</Modal.Heading>
							</div>
						</Modal.Header>
						<Modal.Body>
							<p className="text-sm text-muted">
								{t("deletePromptConfirm", {
									title: prompt.title,
								})}
							</p>
						</Modal.Body>
						<Modal.Footer>
							<Button
								slot="close"
								variant="secondary"
								size="md"
								isDisabled={isDeleting}
								onPress={() => setDeleteDialogOpen(false)}
							>
								{t("cancel")}
							</Button>
							<Button
								variant="danger"
								size="md"
								isDisabled={isDeleting}
								className="min-w-[120px]"
								onPress={() => {
									onDelete();
									setDeleteDialogOpen(false);
								}}
							>
								{isDeleting ? (
									<Spinner size="sm" />
								) : (
									t("deletePrompt")
								)}
							</Button>
						</Modal.Footer>
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</>
	);
}

interface PromptFormValues {
	title: string;
	description: string;
	content: string;
	tags: string[];
}

interface PromptFormFields {
	title: string;
	description: string;
	content: string;
	tags: string;
}

interface PromptFormProps {
	title: string;
	submitLabel: string;
	pendingLabel: string;
	isPending: boolean;
	initial?: PromptResponse;
	onSubmit: (values: PromptFormValues) => void;
	onCancel: () => void;
}

function parseTags(value: string): string[] {
	return value
		.split(",")
		.map((tag) => tag.trim())
		.filter((tag) => tag.length > 0);
}

function PromptForm({
	title,
	submitLabel,
	pendingLabel,
	isPending,
	initial,
	onSubmit,
	onCancel,
}: PromptFormProps) {
	const { t } = useTranslation();

	const {
		control,
		handleSubmit,
		formState: { isSubmitting },
	} = useForm<PromptFormFields>({
		mode: "onSubmit",
		reValidateMode: "onChange",
		defaultValues: {
			title: initial?.title ?? "",
			description: initial?.description ?? "",
			content: initial?.content ?? "",
			tags: initial ? initial.tags.join(", ") : "",
		},
	});

	const submit = (values: PromptFormFields) => {
		onSubmit({
			title: values.title.trim(),
			description: values.description.trim(),
			content: values.content,
			tags: parseTags(values.tags),
		});
	};

	return (
		<div className="h-full w-full overflow-y-auto p-4 sm:p-6">
			<Card>
				<Card.Header>
					<h2 className="text-xl font-semibold text-foreground">
						{title}
					</h2>
				</Card.Header>
				<Card.Content>
					<Form
						validationBehavior="aria"
						onSubmit={handleSubmit(submit)}
					>
						<Fieldset>
							<Fieldset.Group>
								<Controller
									name="title"
									control={control}
									rules={{
										required: t(
											"validationPromptTitleRequired",
										),
										validate: (v) =>
											v.trim()
												? true
												: t(
														"validationPromptTitleRequired",
													),
									}}
									render={({ field, fieldState }) => (
										<TextField
											className="w-full"
											variant="secondary"
											isRequired
											validationBehavior="aria"
											isInvalid={Boolean(
												fieldState.error,
											)}
										>
											<Label>{t("promptTitle")}</Label>
											<Input
												value={field.value}
												onChange={(e) =>
													field.onChange(
														e.target.value,
													)
												}
												onBlur={field.onBlur}
												placeholder={t(
													"promptTitlePlaceholder",
												)}
												variant="secondary"
											/>
											{fieldState.error && (
												<FieldError>
													{fieldState.error.message}
												</FieldError>
											)}
										</TextField>
									)}
								/>
								<Controller
									name="description"
									control={control}
									render={({ field }) => (
										<TextField
											className="w-full"
											variant="secondary"
											validationBehavior="aria"
										>
											<Label>
												{t("promptDescription")}
											</Label>
											<Input
												value={field.value}
												onChange={(e) =>
													field.onChange(
														e.target.value,
													)
												}
												onBlur={field.onBlur}
												placeholder={t(
													"promptDescriptionPlaceholder",
												)}
												variant="secondary"
											/>
										</TextField>
									)}
								/>
							</Fieldset.Group>
						</Fieldset>

						<Fieldset>
							<Fieldset.Group>
								<Controller
									name="content"
									control={control}
									render={({ field }) => (
										<TextField
											className="w-full"
											variant="secondary"
											validationBehavior="aria"
										>
											<Label>{t("promptContent")}</Label>
											<TextArea
												value={field.value}
												onChange={(e) =>
													field.onChange(
														e.target.value,
													)
												}
												onBlur={field.onBlur}
												placeholder={t(
													"promptContentPlaceholder",
												)}
												variant="secondary"
												className="min-h-48"
											/>
										</TextField>
									)}
								/>
							</Fieldset.Group>
						</Fieldset>

						<Fieldset>
							<Fieldset.Group>
								<Controller
									name="tags"
									control={control}
									render={({ field }) => (
										<TextField
											className="w-full"
											variant="secondary"
											validationBehavior="aria"
										>
											<Label>{t("promptTags")}</Label>
											<Input
												value={field.value}
												onChange={(e) =>
													field.onChange(
														e.target.value,
													)
												}
												onBlur={field.onBlur}
												placeholder={t(
													"promptTagsPlaceholder",
												)}
												variant="secondary"
											/>
										</TextField>
									)}
								/>
							</Fieldset.Group>
						</Fieldset>

						<div className="flex justify-end gap-2 pt-2">
							<Button
								type="button"
								variant="secondary"
								onPress={onCancel}
							>
								{t("cancel")}
							</Button>
							<Button
								type="submit"
								isDisabled={isPending || isSubmitting}
							>
								{isPending ? pendingLabel : submitLabel}
							</Button>
						</div>
					</Form>
				</Card.Content>
			</Card>
		</div>
	);
}
