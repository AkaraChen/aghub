import {
	ArrowPathIcon,
	CheckCircleIcon,
	Cog6ToothIcon,
	FolderOpenIcon,
	PlayIcon,
	PlusIcon,
	QuestionMarkCircleIcon,
	TrashIcon,
} from "@heroicons/react/24/solid";
import { homeDir, join } from "@tauri-apps/api/path";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import {
	Alert,
	AlertDialog,
	Button,
	Card,
	Label,
	ListBox,
	Modal,
	Select,
	Separator,
	Spinner,
	Tooltip,
	toast,
} from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";
import type {
	AgentProviderResponse,
	InferenceProviderResponse,
	UpdateAgentProviderRequest,
} from "../../generated/dto";
import { useApi } from "../../hooks/use-api";
import { AgentIcon } from "../../lib/agent-icons";
import { cn } from "../../lib/utils";
import {
	claudeProviderStateQueryOptions,
	clearClaudeProviderMutationOptions,
	createClaudeProviderMutationOptions,
	deleteClaudeProviderMutationOptions,
	inferenceProviderListQueryOptions,
	syncClaudeProviderMutationOptions,
	updateClaudeProviderMutationOptions,
} from "../../requests/inference-providers";
import { selectValidProviderId } from "./provider-selection";
import { ProviderActiveBadge, ProviderRowShell } from "./provider-row";

const INHERIT_PRIMARY_MODEL_KEY = "__aghub_primary_model__";

interface ClaudeModelOption {
	id: string;
	name?: string | null;
}

interface ClaudeModelSelection {
	model?: string;
	haiku_model?: string;
	sonnet_model?: string;
	opus_model?: string;
}

type ClaudeModelRoute = "model" | "haiku_model" | "sonnet_model" | "opus_model";

function claudeModelSelectionUpdateBody(
	selection: ClaudeModelSelection,
): UpdateAgentProviderRequest {
	return {
		name: null,
		api_key: null,
		...(selection.model ? { model: selection.model } : {}),
		haiku_model: selection.haiku_model ?? null,
		sonnet_model: selection.sonnet_model ?? null,
		opus_model: selection.opus_model ?? null,
	};
}

function modelOptionsFromStrings(models: string[]): ClaudeModelOption[] {
	return models.map((model) => ({ id: model, name: model }));
}

function selectValidModelId(
	modelId: string | undefined,
	models: ClaudeModelOption[],
	fallback = "",
) {
	return modelId && models.some((model) => model.id === modelId)
		? modelId
		: fallback;
}

function selectOptionalModelId(
	modelId: string | undefined,
	models: ClaudeModelOption[],
) {
	return modelId && models.some((model) => model.id === modelId)
		? modelId
		: "";
}

function modelOptionsWithSelected(
	models: ClaudeModelOption[],
	selectedModels: Array<string | null | undefined>,
) {
	const options = [...models];
	const knownIds = new Set(options.map((model) => model.id));
	for (const modelId of selectedModels) {
		if (modelId && !knownIds.has(modelId)) {
			options.unshift({ id: modelId, name: modelId });
			knownIds.add(modelId);
		}
	}
	return options;
}

