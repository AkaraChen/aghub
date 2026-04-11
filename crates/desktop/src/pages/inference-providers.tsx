import {
	ArrowPathIcon,
	ArrowRightCircleIcon,
	CheckCircleIcon,
	ExclamationTriangleIcon,
} from "@heroicons/react/24/solid";
import { Button, Card, Chip, SearchField, Spinner, toast } from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
	InferenceCredentialDto,
	ProviderTransferItemDto,
	ProviderTransferResponseDto,
} from "../generated/dto";
import { useAgentAvailability } from "../hooks/use-agent-availability";
import { useApi } from "../hooks/use-api";
import { cn } from "../lib/utils";
import {
	openCodeProvidersQueryOptions,
	transferProvidersMutationOptions,
} from "../requests/inference";

function TransferItemRow({ item }: { item: ProviderTransferItemDto }) {
	return (
		<div className="flex flex-wrap items-center gap-2 rounded-lg border border-separator px-3 py-2">
			<span className="text-sm text-foreground">{item.name}</span>
			<Chip size="sm" variant="tertiary">
				{item.status}
			</Chip>
			{item.reason && (
				<span className="text-xs text-muted">{item.reason}</span>
			)}
		</div>
	);
}

function ProviderListItem({
	provider,
	isSelected,
	onSelect,
	t,
}: {
	provider: InferenceCredentialDto;
	isSelected: boolean;
	onSelect: (name: string) => void;
	t: (key: string) => string;
}) {
	return (
		<button
			type="button"
			onClick={() => onSelect(provider.name)}
			className={cn(
				"w-full rounded-lg border px-3 py-2 text-left transition-colors",
				"focus:outline-none focus:ring-2 focus:ring-accent/40",
				isSelected
					? "border-accent/35 bg-accent/10"
					: "border-transparent hover:bg-default",
			)}
		>
			<div className="flex items-center justify-between gap-2">
				<span className="truncate text-sm font-medium text-foreground">
					{provider.name}
				</span>
				<Chip size="sm" variant="tertiary" className="shrink-0">
					{provider.type}
				</Chip>
			</div>
			<div className="mt-2 flex items-center gap-2">
				<Chip
					size="sm"
					variant={provider.has_key ? "soft" : "tertiary"}
				>
					{provider.has_key
						? t("providerHasKey")
						: t("providerNoKey")}
				</Chip>
				{!provider.base && (
					<span className="text-xs text-warning">
						{t("providerWillBeSkipped")}
					</span>
				)}
			</div>
		</button>
	);
}

