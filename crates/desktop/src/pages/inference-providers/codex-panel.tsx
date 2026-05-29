import {
	ArrowPathIcon,
	CheckCircleIcon,
	FolderOpenIcon,
	PlayIcon,
	PlusIcon,
	ServerIcon,
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
	const effectiveSelectedProviderId = selectValidProviderId(
		selectedProviderId,
		responseProviders,
		defaultProviderId,
	);

	const createMutation = useMutation({
		...createCodexProviderMutationOptions({
			api,
			queryClient,
			onSuccess: async () => {
				toast.success(t("codexProviderUpdated"));
				onClose();
			},
		}),
	});

	const activeError = createMutation.error;
	const isPending = createMutation.isPending;
	const hasResponseProviders = responseProviders.length > 0;

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
		<div className="grid gap-3 border-t border-border py-3 first:border-t-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
			<div className="grid min-w-0 gap-1">
				<div className="flex min-w-0 items-center gap-2">
					<ServerIcon className="size-4 shrink-0 text-muted" />
					<Label className="truncate">OpenAI</Label>
					{isActive && (
						<span className="inline-flex items-center gap-1 rounded-md bg-accent/10 px-2 py-0.5 text-xs text-accent">
							<CheckCircleIcon className="size-3.5" />
							{t("active")}
						</span>
					)}
				</div>
				<span className="text-xs text-muted">
					{t("codexLoginProviderInfo")}
				</span>
			</div>

			<div className="flex items-center gap-1 sm:justify-end">
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
			</div>
		</div>
	);
}

function CodexProviderRow({
	provider,
	isActive,
	isSyncing,
	isSelecting,
	isDeleting,
	canSelect,
	onSelect,
	onSync,
	onDelete,
}: {
	provider: AgentProviderResponse;
	isActive: boolean;
	isSyncing: boolean;
	isSelecting: boolean;
	isDeleting: boolean;
	canSelect: boolean;
	onSelect: () => void;
	onSync: () => void;
	onDelete: () => void;
}) {
	const { t } = useTranslation();
	const matchedProvider = provider.matched_inference_provider;
	const label = matchedProvider?.display_name ?? provider.name;
	const isExternal = provider.source === "external";

	return (
		<div className="grid gap-3 border-t border-border py-3 first:border-t-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
			<div className="grid min-w-0 gap-1">
				<div className="flex min-w-0 items-center gap-2">
					<ServerIcon className="size-4 shrink-0 text-muted" />
					<Label className="truncate">{label}</Label>
					{isActive && (
						<span className="inline-flex items-center gap-1 rounded-md bg-accent/10 px-2 py-0.5 text-xs text-accent">
							<CheckCircleIcon className="size-3.5" />
							{t("active")}
						</span>
					)}
				</div>
				<div className="flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
					<span>
						{matchedProvider
							? t("agentProviderModelCount", {
									count: matchedProvider.model_count,
								})
							: t("codexConfigProvider")}
					</span>
				</div>
			</div>

			<div className="flex items-center gap-1 sm:justify-end">
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
							isDisabled={isActive || !canSelect}
							aria-label={
								isActive
									? t("codexProviderAlreadyActive")
									: t("enable")
							}
							onPress={onSelect}
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
			</div>
		</div>
	);
}

export function CodexInferenceProviderPanel(_: {
	onEditInferenceProvider: (providerName: string) => void;
}) {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();
	const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
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
											onSelect={() => {
												if (!activeProfile) return;
												selectProviderMutation.mutate({
													profileId: activeProfile.id,
													body: {
														provider_id:
															provider.id,
													},
												});
											}}
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
