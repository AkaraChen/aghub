import {
	ArrowPathIcon,
	ArrowUpTrayIcon,
	PaperAirplaneIcon,
	PlusIcon,
	TrashIcon,
	UserGroupIcon,
} from "@heroicons/react/24/solid";
import {
	AlertDialog,
	Button,
	Dropdown,
	Spinner,
	Table,
	Tooltip,
	toast,
} from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "../ui/empty";
import type {
	GatewayAuthFileDto,
	GatewayInstanceDto,
} from "../../generated/dto";
import { useApi } from "../../hooks/use-api";
import {
	deleteGatewayAuthFileMutationOptions,
	gatewayAuthFilesQueryOptions,
	importGatewayVertexMutationOptions,
	invalidateGatewayAuthFileQueries,
	resetGatewayQuotaMutationOptions,
} from "../../requests/gateway";
import { AddGatewayAccountDialog } from "./add-account-dialog";
import { formatGatewayModtime } from "./gateway-helpers";

function AccountsTable({
	authFiles,
	pushTargets,
	isPushPending,
	isResetQuotaPending,
	onPush,
	onResetQuota,
	onDelete,
}: {
	authFiles: GatewayAuthFileDto[];
	pushTargets: GatewayInstanceDto[];
	isPushPending: boolean;
	isResetQuotaPending: boolean;
	onPush: (file: GatewayAuthFileDto, targetId: string) => void;
	onResetQuota: (file: GatewayAuthFileDto) => void;
	onDelete: (file: GatewayAuthFileDto) => void;
}) {
	const { t } = useTranslation();

	return (
		<Table>
			<Table.ScrollContainer>
				<Table.Content aria-label={t("gatewayTabAccounts")}>
					<Table.Header>
						<Table.Column isRowHeader>
							{t("gatewayAccountProvider")}
						</Table.Column>
						<Table.Column>{t("gatewayAccountEmail")}</Table.Column>
						<Table.Column>{t("gatewayAccountStatus")}</Table.Column>
						<Table.Column>
							{t("gatewayUsageSuccess")} /{" "}
							{t("gatewayUsageFailed")}
						</Table.Column>
						<Table.Column>
							{t("gatewayAccountModified")}
						</Table.Column>
						<Table.Column>{""}</Table.Column>
					</Table.Header>
					<Table.Body items={authFiles}>
						{(file) => (
							<Table.Row id={file.id ?? file.name}>
								<Table.Cell>{file.provider ?? "—"}</Table.Cell>
								<Table.Cell>
									{file.email ?? file.account ?? "—"}
								</Table.Cell>
								<Table.Cell>
									<span
										title={file.status_message ?? undefined}
									>
										{file.status ?? "—"}
									</span>
								</Table.Cell>
								<Table.Cell>
									<span className="text-success">
										{file.success ?? 0}
									</span>
									{" / "}
									<span className="text-danger">
										{file.failed ?? 0}
									</span>
								</Table.Cell>
								<Table.Cell>
									{formatGatewayModtime(file.modtime)}
								</Table.Cell>
								<Table.Cell>
									<div className="flex items-center justify-end gap-1">
										{pushTargets.length > 0 && (
											<Dropdown>
												<Button
													isIconOnly
													variant="ghost"
													size="sm"
													className="text-muted"
													aria-label={t(
														"gatewayPushAccount",
													)}
													isDisabled={isPushPending}
												>
													<PaperAirplaneIcon className="size-4" />
												</Button>
												<Dropdown.Popover placement="bottom end">
													<Dropdown.Menu
														onAction={(key) =>
															onPush(
																file,
																String(key),
															)
														}
													>
														{pushTargets.map(
															(target) => (
																<Dropdown.Item
																	key={
																		target.id
																	}
																	id={
																		target.id
																	}
																	textValue={t(
																		"gatewayPushTo",
																		{
																			name: target.name,
																		},
																	)}
																>
																	{t(
																		"gatewayPushTo",
																		{
																			name: target.name,
																		},
																	)}
																</Dropdown.Item>
															),
														)}
													</Dropdown.Menu>
												</Dropdown.Popover>
											</Dropdown>
										)}
										{file.auth_index !== null && (
											<Tooltip delay={0}>
												<Button
													isIconOnly
													variant="ghost"
													size="sm"
													className="text-muted"
													aria-label={t(
														"gatewayResetQuota",
													)}
													isDisabled={
														isResetQuotaPending
													}
													onPress={() =>
														onResetQuota(file)
													}
												>
													<ArrowPathIcon className="size-4" />
												</Button>
												<Tooltip.Content>
													{t("gatewayResetQuota")}
												</Tooltip.Content>
											</Tooltip>
										)}
										<Button
											isIconOnly
											variant="ghost"
											size="sm"
											className="text-muted"
											aria-label={t("delete")}
											onPress={() => onDelete(file)}
										>
											<TrashIcon className="size-4" />
										</Button>
									</div>
								</Table.Cell>
							</Table.Row>
						)}
					</Table.Body>
				</Table.Content>
			</Table.ScrollContainer>
		</Table>
	);
}

