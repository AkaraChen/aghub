import {
	ArrowPathIcon,
	ClipboardDocumentIcon,
	CpuChipIcon,
	EyeIcon,
	EyeSlashIcon,
	PencilIcon,
	PlusIcon,
	ServerIcon,
	TrashIcon,
} from "@heroicons/react/24/solid";
import AnthropicIcon from "@lobehub/icons/es/Anthropic";
import OpenAIIcon from "@lobehub/icons/es/OpenAI";
import {
	Alert,
	AlertDialog,
	Button,
	Card,
	FieldError,
	Fieldset,
	Form,
	Input,
	Label,
	ListBox,
	Select,
	Spinner,
	TextField,
	Tooltip,
	toast,
} from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Fuse from "fuse.js";
import { useMemo, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { ListSearchHeader } from "../components/list-search-header";
import { ResourceSectionHeader } from "../components/resource-section-header";
import type {
	InferenceProviderFormatDto,
	InferenceProviderResponse,
} from "../generated/dto";
import { useApi } from "../hooks/use-api";
import { AgentIcon } from "../lib/agent-icons";
import { cn } from "../lib/utils";
import { ClaudeInferenceProviderPanel } from "./inference-providers/claude-panel";
import { CodexInferenceProviderPanel } from "./inference-providers/codex-panel";
import { OpenCodeInferenceProviderPanel } from "./inference-providers/opencode-panel";
import {
	createInferenceProviderMutationOptions,
	deleteInferenceProviderMutationOptions,
	inferenceProviderListQueryOptions,
	updateInferenceProviderMutationOptions,
} from "../requests/inference-providers";

type CodingAgentId = "opencode" | "codex" | "claude";

type PanelMode =
	| { type: "detail" }
	| { type: "create" }
	| { type: "edit"; provider: InferenceProviderResponse }
	| { type: "agent"; agentId: CodingAgentId };

interface CodingAgentOption {
	id: CodingAgentId;
	label: string;
}

interface FormatOption {
	id: InferenceProviderFormatDto;
	labelKey: string;
	descriptionKey: string;
}

const FORMAT_OPTIONS: FormatOption[] = [
	{
		id: "anthropic",
		labelKey: "inferenceFormatAnthropic",
		descriptionKey: "inferenceFormatAnthropicDescription",
	},
	{
		id: "openai_completions",
		labelKey: "inferenceFormatOpenAiCompletions",
		descriptionKey: "inferenceFormatOpenAiCompletionsDescription",
	},
	{
		id: "openai_responses",
		labelKey: "inferenceFormatOpenAiResponses",
		descriptionKey: "inferenceFormatOpenAiResponsesDescription",
	},
];

const CODING_AGENT_OPTIONS: CodingAgentOption[] = [
	{
		id: "opencode",
		label: "OpenCode",
	},
	{
		id: "codex",
		label: "Codex",
	},
	{
		id: "claude",
		label: "Claude Code",
	},
];

interface InferenceProviderFormValues {
	displayName: string;
	format: InferenceProviderFormatDto;
	apiBaseUrl: string;
	apiKey: string;
	models: ProviderModelFormValue[];
}

interface ProviderModelFormValue {
	id: string;
	name: string;
}

let nextProviderModelId = 0;

function createProviderModelFormValue(name = ""): ProviderModelFormValue {
	const id = `provider-model-${nextProviderModelId++}`;
	return { id, name };
}

function toProviderModelFormValues(models: string[]) {
	return models.map((model) => createProviderModelFormValue(model));
}

function ProviderIcon({ format }: { format: InferenceProviderFormatDto }) {
	const Icon = format === "anthropic" ? AnthropicIcon : OpenAIIcon;

	return (
		<div className="relative inline-flex size-4 shrink-0 items-center justify-center">
			<Icon aria-hidden="true" size={16} />
		</div>
	);
}

function MonoValue({
	children,
	className,
}: {
	children: string;
	className?: string;
}) {
	return (
		<span
			className={cn(
				"block min-w-0 overflow-x-auto rounded-md bg-surface-secondary px-3 py-2 font-mono text-xs leading-5 text-foreground",
				className,
			)}
			title={children}
		>
			{children}
		</span>
	);
}

function normalizeModelNames(models: ProviderModelFormValue[]) {
	return models.map((model) => model.name.trim()).filter(Boolean);
}

function validateModelNames(models: ProviderModelFormValue[], message: string) {
	const seen = new Set<string>();

	for (const model of models) {
		const name = model.name.trim();
		if (!name) continue;

		const key = name.toLowerCase();
		if (seen.has(key)) return message;
		seen.add(key);
	}

	return true;
}

function ProviderModelsEditor({
	value,
	onChange,
	onBlur,
	errorMessage,
}: {
	value: ProviderModelFormValue[];
	onChange: (value: ProviderModelFormValue[]) => void;
	onBlur: () => void;
	errorMessage?: string;
}) {
	const { t } = useTranslation();
	const emptyModel = useMemo(() => createProviderModelFormValue(), []);
	const displayModels = value.length > 0 ? value : [emptyModel];

	const handleAdd = () => {
		onChange([...value, createProviderModelFormValue()]);
	};

	const handleRemove = (id: string) => {
		onChange(value.filter((model) => model.id !== id));
	};

	const handleChange = (id: string, modelName: string) => {
		const nextModels =
			value.length > 0
				? value.map((model) =>
						model.id === id ? { ...model, name: modelName } : model,
					)
				: [{ ...emptyModel, name: modelName }];
		onChange(nextModels);
	};

	return (
		<div className="grid gap-2">
			<div className="flex items-start justify-between gap-3">
				<div className="grid gap-0.5">
					<Label>{t("providerModels")}</Label>
					<p className="text-xs text-muted">
						{t("providerModelsDescription")}
					</p>
				</div>
				<Button
					type="button"
					variant="secondary"
					size="sm"
					onPress={handleAdd}
				>
					<PlusIcon className="size-4" />
					{t("addProviderModel")}
				</Button>
			</div>

			<div className="grid gap-2">
				{displayModels.map((model) => (
					<div key={model.id} className="flex items-start gap-2">
						<Input
							value={model.name}
							onChange={(event) =>
								handleChange(model.id, event.target.value)
							}
							onBlur={onBlur}
							placeholder={t("providerModelNamePlaceholder")}
							aria-label={t("providerModelName")}
							variant="secondary"
							className="min-w-0 flex-1"
						/>
						<Button
							type="button"
							isIconOnly
							variant="ghost"
							size="sm"
							className="mt-1 shrink-0 text-muted"
							aria-label={t("remove")}
							isDisabled={value.length === 0}
							onPress={() => handleRemove(model.id)}
						>
							<TrashIcon className="size-4" />
						</Button>
					</div>
				))}
			</div>

			{errorMessage && (
				<p className="text-sm text-danger">{errorMessage}</p>
			)}
		</div>
	);
}

function ProviderForm({
	mode,
	provider,
	onCancel,
	onSuccess,
}: {
	mode: "create" | "edit";
	provider?: InferenceProviderResponse;
	onCancel: () => void;
	onSuccess: (provider: InferenceProviderResponse) => void;
}) {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();
	const {
		control,
		handleSubmit,
		formState: { isSubmitting },
	} = useForm<InferenceProviderFormValues>({
		mode: "onSubmit",
		reValidateMode: "onChange",
		defaultValues: {
			displayName: provider?.display_name ?? "",
			format: provider?.format ?? "openai_responses",
			apiBaseUrl: provider?.api_base_url ?? "",
			apiKey: "",
			models: toProviderModelFormValues(provider?.models ?? []),
		},
	});

	const createMutation = useMutation({
		...createInferenceProviderMutationOptions({
			api,
			queryClient,
		}),
	});
	const updateMutation = useMutation({
		...updateInferenceProviderMutationOptions({
			api,
			queryClient,
		}),
	});

	const activeError =
		mode === "create" ? createMutation.error : updateMutation.error;
	const isPending =
		createMutation.isPending || updateMutation.isPending || isSubmitting;

	const onSubmit = async (values: InferenceProviderFormValues) => {
		const displayName = values.displayName.trim();
		const apiBaseUrl = values.apiBaseUrl.trim();
		const apiKey = values.apiKey.trim();
		const models = normalizeModelNames(values.models);

		try {
			if (mode === "create") {
				const created = await createMutation.mutateAsync({
					name: displayName,
					display_name: displayName,
					format: values.format,
					api_base_url: apiBaseUrl,
					api_key: apiKey,
					models,
				});
				toast.success(t("inferenceProviderCreated"));
				onSuccess(created);
				return;
			}

			if (!provider) return;
			const updated = await updateMutation.mutateAsync({
				name: provider.name,
				body: {
					name: null,
					display_name: displayName,
					format: values.format,
					api_base_url: apiBaseUrl,
					api_key: apiKey || null,
					models,
				},
			});
			toast.success(t("inferenceProviderUpdated"));
			onSuccess(updated);
		} catch (error) {
			console.error("Failed to save inference provider:", error);
		}
	};

	return (
		<div className="h-full overflow-y-auto p-4 sm:p-6">
			{activeError && (
				<Alert className="mb-4" status="danger">
					<Alert.Indicator />
					<Alert.Content>
						<Alert.Description>
							{activeError instanceof Error
								? activeError.message
								: String(activeError)}
						</Alert.Description>
					</Alert.Content>
				</Alert>
			)}

			<Card>
				<Card.Header>
					<div>
						<Card.Title>
							{mode === "create"
								? t("createInferenceProvider")
								: t("editInferenceProvider")}
						</Card.Title>
					</div>
				</Card.Header>
				<Card.Content>
					<Form
						validationBehavior="aria"
						onSubmit={handleSubmit(onSubmit)}
					>
						<Fieldset>
							<Fieldset.Group>
								<Controller
									name="displayName"
									control={control}
									rules={{
										required: t(
											"validationProviderNameRequired",
										),
										validate: (value) =>
											value.trim()
												? true
												: t(
														"validationProviderNameRequired",
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
											<Label>{t("providerName")}</Label>
											<Input
												value={field.value}
												onChange={(event) =>
													field.onChange(
														event.target.value,
													)
												}
												onBlur={field.onBlur}
												placeholder={t(
													"providerNamePlaceholder",
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
									name="apiBaseUrl"
									control={control}
									rules={{
										required: t(
											"validationProviderApiBaseUrlRequired",
										),
										validate: (value) =>
											value.trim()
												? true
												: t(
														"validationProviderApiBaseUrlRequired",
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
											<Label>
												{t("providerApiBaseUrl")}
											</Label>
											<Input
												value={field.value}
												onChange={(event) =>
													field.onChange(
														event.target.value,
													)
												}
												onBlur={field.onBlur}
												placeholder={t(
													"providerApiBaseUrlPlaceholder",
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
									name="format"
									control={control}
									render={({ field }) => (
										<Select
											className="w-full"
											selectedKey={field.value}
											onSelectionChange={(key) => {
												if (!key) return;
												field.onChange(
													key as InferenceProviderFormatDto,
												);
											}}
											variant="secondary"
										>
											<Label>{t("providerFormat")}</Label>
											<Select.Trigger>
												<Select.Value />
												<Select.Indicator />
											</Select.Trigger>
											<Select.Popover>
												<ListBox>
													{FORMAT_OPTIONS.map(
														(option) => (
															<ListBox.Item
																key={option.id}
																id={option.id}
																textValue={t(
																	option.labelKey,
																)}
															>
																<div className="grid gap-0.5">
																	<Label>
																		{t(
																			option.labelKey,
																		)}
																	</Label>
																	<span className="text-xs text-muted">
																		{t(
																			option.descriptionKey,
																		)}
																	</span>
																</div>
															</ListBox.Item>
														),
													)}
												</ListBox>
											</Select.Popover>
										</Select>
									)}
								/>

								<Controller
									name="apiKey"
									control={control}
									rules={{
										validate: (value) => {
											if (mode === "edit") return true;
											return value.trim()
												? true
												: t(
														"validationProviderApiKeyRequired",
													);
										},
									}}
									render={({ field, fieldState }) => (
										<TextField
											className="w-full"
											variant="secondary"
											isRequired={mode === "create"}
											validationBehavior="aria"
											isInvalid={Boolean(
												fieldState.error,
											)}
										>
											<Label>{t("providerApiKey")}</Label>
											<Input
												type="password"
												value={field.value}
												onChange={(event) =>
													field.onChange(
														event.target.value,
													)
												}
												onBlur={field.onBlur}
												placeholder={
													mode === "create"
														? t(
																"providerApiKeyPlaceholder",
															)
														: t(
																"providerApiKeyEditPlaceholder",
															)
												}
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
									name="models"
									control={control}
									rules={{
										validate: (value) =>
											validateModelNames(
												value,
												t(
													"validationProviderModelNameUnique",
												),
											),
									}}
									render={({ field, fieldState }) => (
										<ProviderModelsEditor
											value={field.value}
											onChange={field.onChange}
											onBlur={field.onBlur}
											errorMessage={
												fieldState.error?.message
											}
										/>
									)}
								/>
							</Fieldset.Group>
						</Fieldset>

						<div className="mt-4 flex justify-end gap-2">
							<Button
								type="button"
								variant="tertiary"
								onPress={onCancel}
								isDisabled={isPending}
							>
								{t("cancel")}
							</Button>
							<Button type="submit" isPending={isPending}>
								{mode === "create" ? t("create") : t("save")}
							</Button>
						</div>
					</Form>
				</Card.Content>
			</Card>
		</div>
	);
}

function ProviderDetail({
	provider,
	onEdit,
	onDeleted,
}: {
	provider: InferenceProviderResponse;
	onEdit: () => void;
	onDeleted: () => void;
}) {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();
	const [isDeleteOpen, setIsDeleteOpen] = useState(false);
	const [revealedKey, setRevealedKey] = useState<string | null>(null);
	const [isCopying, setIsCopying] = useState(false);
	const previewKey = provider.masked_api_key || "••••••••••••••••••••••••";

	const passwordMutation = useMutation({
		mutationFn: (name: string) => api.inferenceProviders.getPassword(name),
		onSuccess: (data) => {
			setRevealedKey(data.api_key);
		},
		onError: (error) => {
			console.error("Failed to load inference provider key:", error);
			toast.danger(
				error instanceof Error
					? error.message
					: t("inferenceProviderPasswordLoadFailed"),
			);
		},
	});

	const deleteMutation = useMutation({
		...deleteInferenceProviderMutationOptions({
			api,
			queryClient,
			onSuccess: async () => {
				setIsDeleteOpen(false);
				toast.success(t("inferenceProviderDeleted"));
				onDeleted();
			},
		}),
		onError: (error) => {
			console.error("Failed to delete inference provider:", error);
			toast.danger(
				error instanceof Error
					? error.message
					: t("deleteInferenceProviderError"),
			);
		},
	});

	const handleReveal = () => {
		if (revealedKey) {
			setRevealedKey(null);
			return;
		}
		passwordMutation.mutate(provider.name);
	};

	const handleCopyKey = async () => {
		setIsCopying(true);
		try {
			const password = revealedKey
				? { api_key: revealedKey }
				: await api.inferenceProviders.getPassword(provider.name);
			await navigator.clipboard.writeText(password.api_key);
			toast.success(t("providerApiKeyCopied"));
		} catch (error) {
			console.error("Failed to copy inference provider key:", error);
			toast.danger(
				error instanceof Error
					? error.message
					: t("providerApiKeyCopyFailed"),
			);
		} finally {
			setIsCopying(false);
		}
	};

	const handleCopyModel = async (modelName: string) => {
		try {
			await navigator.clipboard.writeText(modelName);
			toast.success(t("providerModelNameCopied"));
		} catch (error) {
			console.error("Failed to copy inference model name:", error);
			toast.danger(
				error instanceof Error
					? error.message
					: t("providerModelNameCopyFailed"),
			);
		}
	};

	return (
		<>
			<div className="h-full overflow-y-auto">
				<div className="w-full p-4 sm:p-6">
					<Card>
						<Card.Header className="flex flex-row items-start justify-between gap-3">
							<div className="flex min-w-0 items-center gap-3">
								<ProviderIcon format={provider.format} />
								<div className="min-w-0">
									<h2 className="truncate text-xl font-semibold text-foreground">
										{provider.display_name}
									</h2>
								</div>
							</div>
							<div className="flex shrink-0 items-center gap-2">
								<Tooltip delay={0}>
									<Tooltip.Trigger>
										<Button
											isIconOnly
											variant="ghost"
											size="md"
											className="min-h-[44px] min-w-[44px] text-muted"
											aria-label={t(
												"editInferenceProvider",
											)}
											onPress={onEdit}
										>
											<PencilIcon className="size-4" />
										</Button>
									</Tooltip.Trigger>
									<Tooltip.Content>
										{t("edit")}
									</Tooltip.Content>
								</Tooltip>
								<Tooltip delay={0}>
									<Tooltip.Trigger>
										<Button
											isIconOnly
											variant="ghost"
											size="md"
											className="min-h-[44px] min-w-[44px] text-muted hover:text-danger"
											aria-label={t(
												"deleteInferenceProvider",
											)}
											onPress={() =>
												setIsDeleteOpen(true)
											}
										>
											<TrashIcon className="size-4" />
										</Button>
									</Tooltip.Trigger>
									<Tooltip.Content>
										{t("delete")}
									</Tooltip.Content>
								</Tooltip>
							</div>
						</Card.Header>

						<Card.Content className="flex flex-col gap-4">
							<div className="grid gap-1.5 py-1">
								<h3 className="text-xs font-medium tracking-wider text-muted uppercase">
									{t("providerApiBaseUrl")}
								</h3>
								<MonoValue>{provider.api_base_url}</MonoValue>
							</div>

							<div className="grid gap-1.5 py-1">
								<h3 className="text-xs font-medium tracking-wider text-muted uppercase">
									{t("providerApiKey")}
								</h3>
								<div className="flex min-w-0 items-center gap-2">
									<MonoValue className="flex-1">
										{revealedKey ?? previewKey}
									</MonoValue>
									<Button
										isIconOnly
										variant="tertiary"
										size="sm"
										aria-label={
											revealedKey
												? t("hideProviderApiKey")
												: t("revealProviderApiKey")
										}
										isPending={passwordMutation.isPending}
										onPress={handleReveal}
									>
										{revealedKey ? (
											<EyeSlashIcon className="size-4" />
										) : (
											<EyeIcon className="size-4" />
										)}
									</Button>
									<Button
										isIconOnly
										variant="tertiary"
										size="sm"
										aria-label={t("copyProviderApiKey")}
										isPending={isCopying}
										onPress={handleCopyKey}
									>
										<ClipboardDocumentIcon className="size-4" />
									</Button>
								</div>
							</div>

							<div className="grid gap-1.5 py-1">
								<h3 className="text-xs font-medium tracking-wider text-muted uppercase">
									{t("providerModels")}
								</h3>
								{provider.models.length === 0 ? (
									<p className="text-sm text-muted">
										{t("noProviderModels")}
									</p>
								) : (
									<div className="flex flex-wrap gap-2">
										{provider.models.map((model) => (
											<button
												key={model}
												type="button"
												className="max-w-full cursor-pointer truncate rounded-md bg-surface-secondary px-2.5 py-1 font-mono text-xs leading-5 text-foreground transition-colors hover:bg-default focus:ring-2 focus:ring-accent/40 focus:outline-none"
												aria-label={t(
													"copyProviderModelName",
													{ name: model },
												)}
												title={model}
												onClick={() =>
													handleCopyModel(model)
												}
											>
												{model}
											</button>
										))}
									</div>
								)}
							</div>
						</Card.Content>
					</Card>
				</div>
			</div>

			<AlertDialog.Backdrop
				isOpen={isDeleteOpen}
				onOpenChange={setIsDeleteOpen}
			>
				<AlertDialog.Container>
					<AlertDialog.Dialog className="sm:max-w-[420px]">
						<AlertDialog.CloseTrigger />
						<AlertDialog.Header>
							<AlertDialog.Icon status="danger" />
							<AlertDialog.Heading>
								{t("deleteInferenceProvider")}
							</AlertDialog.Heading>
						</AlertDialog.Header>
						<AlertDialog.Body>
							{t("deleteInferenceProviderConfirm", {
								name: provider.display_name,
							})}
						</AlertDialog.Body>
						<AlertDialog.Footer>
							<Button
								variant="tertiary"
								onPress={() => setIsDeleteOpen(false)}
							>
								{t("cancel")}
							</Button>
							<Button
								variant="danger"
								isPending={deleteMutation.isPending}
								onPress={() =>
									deleteMutation.mutate(provider.name)
								}
							>
								{t("delete")}
							</Button>
						</AlertDialog.Footer>
					</AlertDialog.Dialog>
				</AlertDialog.Container>
			</AlertDialog.Backdrop>
		</>
	);
}

export default function InferenceProvidersPage() {
	const { t } = useTranslation();
	const api = useApi();
	const [searchQuery, setSearchQuery] = useState("");
	const [selectedName, setSelectedName] = useState<string | null>(null);
	const [panel, setPanel] = useState<PanelMode>({ type: "detail" });

	const {
		data: providers = [],
		isLoading,
		isFetching,
		refetch,
	} = useQuery({
		...inferenceProviderListQueryOptions({ api }),
	});

	const codingAgentFuse = useMemo(
		() =>
			new Fuse(CODING_AGENT_OPTIONS, {
				keys: [
					{ name: "label", weight: 2 },
					{ name: "id", weight: 1 },
				],
				threshold: 0.4,
				ignoreLocation: true,
			}),
		[],
	);

	const filteredCodingAgents = useMemo(() => {
		const query = searchQuery.trim();
		if (!query) return CODING_AGENT_OPTIONS;

		return codingAgentFuse.search(query).map((result) => result.item);
	}, [codingAgentFuse, searchQuery]);

	const providerFuse = useMemo(
		() =>
			new Fuse(providers, {
				keys: [
					{ name: "display_name", weight: 2 },
					{ name: "models", weight: 2 },
					{ name: "name", weight: 1 },
					{ name: "api_base_url", weight: 1 },
					{ name: "format", weight: 1 },
				],
				threshold: 0.4,
				ignoreLocation: true,
			}),
		[providers],
	);

	const filteredProviders = useMemo(() => {
		const query = searchQuery.trim();
		if (!query) return providers;

		return providerFuse.search(query).map((result) => result.item);
	}, [providerFuse, providers, searchQuery]);

	const activeProvider = useMemo(() => {
		if (selectedName) {
			const selected = providers.find(
				(provider) => provider.name === selectedName,
			);
			if (selected) return selected;
		}
		return providers[0] ?? null;
	}, [providers, selectedName]);

	const selectedAgentKeys = useMemo(() => {
		return panel.type === "agent"
			? new Set([panel.agentId])
			: new Set<string>();
	}, [panel]);

	const selectedProviderKeys = useMemo(() => {
		return activeProvider &&
			(panel.type === "detail" || panel.type === "edit")
			? new Set([activeProvider.name])
			: new Set<string>();
	}, [activeProvider, panel.type]);

	const handleCreatedOrUpdated = (provider: InferenceProviderResponse) => {
		setSelectedName(provider.name);
		setPanel({ type: "detail" });
	};

	const handleEditProviderByName = (name: string) => {
		const provider = providers.find((provider) => provider.name === name);
		setSelectedName(name);
		setPanel(provider ? { type: "edit", provider } : { type: "detail" });
	};

	if (isLoading) {
		return (
			<div className="flex h-full items-center justify-center">
				<Spinner size="lg" />
			</div>
		);
	}

	return (
		<div className="flex h-full">
			<div className="relative flex w-80 shrink-0 flex-col border-r border-border">
				<ListSearchHeader
					searchValue={searchQuery}
					onSearchChange={setSearchQuery}
					placeholder={t("searchInferenceProviderResources")}
					ariaLabel={t("searchInferenceProviderResources")}
				>
					<Tooltip delay={0}>
						<Tooltip.Trigger>
							<Button
								isIconOnly
								variant="ghost"
								size="sm"
								aria-label={t("createInferenceProvider")}
								onPress={() => {
									setSelectedName(null);
									setPanel({ type: "create" });
								}}
							>
								<PlusIcon className="size-4" />
							</Button>
						</Tooltip.Trigger>
						<Tooltip.Content>{t("add")}</Tooltip.Content>
					</Tooltip>
					<Tooltip delay={0}>
						<Tooltip.Trigger>
							<Button
								isIconOnly
								variant="ghost"
								size="sm"
								aria-label={t("refreshInferenceProviders")}
								onPress={() => refetch()}
							>
								<ArrowPathIcon
									className={cn(
										"size-4",
										isFetching && "animate-spin",
									)}
								/>
							</Button>
						</Tooltip.Trigger>
						<Tooltip.Content>{t("refresh")}</Tooltip.Content>
					</Tooltip>
				</ListSearchHeader>

				<div className="flex-1 overflow-y-auto">
					<ResourceSectionHeader
						title={t("codingAgents")}
						count={filteredCodingAgents.length}
						icon={<CpuChipIcon className="size-3.5" />}
					/>
					{filteredCodingAgents.length === 0 ? (
						<div className="px-4 py-4 text-center">
							<p className="text-sm text-muted">
								{t("noCodingAgentsMatch")}
							</p>
						</div>
					) : (
						<ListBox
							aria-label={t("codingAgents")}
							selectionMode="single"
							selectionBehavior="replace"
							selectedKeys={selectedAgentKeys}
							onSelectionChange={(keys) => {
								if (keys === "all") return;
								const agentId = [...keys][0] as
									| CodingAgentId
									| undefined;
								if (!agentId) return;

								setSelectedName(null);
								setPanel({ type: "agent", agentId });
							}}
							className="p-2"
						>
							{filteredCodingAgents.map((agent) => (
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
					)}

					<ResourceSectionHeader
						title={t("inferenceProviders")}
						count={filteredProviders.length}
						icon={<ServerIcon className="size-3.5" />}
					/>
					{filteredProviders.length === 0 ? (
						<div className="px-4 py-4 text-center">
							<p className="text-sm text-muted">
								{providers.length === 0
									? t("noInferenceProviders")
									: t("noInferenceProvidersMatch")}
							</p>
						</div>
					) : (
						<ListBox
							aria-label={t("inferenceProviders")}
							selectionMode="single"
							selectedKeys={selectedProviderKeys}
							onAction={(key) => {
								setSelectedName(String(key));
								setPanel({ type: "detail" });
							}}
							className="p-2"
						>
							{filteredProviders.map((provider) => (
								<ListBox.Item
									key={provider.name}
									id={provider.name}
									textValue={`${provider.display_name} ${provider.name}`}
									className="data-selected:bg-surface"
								>
									<div className="flex min-w-0 items-center gap-2">
										<ProviderIcon
											format={provider.format}
										/>
										<div className="min-w-0 flex-1">
											<Label className="block truncate">
												{provider.display_name}
											</Label>
										</div>
									</div>
								</ListBox.Item>
							))}
						</ListBox>
					)}
				</div>
			</div>

			<div className="relative flex-1 overflow-hidden">
				{panel.type === "agent" && panel.agentId === "opencode" && (
					<OpenCodeInferenceProviderPanel
						onEditInferenceProvider={handleEditProviderByName}
					/>
				)}

				{panel.type === "agent" && panel.agentId === "codex" && (
					<CodexInferenceProviderPanel
						onEditInferenceProvider={handleEditProviderByName}
					/>
				)}

				{panel.type === "agent" && panel.agentId === "claude" && (
					<ClaudeInferenceProviderPanel
						onEditInferenceProvider={handleEditProviderByName}
					/>
				)}

				{panel.type === "create" && (
					<ProviderForm
						mode="create"
						onCancel={() => setPanel({ type: "detail" })}
						onSuccess={handleCreatedOrUpdated}
					/>
				)}

				{panel.type === "edit" && (
					<ProviderForm
						key={panel.provider.name}
						mode="edit"
						provider={panel.provider}
						onCancel={() => setPanel({ type: "detail" })}
						onSuccess={handleCreatedOrUpdated}
					/>
				)}

				{panel.type === "detail" && activeProvider && (
					<ProviderDetail
						key={activeProvider.name}
						provider={activeProvider}
						onEdit={() =>
							setPanel({
								type: "edit",
								provider: activeProvider,
							})
						}
						onDeleted={() => {
							setSelectedName(null);
							setPanel({ type: "detail" });
						}}
					/>
				)}

				{panel.type === "detail" && !activeProvider && (
					<div className="flex h-full flex-col items-center justify-center gap-4">
						<div className="text-center">
							<p className="mb-2 text-sm text-muted">
								{t("noInferenceProviders")}
							</p>
						</div>
						<Button onPress={() => setPanel({ type: "create" })}>
							<PlusIcon className="mr-2 size-4" />
							{t("createInferenceProvider")}
						</Button>
					</div>
				)}
			</div>
		</div>
	);
}