function ClaudeModelRouteSelect({
	label,
	helpText,
	models,
	selectedModel,
	isOptional = false,
	isRequired = false,
	isDisabled,
	onSelect,
}: {
	label: string;
	helpText?: string;
	models: ClaudeModelOption[];
	selectedModel: string;
	isOptional?: boolean;
	isRequired?: boolean;
	isDisabled?: boolean;
	onSelect: (model: string | null) => void;
}) {
	const { t } = useTranslation();

	return (
		<Select
			className="min-w-0"
			isRequired={isRequired}
			validationBehavior="aria"
			selectedKey={
				isOptional && !selectedModel
					? INHERIT_PRIMARY_MODEL_KEY
					: selectedModel || undefined
			}
			isDisabled={isDisabled || models.length === 0}
			onSelectionChange={(key) => {
				if (!key) return;
				const value = String(key);
				onSelect(value === INHERIT_PRIMARY_MODEL_KEY ? null : value);
			}}
			variant="secondary"
		>
			<Label>
				<span className="inline-flex min-w-0 items-center gap-1">
					<span className="truncate">{label}</span>
					{helpText && (
						<Tooltip delay={0}>
							<Tooltip.Trigger>
								<span
									tabIndex={0}
									aria-label={helpText}
									className="inline-flex size-4 shrink-0 items-center justify-center text-muted outline-none transition-colors hover:text-foreground focus-visible:text-foreground"
								>
									<QuestionMarkCircleIcon className="size-4" />
								</span>
							</Tooltip.Trigger>
							<Tooltip.Content className="max-w-72">
								{helpText}
							</Tooltip.Content>
						</Tooltip>
					)}
				</span>
			</Label>
			<Select.Trigger>
				<Select.Value />
				<Select.Indicator />
			</Select.Trigger>
			<Select.Popover>
				<ListBox>
					{isOptional && (
						<ListBox.Item
							id={INHERIT_PRIMARY_MODEL_KEY}
							textValue={label}
						>
							<Label className="truncate">
								{t("claudeModelUsePrimary")}
							</Label>
						</ListBox.Item>
					)}
					{models.map((model) => (
						<ListBox.Item
							key={model.id}
							id={model.id}
							textValue={model.name ?? model.id}
						>
							<Label className="truncate">
								{model.name ?? model.id}
							</Label>
						</ListBox.Item>
					))}
				</ListBox>
			</Select.Popover>
		</Select>
	);
}

function ClaudeModelRouteSelects({
	models,
	value,
	isDisabled,
	onChange,
}: {
	models: ClaudeModelOption[];
	value: ClaudeModelSelection;
	isDisabled?: boolean;
	onChange: (route: ClaudeModelRoute, model: string | null) => void;
}) {
	const { t } = useTranslation();
	const primaryModel = selectValidModelId(
		value.model,
		models,
		models[0]?.id ?? "",
	);
	const haikuModel = selectOptionalModelId(value.haiku_model, models);
	const sonnetModel = selectOptionalModelId(value.sonnet_model, models);
	const opusModel = selectOptionalModelId(value.opus_model, models);

	return (
		<div className="grid gap-4">
			<ClaudeModelRouteSelect
				label={t("claudePrimaryModel")}
				models={models}
				selectedModel={primaryModel}
				isRequired
				isDisabled={isDisabled}
				onSelect={(model) => {
					if (model) onChange("model", model);
				}}
			/>
			<div className="grid gap-3">
				<div className="flex items-center gap-2">
					<Separator className="flex-1" variant="tertiary" />
					<span className="shrink-0 text-xs font-medium text-muted">
						{t("advanced")}
					</span>
					<Separator className="flex-1" variant="tertiary" />
				</div>
				<ClaudeModelRouteSelect
					label={t("claudeHaikuModel")}
					helpText={t("claudeHaikuModelHelp")}
					models={models}
					selectedModel={haikuModel}
					isOptional
					isDisabled={isDisabled}
					onSelect={(model) => onChange("haiku_model", model)}
				/>
				<ClaudeModelRouteSelect
					label={t("claudeSonnetModel")}
					helpText={t("claudeSonnetModelHelp")}
					models={models}
					selectedModel={sonnetModel}
					isOptional
					isDisabled={isDisabled}
					onSelect={(model) => onChange("sonnet_model", model)}
				/>
				<ClaudeModelRouteSelect
					label={t("claudeOpusModel")}
					helpText={t("claudeOpusModelHelp")}
					models={models}
					selectedModel={opusModel}
					isOptional
					isDisabled={isDisabled}
					onSelect={(model) => onChange("opus_model", model)}
				/>
			</div>
		</div>
	);
}

