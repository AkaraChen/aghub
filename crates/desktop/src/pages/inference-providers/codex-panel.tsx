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
	Spinner,
	Tooltip,
	toast,
} from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";
import type {
	AgentProviderResponse,
	InferenceProviderResponse,
} from "../../generated/dto";
import { useApi } from "../../hooks/use-api";
import { AgentIcon } from "../../lib/agent-icons";
import { cn } from "../../lib/utils";
import {
	clearCodexProviderMutationOptions,
	codexProviderStateQueryOptions,
	createCodexProviderMutationOptions,
	deleteCodexProviderMutationOptions,
	inferenceProviderListQueryOptions,
	syncCodexProviderMutationOptions,
	updateCodexProfileProviderMutationOptions,
} from "../../requests/inference-providers";
import { selectValidProviderId } from "./provider-selection";
import { ProviderActiveBadge, ProviderRowShell } from "./provider-row";

interface CodexModelOption {
	id: string;
	name?: string | null;
}

function codexModelOptionsWithSelected(
	models: CodexModelOption[],
	selectedModel?: string | null,
) {
	if (!selectedModel || models.some((model) => model.id === selectedModel)) {
		return models;
	}
	return [{ id: selectedModel, name: selectedModel }, ...models];
}

function selectCodexModel(
	modelId: string | null | undefined,
	models: CodexModelOption[],
) {
	return modelId && models.some((model) => model.id === modelId)
		? modelId
		: (models[0]?.id ?? "");
}

function CodexPrimaryModelLabel() {
	const { t } = useTranslation();

	return (
		<Label>
			<span className="inline-flex min-w-0 items-center gap-1">
				<span className="truncate">{t("codexPrimaryModel")}</span>
				<Tooltip delay={0}>
					<Tooltip.Trigger>
						<span
							tabIndex={0}
							aria-label={t("codexPrimaryModelHelp")}
							className="inline-flex size-4 shrink-0 items-center justify-center text-muted outline-none transition-colors hover:text-foreground focus-visible:text-foreground"
						>
							<QuestionMarkCircleIcon className="size-4" />
						</span>
					</Tooltip.Trigger>
					<Tooltip.Content className="max-w-72">
						{t("codexPrimaryModelHelp")}
					</Tooltip.Content>
				</Tooltip>
			</span>
		</Label>
	);
}

