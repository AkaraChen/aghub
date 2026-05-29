import {
	ArrowPathIcon,
	FolderOpenIcon,
	PencilIcon,
	PlusIcon,
	TrashIcon,
} from "@heroicons/react/24/solid";
import { homeDir, join } from "@tauri-apps/api/path";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
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
import { useState } from "react";
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
	createOpenCodeProviderMutationOptions,
	deleteOpenCodeProviderMutationOptions,
	inferenceProviderListQueryOptions,
	openCodeProviderListQueryOptions,
	syncOpenCodeProviderMutationOptions,
	updateOpenCodeProviderMutationOptions,
} from "../../requests/inference-providers";
import { selectValidProviderId } from "./provider-selection";
import { ProviderRowShell } from "./provider-row";

type ProviderDialogMode =
	| { type: "create" }
	| { type: "edit"; provider: AgentProviderResponse };

function OpenCodeCreateProviderDialog({
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

	const defaultProviderId = inventoryProviders[0]?.id ?? "";
	const effectiveSelectedProviderId = selectValidProviderId(
		selectedProviderId,
		inventoryProviders,
		defaultProviderId,
	);

	const createMutation = useMutation({
		...createOpenCodeProviderMutationOptions({
			api,
			queryClient,
			onSuccess: async () => {
				toast.success(t("openCodeProviderCreated"));
				onClose();
			},
		}),
	});

	const activeError = createMutation.error;
	const isPending = createMutation.isPending;
	const hasInventoryProviders = inventoryProviders.length > 0;

	const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!effectiveSelectedProviderId) return;

		createMutation.mutate({
			inference_provider_id: effectiveSelectedProviderId,
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
							{t("createOpenCodeProvider")}
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

							{!isInventoryLoading && !hasInventoryProviders && (
								<Alert status="warning">
									<Alert.Indicator />
									<Alert.Content>
										<Alert.Description>
											{t(
												"noInferenceProvidersForOpenCode",
											)}
										</Alert.Description>
									</Alert.Content>
								</Alert>
							)}

							{!isInventoryLoading && hasInventoryProviders && (
								<Select
									className="w-full"
									selectedKey={
										effectiveSelectedProviderId || undefined
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
											{inventoryProviders.map((item) => (
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
									!hasInventoryProviders ||
									!effectiveSelectedProviderId
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

function OpenCodeEditProviderDialog({
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

	const updateMutation = useMutation({
		...updateOpenCodeProviderMutationOptions({
			api,
			queryClient,
			onSuccess: async () => {
				toast.success(t("openCodeProviderUpdated"));
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
				api_key: trimmedApiKey || null,
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
						<Modal.Heading>
							{t("editOpenCodeProvider")}
						</Modal.Heading>
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

function ProviderRow({
	provider,
	isSyncing,
	onEdit,
	onSync,
	onDelete,
}: {
	provider: AgentProviderResponse;
	isSyncing: boolean;
	onEdit: () => void;
	onSync: () => void;
	onDelete: () => void;
}) {
	const { t } = useTranslation();
	const matchedProvider = provider.matched_inference_provider;

	return (
		<ProviderRowShell
			title={provider.name}
			titleExtras={
				provider.id !== provider.name && (
					<span className="rounded-md bg-surface-secondary px-2 py-0.5 text-xs text-muted">
						{provider.id}
					</span>
				)
			}
			description={
				matchedProvider
					? t("agentProviderModelCount", {
							count: matchedProvider.model_count,
						})
					: t("openCodeBuiltInProvider")
			}
			descriptionTooltip={
				matchedProvider ? undefined : t("openCodeBuiltInProviderInfo")
			}
			actionsClassName="gap-2"
			actions={
				<>
					{matchedProvider && (
						<Tooltip delay={0}>
							<Tooltip.Trigger>
								<Button
									isIconOnly
									variant="ghost"
									size="sm"
									aria-label={t("syncOpenCodeProvider")}
									isPending={isSyncing}
									onPress={onSync}
								>
									<ArrowPathIcon className="size-4" />
								</Button>
							</Tooltip.Trigger>
							<Tooltip.Content>
								{t(
									"syncOpenCodeProviderFromInferenceProvider",
									{
										name: matchedProvider.display_name,
									},
								)}
							</Tooltip.Content>
						</Tooltip>
					)}
					<Tooltip delay={0}>
						<Tooltip.Trigger>
							<Button
								isIconOnly
								variant="ghost"
								size="sm"
								aria-label={t(
									matchedProvider
										? "editInferenceProvider"
										: "editOpenCodeProvider",
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
								aria-label={t("deleteOpenCodeProvider")}
								onPress={onDelete}
							>
								<TrashIcon className="size-4" />
							</Button>
						</Tooltip.Trigger>
						<Tooltip.Content>{t("delete")}</Tooltip.Content>
					</Tooltip>
				</>
			}
		/>
	);
}

export function OpenCodeInferenceProviderPanel({
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
		data: providers = [],
		isLoading,
		isFetching,
		refetch,
	} = useQuery({
		...openCodeProviderListQueryOptions({ api }),
	});
	const { data: inventoryProviders = [], isLoading: isInventoryLoading } =
		useQuery({
			...inferenceProviderListQueryOptions({ api }),
		});

	const deleteMutation = useMutation({
		...deleteOpenCodeProviderMutationOptions({
			api,
			queryClient,
			onSuccess: async () => {
				setDeleteTarget(null);
				toast.success(t("openCodeProviderDeleted"));
			},
		}),
		onError: (error) => {
			console.error("Failed to delete OpenCode provider:", error);
			toast.danger(
				error instanceof Error
					? error.message
					: t("openCodeProviderDeleteError"),
			);
		},
	});
	const syncMutation = useMutation({
		...syncOpenCodeProviderMutationOptions({
			api,
			queryClient,
			onSuccess: async () => {
				toast.success(t("openCodeProviderSynced"));
			},
		}),
		onError: (error) => {
			console.error("Failed to sync OpenCode provider:", error);
			toast.danger(
				error instanceof Error
					? error.message
					: t("openCodeProviderSyncError"),
			);
		},
	});

	const handleEditProvider = (provider: AgentProviderResponse) => {
		const matchedProvider = provider.matched_inference_provider;
		if (matchedProvider) {
			onEditInferenceProvider(matchedProvider.latin_name);
			return;
		}

		setProviderDialog({ type: "edit", provider });
	};

	const handleShowFolder = async () => {
		try {
			const home = await homeDir();
			const configPath = await join(
				home,
				".config",
				"opencode",
				"opencode.json",
			);
			await revealItemInDir(configPath);
		} catch (error) {
			console.error("Failed to reveal OpenCode config folder:", error);
			toast.danger(
				error instanceof Error
					? error.message
					: t("showConfigFolderFailed"),
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
								<AgentIcon
									id="opencode"
									name="OpenCode"
									size="xs"
									variant="ghost"
								/>
								<div className="min-w-0">
									<h2 className="truncate text-xl font-semibold text-foreground">
										OpenCode
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
												"refreshOpenCodeProviders",
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
									aria-label={t("createOpenCodeProvider")}
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
												{t("noOpenCodeProviders")}
											</p>
											<Button
												size="sm"
												aria-label={t(
													"createOpenCodeProvider",
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
											{providers.map((provider) => (
												<ProviderRow
													key={provider.id}
													provider={provider}
													isSyncing={
														syncMutation.isPending &&
														syncMutation.variables ===
															provider.id
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
											))}
										</div>
									)}
								</>
							)}
						</Card.Content>
					</Card>
				</div>
			</div>

			<OpenCodeCreateProviderDialog
				isOpen={providerDialog?.type === "create"}
				inventoryProviders={inventoryProviders}
				isInventoryLoading={isInventoryLoading}
				onClose={() => setProviderDialog(null)}
			/>
			{providerDialog?.type === "edit" && (
				<OpenCodeEditProviderDialog
					key={providerDialog.provider.id}
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
								{t("deleteOpenCodeProvider")}
							</AlertDialog.Heading>
						</AlertDialog.Header>
						<AlertDialog.Body>
							{t("deleteOpenCodeProviderConfirm", {
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
