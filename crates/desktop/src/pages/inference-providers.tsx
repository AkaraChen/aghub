import {
	ArrowPathIcon,
	ArrowRightCircleIcon,
	CheckCircleIcon,
	ExclamationTriangleIcon,
} from "@heroicons/react/24/solid";
import { Button, Card, Chip, Spinner, toast } from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ProviderTransferResponseDto } from "../generated/dto";
import { useAgentAvailability } from "../hooks/use-agent-availability";
import { useApi } from "../hooks/use-api";
import {
	openCodeProvidersQueryOptions,
	transferProvidersMutationOptions,
} from "../requests/inference";

export default function InferenceProvidersPage() {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();
	const { availableAgents } = useAgentAvailability();
	const [lastResult, setLastResult] =
		useState<ProviderTransferResponseDto | null>(null);

	const hasOpenCodeSupport = useMemo(
		() =>
			availableAgents.some(
				(agent) =>
					agent.id === "opencode" &&
					agent.isUsable &&
					agent.capabilities.inference.openai,
			),
		[availableAgents],
	);
	const hasCodexSupport = useMemo(
		() =>
			availableAgents.some(
				(agent) =>
					agent.id === "codex" &&
					agent.isUsable &&
					agent.capabilities.inference.openai,
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

	return (
		<div className="h-full overflow-y-auto">
			<div className="w-full space-y-4 p-4 sm:p-6">
				<div className="flex items-start justify-between gap-4">
					<div>
						<h2 className="text-xl font-semibold text-foreground">
							{t("providerTransferTitle")}
						</h2>
						<p className="mt-1 text-sm text-muted">
							{t("providerTransferDescription")}
						</p>
					</div>
					<Button
						isIconOnly
						variant="ghost"
						size="sm"
						aria-label={t("refresh")}
						onPress={() => refetch()}
						isDisabled={!canTransferProviders}
					>
						<ArrowPathIcon
							className={[
								"size-4",
								isFetching ? "animate-spin" : "",
							]
								.filter(Boolean)
								.join(" ")}
						/>
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

				<Card>
					<Card.Header className="flex items-center justify-between">
						<h3 className="text-sm font-medium text-foreground">
							{t("providerSourceList")}
						</h3>
						<Chip size="sm" variant="tertiary">
							{providers.length}
						</Chip>
					</Card.Header>
					<Card.Content className="space-y-2">
						{isFetching ? (
							<div className="flex justify-center py-4">
								<Spinner size="sm" />
							</div>
						) : providers.length === 0 ? (
							<p className="text-sm text-muted">
								{t("providerTransferNoProviders")}
							</p>
						) : (
							providers.map((provider) => (
								<div
									key={provider.name}
									className="rounded-lg border border-separator px-3 py-2"
								>
									<div className="flex flex-wrap items-center gap-2">
										<span className="text-sm font-medium text-foreground">
											{provider.name}
										</span>
										<Chip size="sm" variant="tertiary">
											{provider.type}
										</Chip>
										<Chip
											size="sm"
											variant={
												provider.has_key
													? "soft"
													: "tertiary"
											}
										>
											{provider.has_key
												? t("providerHasKey")
												: t("providerNoKey")}
										</Chip>
									</div>
									{provider.base ? (
										<p className="mt-1 font-mono text-xs text-muted break-all">
											{provider.base}
										</p>
									) : (
										<p className="mt-1 text-xs text-warning">
											{t("providerMissingBase")}
										</p>
									)}
								</div>
							))
						)}
					</Card.Content>
				</Card>

				<Card>
					<Card.Content className="flex flex-wrap items-center justify-between gap-3">
						<div className="space-y-1">
							<p className="text-sm font-medium text-foreground">
								{t("providerTransferTarget")}
							</p>
							<p className="text-xs text-muted">
								{t("providerTransferTargetDesc")}
							</p>
						</div>
						<Button
							variant="primary"
							onPress={handleTransfer}
							isDisabled={
								!canTransferProviders ||
								providers.length === 0 ||
								transferMutation.isPending
							}
						>
							{transferMutation.isPending ? (
								<ArrowPathIcon className="size-4 animate-spin" />
							) : (
								<ArrowRightCircleIcon className="size-4" />
							)}
							{t("providerTransferAction")}
						</Button>
					</Card.Content>
				</Card>

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
								<div
									key={`${item.name}-${item.status}-${item.reason ?? ""}`}
									className="flex flex-wrap items-center gap-2 rounded-lg border border-separator px-3 py-2"
								>
									<span className="text-sm text-foreground">
										{item.name}
									</span>
									<Chip size="sm" variant="tertiary">
										{item.status}
									</Chip>
									{item.reason && (
										<span className="text-xs text-muted">
											{item.reason}
										</span>
									)}
								</div>
							))}
						</Card.Content>
					</Card>
				)}
			</div>
		</div>
	);
}
