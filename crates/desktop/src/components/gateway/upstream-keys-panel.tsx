import { PlusIcon, TrashIcon } from "@heroicons/react/24/solid";
import { AlertDialog, Button, Chip, Spinner, toast } from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { GatewayUpstreamProvider } from "../../generated/dto";
import { useApi } from "../../hooks/use-api";
import {
	deleteGatewayCompatProviderMutationOptions,
	deleteGatewayUpstreamKeyMutationOptions,
	gatewayCompatProvidersQueryOptions,
	gatewayUpstreamKeysQueryOptions,
} from "../../requests/gateway";
import { AddGatewayCompatProviderDialog } from "./add-compat-provider-dialog";
import { AddGatewayUpstreamKeyDialog } from "./add-upstream-key-dialog";
import {
	GATEWAY_UPSTREAM_PROVIDER_OPTIONS,
	maskGatewayKey,
} from "./gateway-helpers";
import { UpstreamProviderIcon } from "./upstream-provider-icon";

type DeleteTarget =
	| { kind: "upstream"; provider: GatewayUpstreamProvider; apiKey: string }
	| { kind: "compat"; name: string };

interface GatewayUpstreamKeysPanelProps {
	instanceId: string;
}

export function GatewayUpstreamKeysPanel({
	instanceId,
}: GatewayUpstreamKeysPanelProps) {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();
	const [isAddKeyOpen, setIsAddKeyOpen] = useState(false);
	const [isAddCompatOpen, setIsAddCompatOpen] = useState(false);
	const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);

	const { data: upstreamKeys, isLoading: isKeysLoading } = useQuery(
		gatewayUpstreamKeysQueryOptions({ api, instanceId }),
	);
	const { data: compatProviders = [], isLoading: isCompatLoading } = useQuery(
		gatewayCompatProvidersQueryOptions({ api, instanceId }),
	);

	const deleteKeyMutation = useMutation({
		...deleteGatewayUpstreamKeyMutationOptions({
			api,
			queryClient,
			onSuccess: () => {
				toast.success(t("gatewayUpstreamKeyDeleted"));
				setDeleteTarget(null);
			},
		}),
		onError: (error) => {
			console.error("Failed to delete upstream key:", error);
			toast.danger(
				error instanceof Error
					? error.message
					: t("gatewayUpstreamDeleteFailed"),
			);
		},
	});

	const deleteCompatMutation = useMutation({
		...deleteGatewayCompatProviderMutationOptions({
			api,
			queryClient,
			onSuccess: () => {
				toast.success(t("gatewayCompatProviderDeleted"));
				setDeleteTarget(null);
			},
		}),
		onError: (error) => {
			console.error("Failed to delete compat provider:", error);
			toast.danger(
				error instanceof Error
					? error.message
					: t("gatewayUpstreamDeleteFailed"),
			);
		},
	});

	const isDeletePending =
		deleteKeyMutation.isPending || deleteCompatMutation.isPending;

	const handleConfirmDelete = () => {
		if (!deleteTarget) return;
		if (deleteTarget.kind === "upstream") {
			deleteKeyMutation.mutate({
				instanceId,
				provider: deleteTarget.provider,
				apiKey: deleteTarget.apiKey,
			});
		} else {
			deleteCompatMutation.mutate({
				instanceId,
				name: deleteTarget.name,
			});
		}
	};

	if (isKeysLoading || isCompatLoading) {
		return (
			<div className="flex h-32 items-center justify-center">
				<Spinner />
			</div>
		);
	}

	const hasAnyKey = GATEWAY_UPSTREAM_PROVIDER_OPTIONS.some(
		(option) => (upstreamKeys?.[option.id] ?? []).length > 0,
	);

	return (
		<div className="flex flex-col gap-6">
			<section className="flex flex-col gap-2">
				<div className="flex items-center justify-between gap-3">
					<div>
						<h3 className="text-sm font-medium text-foreground">
							{t("gatewayOfficialKeysTitle")}
						</h3>
						<p className="text-xs text-muted">
							{t("gatewayOfficialKeysDescription")}
						</p>
					</div>
					<Button
						variant="secondary"
						size="sm"
						className="shrink-0"
						onPress={() => setIsAddKeyOpen(true)}
					>
						<PlusIcon className="size-4" />
						{t("add")}
					</Button>
				</div>

				{!hasAnyKey ? (
					<p className="py-2 text-sm text-muted">
						{t("gatewayNoUpstreamKeys")}
					</p>
				) : (
					<div className="flex flex-col gap-3">
						{GATEWAY_UPSTREAM_PROVIDER_OPTIONS.map((option) => {
							const keys = upstreamKeys?.[option.id] ?? [];
							if (keys.length === 0) return null;
							return (
								<div
									key={option.id}
									className="flex flex-col gap-1"
								>
									<div className="flex items-center gap-1.5 text-xs font-medium text-muted">
										<UpstreamProviderIcon
											logo={option.logo}
										/>
										{option.label}
									</div>
									<div className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface">
										{keys.map((key) => (
											<div
												key={key.api_key}
												className="flex min-w-0 items-center gap-3 px-3 py-2"
											>
												<span className="shrink-0 font-mono text-xs text-foreground">
													{maskGatewayKey(
														key.api_key,
													)}
												</span>
												{key.base_url && (
													<span className="min-w-0 truncate font-mono text-xs text-muted">
														{key.base_url}
													</span>
												)}
												<Button
													isIconOnly
													variant="ghost"
													size="sm"
													className="ml-auto shrink-0 text-muted"
													aria-label={t("delete")}
													onPress={() =>
														setDeleteTarget({
															kind: "upstream",
															provider: option.id,
															apiKey: key.api_key,
														})
													}
												>
													<TrashIcon className="size-4" />
												</Button>
											</div>
										))}
									</div>
								</div>
							);
						})}
					</div>
				)}
			</section>

			<section className="flex flex-col gap-2">
				<div className="flex items-center justify-between gap-3">
					<div>
						<h3 className="text-sm font-medium text-foreground">
							{t("gatewayCompatTitle")}
						</h3>
						<p className="text-xs text-muted">
							{t("gatewayCompatDescription")}
						</p>
					</div>
					<Button
						variant="secondary"
						size="sm"
						className="shrink-0"
						onPress={() => setIsAddCompatOpen(true)}
					>
						<PlusIcon className="size-4" />
						{t("gatewayAddCompatProvider")}
					</Button>
				</div>

				{compatProviders.length === 0 ? (
					<p className="py-2 text-sm text-muted">
						{t("gatewayNoCompatProviders")}
					</p>
				) : (
					<div className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface">
						{compatProviders.map((provider) => (
							<div
								key={provider.name}
								className="flex min-w-0 items-center gap-3 px-3 py-2"
							>
								<span className="shrink-0 text-sm font-medium text-foreground">
									{provider.name}
								</span>
								<span className="min-w-0 truncate font-mono text-xs text-muted">
									{provider.base_url}
								</span>
								{provider.models.length > 0 && (
									<Chip size="sm" variant="soft">
										{t("gatewayCompatModelCount", {
											count: provider.models.length,
										})}
									</Chip>
								)}
								<Button
									isIconOnly
									variant="ghost"
									size="sm"
									className="ml-auto shrink-0 text-muted"
									aria-label={t("delete")}
									onPress={() =>
										setDeleteTarget({
											kind: "compat",
											name: provider.name,
										})
									}
								>
									<TrashIcon className="size-4" />
								</Button>
							</div>
						))}
					</div>
				)}
			</section>

			<AddGatewayUpstreamKeyDialog
				instanceId={instanceId}
				isOpen={isAddKeyOpen}
				onClose={() => setIsAddKeyOpen(false)}
			/>
			<AddGatewayCompatProviderDialog
				instanceId={instanceId}
				isOpen={isAddCompatOpen}
				onClose={() => setIsAddCompatOpen(false)}
			/>

			<AlertDialog.Backdrop
				isOpen={deleteTarget !== null}
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
								{t("gatewayDeleteUpstream")}
							</AlertDialog.Heading>
						</AlertDialog.Header>
						<AlertDialog.Body>
							{t("gatewayDeleteUpstreamConfirm", {
								name:
									deleteTarget?.kind === "upstream"
										? maskGatewayKey(deleteTarget.apiKey)
										: (deleteTarget?.name ?? ""),
							})}
						</AlertDialog.Body>
						<AlertDialog.Footer>
							<Button
								variant="tertiary"
								isDisabled={isDeletePending}
								onPress={() => setDeleteTarget(null)}
							>
								{t("cancel")}
							</Button>
							<Button
								variant="danger"
								isPending={isDeletePending}
								onPress={handleConfirmDelete}
							>
								{t("delete")}
							</Button>
						</AlertDialog.Footer>
					</AlertDialog.Dialog>
				</AlertDialog.Container>
			</AlertDialog.Backdrop>
		</div>
	);
}
