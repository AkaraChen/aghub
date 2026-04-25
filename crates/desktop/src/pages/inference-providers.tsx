import {
	ArrowPathIcon,
	ClipboardDocumentIcon,
	EyeIcon,
	EyeSlashIcon,
	KeyIcon,
	PencilIcon,
	PlusIcon,
	TrashIcon,
} from "@heroicons/react/24/solid";
import {
	Alert,
	AlertDialog,
	Button,
	Card,
	Chip,
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
import { useMemo, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { ListSearchHeader } from "../components/list-search-header";
import type {
	InferenceProviderFormatDto,
	InferenceProviderResponse,
} from "../generated/dto";
import { useApi } from "../hooks/use-api";
import { cn } from "../lib/utils";
import {
	createInferenceProviderMutationOptions,
	deleteInferenceProviderMutationOptions,
	inferenceProviderListQueryOptions,
	updateInferenceProviderMutationOptions,
} from "../requests/inference-providers";

type PanelMode =
	| { type: "detail" }
	| { type: "create" }
	| { type: "edit"; provider: InferenceProviderResponse };

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

interface InferenceProviderFormValues {
	name: string;
	format: InferenceProviderFormatDto;
	apiKey: string;
}

function formatOption(
	format: InferenceProviderFormatDto,
	t: (key: string) => string,
) {
	const option = FORMAT_OPTIONS.find((item) => item.id === format);
	return option ? t(option.labelKey) : format;
}

function formatDescription(
	format: InferenceProviderFormatDto,
	t: (key: string) => string,
) {
	const option = FORMAT_OPTIONS.find((item) => item.id === format);
	return option ? t(option.descriptionKey) : format;
}

function ProviderIcon({
	format,
	isActive = false,
}: {
	format: InferenceProviderFormatDto;
	isActive?: boolean;
}) {
	return (
		<div
			className={cn(
				"flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-secondary text-muted",
				isActive && "border-accent/40 bg-accent/10 text-accent",
			)}
		>
			<KeyIcon className="size-4" />
			<span className="sr-only">{format}</span>
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
			name: provider?.name ?? "",
			format: provider?.format ?? "openai_responses",
			apiKey: "",
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
		const name = values.name.trim();
		const apiKey = values.apiKey.trim();

		try {
			if (mode === "create") {
				const created = await createMutation.mutateAsync({
					name,
					format: values.format,
					api_key: apiKey,
				});
				toast.success(t("inferenceProviderCreated"));
				onSuccess(created);
				return;
			}

			if (!provider) return;
			const updated = await updateMutation.mutateAsync({
				name: provider.name,
				body: {
					name,
					format: values.format,
					api_key: apiKey || null,
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
						<Card.Description>
							{mode === "create"
								? t("createInferenceProviderDescription")
								: t("editInferenceProviderDescription")}
						</Card.Description>
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
									name="name"
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

	return (
		<div className="h-full overflow-y-auto p-4 sm:p-6">
			<div className="mb-5 flex items-start justify-between gap-4">
				<div className="flex min-w-0 items-center gap-3">
					<ProviderIcon format={provider.format} isActive />
					<div className="min-w-0">
						<h3 className="truncate text-xl font-semibold text-foreground">
							{provider.name}
						</h3>
						<p className="text-sm text-muted">
							{formatOption(provider.format, t)}
						</p>
					</div>
				</div>
				<div className="flex shrink-0 items-center gap-1">
					<Tooltip delay={0}>
						<Tooltip.Trigger>
							<Button
								isIconOnly
								variant="ghost"
								size="sm"
								aria-label={t("editInferenceProvider")}
								onPress={onEdit}
							>
								<PencilIcon className="size-4" />
							</Button>
						</Tooltip.Trigger>
						<Tooltip.Content>{t("edit")}</Tooltip.Content>
					</Tooltip>
					<Tooltip delay={0}>
						<Tooltip.Trigger>
							<Button
								isIconOnly
								variant="ghost"
								size="sm"
								aria-label={t("deleteInferenceProvider")}
								onPress={() => setIsDeleteOpen(true)}
							>
								<TrashIcon className="size-4" />
							</Button>
						</Tooltip.Trigger>
						<Tooltip.Content>{t("delete")}</Tooltip.Content>
					</Tooltip>
				</div>
			</div>

			<div className="grid gap-4">
				<Card variant="secondary">
					<Card.Header className="flex flex-row items-start justify-between gap-3">
						<div>
							<Card.Title>{t("providerFormat")}</Card.Title>
							<Card.Description>
								{formatDescription(provider.format, t)}
							</Card.Description>
						</div>
						<Chip color="accent" variant="soft" size="sm">
							{formatOption(provider.format, t)}
						</Chip>
					</Card.Header>
				</Card>

				<Card variant="secondary">
					<Card.Header>
						<div>
							<Card.Title>{t("providerApiKey")}</Card.Title>
							<Card.Description>
								{t("providerApiKeyStored")}
							</Card.Description>
						</div>
					</Card.Header>
					<Card.Content>
						<div className="flex min-w-0 items-center gap-2 rounded-lg border border-separator bg-surface-secondary px-3 py-2">
							<code className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
								{revealedKey ?? "••••••••••••••••••••••••"}
							</code>
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
					</Card.Content>
				</Card>
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
								name: provider.name,
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
		</div>
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

	const filteredProviders = useMemo(() => {
		const query = searchQuery.trim().toLowerCase();
		if (!query) return providers;

		return providers.filter((provider) => {
			const format = formatOption(provider.format, t).toLowerCase();
			return (
				provider.name.toLowerCase().includes(query) ||
				provider.format.includes(query) ||
				format.includes(query)
			);
		});
	}, [providers, searchQuery, t]);

	const activeProvider = useMemo(() => {
		if (selectedName) {
			const selected = providers.find(
				(provider) => provider.name === selectedName,
			);
			if (selected) return selected;
		}
		return providers[0] ?? null;
	}, [providers, selectedName]);

	const selectedKeys = useMemo(() => {
		return activeProvider && panel.type !== "create"
			? new Set([activeProvider.name])
			: new Set<string>();
	}, [activeProvider, panel.type]);

	const handleCreatedOrUpdated = (provider: InferenceProviderResponse) => {
		setSelectedName(provider.name);
		setPanel({ type: "detail" });
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
					placeholder={t("searchInferenceProviders")}
					ariaLabel={t("searchInferenceProviders")}
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

				{filteredProviders.length === 0 ? (
					<div className="px-4 py-8 text-center">
						<p className="text-sm text-muted">
							{providers.length === 0
								? t("noInferenceProviders")
								: t("noInferenceProvidersMatch")}
						</p>
					</div>
				) : (
					<div className="flex-1 overflow-y-auto">
						<ListBox
							aria-label={t("inferenceProviders")}
							selectionMode="single"
							selectedKeys={selectedKeys}
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
									textValue={provider.name}
									className="data-selected:bg-surface"
								>
									<div className="flex min-w-0 items-center gap-2">
										<ProviderIcon
											format={provider.format}
											isActive={
												activeProvider?.name ===
												provider.name
											}
										/>
										<div className="min-w-0 flex-1">
											<Label className="block truncate">
												{provider.name}
											</Label>
											<span className="block truncate text-xs text-muted">
												{formatOption(
													provider.format,
													t,
												)}
											</span>
										</div>
									</div>
								</ListBox.Item>
							))}
						</ListBox>
					</div>
				)}
			</div>

			<div className="relative flex-1 overflow-hidden">
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
