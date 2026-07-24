import {
	Button,
	Card,
	FieldError,
	Fieldset,
	Form,
	Input,
	Label,
	TextArea,
	TextField,
} from "@heroui/react";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import type { PromptResponse } from "../../generated/dto";

interface PromptFormValues {
	title: string;
	description: string;
	content: string;
	tags: string[];
}

interface PromptFormFields {
	title: string;
	description: string;
	content: string;
	tags: string;
}

interface PromptFormProps {
	title: string;
	submitLabel: string;
	pendingLabel: string;
	isPending: boolean;
	initial?: PromptResponse;
	onSubmit: (values: PromptFormValues) => void;
	onCancel: () => void;
}

function parseTags(value: string): string[] {
	return value
		.split(",")
		.map((tag) => tag.trim())
		.filter((tag) => tag.length > 0);
}

export function PromptForm({
	title,
	submitLabel,
	pendingLabel,
	isPending,
	initial,
	onSubmit,
	onCancel,
}: PromptFormProps) {
	const { t } = useTranslation();
	const {
		control,
		handleSubmit,
		formState: { isSubmitting },
	} = useForm<PromptFormFields>({
		mode: "onSubmit",
		reValidateMode: "onChange",
		defaultValues: {
			title: initial?.title ?? "",
			description: initial?.description ?? "",
			content: initial?.content ?? "",
			tags: initial ? initial.tags.join(", ") : "",
		},
	});

	const submitting = isPending || isSubmitting;
	const submit = (values: PromptFormFields) => {
		onSubmit({
			title: values.title.trim(),
			description: values.description.trim(),
			content: values.content,
			tags: parseTags(values.tags),
		});
	};

	return (
		<div className="h-full w-full overflow-y-auto p-4 sm:p-6">
			<Card variant="secondary">
				<Card.Header>
					<Card.Title
						render={(props) => <h2 {...props} />}
						className="text-xl"
					>
						{title}
					</Card.Title>
				</Card.Header>
				<Card.Content>
					<Form
						validationBehavior="aria"
						onSubmit={handleSubmit(submit)}
					>
						<Fieldset>
							<Fieldset.Group>
								<Controller
									name="title"
									control={control}
									rules={{
										required: t(
											"validationPromptTitleRequired",
										),
										validate: (value) =>
											value.trim()
												? true
												: t(
														"validationPromptTitleRequired",
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
											<Label>{t("promptTitle")}</Label>
											<Input
												value={field.value}
												onChange={(event) =>
													field.onChange(
														event.target.value,
													)
												}
												onBlur={field.onBlur}
												placeholder={t(
													"promptTitlePlaceholder",
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
									name="description"
									control={control}
									render={({ field }) => (
										<TextField
											className="w-full"
											variant="secondary"
											validationBehavior="aria"
										>
											<Label>
												{t("promptDescription")}
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
													"promptDescriptionPlaceholder",
												)}
												variant="secondary"
											/>
										</TextField>
									)}
								/>
							</Fieldset.Group>
						</Fieldset>

						<Fieldset>
							<Fieldset.Group>
								<Controller
									name="content"
									control={control}
									render={({ field }) => (
										<TextField
											className="w-full"
											variant="secondary"
											validationBehavior="aria"
										>
											<Label>{t("promptContent")}</Label>
											<TextArea
												value={field.value}
												onChange={(event) =>
													field.onChange(
														event.target.value,
													)
												}
												onBlur={field.onBlur}
												placeholder={t(
													"promptContentPlaceholder",
												)}
												variant="secondary"
												className="min-h-48"
											/>
										</TextField>
									)}
								/>
							</Fieldset.Group>
						</Fieldset>

						<Fieldset>
							<Fieldset.Group>
								<Controller
									name="tags"
									control={control}
									render={({ field }) => (
										<TextField
											className="w-full"
											variant="secondary"
											validationBehavior="aria"
										>
											<Label>{t("promptTags")}</Label>
											<Input
												value={field.value}
												onChange={(event) =>
													field.onChange(
														event.target.value,
													)
												}
												onBlur={field.onBlur}
												placeholder={t(
													"promptTagsPlaceholder",
												)}
												variant="secondary"
											/>
										</TextField>
									)}
								/>
							</Fieldset.Group>
						</Fieldset>

						<div className="flex justify-end gap-2 pt-2">
							<Button
								type="button"
								variant="secondary"
								isDisabled={submitting}
								onPress={onCancel}
							>
								{t("cancel")}
							</Button>
							<Button type="submit" isPending={submitting}>
								{submitting ? pendingLabel : submitLabel}
							</Button>
						</div>
					</Form>
				</Card.Content>
			</Card>
		</div>
	);
}
