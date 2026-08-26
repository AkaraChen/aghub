import { AlertDialog, Button, toast } from "@heroui/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { GatewayInstanceDto } from "../../generated/dto";
import { useApi } from "../../hooks/use-api";
import { deleteGatewayInstanceMutationOptions } from "../../requests/gateway";

interface DeleteGatewayInstanceDialogProps {
	instance: GatewayInstanceDto;
	isOpen: boolean;
	onClose: () => void;
}

export function DeleteGatewayInstanceDialog({
	instance,
	isOpen,
	onClose,
}: DeleteGatewayInstanceDialogProps) {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();

	const deleteMutation = useMutation({
		...deleteGatewayInstanceMutationOptions({
			api,
			queryClient,
			onSuccess: () => {
				toast.success(t("gatewayInstanceDeleted"));
				onClose();
			},
		}),
		onError: (error) => {
			console.error("Failed to delete gateway instance:", error);
			toast.danger(
				error instanceof Error
					? error.message
					: t("gatewayDeleteFailed"),
			);
		},
	});

	return (
		<AlertDialog.Backdrop isOpen={isOpen} onOpenChange={onClose}>
			<AlertDialog.Container>
				<AlertDialog.Dialog className="sm:max-w-[420px]">
					<AlertDialog.CloseTrigger />
					<AlertDialog.Header>
						<AlertDialog.Icon status="danger" />
						<AlertDialog.Heading>
							{t("gatewayDeleteInstance")}
						</AlertDialog.Heading>
					</AlertDialog.Header>
					<AlertDialog.Body>
						{t("gatewayDeleteInstanceConfirm", {
							name: instance.name,
						})}
					</AlertDialog.Body>
					<AlertDialog.Footer>
						<Button
							variant="tertiary"
							isDisabled={deleteMutation.isPending}
							onPress={onClose}
						>
							{t("cancel")}
						</Button>
						<Button
							variant="danger"
							isPending={deleteMutation.isPending}
							onPress={() => deleteMutation.mutate(instance.id)}
						>
							{t("delete")}
						</Button>
					</AlertDialog.Footer>
				</AlertDialog.Dialog>
			</AlertDialog.Container>
		</AlertDialog.Backdrop>
	);
}