function ClaudeCreateProviderDialog({
	isOpen,
	inventoryProviders,
	isInventoryLoading,
	onClose,
}: {
	isOpen: boolean;
	inventoryProviders: InferenceProviderResponse[];
	isInventoryLoading: boolean;
	onClose: () => void;
}) {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();
	const [selectedProviderId, setSelectedProviderId] = useState("");
	const [modelSelection, setModelSelection] = useState<ClaudeModelSelection>(
		{},
	);

	const anthropicProviders = useMemo(
		() =>
			inventoryProviders.filter(
				(provider) => provider.format === "anthropic",
			),
		[inventoryProviders],
	);
	const defaultProviderId = anthropicProviders[0]?.id ?? "";
	const effectiveSelectedProviderId = selectValidProviderId(
		selectedProviderId,
		anthropicProviders,
		defaultProviderId,
	);
	const selectedProvider = anthropicProviders.find(
		(provider) => provider.id === effectiveSelectedProviderId,
	);
	const modelOptions = selectedProvider
		? modelOptionsFromStrings(selectedProvider.models)
		: [];
	const primaryModel = selectValidModelId(
		modelSelection.model,
		modelOptions,
		modelOptions[0]?.id ?? "",
	);
	const haikuModel = selectOptionalModelId(
		modelSelection.haiku_model,
		modelOptions,
	);
	const sonnetModel = selectOptionalModelId(
		modelSelection.sonnet_model,
		modelOptions,
	);
	const opusModel = selectOptionalModelId(
		modelSelection.opus_model,
		modelOptions,
	);

	const createMutation = useMutation({
		...createClaudeProviderMutationOptions({
			api,
			queryClient,
			onSuccess: async () => {
				toast.success(t("claudeProviderUpdated"));
				handleClose();
			},
		}),
		onError: (error) => {
			console.error("Failed to create Claude provider:", error);
			toast.danger(
				error instanceof Error
					? error.message
					: t("claudeProviderUpdateError"),
			);
		},
	});

	const isPending = createMutation.isPending;
	const hasAnthropicProviders = anthropicProviders.length > 0;

	const handleClose = () => {
		setSelectedProviderId("");
		setModelSelection({});
		onClose();
	};

	const handleModelChange = (
		route: ClaudeModelRoute,
		model: string | null,
	) => {
		setModelSelection((current) => ({
			...current,
			[route]: model ?? undefined,
		}));
	};

	const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!effectiveSelectedProviderId || !primaryModel) return;

		createMutation.mutate({
			inference_provider_id: effectiveSelectedProviderId,
			model: primaryModel,
			...(haikuModel ? { haiku_model: haikuModel } : {}),
			...(sonnetModel ? { sonnet_model: sonnetModel } : {}),
			...(opusModel ? { opus_model: opusModel } : {}),
		});
	};

	return (
		<Modal.Backdrop
			isOpen={isOpen}
			onOpenChange={(open) => {
				if (!open) handleClose();
			}}
		>
			<Modal.Container>
				<Modal.Dialog className="sm:max-w-[440px]">
					<Modal.CloseTrigger />
					<Modal.Header>
						<Modal.Heading>
							{t("createClaudeProvider")}
						</Modal.Heading>
					</Modal.Header>
					<form onSubmit={handleSubmit}>
						<Modal.Body className="grid gap-4 p-4">
							{isInventoryLoading && (
								<div className="flex justify-center py-6">
									<Spinner />
								</div>
							)}

							{!isInventoryLoading && !hasAnthropicProviders && (
								<Alert status="warning">
									<Alert.Indicator />
									<Alert.Content>
										<Alert.Description>
											{t("noInferenceProvidersForClaude")}
										</Alert.Description>
									</Alert.Content>
								</Alert>
							)}

							{!isInventoryLoading && hasAnthropicProviders && (
								<Select
									className="w-full"
									isRequired
									validationBehavior="aria"
									selectedKey={
										effectiveSelectedProviderId || undefined
									}
									onSelectionChange={(key) => {
										if (!key) return;
										setSelectedProviderId(String(key));
										setModelSelection({});
									}}
									isDisabled={isPending}
									variant="secondary"
								>
									<Label>
										{t("selectInferenceProvider")}
									</Label>
									<Select.Trigger>
										<Select.Value />
										<Select.Indicator />
									</Select.Trigger>
									<Select.Popover>
										<ListBox>
											{anthropicProviders.map((item) => (
												<ListBox.Item
													key={item.id}
													id={item.id}
													textValue={`${item.display_name} ${item.latin_name}`}
												>
													<div className="grid min-w-0 gap-0.5">
														<Label className="truncate">
															{item.display_name}
														</Label>
														<span className="truncate text-xs text-muted">
															{item.api_base_url}
														</span>
													</div>
												</ListBox.Item>
											))}
										</ListBox>
									</Select.Popover>
								</Select>
							)}

							{!isInventoryLoading &&
								hasAnthropicProviders &&
								selectedProvider &&
								modelOptions.length === 0 && (
									<Alert status="warning">
										<Alert.Indicator />
										<Alert.Content>
											<Alert.Description>
												{t("claudeProviderNeedsModels")}
											</Alert.Description>
										</Alert.Content>
									</Alert>
								)}

							{!isInventoryLoading &&
								hasAnthropicProviders &&
								modelOptions.length > 0 && (
									<ClaudeModelRouteSelects
										models={modelOptions}
										value={{
											model: primaryModel,
											haiku_model: haikuModel,
											sonnet_model: sonnetModel,
											opus_model: opusModel,
										}}
										isDisabled={isPending}
										onChange={handleModelChange}
									/>
								)}
						</Modal.Body>
						<Modal.Footer>
							<Button
								type="button"
								variant="tertiary"
								onPress={handleClose}
								isDisabled={isPending}
							>
								{t("cancel")}
							</Button>
							<Button
								type="submit"
								isPending={isPending}
								isDisabled={
									isInventoryLoading ||
									!hasAnthropicProviders ||
									!effectiveSelectedProviderId ||
									!primaryModel
								}
							>
								{t("add")}
							</Button>
						</Modal.Footer>
					</form>
				</Modal.Dialog>
			</Modal.Container>
		</Modal.Backdrop>
	);
}

