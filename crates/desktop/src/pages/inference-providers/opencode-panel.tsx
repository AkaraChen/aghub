import {
	ArrowPathIcon,
	PencilIcon,
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
	AgentProviderSourceDto,
	InferenceProviderFormatDto,
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
	updateOpenCodeProviderMutationOptions,
} from "../../requests/inference-providers";

type PanelMode =
	| { type: "list" }
	| { type: "create" }
	| { type: "edit"; provider: AgentProviderResponse };

function formatLabelKey(format: InferenceProviderFormatDto | null) {
	switch (format) {
		case "anthropic":
			return "inferenceFormatAnthropic";
		case "openai_completions":
			return "inferenceFormatOpenAiCompletions";
		case "openai_responses":
			return "inferenceFormatOpenAiResponses";
		default:
			return "unknown";
	}
}

function sourceLabelKey(source: AgentProviderSourceDto) {
	switch (source) {
		case "built_in":
			return "agentProviderSourceBuiltIn";
		case "closed_slot":
			return "agentProviderSourceClosedSlot";
		case "custom":
			return "agentProviderSourceCustom";
		case "stored_credential":
			return "agentProviderSourceStoredCredential";
	}
}

function credentialLabel(provider: AgentProviderResponse) {
	switch (provider.credential.type) {
		case "agent_store":
			return "agentProviderCredentialAgentStore";
		case "env_var":
			return provider.credential.name;
		case "inline":
			return "agentProviderCredentialInline";
		case "none":
			return "agentProviderCredentialNone";
	}
}

function findInventoryProviderId(
	provider: AgentProviderResponse | undefined,
	inventoryProviders: InferenceProviderResponse[],
) {
	if (!provider) return inventoryProviders[0]?.id ?? "";
	if (
		provider.source_provider_id &&
		inventoryProviders.some(
			(item) => item.id === provider.source_provider_id,
		)
	) {
		return provider.source_provider_id;
	}

	return (
		inventoryProviders.find(
			(item) =>
				item.name === provider.name &&
				item.api_base_url === provider.api_base_url &&
				item.format === provider.format,
		)?.id ??
		inventoryProviders.find((item) => item.name === provider.name)?.id ??
		inventoryProviders[0]?.id ??
		""
	);
}

function OpenCodeProviderForm({
	mode,
	provider,
	inventoryProviders,
	onCancel,
	onSaved,
}: {
	mode: "create" | "edit";
	provider?: AgentProviderResponse;
	inventoryProviders: InferenceProviderResponse[];
	onCancel: () => void;
	onSaved: () => void;
}) {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();
	const [selectedProviderId, setSelectedProviderId] = useState(() =>
		findInventoryProviderId(provider, inventoryProviders),
	);

	const createMutation = useMutation({
		...createOpenCodeProviderMutationOptions({
			api,
			queryClient,
			onSuccess: async () => {
				toast.success(t("openCodeProviderCreated"));
				onSaved();
			},
		}),
	});
	const updateMutation = useMutation({
		...updateOpenCodeProviderMutationOptions({
			api,
			queryClient,
			onSuccess: async () => {
				toast.success(t("openCodeProviderUpdated"));
				onSaved();
			},
		}),
	});

	const activeError =
		mode === "create" ? createMutation.error : updateMutation.error;
	const isPending = createMutation.isPending || updateMutation.isPending;
	const hasInventoryProviders = inventoryProviders.length > 0;

	const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!selectedProviderId) return;

		if (mode === "create") {
			createMutation.mutate({
				inference_provider_id: selectedProviderId,
			});
			return;
		}

		if (!provider) return;
		updateMutation.mutate({
			id: provider.id,
			body: {
				inference_provider_id: selectedProviderId,
			},
		});
	};

	return (
		<form className="grid gap-4" onSubmit={handleSubmit}>
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

			{!hasInventoryProviders && (
				<Alert status="warning">
					<Alert.Indicator />
					<Alert.Content>
						<Alert.Description>
							{t("noInferenceProvidersForOpenCode")}
						</Alert.Description>
					</Alert.Content>
				</Alert>
			)}

			<Select
				className="w-full"
				selectedKey={selectedProviderId || undefined}
				onSelectionChange={(key) => {
					if (!key) return;
					setSelectedProviderId(String(key));
				}}
				isDisabled={!hasInventoryProviders || isPending}
				variant="secondary"
			>
				<Label>{t("selectInferenceProvider")}</Label>
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
								textValue={item.name}
							>
								<div className="grid min-w-0 gap-0.5">
									<Label className="truncate">
										{item.name}
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

			<div className="flex justify-end gap-2">
				<Button
					type="button"
					variant="tertiary"
					onPress={onCancel}
					isDisabled={isPending}
				>
					{t("cancel")}
				</Button>
				<Button
					type="submit"
					isPending={isPending}
					isDisabled={!hasInventoryProviders || !selectedProviderId}
				>
					{mode === "create" ? t("create") : t("save")}
				</Button>
			</div>
		</form>
	);
}

