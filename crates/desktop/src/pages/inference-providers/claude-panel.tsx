import {
	ArrowPathIcon,
	CheckCircleIcon,
	PlayIcon,
	PlusIcon,
	ServerIcon,
	TrashIcon,
} from "@heroicons/react/24/solid";
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

	const createMutation = useMutation({
		...createClaudeProviderMutationOptions({
			api,
			queryClient,
			onSuccess: async () => {
				toast.success(t("claudeProviderUpdated"));
				onClose();
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
											{anthropicProviders.map((item) => (
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
									!hasAnthropicProviders ||
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
		<div className="grid gap-3 border-t border-border py-3 first:border-t-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
			<div className="grid min-w-0 gap-1">
				<div className="flex min-w-0 items-center gap-2">
					<ServerIcon className="size-4 shrink-0 text-muted" />
					<Label className="truncate">{t("claudeOfficial")}</Label>
					{isActive && (
						<span className="inline-flex items-center gap-1 rounded-md bg-accent/10 px-2 py-0.5 text-xs text-accent">
							<CheckCircleIcon className="size-3.5" />
							{t("active")}
						</span>
					)}
				</div>
				<span className="text-xs text-muted">
					{t("claudeOfficialDescription")}
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
			</div>
		</div>
	);
}

function ClaudeProviderRow({
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
	const model = provider.models[0]?.id ?? null;

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
							? `${t("providerModels")}: ${
									matchedProvider.model_count
								}`
							: t("claudeConfigProvider")}
					</span>
					{provider.api_base_url && (
						<span className="truncate">
							{provider.api_base_url}
						</span>
					)}
					{model && <span>{model}</span>}
				</div>
			</div>

			<div className="flex items-center gap-1 sm:justify-end">
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
							isDisabled={isActive || !canSelect}
							aria-label={
								isActive
									? t("claudeProviderAlreadyActive")
									: t("enable")
							}
							onPress={onSelect}
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
			</div>
		</div>
	);
}

export function ClaudeInferenceProviderPanel(_: {
	onEditInferenceProvider: (providerName: string) => void;
}) {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();
	const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
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
											aria-label={t(
												"refreshClaudeProviders",
											)}
											onPress={() => refetch()}
											isPending={isFetching}
										>
											{isFetching ? (
												<Spinner size="sm" />
											) : (
												<ArrowPathIcon className="size-4" />
											)}
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
												onSelect={() => {
													updateMutation.mutate({
														id: provider.id,
														body: {
															name: null,
															api_key: null,
														},
													});
												}}
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
