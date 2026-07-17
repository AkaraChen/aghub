import {
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
import { useApi } from "../../hooks/use-api";
import { createExternalGatewayMutationOptions } from "../../requests/gateway";

interface CreateExternalGatewayFormValues {
	name: string;
	baseUrl: string;
	managementKey: string;
}

interface CreateExternalGatewayDialogProps {
	isOpen: boolean;
	onClose: () => void;
}

export function CreateExternalGatewayDialog({
	isOpen,
	onClose,
}: CreateExternalGatewayDialogProps) {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();
	const {
		control,
		handleSubmit,
		reset,
		formState: { isSubmitting },
	} = useForm<CreateExternalGatewayFormValues>({
		mode: "onSubmit",
		reValidateMode: "onChange",
		defaultValues: {
			name: "",
			baseUrl: "",
			managementKey: "",
		},
	});

	const createMutation = useMutation({
		...createExternalGatewayMutationOptions({
			api,
			queryClient,
			onSuccess: () => {
				toast.success(t("gatewayInstanceCreated"));
				reset();
				onClose();
			},
		}),
		onError: (error) => {
			console.error("Failed to connect external gateway:", error);
			toast.danger(
				error instanceof Error
					? error.message
					: t("gatewayCreateFailed"),
			);
		},
	});

	const handleSave = (values: CreateExternalGatewayFormValues) => {
		createMutation.mutate({
			name: values.name.trim(),
			base_url: values.baseUrl.trim(),
			management_key: values.managementKey.trim(),
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
								{t("gatewayAddExternal")}
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
												placeholder={t(
													"gatewayExternalNamePlaceholder",
												)}
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

								<Controller
									name="baseUrl"
									control={control}
									rules={{
										required: t(
											"validationGatewayBaseUrlRequired",
										),
										validate: (value) =>
											value.trim()
												? true
												: t(
														"validationGatewayBaseUrlRequired",
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
											<Label>{t("gatewayBaseUrl")}</Label>
											<Input
												value={field.value}
												onChange={(event) =>
													field.onChange(
														event.target.value,
													)
												}
												onBlur={field.onBlur}
												placeholder="http://127.0.0.1:8317"
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

								<Controller
									name="managementKey"
									control={control}
									rules={{
										required: t(
											"validationGatewayManagementKeyRequired",
										),
										validate: (value) =>
											value.trim()
												? true
												: t(
														"validationGatewayManagementKeyRequired",
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
											<Label>
												{t("gatewayManagementKey")}
											</Label>
											<Input
												type="password"
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
									createMutation.isPending || isSubmitting
								}
							>
								{t("gatewayConnect")}
							</Button>
						</Modal.Footer>
					</Form>
				</Modal.Dialog>
			</Modal.Container>
		</Modal.Backdrop>
	);
}
