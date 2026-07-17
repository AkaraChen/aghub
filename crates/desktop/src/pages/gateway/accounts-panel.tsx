import {
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
	toast,
} from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "../../components/ui/empty";
import type {
	GatewayAuthFileDto,
	GatewayInstanceDto,
} from "../../generated/dto";
import { useApi } from "../../hooks/use-api";
import {
	deleteGatewayAuthFileMutationOptions,
	gatewayAuthFilesQueryOptions,
	invalidateGatewayAuthFileQueries,
} from "../../requests/gateway";
import { AddGatewayAccountDialog } from "./add-account-dialog";
import { formatGatewayModtime } from "./gateway-helpers";

function AccountsTable({
	authFiles,
	pushTargets,
	isPushPending,
	onPush,
	onDelete,
}: {
	authFiles: GatewayAuthFileDto[];
	pushTargets: GatewayInstanceDto[];
	isPushPending: boolean;
	onPush: (file: GatewayAuthFileDto, targetId: string) => void;
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

	const handlePush = (file: GatewayAuthFileDto, targetId: string) => {
		const target = pushTargets.find((item) => item.id === targetId);
		if (!target) return;
		pushMutation.mutate({ file, target });
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
				{instance.kind === "managed" ? (
					<>
						<span className="text-sm text-muted">
							{t("gatewayAccountsDescription")}
						</span>
						<Button
							variant="secondary"
							size="sm"
							onPress={() => setIsAddOpen(true)}
						>
							<PlusIcon className="size-4" />
							{t("gatewayAddAccount")}
						</Button>
					</>
				) : (
					<span className="text-sm text-muted">
						{t("gatewayAddAccountExternalHint")}
					</span>
				)}
			</div>

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
					onPush={handlePush}
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
