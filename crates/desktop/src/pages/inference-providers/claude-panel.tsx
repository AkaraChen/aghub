import {
	ArrowPathIcon,
	CheckCircleIcon,
	KeyIcon,
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
import type { InferenceProviderResponse } from "../../generated/dto";
import { useApi } from "../../hooks/use-api";
import { AgentIcon } from "../../lib/agent-icons";
import { cn } from "../../lib/utils";
import {
	clearClaudeProviderMutationOptions,
	claudeProviderStateQueryOptions,
	inferenceProviderListQueryOptions,
	updateClaudeProviderMutationOptions,
} from "../../requests/inference-providers";

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
				{!isActive && (
					<Button
						size="sm"
						variant="ghost"
						isPending={isPending}
						onPress={onActivate}
					>
						{t("enable")}
					</Button>
				)}
			</div>
		</div>
	);
}

function ClaudeProviderRow({
	apiBaseUrl,
	apiKey,
	model,
	matchedProvider,
	isActive,
	isSyncing,
	isDeleting,
	onSync,
	onDelete,
}: {
	apiBaseUrl: string | null;
	apiKey: string | null;
	model: string | null;
	matchedProvider: InferenceProviderResponse | undefined;
	isActive: boolean;
	isSyncing: boolean;
	isDeleting: boolean;
	onSync: () => void;
	onDelete: () => void;
}) {
	const { t } = useTranslation();

	return (
		<div className="grid gap-3 border-t border-border py-3 first:border-t-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
			<div className="grid min-w-0 gap-1">
				<div className="flex min-w-0 items-center gap-2">
					<ServerIcon className="size-4 shrink-0 text-muted" />
					<Label className="truncate">
						{matchedProvider?.display_name ??
							matchedProvider?.name ??
							apiBaseUrl ??
							t("custom")}
					</Label>
					{isActive && (
						<span className="inline-flex items-center gap-1 rounded-md bg-accent/10 px-2 py-0.5 text-xs text-accent">
							<CheckCircleIcon className="size-3.5" />
							{t("active")}
						</span>
					)}
				</div>
				<div className="flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
					{apiBaseUrl && (
						<span className="truncate">{apiBaseUrl}</span>
					)}
					{apiKey && (
						<span className="inline-flex items-center gap-1">
							<KeyIcon className="size-3" />
							***
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
							aria-label={t("delete")}
							isPending={isDeleting}
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

export function ClaudeInferenceProviderPanel() {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();
	const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
	const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
	const [selectedProviderId, setSelectedProviderId] = useState("");

	const {
		data: state,
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

	const anthropicProviders = useMemo(
		() =>
			inventoryProviders.filter(
				(provider) => provider.format === "anthropic",
			),
		[inventoryProviders],
	);

	const { data: matchedProvider } = useQuery({
		queryKey: [
			"claude-provider-match",
			state?.api_base_url,
			state?.api_key,
		],
		queryFn: async () => {
			if (!state?.api_base_url || !state?.api_key) {
				return undefined;
			}
			const candidate = inventoryProviders.find(
				(p) => p.api_base_url === state.api_base_url,
			);
			if (!candidate) return undefined;
			try {
				const password = await api.inferenceProviders.getPassword(
					candidate.name,
				);
				return password.api_key === state.api_key
					? candidate
					: undefined;
			} catch {
				return undefined;
			}
		},
		enabled: Boolean(state?.api_base_url && state?.api_key),
		staleTime: 0,
	});

	const updateMutation = useMutation({
		...updateClaudeProviderMutationOptions({
			api,
			queryClient,
			onSuccess: async () => {
				toast.success(t("claudeProviderUpdated"));
				setIsAddDialogOpen(false);
				setSelectedProviderId("");
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

	const clearMutation = useMutation({
		...clearClaudeProviderMutationOptions({
			api,
			queryClient,
			onSuccess: async () => {
				setIsDeleteDialogOpen(false);
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

	const hasCustomConfig = Boolean(
		state?.api_base_url || state?.api_key || state?.model,
	);

	const handleAdd = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!selectedProviderId) return;

		const provider = inventoryProviders.find(
			(p) => p.id === selectedProviderId,
		);
		if (!provider) return;

		try {
			const password = await api.inferenceProviders.getPassword(
				provider.name,
			);
			updateMutation.mutate({
				api_base_url: provider.api_base_url,
				api_key: password.api_key,
				model: provider.models[0] ?? null,
			});
		} catch (error) {
			console.error("Failed to get provider password:", error);
			toast.danger(
				error instanceof Error
					? error.message
					: t("inferenceProviderPasswordLoadFailed"),
			);
		}
	};

	const handleSync = async () => {
		if (!matchedProvider) return;
		try {
			const password = await api.inferenceProviders.getPassword(
				matchedProvider.name,
			);
			updateMutation.mutate({
				api_base_url: matchedProvider.api_base_url,
				api_key: password.api_key,
				model: matchedProvider.models[0] ?? state?.model ?? null,
			});
		} catch (error) {
			console.error("Failed to sync Claude provider:", error);
			toast.danger(
				error instanceof Error
					? error.message
					: t("claudeProviderUpdateError"),
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
								<Button
									variant="ghost"
									size="sm"
									aria-label={t("refresh")}
									onPress={() => refetch()}
									isPending={isFetching}
								>
									<ArrowPathIcon
										className={cn(
											"size-4",
											isFetching && "animate-spin",
										)}
									/>
								</Button>
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
										isActive={!hasCustomConfig}
										isPending={clearMutation.isPending}
										onActivate={() =>
											setIsDeleteDialogOpen(true)
										}
									/>
									{hasCustomConfig && (
										<ClaudeProviderRow
											apiBaseUrl={
												state?.api_base_url ?? null
											}
											apiKey={state?.api_key ?? null}
											model={state?.model ?? null}
											matchedProvider={matchedProvider}
											isActive={hasCustomConfig}
											isSyncing={updateMutation.isPending}
											isDeleting={clearMutation.isPending}
											onSync={handleSync}
											onDelete={() =>
												setIsDeleteDialogOpen(true)
											}
										/>
									)}
								</div>
							)}
						</Card.Content>
					</Card>
				</div>
			</div>

			<Modal.Backdrop
				isOpen={isAddDialogOpen}
				onOpenChange={(open) => {
					if (!open) {
						setIsAddDialogOpen(false);
						setSelectedProviderId("");
					}
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
						<form onSubmit={handleAdd}>
							<Modal.Body className="grid gap-4 p-4">
								{updateMutation.error && (
									<Alert status="danger">
										<Alert.Indicator />
										<Alert.Content>
											<Alert.Description>
												{updateMutation.error instanceof
												Error
													? updateMutation.error
															.message
													: String(
															updateMutation.error,
														)}
											</Alert.Description>
										</Alert.Content>
									</Alert>
								)}

								{isInventoryLoading && (
									<div className="flex justify-center py-6">
										<Spinner />
									</div>
								)}

								{!isInventoryLoading &&
									anthropicProviders.length === 0 && (
										<Alert status="warning">
											<Alert.Indicator />
											<Alert.Content>
												<Alert.Description>
													{t(
														"noInferenceProvidersForClaude",
													)}
												</Alert.Description>
											</Alert.Content>
										</Alert>
									)}

								{!isInventoryLoading &&
									anthropicProviders.length > 0 && (
										<Select
											className="w-full"
											selectedKey={
												selectedProviderId || undefined
											}
											onSelectionChange={(key) => {
												if (!key) return;
												setSelectedProviderId(
													String(key),
												);
											}}
											isDisabled={
												updateMutation.isPending
											}
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
													{anthropicProviders.map(
														(
															item: InferenceProviderResponse,
														) => (
															<ListBox.Item
																key={item.id}
																id={item.id}
																textValue={`${item.display_name} ${item.name}`}
															>
																<div className="grid min-w-0 gap-0.5">
																	<Label className="truncate">
																		{
																			item.display_name
																		}
																	</Label>
																	<span className="truncate text-xs text-muted">
																		{
																			item.api_base_url
																		}
																	</span>
																</div>
															</ListBox.Item>
														),
													)}
												</ListBox>
											</Select.Popover>
										</Select>
									)}
							</Modal.Body>
							<Modal.Footer>
								<Button
									type="button"
									variant="tertiary"
									onPress={() => {
										setIsAddDialogOpen(false);
										setSelectedProviderId("");
									}}
									isDisabled={updateMutation.isPending}
								>
									{t("cancel")}
								</Button>
								<Button
									type="submit"
									isPending={updateMutation.isPending}
									isDisabled={
										isInventoryLoading ||
										anthropicProviders.length === 0 ||
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

			<AlertDialog.Backdrop
				isOpen={isDeleteDialogOpen}
				onOpenChange={() => setIsDeleteDialogOpen(false)}
			>
				<AlertDialog.Container>
					<AlertDialog.Dialog className="sm:max-w-[420px]">
						<AlertDialog.CloseTrigger />
						<AlertDialog.Header>
							<AlertDialog.Icon status="danger" />
							<AlertDialog.Heading>
								{t("clearClaudeProvider")}
							</AlertDialog.Heading>
						</AlertDialog.Header>
						<AlertDialog.Body>
							{t("clearClaudeProviderConfirm")}
						</AlertDialog.Body>
						<AlertDialog.Footer>
							<Button
								variant="tertiary"
								onPress={() => setIsDeleteDialogOpen(false)}
							>
								{t("cancel")}
							</Button>
							<Button
								variant="danger"
								isPending={clearMutation.isPending}
								onPress={() => clearMutation.mutate()}
							>
								{t("clear")}
							</Button>
						</AlertDialog.Footer>
					</AlertDialog.Dialog>
				</AlertDialog.Container>
			</AlertDialog.Backdrop>
		</>
	);
}