function ProviderRow({
	provider,
	onEdit,
	onDelete,
}: {
	provider: AgentProviderResponse;
	onEdit: () => void;
	onDelete: () => void;
}) {
	const { t } = useTranslation();
	const credential = credentialLabel(provider);

	return (
		<div className="grid gap-3 border-t border-border py-3 first:border-t-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
			<div className="grid min-w-0 gap-1">
				<div className="flex min-w-0 items-center gap-2">
					<ServerIcon className="size-4 shrink-0 text-muted" />
					<Label className="truncate">{provider.name}</Label>
					{provider.id !== provider.name && (
						<span className="rounded-md bg-surface-secondary px-2 py-0.5 text-xs text-muted">
							{provider.id}
						</span>
					)}
				</div>
				<div className="flex min-w-0 flex-wrap gap-2 text-xs text-muted">
					<span>{t(formatLabelKey(provider.format))}</span>
					{provider.api_base_url && (
						<span className="max-w-full truncate font-mono">
							{provider.api_base_url}
						</span>
					)}
					<span>
						{t("providerModels")}: {provider.models.length}
					</span>
					<span>{t(sourceLabelKey(provider.source))}</span>
					<span>
						{credential.startsWith("agentProvider")
							? t(credential)
							: credential}
					</span>
				</div>
			</div>

			<div className="flex items-center gap-2 sm:justify-end">
				<Tooltip delay={0}>
					<Tooltip.Trigger>
						<Button
							isIconOnly
							variant="ghost"
							size="sm"
							aria-label={t("editOpenCodeProvider")}
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
			</div>
		</div>
	);
}

export function OpenCodeInferenceProviderPanel() {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();
	const [mode, setMode] = useState<PanelMode>({ type: "list" });
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

	const activeProvider = useMemo(() => {
		if (mode.type !== "edit") return undefined;
		return mode.provider;
	}, [mode]);

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

	const showForm = mode.type === "create" || mode.type === "edit";

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
									onPress={() => setMode({ type: "create" })}
								>
									<PlusIcon className="size-4" />
									{t("add")}
								</Button>
							</div>
						</Card.Header>

						<Card.Content className="grid gap-4">
							{isLoading || isInventoryLoading ? (
								<div className="flex justify-center py-8">
									<Spinner />
								</div>
							) : (
								<>
									{showForm && (
										<div className="rounded-md border border-border bg-surface-secondary p-3">
											<div className="mb-3">
												<h3 className="text-sm font-medium text-foreground">
													{mode.type === "create"
														? t(
																"createOpenCodeProvider",
															)
														: t(
																"editOpenCodeProvider",
															)}
												</h3>
											</div>
											<OpenCodeProviderForm
												mode={mode.type}
												provider={activeProvider}
												inventoryProviders={
													inventoryProviders
												}
												onCancel={() =>
													setMode({ type: "list" })
												}
												onSaved={() =>
													setMode({ type: "list" })
												}
											/>
										</div>
									)}

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
													setMode({ type: "create" })
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
													onEdit={() =>
														setMode({
															type: "edit",
															provider,
														})
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