export default function InferenceProvidersPage() {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();
	const { availableAgents } = useAgentAvailability();
	const [lastResult, setLastResult] =
		useState<ProviderTransferResponseDto | null>(null);
	const [searchQuery, setSearchQuery] = useState("");
	const [manualSelectedProviderName, setManualSelectedProviderName] =
		useState<string | null>(null);

	const hasOpenCodeSupport = useMemo(
		() =>
			availableAgents.some(
				(agent) => agent.id === "opencode" && agent.isUsable,
			),
		[availableAgents],
	);
	const hasCodexSupport = useMemo(
		() =>
			availableAgents.some(
				(agent) => agent.id === "codex" && agent.isUsable,
			),
		[availableAgents],
	);
	const canTransferProviders = hasOpenCodeSupport && hasCodexSupport;

	const {
		data: providers = [],
		isFetching,
		refetch,
	} = useQuery({
		...openCodeProvidersQueryOptions({
			api,
			enabled: canTransferProviders,
		}),
	});

	const transferMutation = useMutation(
		transferProvidersMutationOptions({
			api,
			queryClient,
		}),
	);

	const filteredProviders = useMemo(() => {
		const query = searchQuery.trim().toLowerCase();
		if (!query) {
			return providers;
		}

		return providers.filter((provider) => {
			const haystack = [provider.name, provider.type, provider.base ?? ""]
				.join(" ")
				.toLowerCase();

			return haystack.includes(query);
		});
	}, [providers, searchQuery]);

	const selectedProviderName = useMemo(() => {
		if (filteredProviders.length === 0) {
			return null;
		}

		if (
			manualSelectedProviderName &&
			filteredProviders.some(
				(provider) => provider.name === manualSelectedProviderName,
			)
		) {
			return manualSelectedProviderName;
		}

		return filteredProviders[0].name;
	}, [filteredProviders, manualSelectedProviderName]);

	const selectedProvider = useMemo(
		() =>
			filteredProviders.find(
				(provider) => provider.name === selectedProviderName,
			) ?? null,
		[filteredProviders, selectedProviderName],
	);

	const handleTransfer = async () => {
		try {
			const result = await transferMutation.mutateAsync();
			setLastResult(result);
			toast.success(
				t("providerTransferSuccess", {
					imported: result.imported_count,
					skipped: result.skipped_count,
				}),
			);
			await refetch();
		} catch (error) {
			toast.danger(
				error instanceof Error
					? error.message
					: t("providerTransferFailed"),
			);
		}
	};

	const transferDisabled =
		!canTransferProviders ||
		providers.length === 0 ||
		transferMutation.isPending;
	const isInitialLoading =
		canTransferProviders && isFetching && providers.length === 0;

	return (
		<div className="flex h-full">
			<div className="flex w-80 shrink-0 flex-col border-r border-border">
				<div className="border-b border-border/70 p-3">
					<div className="mb-3 flex items-start justify-between gap-3">
						<div className="min-w-0">
							<p className="text-sm font-medium text-foreground">
								{t("providerSourceList")}
							</p>
							<p className="mt-1 text-xs text-muted">
								{t("providerTransferDescription")}
							</p>
						</div>
						<Chip size="sm" variant="tertiary">
							{providers.length}
						</Chip>
					</div>

					<div className="flex items-center gap-2">
						<SearchField
							value={searchQuery}
							onChange={setSearchQuery}
							aria-label={t("searchProviders")}
							className="min-w-0 flex-1"
						>
							<SearchField.Group>
								<SearchField.SearchIcon />
								<SearchField.Input
									placeholder={t("searchProviders")}
								/>
								<SearchField.ClearButton />
							</SearchField.Group>
						</SearchField>
						<Button
							isIconOnly
							variant="ghost"
							size="sm"
							aria-label={t("refresh")}
							onPress={() => refetch()}
							isDisabled={!canTransferProviders}
						>
							<ArrowPathIcon
								className={cn(
									"size-4",
									isFetching && "animate-spin",
								)}
							/>
						</Button>
					</div>
				</div>

				<div className="flex-1 overflow-y-auto p-2">
					{!canTransferProviders ? (
						<p className="px-2 py-5 text-sm text-muted">
							{t("providerTransferNotReady")}
						</p>
					) : isInitialLoading ? (
						<div className="flex justify-center py-6">
							<Spinner size="sm" />
						</div>
					) : filteredProviders.length === 0 ? (
						<p className="px-2 py-5 text-sm text-muted">
							{searchQuery.trim().length > 0
								? t("noProvidersMatch")
								: t("providerTransferNoProviders")}
						</p>
					) : (
						<div className="space-y-1">
							{filteredProviders.map((provider) => (
								<ProviderListItem
									key={provider.name}
									provider={provider}
									isSelected={
										provider.name === selectedProvider?.name
									}
									onSelect={setManualSelectedProviderName}
									t={t}
								/>
							))}
						</div>
					)}
				</div>
			</div>

			<div className="relative flex-1 overflow-hidden">
				<div className="h-full overflow-y-auto">
					<div className="w-full space-y-4 p-4 sm:p-6">
						<div className="flex items-start justify-between gap-4">
							<div>
								<h2 className="text-xl font-semibold text-foreground">
									{t("providerTransferTitle")}
								</h2>
								<p className="mt-1 text-sm text-muted">
									{t("providerTransferTarget")}
								</p>
							</div>
							<Button
								variant="primary"
								onPress={handleTransfer}
								isDisabled={transferDisabled}
							>
								{transferMutation.isPending ? (
									<ArrowPathIcon className="size-4 animate-spin" />
								) : (
									<ArrowRightCircleIcon className="size-4" />
								)}
								{t("providerTransferAction")}
							</Button>
						</div>

						{!canTransferProviders && (
							<Card>
								<Card.Content className="flex items-start gap-3">
									<ExclamationTriangleIcon className="mt-0.5 size-5 text-warning" />
									<div className="space-y-1">
										<p className="text-sm font-medium text-foreground">
											{t("providerTransferNotReady")}
										</p>
										<p className="text-xs text-muted">
											{t("providerTransferNotReadyDesc")}
										</p>
									</div>
								</Card.Content>
							</Card>
						)}

						{isInitialLoading && (
							<Card>
								<Card.Content className="flex justify-center py-10">
									<Spinner size="sm" />
								</Card.Content>
							</Card>
						)}

						{!isInitialLoading &&
							canTransferProviders &&
							selectedProvider && (
								<Card>
									<Card.Header className="flex items-start justify-between gap-3">
										<div className="min-w-0 flex-1">
											<h3 className="truncate text-lg font-semibold text-foreground">
												{selectedProvider.name}
											</h3>
											<p className="mt-1 text-xs text-muted">
												{t("providerDetails")}
											</p>
										</div>
										<div className="flex flex-wrap items-center gap-2">
											<Chip size="sm" variant="tertiary">
												{selectedProvider.type}
											</Chip>
											<Chip
												size="sm"
												variant={
													selectedProvider.has_key
														? "soft"
														: "tertiary"
												}
											>
												{selectedProvider.has_key
													? t("providerHasKey")
													: t("providerNoKey")}
											</Chip>
											<Chip
												size="sm"
												variant={
													selectedProvider.base
														? "soft"
														: "tertiary"
												}
											>
												{selectedProvider.base
													? t("providerReadyToImport")
													: t(
															"providerWillBeSkipped",
														)}
											</Chip>
										</div>
									</Card.Header>
									<Card.Content className="space-y-3">
										<div className="grid gap-1.5">
											<span className="text-[11px] font-medium tracking-wide text-muted uppercase">
												{t("url")}
											</span>
											{selectedProvider.base ? (
												<div className="overflow-x-auto rounded-lg border border-separator bg-surface-secondary px-3 py-2">
													<code className="block font-mono text-xs leading-5 text-foreground whitespace-pre-wrap break-all">
														{selectedProvider.base}
													</code>
												</div>
											) : (
												<p className="text-xs text-warning">
													{t("providerMissingBase")}
												</p>
											)}
										</div>
										<p className="text-xs text-muted">
											{t("providerTransferTargetDesc")}
										</p>
									</Card.Content>
								</Card>
							)}

						{!isInitialLoading &&
							canTransferProviders &&
							!selectedProvider && (
								<Card>
									<Card.Content className="py-10 text-center text-sm text-muted">
										{providers.length === 0
											? t("providerTransferNoProviders")
											: t("selectProvider")}
									</Card.Content>
								</Card>
							)}

						{lastResult && (
							<Card>
								<Card.Header className="flex items-center gap-2">
									<CheckCircleIcon className="size-4 text-success" />
									<h3 className="text-sm font-medium text-foreground">
										{t("providerTransferResult")}
									</h3>
								</Card.Header>
								<Card.Content className="space-y-2">
									<p className="text-xs text-muted">
										{t("providerTransferSuccess", {
											imported: lastResult.imported_count,
											skipped: lastResult.skipped_count,
										})}
									</p>
									{lastResult.items.map((item) => (
										<TransferItemRow
											key={`${item.name}-${item.status}-${item.reason ?? ""}`}
											item={item}
										/>
									))}
								</Card.Content>
							</Card>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}
