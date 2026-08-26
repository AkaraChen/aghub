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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { type Control, Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useApi } from "../../hooks/use-api";
import { addGatewayCompatProviderMutationOptions } from "../../requests/gateway";
import { inferenceProviderListQueryOptions } from "../../requests/inference-providers";
import { GATEWAY_MANAGED_PRESET } from "./gateway-helpers";

interface AddCompatProviderFormValues {
	name: string;
	baseUrl: string;
	apiKey: string;
	models: string;
}

function CompatTextField({
	control,
	name,
	label,
	requiredMessage,
	type,
	placeholder,
}: {
	control: Control<AddCompatProviderFormValues>;
	name: keyof AddCompatProviderFormValues;
	label: string;
	requiredMessage?: string;
	type?: "password";
	placeholder?: string;
}) {
	return (
		<Controller
			name={name}
			control={control}
			rules={
				requiredMessage
					? {
							required: requiredMessage,
							validate: (value) =>
								value.trim() ? true : requiredMessage,
						}
					: undefined
			}
			render={({ field, fieldState }) => (
				<TextField
					className="w-full"
					variant="secondary"
					isRequired={Boolean(requiredMessage)}
					validationBehavior="aria"
					isInvalid={Boolean(fieldState.error)}
				>
					<Label>{label}</Label>
					<Input
						type={type}
						value={field.value}
						onChange={(event) => field.onChange(event.target.value)}
						onBlur={field.onBlur}
						placeholder={placeholder}
						variant="secondary"
					/>
					{fieldState.error && (
						<FieldError>{fieldState.error.message}</FieldError>
					)}
				</TextField>
			)}
		/>
	);
}

interface AddGatewayCompatProviderDialogProps {
	instanceId: string;
	isOpen: boolean;
	onClose: () => void;
}

export function AddGatewayCompatProviderDialog({
	instanceId,
	isOpen,
	onClose,
}: AddGatewayCompatProviderDialogProps) {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();
	const [importedProviderId, setImportedProviderId] = useState<string | null>(
		null,
	);
	const {
		control,
		handleSubmit,
		reset,
		setValue,
		formState: { isSubmitting },
	} = useForm<AddCompatProviderFormValues>({
		mode: "onSubmit",
		reValidateMode: "onChange",
		defaultValues: {
			name: "",
			baseUrl: "",
			apiKey: "",
			models: "",
		},
	});

	const { data: providers = [] } = useQuery(
		inferenceProviderListQueryOptions({ api, enabled: isOpen }),
	);
	// Relays already in the inventory can be attached in one step; the
	// gateway's own mirrored entries would create a loop, so skip them.
	const importableProviders = providers.filter(
		(provider) =>
			(provider.format === "openai_completions" ||
				provider.format === "openai_responses") &&
			provider.preset !== GATEWAY_MANAGED_PRESET,
	);
	const importedProvider =
		importableProviders.find(
			(provider) => provider.latin_name === importedProviderId,
		) ?? null;

	const importKeyMutation = useMutation({
		mutationFn: (latinName: string) =>
			api.inferenceProviders.getPassword(latinName),
		onSuccess: (data) => {
			setValue("apiKey", data.api_key, { shouldDirty: true });
		},
		onError: (error) => {
			console.error("Failed to load inference provider key:", error);
			toast.danger(
				error instanceof Error
					? error.message
					: t("inferenceProviderPasswordLoadFailed"),
			);
		},
	});

	const handleImportSelection = (key: string | null) => {
		if (!key || key === "__none__") {
			setImportedProviderId(null);
			return;
		}
		const provider = importableProviders.find(
			(candidate) => candidate.latin_name === key,
		);
		if (!provider) return;
		setImportedProviderId(provider.latin_name);
		setValue("name", provider.display_name, { shouldDirty: true });
		setValue("baseUrl", provider.api_base_url, { shouldDirty: true });
		setValue("models", provider.models.join(", "), { shouldDirty: true });
		importKeyMutation.mutate(provider.latin_name);
	};

	const addMutation = useMutation({
		...addGatewayCompatProviderMutationOptions({
			api,
			queryClient,
			onSuccess: () => {
				toast.success(t("gatewayCompatProviderAdded"));
				reset();
				setImportedProviderId(null);
				onClose();
			},
		}),
		onError: (error) => {
			console.error("Failed to add compat provider:", error);
			toast.danger(
				error instanceof Error
					? error.message
					: t("gatewayUpstreamAddFailed"),
			);
		},
	});

	const handleSave = (values: AddCompatProviderFormValues) => {
		addMutation.mutate({
			instanceId,
			body: {
				name: values.name.trim(),
				base_url: values.baseUrl.trim(),
				api_key: values.apiKey.trim(),
				models: values.models
					.split(",")
					.map((model) => model.trim())
					.filter(Boolean)
					.map((model) => ({ name: model, alias: null })),
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
								{t("gatewayAddCompatProvider")}
							</Modal.Heading>
						</Modal.Header>
						<Modal.Body className="p-2">
							<Fieldset>
								<Select
									className="w-full"
									variant="secondary"
									selectedKey={
										importedProviderId ?? "__none__"
									}
									onSelectionChange={(key) =>
										handleImportSelection(
											key === null ? null : String(key),
										)
									}
								>
									<Label>
										{t("gatewayImportFromInference")}
									</Label>
									<Select.Trigger>
										<Select.Value>
											{importedProvider ? (
												importedProvider.display_name
											) : (
												<span className="text-muted">
													{t(
														"gatewayImportFromInferenceNone",
													)}
												</span>
											)}
										</Select.Value>
										<Select.Indicator />
									</Select.Trigger>
									<Select.Popover>
										<ListBox>
											<ListBox.Item
												id="__none__"
												textValue={t(
													"gatewayImportFromInferenceNone",
												)}
											>
												<span className="text-muted">
													{t(
														"gatewayImportFromInferenceNone",
													)}
												</span>
												<ListBox.ItemIndicator />
											</ListBox.Item>
											{importableProviders.map(
												(provider) => (
													<ListBox.Item
														key={
															provider.latin_name
														}
														id={provider.latin_name}
														textValue={
															provider.display_name
														}
													>
														{provider.display_name}
														<ListBox.ItemIndicator />
													</ListBox.Item>
												),
											)}
										</ListBox>
									</Select.Popover>
								</Select>

								<CompatTextField
									control={control}
									name="name"
									label={t("name")}
									requiredMessage={t(
										"validationGatewayNameRequired",
									)}
								/>
								<CompatTextField
									control={control}
									name="baseUrl"
									label={t("gatewayBaseUrl")}
									requiredMessage={t(
										"validationGatewayBaseUrlRequired",
									)}
									placeholder="https://relay.example.com/v1"
								/>
								<CompatTextField
									control={control}
									name="apiKey"
									label={t("gatewayUpstreamApiKey")}
									requiredMessage={t(
										"validationGatewayApiKeyRequired",
									)}
									type="password"
								/>
								<CompatTextField
									control={control}
									name="models"
									label={t("gatewayCompatModels")}
									placeholder={t(
										"gatewayCompatModelsPlaceholder",
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
									addMutation.isPending ||
									importKeyMutation.isPending ||
									isSubmitting
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
