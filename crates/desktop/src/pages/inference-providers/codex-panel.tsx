import {
	ArrowPathIcon,
	CheckCircleIcon,
	KeyIcon,
	PencilIcon,
	PlusIcon,
	QuestionMarkCircleIcon,
	ServerIcon,
	TrashIcon,
} from "@heroicons/react/24/solid";
import {
	Alert,
	AlertDialog,
	Button,
	Card,
	FieldError,
	Input,
	Label,
	ListBox,
	Modal,
	Select,
	Spinner,
	TextField,
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
} from "../../generated/dto";
import { useApi } from "../../hooks/use-api";
import { AgentIcon } from "../../lib/agent-icons";
import { cn } from "../../lib/utils";
import {
	codexProviderStateQueryOptions,
	createCodexProviderMutationOptions,
	deleteCodexProviderMutationOptions,
	inferenceProviderListQueryOptions,
	syncCodexProviderMutationOptions,
	updateCodexActiveProfileMutationOptions,
	updateCodexProfileProviderMutationOptions,
	updateCodexProviderMutationOptions,
} from "../../requests/inference-providers";

type ProviderDialogMode =
	| { type: "create" }
	| { type: "edit"; provider: AgentProviderResponse };

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

	const responseProviders = useMemo(
		() =>
			inventoryProviders.filter(
				(provider) => provider.format === "openai_responses",
			),
		[inventoryProviders],
	);
	const defaultProviderId = responseProviders[0]?.id ?? "";
	useEffect(() => {
		if (!isOpen) return;
		setSelectedProviderId((current) => current || defaultProviderId);
	}, [defaultProviderId, isOpen]);

	const createMutation = useMutation({
		...createCodexProviderMutationOptions({
			api,
			queryClient,
			onSuccess: async () => {
				toast.success(t("codexProviderCreated"));
				onClose();
			},
		}),
	});

	const activeError = createMutation.error;
	const isPending = createMutation.isPending;
	const hasResponseProviders = responseProviders.length > 0;

	const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!selectedProviderId) return;

		createMutation.mutate({
			inference_provider_id: selectedProviderId,
		});
	};

	return (
		<Modal.Backdrop
			isOpen={isOpen}
			onOpenChange={(open) => {
				if (!open) onClose();
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
									selectedKey={
										selectedProviderId || undefined
									}
									onSelectionChange={(key) => {
										if (!key) return;
										setSelectedProviderId(String(key));
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
													textValue={`${item.display_name} ${item.name}`}
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
						</Modal.Body>
						<Modal.Footer>
							<Button
								type="button"
								variant="tertiary"
								onPress={onClose}
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
									!selectedProviderId
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

function CodexEditProviderDialog({
	isOpen,
	provider,
	onClose,
}: {
	isOpen: boolean;
	provider: AgentProviderResponse;
	onClose: () => void;
}) {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();
	const [name, setName] = useState(provider.name);
	const [apiKey, setApiKey] = useState("");
	const [nameError, setNameError] = useState<string | null>(null);

	useEffect(() => {
		if (!isOpen) return;
		setName(provider.name);
		setApiKey("");
		setNameError(null);
	}, [isOpen, provider.id, provider.name]);

	const updateMutation = useMutation({
		...updateCodexProviderMutationOptions({
			api,
			queryClient,
			onSuccess: async () => {
				toast.success(t("codexProviderUpdated"));
				onClose();
			},
		}),
	});

	const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const trimmedName = name.trim();
		if (!trimmedName) {
			setNameError(t("validationProviderNameRequired"));
			return;
		}

		const trimmedApiKey = apiKey.trim();
		updateMutation.mutate({
			id: provider.id,
			body: {
				name: trimmedName === provider.name ? null : trimmedName,
				api_key: trimmedApiKey ? trimmedApiKey : null,
			},
		});
	};

	return (
		<Modal.Backdrop
			isOpen={isOpen}
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<Modal.Container>
				<Modal.Dialog className="sm:max-w-[440px]">
					<Modal.CloseTrigger />
					<Modal.Header>
						<Modal.Heading>{t("editCodexProvider")}</Modal.Heading>
					</Modal.Header>
					<form onSubmit={handleSubmit}>
						<Modal.Body className="grid gap-4 p-4">
							{updateMutation.error && (
								<Alert status="danger">
									<Alert.Indicator />
									<Alert.Content>
										<Alert.Description>
											{updateMutation.error instanceof
											Error
												? updateMutation.error.message
												: String(updateMutation.error)}
										</Alert.Description>
									</Alert.Content>
								</Alert>
							)}

							<TextField
								className="w-full"
								isRequired
								validationBehavior="aria"
								isInvalid={Boolean(nameError)}
							>
								<Label>{t("providerName")}</Label>
								<Input
									value={name}
									onChange={(event) => {
										setName(event.target.value);
										if (nameError) setNameError(null);
									}}
									placeholder={t("providerNamePlaceholder")}
									variant="secondary"
								/>
								{nameError && (
									<FieldError>{nameError}</FieldError>
								)}
							</TextField>

							<TextField className="w-full">
								<Label>{t("providerApiKey")}</Label>
								<Input
									type="password"
									value={apiKey}
									onChange={(event) =>
										setApiKey(event.target.value)
									}
									placeholder={t(
										"providerApiKeyEditPlaceholder",
									)}
									variant="secondary"
								/>
							</TextField>
						</Modal.Body>
						<Modal.Footer>
							<Button
								type="button"
								variant="tertiary"
								onPress={onClose}
								isDisabled={updateMutation.isPending}
							>
								{t("cancel")}
							</Button>
							<Button
								type="submit"
								isPending={updateMutation.isPending}
							>
								{t("save")}
							</Button>
						</Modal.Footer>
					</form>
				</Modal.Dialog>
			</Modal.Container>
		</Modal.Backdrop>
	);
}

function ProviderIdentity({
	provider,
	fallbackId,
	isActive,
}: {
	provider: AgentProviderResponse | undefined;
	fallbackId: string;
	isActive?: boolean;
}) {
	const { t } = useTranslation();
	const isLoginProvider = provider?.source === "built_in";
	const label = provider?.name ?? fallbackId;

	return (
		<div className="flex min-w-0 items-center gap-2">
			{isLoginProvider ? (
				<KeyIcon className="size-4 shrink-0 text-accent" />
			) : (
				<ServerIcon className="size-4 shrink-0 text-muted" />
			)}
			<Label className="truncate">{label}</Label>
			{provider && provider.id !== provider.name && (
				<span className="rounded-md bg-surface-secondary px-2 py-0.5 text-xs text-muted">
					{provider.id}
				</span>
			)}
			{isActive && (
				<span className="inline-flex items-center gap-1 rounded-md bg-accent/10 px-2 py-0.5 text-xs text-accent">
					<CheckCircleIcon className="size-3.5" />
					{t("codexActiveProvider")}
				</span>
			)}
		</div>
	);
}

function ProviderMeta({ provider }: { provider: AgentProviderResponse }) {
	const { t } = useTranslation();
	const matchedProvider = provider.matched_inference_provider;

	if (provider.source === "built_in") {
		return (
			<span className="inline-flex items-center gap-1 text-xs text-muted">
				{t("codexLoginProvider")}
				<Tooltip delay={0}>
					<Tooltip.Trigger>
						<span
							tabIndex={0}
							aria-label={t("codexLoginProviderInfo")}
							className="inline-flex size-4 items-center justify-center"
						>
							<QuestionMarkCircleIcon className="size-4" />
						</span>
					</Tooltip.Trigger>
					<Tooltip.Content className="max-w-64">
						{t("codexLoginProviderInfo")}
					</Tooltip.Content>
				</Tooltip>
			</span>
		);
	}

	if (matchedProvider) {
		return (
			<span className="text-xs text-muted">
				{t("providerModels")}: {matchedProvider.model_count}
			</span>
		);
	}

	return (
		<span className="inline-flex items-center gap-1 text-xs text-muted">
			{t("codexConfigProvider")}
			<Tooltip delay={0}>
				<Tooltip.Trigger>
					<span
						tabIndex={0}
						aria-label={t("codexConfigProviderInfo")}
						className="inline-flex size-4 items-center justify-center"
					>
						<QuestionMarkCircleIcon className="size-4" />
					</span>
				</Tooltip.Trigger>
				<Tooltip.Content className="max-w-64">
					{t("codexConfigProviderInfo")}
				</Tooltip.Content>
			</Tooltip>
		</span>
	);
}

function ProviderActions({
	provider,
	isActive,
	isSyncing,
	isSelecting,
	canSelect,
	onSelectForProfile,
	onEdit,
	onSync,
	onDelete,
}: {
	provider: AgentProviderResponse;
	isActive: boolean;
	isSyncing: boolean;
	isSelecting: boolean;
	canSelect: boolean;
	onSelectForProfile: () => void;
	onEdit: () => void;
	onSync: () => void;
	onDelete: () => void;
}) {
	const { t } = useTranslation();
	const matchedProvider = provider.matched_inference_provider;
	const isBuiltIn = provider.source === "built_in";

	return (
		<div className="flex items-center gap-1 sm:justify-end">
			{canSelect && !isActive && (
				<Button
					size="sm"
					variant="ghost"
					isPending={isSelecting}
					onPress={onSelectForProfile}
				>
					{t("codexUseForActiveProfile")}
				</Button>
			)}
			{matchedProvider && (
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
			{!isBuiltIn && (
				<>
					<Tooltip delay={0}>
						<Tooltip.Trigger>
							<Button
								isIconOnly
								variant="ghost"
								size="sm"
								aria-label={t(
									matchedProvider
										? "editInferenceProvider"
										: "editCodexProvider",
								)}
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
								className="text-muted hover:text-danger"
								aria-label={t("deleteCodexProvider")}
								onPress={onDelete}
							>
								<TrashIcon className="size-4" />
							</Button>
						</Tooltip.Trigger>
						<Tooltip.Content>{t("delete")}</Tooltip.Content>
					</Tooltip>
				</>
			)}
		</div>
	);
}

function ProviderRow({
	provider,
	isActive,
	isSyncing,
	isSelecting,
	canSelect,
	onSelectForProfile,
	onEdit,
	onSync,
	onDelete,
}: {
	provider: AgentProviderResponse;
	isActive: boolean;
	isSyncing: boolean;
	isSelecting: boolean;
	canSelect: boolean;
	onSelectForProfile: () => void;
	onEdit: () => void;
	onSync: () => void;
	onDelete: () => void;
}) {
	return (
		<div className="grid gap-3 border-t border-border py-3 first:border-t-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
			<div className="grid min-w-0 gap-1">
				<ProviderIdentity
					provider={provider}
					fallbackId={provider.id}
					isActive={isActive}
				/>
				<div className="flex min-w-0 flex-wrap gap-x-3 gap-y-1">
					<ProviderMeta provider={provider} />
					{provider.api_base_url && (
						<span className="truncate text-xs text-muted">
							{provider.api_base_url}
						</span>
					)}
				</div>
			</div>

			<ProviderActions
				provider={provider}
				isActive={isActive}
				isSyncing={isSyncing}
				isSelecting={isSelecting}
				canSelect={canSelect}
				onSelectForProfile={onSelectForProfile}
				onEdit={onEdit}
				onSync={onSync}
				onDelete={onDelete}
			/>
		</div>
	);
}

export function CodexInferenceProviderPanel({
	onEditInferenceProvider,
}: {
	onEditInferenceProvider: (providerName: string) => void;
}) {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();
	const [providerDialog, setProviderDialog] =
		useState<ProviderDialogMode | null>(null);
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

	const providers = codexState?.providers ?? [];
	const profiles = codexState?.profiles ?? [];
	const activeProfile =
		profiles.find((profile) => profile.is_active) ?? profiles[0];

	const profileMutation = useMutation({
		...updateCodexActiveProfileMutationOptions({
			api,
			queryClient,
		}),
		onError: (error) => {
			console.error("Failed to update Codex profile:", error);
			toast.danger(
				error instanceof Error
					? error.message
					: t("codexProfileUpdateError"),
			);
		},
	});
	const profileProviderMutation = useMutation({
		...updateCodexProfileProviderMutationOptions({
			api,
			queryClient,
			onSuccess: async () => {
				toast.success(t("codexProfileProviderUpdated"));
			},
		}),
		onError: (error) => {
			console.error("Failed to update Codex profile provider:", error);
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

	const handleEditProvider = (provider: AgentProviderResponse) => {
		const matchedProvider = provider.matched_inference_provider;
		if (matchedProvider) {
			onEditInferenceProvider(matchedProvider.name);
			return;
		}

		setProviderDialog({ type: "edit", provider });
	};

	const handleProfileProviderChange = (providerId: string) => {
		if (!activeProfile) return;
		profileProviderMutation.mutate({
			profileId: activeProfile.id,
			body: { provider_id: providerId },
		});
	};

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
								<Select
									className="w-44"
									selectedKey={activeProfile?.id}
									onSelectionChange={(key) => {
										if (!key) return;
										profileMutation.mutate({
											profile_id: String(key),
										});
									}}
									isDisabled={
										isLoading ||
										profileMutation.isPending ||
										profiles.length === 0
									}
									variant="secondary"
								>
									<Label className="sr-only">
										{t("codexActiveProfile")}
									</Label>
									<Select.Trigger>
										<Select.Value />
										<Select.Indicator />
									</Select.Trigger>
									<Select.Popover>
										<ListBox>
											{profiles.map((profile) => (
												<ListBox.Item
													key={profile.id}
													id={profile.id}
													textValue={profile.name}
												>
													<div className="grid min-w-0 gap-0.5">
														<Label className="truncate">
															{profile.name}
														</Label>
														<span className="truncate text-xs text-muted">
															{
																profile.selected_provider_id
															}
														</span>
													</div>
												</ListBox.Item>
											))}
										</ListBox>
									</Select.Popover>
								</Select>
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
									onPress={() =>
										setProviderDialog({ type: "create" })
									}
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
								<>
									{providers.length === 0 ? (
										<div className="grid justify-items-center gap-3 py-8 text-center">
											<p className="text-sm text-muted">
												{t("noCodexProviders")}
											</p>
											<Button
												size="sm"
												aria-label={t(
													"createCodexProvider",
												)}
												onPress={() =>
													setProviderDialog({
														type: "create",
													})
												}
											>
												<PlusIcon className="size-4" />
												{t("add")}
											</Button>
										</div>
									) : (
										<div>
											{providers.map((provider) => {
												const isActive =
													activeProfile?.selected_provider_id ===
													provider.id;
												return (
													<ProviderRow
														key={provider.id}
														provider={provider}
														isActive={isActive}
														isSyncing={
															syncMutation.isPending &&
															syncMutation.variables ===
																provider.id
														}
														isSelecting={
															profileProviderMutation.isPending &&
															profileProviderMutation
																.variables?.body
																.provider_id ===
																provider.id
														}
														canSelect={Boolean(
															activeProfile,
														)}
														onSelectForProfile={() =>
															handleProfileProviderChange(
																provider.id,
															)
														}
														onEdit={() =>
															handleEditProvider(
																provider,
															)
														}
														onSync={() =>
															syncMutation.mutate(
																provider.id,
															)
														}
														onDelete={() =>
															setDeleteTarget(
																provider,
															)
														}
													/>
												);
											})}
										</div>
									)}
								</>
							)}
						</Card.Content>
					</Card>
				</div>
			</div>

			<CodexCreateProviderDialog
				isOpen={providerDialog?.type === "create"}
				inventoryProviders={inventoryProviders}
				isInventoryLoading={isInventoryLoading}
				onClose={() => setProviderDialog(null)}
			/>
			{providerDialog?.type === "edit" && (
				<CodexEditProviderDialog
					isOpen
					provider={providerDialog.provider}
					onClose={() => setProviderDialog(null)}
				/>
			)}

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
									if (deleteTarget) {
										deleteMutation.mutate(deleteTarget.id);
									}
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