function providerModelOptions(
	provider: AgentProviderResponse,
	activeModel?: string | null,
	isActive = false,
) {
	return modelOptionsWithSelected(provider.models, [
		provider.model,
		provider.haiku_model,
		provider.sonnet_model,
		provider.opus_model,
		isActive ? activeModel : undefined,
	]);
}

function providerModelSelection(
	provider: AgentProviderResponse,
	modelOptions: ClaudeModelOption[],
	activeModel?: string | null,
	isActive = false,
): ClaudeModelSelection {
	const primaryModel = selectValidModelId(
		provider.model ?? (isActive && activeModel ? activeModel : undefined),
		modelOptions,
		modelOptions[0]?.id ?? "",
	);
	return {
		model: primaryModel,
		haiku_model: provider.haiku_model ?? undefined,
		sonnet_model: provider.sonnet_model ?? undefined,
		opus_model: provider.opus_model ?? undefined,
	};
}

function ClaudeModelSettingsDialog({
	provider,
	isOpen,
	activeModel,
	isActive,
	isPending,
	onClose,
	onSave,
}: {
	provider: AgentProviderResponse | null;
	isOpen: boolean;
	activeModel?: string | null;
	isActive: boolean;
	isPending: boolean;
	onClose: () => void;
	onSave: (selection: ClaudeModelSelection) => void;
}) {
	const { t } = useTranslation();
	const [selection, setSelection] = useState<ClaudeModelSelection>({});

	const modelOptions = useMemo(() => {
		if (!provider) return [];
		return providerModelOptions(provider, activeModel, isActive);
	}, [activeModel, isActive, provider]);

	useEffect(() => {
		if (!provider || !isOpen) return;
		setSelection(
			providerModelSelection(
				provider,
				modelOptions,
				activeModel,
				isActive,
			),
		);
	}, [activeModel, isActive, isOpen, modelOptions, provider]);

	const label =
		provider?.matched_inference_provider?.display_name ??
		provider?.name ??
		"";
	const heading = label
		? t("providerModelSettings", { name: label })
		: t("claudeModelSettings");
	const primaryModel = selectValidModelId(
		selection.model,
		modelOptions,
		modelOptions[0]?.id ?? "",
	);
	const normalizedSelection: ClaudeModelSelection = {
		model: primaryModel,
		haiku_model: selectOptionalModelId(selection.haiku_model, modelOptions),
		sonnet_model: selectOptionalModelId(
			selection.sonnet_model,
			modelOptions,
		),
		opus_model: selectOptionalModelId(selection.opus_model, modelOptions),
	};

	const handleModelChange = (
		route: ClaudeModelRoute,
		model: string | null,
	) => {
		setSelection((current) => ({
			...current,
			[route]: model ?? undefined,
		}));
	};

	return (
		<Modal.Backdrop
			isOpen={isOpen}
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<Modal.Container>
				<Modal.Dialog className="sm:max-w-[520px]">
					<Modal.CloseTrigger />
					<Modal.Header>
						<Modal.Heading>
							<span className="truncate">{heading}</span>
						</Modal.Heading>
					</Modal.Header>
					<Modal.Body className="grid gap-4 p-4">
						{modelOptions.length === 0 ? (
							<Alert status="warning">
								<Alert.Indicator />
								<Alert.Content>
									<Alert.Description>
										{t("claudeProviderNeedsModels")}
									</Alert.Description>
								</Alert.Content>
							</Alert>
						) : (
							<ClaudeModelRouteSelects
								models={modelOptions}
								value={normalizedSelection}
								isDisabled={isPending}
								onChange={handleModelChange}
							/>
						)}
					</Modal.Body>
					<Modal.Footer>
						<Button
							type="button"
							variant="tertiary"
							isDisabled={isPending}
							onPress={onClose}
						>
							{t("cancel")}
						</Button>
						<Button
							isPending={isPending}
							isDisabled={
								!primaryModel || modelOptions.length === 0
							}
							onPress={() => onSave(normalizedSelection)}
						>
							{t("save")}
						</Button>
					</Modal.Footer>
				</Modal.Dialog>
			</Modal.Container>
		</Modal.Backdrop>
	);
}

