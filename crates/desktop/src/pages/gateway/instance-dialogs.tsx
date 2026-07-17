import {
	AlertDialog,
	Button,
	FieldError,
	Fieldset,
	Form,
	Input,
	Label,
	Modal,
	TextField,
	toast,
} from "@heroui/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import type { GatewayInstanceDto } from "../../generated/dto";
import { useApi } from "../../hooks/use-api";
import {
	deleteGatewayInstanceMutationOptions,
	updateGatewayInstanceMutationOptions,
} from "../../requests/gateway";

interface RenameGatewayInstanceFormValues {
	name: string;
}

interface RenameGatewayInstanceDialogProps {
	instance: GatewayInstanceDto;
	isOpen: boolean;
	onClose: () => void;
}

export function RenameGatewayInstanceDialog({
	instance,
	isOpen,
	onClose,
}: RenameGatewayInstanceDialogProps) {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();
	const {
		control,
		handleSubmit,
		formState: { isSubmitting },
	} = useForm<RenameGatewayInstanceFormValues>({
		mode: "onSubmit",
		reValidateMode: "onChange",
		defaultValues: {
			name: instance.name,
		},
	});

	const renameMutation = useMutation({
		...updateGatewayInstanceMutationOptions({
			api,
			queryClient,
			onSuccess: () => {
				toast.success(t("gatewayInstanceUpdated"));
				onClose();
			},
		}),
		onError: (error) => {
			console.error("Failed to rename gateway instance:", error);
			toast.danger(
				error instanceof Error
					? error.message
					: t("gatewayUpdateFailed"),
			);
		},
	});

	const handleSave = (values: RenameGatewayInstanceFormValues) => {
		renameMutation.mutate({
			id: instance.id,
			body: {
				name: values.name.trim(),
				auto_start: null,
				base_url: null,
				management_key: null,
			},
		});
	};

	return (
		<Modal.Backdrop isOpen={isOpen} onOpenChange={onClose}>
			<Modal.Container>
				<Modal.Dialog>
					<Modal.CloseTrigger />
					<Form
						validationBehavior="aria"
						onSubmit={handleSubmit(handleSave)}
					>
						<Modal.Header>
							<Modal.Heading>
								{t("gatewayRenameInstance")}
							</Modal.Heading>
						</Modal.Header>
						<Modal.Body className="p-2">
							<Fieldset>
								<Controller
									name="name"
									control={control}
									rules={{
										required: t(
											"validationGatewayNameRequired",
										),
										validate: (value) =>
											value.trim()
												? true
												: t(
														"validationGatewayNameRequired",
													),
									}}
									render={({ field, fieldState }) => (
										<TextField
											className="w-full"
											variant="secondary"
											isRequired
											validationBehavior="aria"
											isInvalid={Boolean(
												fieldState.error,
											)}
										>
											<Label>{t("name")}</Label>
											<Input
												value={field.value}
												onChange={(event) =>
													field.onChange(
														event.target.value,
													)
												}
												onBlur={field.onBlur}
												variant="secondary"
											/>
											{fieldState.error && (
												<FieldError>
													{fieldState.error.message}
												</FieldError>
											)}
										</TextField>
									)}
								/>
							</Fieldset>
						</Modal.Body>
						<Modal.Footer>
							<Button
								type="button"
								slot="close"
								variant="secondary"
							>
								{t("cancel")}
							</Button>
							<Button
								type="submit"
								isDisabled={
									renameMutation.isPending || isSubmitting
								}
							>
								{t("save")}
							</Button>
						</Modal.Footer>
					</Form>
				</Modal.Dialog>
			</Modal.Container>
		</Modal.Backdrop>
	);
}

interface DeleteGatewayInstanceDialogProps {
	instance: GatewayInstanceDto;
	isOpen: boolean;
	onClose: () => void;
	onDeleted?: () => void;
}

export function DeleteGatewayInstanceDialog({
	instance,
	isOpen,
	onClose,
	onDeleted,
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
				onDeleted?.();
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