interface GatewayAccountsPanelProps {
	instance: GatewayInstanceDto;
	instances: GatewayInstanceDto[];
}

export function GatewayAccountsPanel({
	instance,
	instances,
}: GatewayAccountsPanelProps) {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();
	const [isAddOpen, setIsAddOpen] = useState(false);
	const vertexFileInputRef = useRef<HTMLInputElement>(null);
	const [deleteTarget, setDeleteTarget] = useState<GatewayAuthFileDto | null>(
		null,
	);

	const { data: authFiles = [], isLoading } = useQuery(
		gatewayAuthFilesQueryOptions({ api, instanceId: instance.id }),
	);

	// OAuth callbacks only ever reach this machine, so credentials can be
	// pushed from here to any other reachable instance ("account roaming").
	const pushTargets = instances.filter(
		(item) => item.id !== instance.id && item.status === "running",
	);

	const pushMutation = useMutation({
		mutationFn: async ({
			file,
			target,
		}: {
			file: GatewayAuthFileDto;
			target: GatewayInstanceDto;
		}) => {
			const content = await api.gateway.getAuthFileContent(
				instance.id,
				file.name,
			);
			await api.gateway.uploadAuthFile(target.id, content);
			return target;
		},
		onSuccess: async (target) => {
			await invalidateGatewayAuthFileQueries(queryClient, target.id);
			toast.success(t("gatewayAccountPushed", { name: target.name }));
		},
		onError: (error) => {
			console.error("Failed to push gateway credential:", error);
			toast.danger(
				error instanceof Error ? error.message : t("gatewayPushFailed"),
			);
		},
	});

	const deleteMutation = useMutation({
		...deleteGatewayAuthFileMutationOptions({
			api,
			queryClient,
			onSuccess: () => {
				toast.success(t("gatewayAccountDeleted"));
				setDeleteTarget(null);
			},
		}),
		onError: (error) => {
			console.error("Failed to delete gateway credential:", error);
			toast.danger(
				error instanceof Error
					? error.message
					: t("gatewayDeleteAccountFailed"),
			);
		},
	});

	const resetQuotaMutation = useMutation({
		...resetGatewayQuotaMutationOptions({
			api,
			queryClient,
			onSuccess: () => {
				toast.success(t("gatewayQuotaReset"));
			},
		}),
		onError: (error) => {
			console.error("Failed to reset gateway quota:", error);
			toast.danger(
				error instanceof Error
					? error.message
					: t("gatewayQuotaResetFailed"),
			);
		},
	});

	const handlePush = (file: GatewayAuthFileDto, targetId: string) => {
		const target = pushTargets.find((item) => item.id === targetId);
		if (!target) return;
		pushMutation.mutate({ file, target });
	};

	const handleResetQuota = (file: GatewayAuthFileDto) => {
		if (file.auth_index === null) return;
		resetQuotaMutation.mutate({
			instanceId: instance.id,
			authIndex: file.auth_index,
		});
	};

	const importVertexMutation = useMutation({
		...importGatewayVertexMutationOptions({
			api,
			queryClient,
			onSuccess: () => {
				toast.success(t("gatewayVertexImported"));
			},
		}),
		onError: (error) => {
			console.error("Failed to import Vertex service account:", error);
			toast.danger(
				error instanceof Error
					? error.message
					: t("gatewayVertexImportFailed"),
			);
		},
	});

	const handleVertexFile = async (
		event: React.ChangeEvent<HTMLInputElement>,
	) => {
		const file = event.target.files?.[0];
		// Reset so picking the same file again re-triggers the change event.
		event.target.value = "";
		if (!file) return;
		try {
			const content = await file.text();
			importVertexMutation.mutate({
				instanceId: instance.id,
				body: { file_name: file.name, content },
			});
		} catch (error) {
			console.error("Failed to read Vertex service-account file:", error);
			toast.danger(t("gatewayVertexReadFailed"));
		}
	};

	if (isLoading) {
		return (
			<div className="flex h-32 items-center justify-center">
				<Spinner />
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-3">
			<div className="flex items-center justify-between gap-3">
				<span className="text-sm text-muted">
					{instance.kind === "managed"
						? t("gatewayAccountsDescription")
						: t("gatewayAddAccountExternalHint")}
				</span>
				<div className="flex shrink-0 items-center gap-2">
					<Button
						variant="secondary"
						size="sm"
						isPending={importVertexMutation.isPending}
						onPress={() => vertexFileInputRef.current?.click()}
					>
						<ArrowUpTrayIcon className="size-4" />
						{t("gatewayImportVertex")}
					</Button>
					{instance.kind === "managed" && (
						<Button
							variant="secondary"
							size="sm"
							onPress={() => setIsAddOpen(true)}
						>
							<PlusIcon className="size-4" />
							{t("gatewayAddAccount")}
						</Button>
					)}
				</div>
			</div>
			{/* Reads the service-account JSON locally, so it works for
			    external instances too (same principle as roaming). */}
			<input
				ref={vertexFileInputRef}
				type="file"
				accept=".json,application/json"
				className="hidden"
				onChange={handleVertexFile}
			/>

			{authFiles.length === 0 ? (
				<Empty>
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<UserGroupIcon />
						</EmptyMedia>
						<EmptyTitle>{t("gatewayNoAccounts")}</EmptyTitle>
						<EmptyDescription>
							{t("gatewayNoAccountsDescription")}
						</EmptyDescription>
					</EmptyHeader>
				</Empty>
			) : (
				<AccountsTable
					authFiles={authFiles}
					pushTargets={pushTargets}
					isPushPending={pushMutation.isPending}
					isResetQuotaPending={resetQuotaMutation.isPending}
					onPush={handlePush}
					onResetQuota={handleResetQuota}
					onDelete={setDeleteTarget}
				/>
			)}

			{instance.kind === "managed" && (
				<AddGatewayAccountDialog
					instanceId={instance.id}
					isOpen={isAddOpen}
					onClose={() => setIsAddOpen(false)}
				/>
			)}

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
								{t("gatewayDeleteAccount")}
							</AlertDialog.Heading>
						</AlertDialog.Header>
						<AlertDialog.Body>
							{t("gatewayDeleteAccountConfirm", {
								name:
									deleteTarget?.email ??
									deleteTarget?.name ??
									"",
							})}
						</AlertDialog.Body>
						<AlertDialog.Footer>
							<Button
								variant="tertiary"
								isDisabled={deleteMutation.isPending}
								onPress={() => setDeleteTarget(null)}
							>
								{t("cancel")}
							</Button>
							<Button
								variant="danger"
								isPending={deleteMutation.isPending}
								onPress={() => {
									if (!deleteTarget) return;
									deleteMutation.mutate({
										instanceId: instance.id,
										name: deleteTarget.name,
									});
								}}
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
