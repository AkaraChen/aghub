import {
	Button,
	Card,
	FieldError,
	Fieldset,
	Form,
	Input,
	InputGroup,
	Label,
	Tag,
	TagGroup,
	TextArea,
	TextField,
} from "@heroui/react";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import type { PromptResponse } from "../../generated/dto";

interface PromptFormValues {
	title: string;
	description: string;
	category: string;
	content: string;
	tags: string[];
}

interface PromptFormFields {
	title: string;
	description: string;
	category: string;
	content: string;
	tags: string[];
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

interface PromptTagFieldProps {
	value: string[];
	onChange: (tags: string[]) => void;
	onBlur: () => void;
}

function PromptTagField({ value, onChange, onBlur }: PromptTagFieldProps) {
	const { t } = useTranslation();
	const [draft, setDraft] = useState("");
	const canAddTag = draft.trim().length > 0;

	const addTag = (input: string) => {
		const tag = input.trim();
		if (tag && !value.includes(tag)) onChange([...value, tag]);
		setDraft("");
	};

	return (
		<div
			className="flex max-w-md flex-col gap-2"
			onBlur={(event) => {
				if (
					event.relatedTarget instanceof Node &&
					event.currentTarget.contains(event.relatedTarget)
				) {
					return;
				}
				if (draft.trim()) addTag(draft);
				onBlur();
			}}
		>
			<TextField variant="secondary" validationBehavior="aria">
				<Label>{t("promptTags")}</Label>
				<InputGroup fullWidth variant="secondary">
					<InputGroup.Input
						value={draft}
						onChange={(event) => setDraft(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter" || event.key === ",") {
								event.preventDefault();
								addTag(draft);
								return;
							}
							if (
								event.key === "Backspace" &&
								draft.length === 0 &&
								value.length > 0
							) {
								onChange(value.slice(0, -1));
							}
						}}
						placeholder={t("promptTagsPlaceholder")}
						spellCheck={false}
						autoCapitalize="none"
					/>
					<InputGroup.Suffix className="px-1">
						<Button
							type="button"
							size="sm"
							variant="ghost"
							isDisabled={!canAddTag}
							onPress={() => addTag(draft)}
						>
							{t("add")}
						</Button>
					</InputGroup.Suffix>
				</InputGroup>
			</TextField>
			{value.length > 0 && (
				<TagGroup
					aria-label={t("promptTags")}
					size="sm"
					variant="surface"
					onRemove={(keys) =>
						onChange(value.filter((tag) => !keys.has(tag)))
					}
				>
					<TagGroup.List>
						{value.map((tag) => (
							<Tag key={tag} id={tag} textValue={tag}>
								{tag}
								<Tag.RemoveButton
									aria-label={t("removePromptTag", {
										tag,
									})}
								/>
							</Tag>
						))}
					</TagGroup.List>
				</TagGroup>
			)}
		</div>
	);
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
			category: initial?.category ?? "",
			content: initial?.content ?? "",
			tags: initial?.tags ?? [],
		},
	});

	const submitting = isPending || isSubmitting;
	const submit = (values: PromptFormFields) => {
		onSubmit({
			title: values.title.trim(),
			description: values.description.trim(),
			category: values.category.trim(),
			content: values.content,
			tags: values.tags,
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
								<Controller
									name="category"
									control={control}
									render={({ field }) => (
										<TextField
											className="w-full"
											variant="secondary"
											validationBehavior="aria"
										>
											<Label>{t("promptCategory")}</Label>
											<Input
												value={field.value}
												onChange={(event) =>
													field.onChange(
														event.target.value,
													)
												}
												onBlur={field.onBlur}
												placeholder={t(
													"promptCategoryPlaceholder",
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
										<PromptTagField
											value={field.value}
											onChange={field.onChange}
											onBlur={field.onBlur}
										/>
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
