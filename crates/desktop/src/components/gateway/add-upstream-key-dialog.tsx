import {
	Button,
	FieldError,
	Fieldset,
	Form,
	Input,
	Label,
	ListBox,
	Modal,
	Select,
	TextField,
	toast,
} from "@heroui/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import type { GatewayUpstreamProvider } from "../../generated/dto";
import { useApi } from "../../hooks/use-api";
import { addGatewayUpstreamKeyMutationOptions } from "../../requests/gateway";
import { GATEWAY_UPSTREAM_PROVIDER_OPTIONS } from "./gateway-helpers";
import { UpstreamProviderIcon } from "./upstream-provider-icon";

interface AddUpstreamKeyFormValues {
	provider: GatewayUpstreamProvider;
	apiKey: string;
	baseUrl: string;
}

interface AddGatewayUpstreamKeyDialogProps {
	instanceId: string;
	isOpen: boolean;
	onClose: () => void;
}

export function AddGatewayUpstreamKeyDialog({
	instanceId,
	isOpen,
	onClose,
}: AddGatewayUpstreamKeyDialogProps) {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();
	const {
		control,
		handleSubmit,
		reset,
		formState: { isSubmitting },
	} = useForm<AddUpstreamKeyFormValues>({
		mode: "onSubmit",
		reValidateMode: "onChange",
		defaultValues: {
			provider: "gemini",
			apiKey: "",
			baseUrl: "",
		},
	});

	const addMutation = useMutation({
		...addGatewayUpstreamKeyMutationOptions({
			api,
			queryClient,
			onSuccess: () => {
				toast.success(t("gatewayUpstreamKeyAdded"));
				reset();
				onClose();
			},
		}),
		onError: (error) => {
			console.error("Failed to add upstream key:", error);
			toast.danger(
				error instanceof Error
					? error.message
					: t("gatewayUpstreamAddFailed"),
			);
		},
	});

	const handleSave = (values: AddUpstreamKeyFormValues) => {
		addMutation.mutate({
			instanceId,
			body: {
				provider: values.provider,
				api_key: values.apiKey.trim(),
				base_url: values.baseUrl.trim() || null,
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
								{t("gatewayAddUpstreamKey")}
							</Modal.Heading>
						</Modal.Header>
						<Modal.Body className="p-2">
							<Fieldset>
								<Controller
									name="provider"
									control={control}
									render={({ field }) => (
										<Select
											className="w-full"
											variant="secondary"
											selectedKey={field.value}
											onSelectionChange={(key) => {
												if (!key) return;
												field.onChange(
													String(
														key,
													) as GatewayUpstreamProvider,
												);
											}}
										>
											<Label>
												{t("gatewayOauthProviderLabel")}
											</Label>
											<Select.Trigger>
												<Select.Value />
												<Select.Indicator />
											</Select.Trigger>
											<Select.Popover>
												<ListBox>
													{GATEWAY_UPSTREAM_PROVIDER_OPTIONS.map(
														(option) => (
															<ListBox.Item
																key={option.id}
																id={option.id}
																textValue={
																	option.label
																}
															>
																<span className="flex items-center gap-2">
																	<UpstreamProviderIcon
																		logo={
																			option.logo
																		}
																	/>
																	{
																		option.label
																	}
																</span>
																<ListBox.ItemIndicator />
															</ListBox.Item>
														),
													)}
												</ListBox>
											</Select.Popover>
										</Select>
									)}
								/>

								<Controller
									name="apiKey"
									control={control}
									rules={{
										required: t(
											"validationGatewayApiKeyRequired",
										),
										validate: (value) =>
											value.trim()
												? true
												: t(
														"validationGatewayApiKeyRequired",
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
												{t("gatewayUpstreamApiKey")}
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

								<Controller
									name="baseUrl"
									control={control}
									render={({ field }) => (
										<TextField
											className="w-full"
											variant="secondary"
										>
											<Label>
												{t("gatewayUpstreamBaseUrl")}
											</Label>
											<Input
												value={field.value}
												onChange={(event) =>
													field.onChange(
														event.target.value,
													)
												}
												onBlur={field.onBlur}
												placeholder={t(
													"gatewayUpstreamBaseUrlPlaceholder",
												)}
												variant="secondary"
											/>
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
									addMutation.isPending || isSubmitting
								}
							>
								{t("add")}
							</Button>
						</Modal.Footer>
					</Form>
				</Modal.Dialog>
			</Modal.Container>
		</Modal.Backdrop>
	);
}
