import {
	Button,
	FieldError,
	Fieldset,
	Form,
	Input,
	Label,
	Link,
	Modal,
	TextField,
} from "@heroui/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useApi } from "../../../hooks/use-api";
import { createCredentialMutationOptions } from "../../../requests/credentials";

const GITHUB_TOKEN_URL =
	"https://github.com/settings/tokens/new?scopes=repo,read:org&description=aghub";

interface CreateCredentialDialogProps {
	isOpen: boolean;
	onClose: () => void;
	onSuccess: (newId: string) => void;
}

interface FormValues {
	name: string;
	token: string;
}

export function CreateCredentialDialog({
	isOpen,
	onClose,
	onSuccess,
}: CreateCredentialDialogProps) {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();
	const {
		control,
		handleSubmit,
		reset,
		formState: { isSubmitting },
	} = useForm<FormValues>({
		mode: "onSubmit",
		reValidateMode: "onChange",
		defaultValues: { name: "", token: "" },
	});
	const createMutation = useMutation(
		createCredentialMutationOptions({
			api,
			queryClient,
		}),
	);

	const handleClose = () => {
		reset();
		onClose();
	};

	const handleSave = async (values: FormValues) => {
		const result = await createMutation.mutateAsync({
			name: values.name.trim(),
			token: values.token.trim(),
		});
		reset();
		onSuccess(result.id);
		onClose();
	};

	return (
		<Modal.Backdrop
			isOpen={isOpen}
			onOpenChange={(open) => {
				if (!open) handleClose();
			}}
		>
			<Modal.Container>
				<Modal.Dialog>
					<Modal.CloseTrigger />
					<Form
						validationBehavior="aria"
						onSubmit={handleSubmit(handleSave)}
					>
						<Modal.Header>
							<Modal.Heading>
								{t("createCredential")}
							</Modal.Heading>
						</Modal.Header>
						<Modal.Body className="p-2">
							<Fieldset>
								<Controller
									name="name"
									control={control}
									rules={{
										required: t(
											"validationCredentialNameRequired",
										),
										validate: (v) =>
											v.trim()
												? true
												: t(
														"validationCredentialNameRequired",
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
											<Label>{t("credentialName")}</Label>
											<Input
												value={field.value}
												onChange={(e) =>
													field.onChange(
														e.target.value,
													)
												}
												onBlur={field.onBlur}
												placeholder={t(
													"credentialNamePlaceholder",
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
									name="token"
									control={control}
									rules={{
										required: t(
											"validationCredentialTokenRequired",
										),
										validate: (v) =>
											v.trim()
												? true
												: t(
														"validationCredentialTokenRequired",
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
											<Label className="flex w-full items-center justify-between after:content-none">
												<span>
													{t("credentialToken")}
													<span
														className="ml-0.5 text-danger"
														aria-hidden="true"
													>
														*
													</span>
												</span>
												<Link
													className="text-xs font-normal"
													onPress={() =>
														openUrl(
															GITHUB_TOKEN_URL,
														)
													}
												>
													{t(
														"credentialTokenGenerate",
													)}
												</Link>
											</Label>
											<Input
												type="password"
												value={field.value}
												onChange={(e) =>
													field.onChange(
														e.target.value,
													)
												}
												onBlur={field.onBlur}
												placeholder={t(
													"credentialTokenPlaceholder",
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
							</Fieldset>
						</Modal.Body>
						<Modal.Footer>
							<Button
								type="button"
								slot="close"
								variant="secondary"
								onPress={handleClose}
							>
								{t("cancel")}
							</Button>
							<Button type="submit" isDisabled={isSubmitting}>
								{t("create")}
							</Button>
						</Modal.Footer>
					</Form>
				</Modal.Dialog>
			</Modal.Container>
		</Modal.Backdrop>
	);
}