function ClaudeOfficialRow({
	isActive,
	isPending,
	onActivate,
}: {
	isActive: boolean;
	isPending: boolean;
	onActivate: () => void;
}) {
	const { t } = useTranslation();

	return (
		<ProviderRowShell
			isActive={isActive}
			title={t("claudeOfficial")}
			titleExtras={
				isActive && (
					<ProviderActiveBadge
						icon={<CheckCircleIcon className="size-3.5" />}
					>
						{t("active")}
					</ProviderActiveBadge>
				)
			}
			description={t("claudeOfficialDescription")}
			actions={
				<Tooltip delay={0}>
					<Tooltip.Trigger>
						<Button
							isIconOnly
							size="sm"
							variant="ghost"
							isPending={isPending}
							isDisabled={isActive}
							aria-label={
								isActive
									? t("claudeProviderAlreadyActive")
									: t("enable")
							}
							onPress={onActivate}
						>
							<PlayIcon className="size-4" />
						</Button>
					</Tooltip.Trigger>
					<Tooltip.Content>
						{isActive
							? t("claudeProviderAlreadyActive")
							: t("enable")}
					</Tooltip.Content>
				</Tooltip>
			}
		/>
	);
}

function ClaudeProviderRow({
	provider,
	isActive,
	activeModel,
	isSyncing,
	isSelecting,
	isDeleting,
	canSelect,
	onSelect,
	onEditModels,
	onSync,
	onDelete,
}: {
	provider: AgentProviderResponse;
	isActive: boolean;
	activeModel?: string | null;
	isSyncing: boolean;
	isSelecting: boolean;
	isDeleting: boolean;
	canSelect: boolean;
	onSelect: (selection: ClaudeModelSelection) => void;
	onEditModels: () => void;
	onSync: () => void;
	onDelete: () => void;
}) {
	const { t } = useTranslation();
	const matchedProvider = provider.matched_inference_provider;
	const label = matchedProvider?.display_name ?? provider.name;
	const modelOptions = providerModelOptions(provider, activeModel, isActive);
	const modelSelection = providerModelSelection(
		provider,
		modelOptions,
		activeModel,
		isActive,
	);
	const primaryModel = modelSelection.model ?? "";
	const isBusy = isSelecting || isSyncing || isDeleting;

	return (
		<ProviderRowShell
			isActive={isActive}
			title={label}
			titleExtras={
				isActive && (
					<ProviderActiveBadge
						icon={<CheckCircleIcon className="size-3.5" />}
					>
						{t("active")}
					</ProviderActiveBadge>
				)
			}
			description={
				matchedProvider
					? t("agentProviderModelCount", {
							count: matchedProvider.model_count,
						})
					: undefined
			}
			actions={
				<>
					{modelOptions.length > 0 && (
						<Tooltip delay={0}>
							<Tooltip.Trigger>
								<Button
									isIconOnly
									variant="ghost"
									size="sm"
									aria-label={t("claudeModelSettings")}
									isDisabled={isBusy}
									onPress={onEditModels}
								>
									<Cog6ToothIcon className="size-4" />
								</Button>
							</Tooltip.Trigger>
							<Tooltip.Content>
								{t("claudeModelSettings")}
							</Tooltip.Content>
						</Tooltip>
					)}
					{matchedProvider && (
						<Tooltip delay={0}>
							<Tooltip.Trigger>
								<Button
									isIconOnly
									variant="ghost"
									size="sm"
									aria-label={t("syncClaudeProvider")}
									isPending={isSyncing}
									onPress={onSync}
								>
									<ArrowPathIcon className="size-4" />
								</Button>
							</Tooltip.Trigger>
							<Tooltip.Content>
								{t("syncClaudeProviderFromInferenceProvider", {
									name: matchedProvider.display_name,
								})}
							</Tooltip.Content>
						</Tooltip>
					)}
					<Tooltip delay={0}>
						<Tooltip.Trigger>
							<Button
								isIconOnly
								variant="ghost"
								size="sm"
								className="text-muted hover:text-danger"
								aria-label={t("deleteClaudeProvider")}
								isPending={isDeleting}
								onPress={onDelete}
							>
								<TrashIcon className="size-4" />
							</Button>
						</Tooltip.Trigger>
						<Tooltip.Content>{t("delete")}</Tooltip.Content>
					</Tooltip>
					<Tooltip delay={0}>
						<Tooltip.Trigger>
							<Button
								isIconOnly
								variant="ghost"
								size="sm"
								isPending={isSelecting}
								isDisabled={
									isActive || !canSelect || !primaryModel
								}
								aria-label={
									isActive
										? t("claudeProviderAlreadyActive")
										: t("enable")
								}
								onPress={() => onSelect(modelSelection)}
							>
								<PlayIcon className="size-4" />
							</Button>
						</Tooltip.Trigger>
						<Tooltip.Content>
							{isActive
								? t("claudeProviderAlreadyActive")
								: !canSelect
									? t("claudeNoProfiles")
									: t("enable")}
						</Tooltip.Content>
					</Tooltip>
				</>
			}
			actionsClassName="flex-wrap gap-2"
		/>
	);
}