function CodexCreateProviderDialog({
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
	const [selectedModel, setSelectedModel] = useState("");

	const responseProviders = useMemo(
		() =>
			inventoryProviders.filter(
				(provider) => provider.format === "openai_responses",
			),
		[inventoryProviders],
	);
	const defaultProviderId = responseProviders[0]?.id ?? "";
	const effectiveSelectedProviderId = selectValidProviderId(
		selectedProviderId,
		responseProviders,
		defaultProviderId,
	);
	const selectedProvider = responseProviders.find(
		(provider) => provider.id === effectiveSelectedProviderId,
	);
	const modelOptions = useMemo(
		() =>
			selectedProvider?.models.map((model) => ({
				id: model,
				name: model,
			})) ?? [],
		[selectedProvider],
	);
	const effectiveModel = selectCodexModel(selectedModel, modelOptions);

	const handleClose = () => {
		setSelectedProviderId("");
		setSelectedModel("");
		onClose();
	};

	const createMutation = useMutation({
		...createCodexProviderMutationOptions({
			api,
			queryClient,
			onSuccess: async () => {
				toast.success(t("codexProviderUpdated"));
				handleClose();
			},
		}),
	});

	const activeError = createMutation.error;
	const isPending = createMutation.isPending;
	const hasResponseProviders = responseProviders.length > 0;

	const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!effectiveSelectedProviderId || !effectiveModel) return;

		createMutation.mutate({
			inference_provider_id: effectiveSelectedProviderId,
			model: effectiveModel,
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
							{t("createCodexProvider")}
						</Modal.Heading>
					</Modal.Header>
					<form onSubmit={handleSubmit}>
						<Modal.Body className="grid gap-4 p-4">
							{activeError && (
								<Alert status="danger">
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

							{isInventoryLoading && (
								<div className="flex justify-center py-6">
									<Spinner />
								</div>
							)}

							{!isInventoryLoading && !hasResponseProviders && (
								<Alert status="warning">
									<Alert.Indicator />
									<Alert.Content>
										<Alert.Description>
											{t("noInferenceProvidersForCodex")}
										</Alert.Description>
									</Alert.Content>
								</Alert>
							)}

							{!isInventoryLoading && hasResponseProviders && (
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
										setSelectedModel("");
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
											{responseProviders.map((item) => (
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
								hasResponseProviders &&
								selectedProvider &&
								modelOptions.length === 0 && (
									<Alert status="warning">
										<Alert.Indicator />
										<Alert.Content>
											<Alert.Description>
												{t("codexProviderNeedsModels")}
											</Alert.Description>
										</Alert.Content>
									</Alert>
								)}

							{!isInventoryLoading &&
								hasResponseProviders &&
								modelOptions.length > 0 && (
									<Select
										className="w-full"
										isRequired
										validationBehavior="aria"
										selectedKey={
											effectiveModel || undefined
										}
										isDisabled={isPending}
										onSelectionChange={(key) => {
											if (!key) return;
											setSelectedModel(String(key));
										}}
										variant="secondary"
									>
										<CodexPrimaryModelLabel />
										<Select.Trigger>
											<Select.Value />
											<Select.Indicator />
										</Select.Trigger>
										<Select.Popover>
											<ListBox>
												{modelOptions.map((model) => (
													<ListBox.Item
														key={model.id}
														id={model.id}
														textValue={
															model.name ??
															model.id
														}
													>
														<Label className="truncate">
															{model.name ??
																model.id}
														</Label>
													</ListBox.Item>
												))}
											</ListBox>
										</Select.Popover>
									</Select>
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
									!hasResponseProviders ||
									!effectiveSelectedProviderId ||
									!effectiveModel
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

function CodexModelSettingsDialog({
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
	onSave: (model: string) => void;
}) {
	const { t } = useTranslation();
	const modelOptions = provider
		? codexModelOptionsWithSelected(
				provider.models,
				isActive ? activeModel : undefined,
			)
		: [];
	const [selectedModel, setSelectedModel] = useState(() => {
		if (!provider) return "";
		return selectCodexModel(
			isActive ? activeModel : provider.models[0]?.id,
			modelOptions,
		);
	});

	const label =
		provider?.matched_inference_provider?.display_name ??
		provider?.name ??
		"";
	const heading = label
		? t("providerModelSettings", { name: label })
		: t("codexModelSettings");
	const effectiveModel = selectCodexModel(selectedModel, modelOptions);

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
										{t("codexProviderNeedsModels")}
									</Alert.Description>
								</Alert.Content>
							</Alert>
						) : (
							<Select
								className="w-full"
								isRequired
								validationBehavior="aria"
								selectedKey={effectiveModel || undefined}
								isDisabled={isPending}
								onSelectionChange={(key) => {
									if (!key) return;
									setSelectedModel(String(key));
								}}
								variant="secondary"
							>
								<CodexPrimaryModelLabel />
								<Select.Trigger>
									<Select.Value />
									<Select.Indicator />
								</Select.Trigger>
								<Select.Popover>
									<ListBox>
										{modelOptions.map((model) => (
											<ListBox.Item
												key={model.id}
												id={model.id}
												textValue={
													model.name ?? model.id
												}
											>
												<Label className="truncate">
													{model.name ?? model.id}
												</Label>
											</ListBox.Item>
										))}
									</ListBox>
								</Select.Popover>
							</Select>
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
								!effectiveModel || modelOptions.length === 0
							}
							onPress={() => onSave(effectiveModel)}
						>
							{t("save")}
						</Button>
					</Modal.Footer>
				</Modal.Dialog>
			</Modal.Container>
		</Modal.Backdrop>
	);
}

function CodexOfficialRow({
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
			title="OpenAI"
			titleExtras={
				isActive && (
					<ProviderActiveBadge
						icon={<CheckCircleIcon className="size-3.5" />}
					>
						{t("active")}
					</ProviderActiveBadge>
				)
			}
			description={t("codexLoginProviderInfo")}
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
									? t("codexProviderAlreadyActive")
									: t("enable")
							}
							onPress={onActivate}
						>
							<PlayIcon className="size-4" />
						</Button>
					</Tooltip.Trigger>
					<Tooltip.Content>
						{isActive
							? t("codexProviderAlreadyActive")
							: t("enable")}
					</Tooltip.Content>
				</Tooltip>
			}
		/>
	);
}

function CodexProviderRow({
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
	onSelect: (model?: string) => void;
	onEditModels: () => void;
	onSync: () => void;
	onDelete: () => void;
}) {
	const { t } = useTranslation();
	const matchedProvider = provider.matched_inference_provider;
	const label = matchedProvider?.display_name ?? provider.name;
	const isExternal = provider.source === "external";
	const modelOptions = codexModelOptionsWithSelected(
		provider.models,
		isActive ? activeModel : undefined,
	);
	const modelIds = new Set(modelOptions.map((model) => model.id));
	const selectedModel = selectCodexModel(
		isActive ? activeModel : provider.models[0]?.id,
		modelOptions,
	);
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
					: t("codexConfigProvider")
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
									aria-label={t("codexModelSettings")}
									isDisabled={!canSelect || isBusy}
									onPress={onEditModels}
								>
									<Cog6ToothIcon className="size-4" />
								</Button>
							</Tooltip.Trigger>
							<Tooltip.Content>
								{t("codexModelSettings")}
							</Tooltip.Content>
						</Tooltip>
					)}
					{matchedProvider && !isExternal && (
						<Tooltip delay={0}>
							<Tooltip.Trigger>
								<Button
									isIconOnly
									variant="ghost"
									size="sm"
									aria-label={t("syncCodexProvider")}
									isPending={isSyncing}
									onPress={onSync}
								>
									<ArrowPathIcon className="size-4" />
								</Button>
							</Tooltip.Trigger>
							<Tooltip.Content>
								{t("syncCodexProviderFromInferenceProvider", {
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
								aria-label={
									isExternal
										? t("codexProviderExternalTooltip")
										: t("deleteCodexProvider")
								}
								isPending={isDeleting}
								isDisabled={isExternal}
								onPress={onDelete}
							>
								<TrashIcon className="size-4" />
							</Button>
						</Tooltip.Trigger>
						<Tooltip.Content>
							{isExternal
								? t("codexProviderExternalTooltip")
								: t("delete")}
						</Tooltip.Content>
					</Tooltip>
					<Tooltip delay={0}>
						<Tooltip.Trigger>
							<Button
								isIconOnly
								variant="ghost"
								size="sm"
								isPending={isSelecting}
								isDisabled={
									isActive || !canSelect || !selectedModel
								}
								aria-label={
									isActive
										? t("codexProviderAlreadyActive")
										: t("enable")
								}
								onPress={() =>
									onSelect(
										selectedModel &&
											modelIds.has(selectedModel)
											? selectedModel
											: undefined,
									)
								}
							>
								<PlayIcon className="size-4" />
							</Button>
						</Tooltip.Trigger>
						<Tooltip.Content>
							{isActive
								? t("codexProviderAlreadyActive")
								: !canSelect
									? t("codexNoProfiles")
									: t("enable")}
						</Tooltip.Content>
					</Tooltip>
				</>
			}
			actionsClassName="flex-wrap gap-2"
		/>
	);
}

export function CodexInferenceProviderPanel(_: {
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
		data: codexState,
		isLoading,
		isFetching,
		refetch,
	} = useQuery({
		...codexProviderStateQueryOptions({ api }),
	});
	const { data: inventoryProviders = [], isLoading: isInventoryLoading } =
		useQuery({
			...inferenceProviderListQueryOptions({ api }),
		});

	const activeProfile =
		codexState?.profiles.find((profile) => profile.is_active) ??
		codexState?.profiles[0];
	const activeProviderId = activeProfile?.selected_provider_id ?? "openai";
	const isOfficialActive = activeProviderId === "openai";
	const customProviders = (codexState?.providers ?? []).filter(
		(provider) => provider.id !== "openai",
	);
	const isModelSettingsActive = modelSettingsTarget
		? activeProviderId === modelSettingsTarget.id
		: false;

	const handleShowFolder = async () => {
		try {
			const home = await homeDir();
			const configPath = await join(home, ".codex", "config.toml");
			await revealItemInDir(configPath);
		} catch (error) {
			console.error("Failed to reveal codex config folder:", error);
			toast.danger(
				error instanceof Error
					? error.message
					: t("showConfigFolderFailed"),
			);
		}
	};

	const clearMutation = useMutation({
		...clearCodexProviderMutationOptions({
			api,
			queryClient,
			onSuccess: async () => {
				toast.success(t("codexProviderCleared"));
			},
		}),
		onError: (error) => {
			console.error("Failed to clear Codex provider:", error);
			toast.danger(
				error instanceof Error
					? error.message
					: t("codexProviderClearError"),
			);
		},
	});
	const selectProviderMutation = useMutation({
		...updateCodexProfileProviderMutationOptions({
			api,
			queryClient,
			onSuccess: async () => {
				toast.success(t("codexProviderUpdated"));
			},
		}),
		onError: (error) => {
			console.error("Failed to switch Codex provider:", error);
			toast.danger(
				error instanceof Error
					? error.message
					: t("codexProfileProviderUpdateError"),
			);
		},
	});
	const deleteMutation = useMutation({
		...deleteCodexProviderMutationOptions({
			api,
			queryClient,
			onSuccess: async () => {
				setDeleteTarget(null);
				toast.success(t("codexProviderDeleted"));
			},
		}),
		onError: (error) => {
			console.error("Failed to delete Codex provider:", error);
			toast.danger(
				error instanceof Error
					? error.message
					: t("codexProviderDeleteError"),
			);
		},
	});
	const syncMutation = useMutation({
		...syncCodexProviderMutationOptions({
			api,
			queryClient,
			onSuccess: async () => {
				toast.success(t("codexProviderSynced"));
			},
		}),
		onError: (error) => {
			console.error("Failed to sync Codex provider:", error);
			toast.danger(
				error instanceof Error
					? error.message
					: t("codexProviderSyncError"),
			);
		},
	});

	return (
		<>
			<div className="h-full overflow-y-auto">
				<div className="w-full p-4 sm:p-6">
					<Card>
						<Card.Header className="flex flex-row items-start justify-between gap-3">
							<div className="flex min-w-0 items-center gap-3">
								<AgentIcon
									id="codex"
									name="Codex"
									size="xs"
									variant="ghost"
								/>
								<div className="min-w-0">
									<h2 className="truncate text-xl font-semibold text-foreground">
										Codex
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
												"refreshCodexProviders",
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
									aria-label={t("createCodexProvider")}
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
									<CodexOfficialRow
										isActive={isOfficialActive}
										isPending={clearMutation.isPending}
										onActivate={() =>
											clearMutation.mutate()
										}
									/>
									{customProviders.map((provider) => (
										<CodexProviderRow
											key={provider.id}
											provider={provider}
											isActive={
												activeProviderId === provider.id
											}
											activeModel={activeProfile?.model}
											isSyncing={
												syncMutation.isPending &&
												syncMutation.variables ===
													provider.id
											}
											isSelecting={
												selectProviderMutation.isPending &&
												selectProviderMutation.variables
													?.body.provider_id ===
													provider.id
											}
											isDeleting={
												deleteMutation.isPending &&
												deleteTarget?.id === provider.id
											}
											canSelect={Boolean(activeProfile)}
											onSelect={(model) => {
												if (!activeProfile) return;
												selectProviderMutation.mutate({
													profileId: activeProfile.id,
													body: {
														provider_id:
															provider.id,
														...(model
															? { model }
															: {}),
													},
												});
											}}
											onEditModels={() =>
												setModelSettingsTarget(provider)
											}
											onSync={() =>
												syncMutation.mutate(provider.id)
											}
											onDelete={() =>
												setDeleteTarget(provider)
											}
										/>
									))}
								</div>
							)}
						</Card.Content>
					</Card>
				</div>
			</div>

			<CodexCreateProviderDialog
				isOpen={isAddDialogOpen}
				inventoryProviders={inventoryProviders}
				isInventoryLoading={isInventoryLoading}
				onClose={() => setIsAddDialogOpen(false)}
			/>

			<CodexModelSettingsDialog
				key={
					modelSettingsTarget
						? `model-settings:provider:${modelSettingsTarget.id}`
						: "model-settings:closed"
				}
				provider={modelSettingsTarget}
				isOpen={Boolean(modelSettingsTarget)}
				activeModel={activeProfile?.model}
				isActive={isModelSettingsActive}
				isPending={
					selectProviderMutation.isPending &&
					selectProviderMutation.variables?.body.provider_id ===
						modelSettingsTarget?.id
				}
				onClose={() => setModelSettingsTarget(null)}
				onSave={(model) => {
					if (!activeProfile || !modelSettingsTarget) return;
					selectProviderMutation.mutate(
						{
							profileId: activeProfile.id,
							body: {
								provider_id: modelSettingsTarget.id,
								model,
							},
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
								{t("deleteCodexProvider")}
							</AlertDialog.Heading>
						</AlertDialog.Header>
						<AlertDialog.Body>
							{t("deleteCodexProviderConfirm", {
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