export function ClaudeInferenceProviderPanel(_: {
	onEditInferenceProvider: (providerName: string) => void;
}) {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();
	const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
	const [modelSettingsTarget, setModelSettingsTarget] =
		useState<AgentProviderResponse | null>(null);
	const [deleteTarget, setDeleteTarget] =
		useState<AgentProviderResponse | null>(null);

	const {
		data: claudeState,
		isLoading,
		isFetching,
		refetch,
	} = useQuery({
		...claudeProviderStateQueryOptions({ api }),
	});
	const { data: inventoryProviders = [], isLoading: isInventoryLoading } =
		useQuery({
			...inferenceProviderListQueryOptions({ api }),
		});

	const activeProviderId =
		(claudeState as { active_provider_id?: string } | undefined)
			?.active_provider_id ?? "official_login";
	const activeModel =
		(claudeState as { active_model?: string | null } | undefined)
			?.active_model ?? null;
	const isOfficialActive = activeProviderId === "official_login";
	const customProviders = (
		(claudeState as { providers?: AgentProviderResponse[] } | undefined)
			?.providers ?? []
	).filter((p) => p.source !== "built_in");

	const clearMutation = useMutation({
		...clearClaudeProviderMutationOptions({
			api,
			queryClient,
			onSuccess: async () => {
				toast.success(t("claudeProviderCleared"));
			},
		}),
		onError: (error) => {
			console.error("Failed to clear Claude provider:", error);
			toast.danger(
				error instanceof Error
					? error.message
					: t("claudeProviderClearError"),
			);
		},
	});
	const deleteMutation = useMutation({
		...deleteClaudeProviderMutationOptions({
			api,
			queryClient,
			onSuccess: async () => {
				setDeleteTarget(null);
				toast.success(t("claudeProviderDeleted"));
			},
		}),
		onError: (error) => {
			console.error("Failed to delete Claude provider:", error);
			toast.danger(
				error instanceof Error
					? error.message
					: t("claudeProviderDeleteError"),
			);
		},
	});
	const syncMutation = useMutation({
		...syncClaudeProviderMutationOptions({
			api,
			queryClient,
			onSuccess: async () => {
				toast.success(t("claudeProviderSynced"));
			},
		}),
		onError: (error) => {
			console.error("Failed to sync Claude provider:", error);
			toast.danger(
				error instanceof Error
					? error.message
					: t("claudeProviderSyncError"),
			);
		},
	});
	const updateMutation = useMutation({
		...updateClaudeProviderMutationOptions({
			api,
			queryClient,
			onSuccess: async () => {
				toast.success(t("claudeProviderUpdated"));
			},
		}),
		onError: (error) => {
			console.error("Failed to update Claude provider:", error);
			toast.danger(
				error instanceof Error
					? error.message
					: t("claudeProviderUpdateError"),
			);
		},
	});

	const handleShowFolder = async () => {
		try {
			const home = await homeDir();
			const configPath = await join(home, ".claude", "settings.json");
			await revealItemInDir(configPath);
		} catch (error) {
			console.error("Failed to reveal Claude Code config folder:", error);
			toast.danger(
				error instanceof Error
					? error.message
					: t("showConfigFolderFailed"),
			);
		}
	};
	const isModelSettingsActive = modelSettingsTarget
		? activeProviderId === modelSettingsTarget.id
		: false;

	return (
		<>
			<div className="h-full overflow-y-auto">
				<div className="w-full p-4 sm:p-6">
					<Card>
						<Card.Header className="flex flex-row items-start justify-between gap-3">
							<div className="flex min-w-0 items-center gap-3">
								<AgentIcon
									id="claude"
									name="Claude Code"
									size="xs"
									variant="ghost"
								/>
								<div className="min-w-0">
									<h2 className="truncate text-xl font-semibold text-foreground">
										Claude Code
									</h2>
								</div>
							</div>
							<div className="flex shrink-0 items-center gap-2">
								<Tooltip delay={0}>
									<Tooltip.Trigger>
										<Button
											isIconOnly
											variant="ghost"
											size="sm"
											aria-label={t("showConfigFolder")}
											onPress={handleShowFolder}
										>
											<FolderOpenIcon className="size-4" />
										</Button>
									</Tooltip.Trigger>
									<Tooltip.Content>
										{t("showConfigFolder")}
									</Tooltip.Content>
								</Tooltip>
								<Tooltip delay={0}>
									<Tooltip.Trigger>
										<Button
											isIconOnly
											variant="ghost"
											size="sm"
											aria-label={t(
												"refreshClaudeProviders",
											)}
											onPress={() => refetch()}
										>
											<ArrowPathIcon
												className={cn(
													"size-4",
													isFetching &&
														"animate-spin",
												)}
											/>
										</Button>
									</Tooltip.Trigger>
									<Tooltip.Content>
										{t("refresh")}
									</Tooltip.Content>
								</Tooltip>
								<Button
									size="sm"
									aria-label={t("createClaudeProvider")}
									onPress={() => setIsAddDialogOpen(true)}
								>
									<PlusIcon className="size-4" />
									{t("add")}
								</Button>
							</div>
						</Card.Header>

						<Card.Content className="grid gap-4">
							{isLoading ? (
								<div className="flex justify-center py-8">
									<Spinner />
								</div>
							) : (
								<div>
									<ClaudeOfficialRow
										isActive={isOfficialActive}
										isPending={clearMutation.isPending}
										onActivate={() =>
											clearMutation.mutate()
										}
									/>
									{customProviders.map(
										(provider: AgentProviderResponse) => (
											<ClaudeProviderRow
												key={provider.id}
												provider={provider}
												isActive={
													activeProviderId ===
													provider.id
												}
												activeModel={activeModel}
												isSyncing={
													syncMutation.isPending &&
													syncMutation.variables ===
														provider.id
												}
												isSelecting={
													updateMutation.isPending &&
													updateMutation.variables
														?.id === provider.id
												}
												isDeleting={
													deleteMutation.isPending &&
													deleteTarget?.id ===
														provider.id
												}
												canSelect
												onSelect={(selection) => {
													updateMutation.mutate({
														id: provider.id,
														body: claudeModelSelectionUpdateBody(
															selection,
														),
													});
												}}
												onEditModels={() =>
													setModelSettingsTarget(
														provider,
													)
												}
												onSync={() =>
													syncMutation.mutate(
														provider.id,
													)
												}
												onDelete={() =>
													setDeleteTarget(provider)
												}
											/>
										),
									)}
								</div>
							)}
						</Card.Content>
					</Card>
				</div>
			</div>

			<ClaudeCreateProviderDialog
				isOpen={isAddDialogOpen}
				inventoryProviders={inventoryProviders}
				isInventoryLoading={isInventoryLoading}
				onClose={() => setIsAddDialogOpen(false)}
			/>

			<ClaudeModelSettingsDialog
				provider={modelSettingsTarget}
				isOpen={Boolean(modelSettingsTarget)}
				activeModel={activeModel}
				isActive={isModelSettingsActive}
				isPending={
					updateMutation.isPending &&
					updateMutation.variables?.id === modelSettingsTarget?.id
				}
				onClose={() => setModelSettingsTarget(null)}
				onSave={(selection) => {
					if (!modelSettingsTarget) return;
					updateMutation.mutate(
						{
							id: modelSettingsTarget.id,
							body: claudeModelSelectionUpdateBody(selection),
						},
						{
							onSuccess: () => setModelSettingsTarget(null),
						},
					);
				}}
			/>

			<AlertDialog.Backdrop
				isOpen={Boolean(deleteTarget)}
				onOpenChange={(open) => {
					if (!open) setDeleteTarget(null);
				}}
			>
				<AlertDialog.Container>
					<AlertDialog.Dialog className="sm:max-w-[420px]">
						<AlertDialog.CloseTrigger />
						<AlertDialog.Header>
							<AlertDialog.Icon status="danger" />
							<AlertDialog.Heading>
								{t("deleteClaudeProvider")}
							</AlertDialog.Heading>
						</AlertDialog.Header>
						<AlertDialog.Body>
							{t("deleteClaudeProviderConfirm", {
								name: deleteTarget?.name,
							})}
						</AlertDialog.Body>
						<AlertDialog.Footer>
							<Button
								variant="tertiary"
								onPress={() => setDeleteTarget(null)}
							>
								{t("cancel")}
							</Button>
							<Button
								variant="danger"
								isPending={deleteMutation.isPending}
								onPress={() => {
									if (!deleteTarget) return;
									deleteMutation.mutate(deleteTarget.id);
								}}
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
