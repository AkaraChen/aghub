import {
	CpuChipIcon,
	PencilIcon,
	PlusIcon,
	TrashIcon,
} from "@heroicons/react/24/solid";
import {
	Button,
	FieldError,
	Fieldset,
	Form,
	Input,
	Label,
	ListBox,
	Select,
	TextArea,
	TextField,
	toast,
} from "@heroui/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import type { SubAgentResponse } from "../generated/dto";
import { useAgentAvailability } from "../hooks/use-agent-availability";
import { useApi } from "../hooks/use-api";
import {
	supportsSubAgent,
	supportsSubAgentScope,
} from "../lib/agent-capabilities";
import { cn } from "../lib/utils";
import {
	createSubAgentMutationOptions,
	deleteSubAgentMutationOptions,
	updateSubAgentMutationOptions,
} from "../requests/sub-agents";

type PanelMode = "create" | "edit" | null;

interface ProjectSubAgentsProps {
	subAgents: SubAgentResponse[];
	projectPath: string;
	onRefresh: () => void;
	isRefreshing: boolean;
}

export function ProjectSubAgents({
	subAgents,
	projectPath,
}: ProjectSubAgentsProps) {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();
	const { availableAgents } = useAgentAvailability();

	const [panelMode, setPanelMode] = useState<PanelMode>(null);
	const [selected, setSelected] = useState<SubAgentResponse | null>(null);
	const [editTarget, setEditTarget] = useState<SubAgentResponse | null>(null);

	const subAgentCapableAgents = useMemo(
		() =>
			availableAgents.filter(
				(a) =>
					a.isUsable &&
					supportsSubAgent(a) &&
					supportsSubAgentScope(a, "project"),
			),
		[availableAgents],
	);

	const createMutation = useMutation({
		...createSubAgentMutationOptions({
			api,
			queryClient,
			onSuccess: () => {
				toast.success(t("subAgentCreated"));
				setPanelMode(null);
			},
		}),
		onError: (error) => {
			toast.danger(
				error instanceof Error
					? error.message
					: t("createSubAgentError"),
			);
		},
	});

	const updateMutation = useMutation({
		...updateSubAgentMutationOptions({
			api,
			queryClient,
			onSuccess: (data) => {
				toast.success(t("subAgentUpdated"));
				setSelected(data);
				setPanelMode(null);
			},
		}),
		onError: (error) => {
			toast.danger(
				error instanceof Error
					? error.message
					: t("updateSubAgentError"),
			);
		},
	});

	const deleteMutation = useMutation({
		...deleteSubAgentMutationOptions({
			api,
			queryClient,
			onSuccess: () => {
				toast.success(t("subAgentDeleted"));
				setSelected(null);
			},
		}),
		onError: (error) => {
			toast.danger(
				error instanceof Error
					? error.message
					: t("deleteSubAgentError"),
			);
		},
	});

	if (subAgents.length === 0 && !panelMode) {
		return null;
	}

	return (
		<div className="border-t border-border">
			<div className="flex items-center justify-between px-4 py-3">
				<h3 className="text-sm font-medium">{t("subAgents")}</h3>
				<Button
					isIconOnly
					variant="ghost"
					size="sm"
					onPress={() => {
						setPanelMode("create");
						setSelected(null);
					}}
					aria-label={t("createSubAgent")}
				>
					<PlusIcon className="size-4" />
				</Button>
			</div>

			{subAgents.length > 0 && (
				<ul className="px-2 pb-2">
					{subAgents.map((agent) => (
						<li key={`${agent.agent}:${agent.name}`}>
							<button
								type="button"
								onClick={() => {
									setSelected(agent);
									setPanelMode(null);
								}}
								className={cn(
									"w-full rounded-md px-3 py-2 text-left text-sm transition-colors",
									selected?.name === agent.name &&
										selected?.agent === agent.agent
										? "bg-surface font-medium text-foreground"
										: "text-foreground hover:bg-surface-secondary",
								)}
							>
								<div className="flex items-center justify-between gap-2">
									<div className="flex items-center gap-2">
										<CpuChipIcon className="size-3.5 shrink-0 text-muted" />
										<span className="truncate">
											{agent.name}
										</span>
									</div>
									{agent.agent && (
										<span className="shrink-0 rounded-full bg-surface-secondary px-1.5 py-0.5 text-xs text-muted">
											{agent.agent}
										</span>
									)}
								</div>
								{agent.description && (
									<p className="mt-0.5 truncate pl-5 text-xs text-muted">
										{agent.description}
									</p>
								)}
							</button>
						</li>
					))}
				</ul>
			)}

			{selected && !panelMode && (
				<SubAgentInlineDetail
					agent={selected}
					onEdit={() => {
						setEditTarget(selected);
						setPanelMode("edit");
					}}
					onDelete={() => {
						if (!selected.agent) return;
						deleteMutation.mutate({
							name: selected.name,
							agent: selected.agent,
							scope: "project",
							projectRoot: projectPath,
						});
					}}
					isDeleting={deleteMutation.isPending}
				/>
			)}

			{panelMode === "create" && (
				<div className="px-4 pb-4">
					<SubAgentInlineForm
						agents={subAgentCapableAgents.map((a) => ({
							id: a.id,
							name: a.display_name,
						}))}
						onSubmit={({
							agentId,
							name,
							description,
							instruction,
						}) =>
							createMutation.mutate({
								agent: agentId,
								scope: "project",
								projectRoot: projectPath,
								body: {
									name,
									description,
									instruction,
								},
							})
						}
						isLoading={createMutation.isPending}
						onCancel={() => setPanelMode(null)}
					/>
				</div>
			)}

			{panelMode === "edit" && editTarget && (
				<div className="px-4 pb-4">
					<SubAgentInlineEditForm
						agent={editTarget}
						onSubmit={(body) => {
							if (!editTarget.agent) return;
							updateMutation.mutate({
								name: editTarget.name,
								agent: editTarget.agent,
								scope: "project",
								projectRoot: projectPath,
								body,
							});
						}}
						isLoading={updateMutation.isPending}
						onCancel={() => setPanelMode(null)}
					/>
				</div>
			)}
		</div>
	);
}

function SubAgentInlineDetail({
	agent,
	onEdit,
	onDelete,
	isDeleting,
}: {
	agent: SubAgentResponse;
	onEdit: () => void;
	onDelete: () => void;
	isDeleting: boolean;
}) {
	return (
		<div className="mx-2 mb-3 rounded-lg border border-border p-3">
			<div className="flex items-center justify-between gap-2">
				<span className="text-sm font-medium">{agent.name}</span>
				<div className="flex gap-1">
					<Button
						isIconOnly
						variant="ghost"
						size="sm"
						onPress={onEdit}
					>
						<PencilIcon className="size-3.5" />
					</Button>
					<Button
						isIconOnly
						variant="ghost"
						size="sm"
						isDisabled={isDeleting}
						onPress={onDelete}
					>
						<TrashIcon className="size-3.5 text-danger" />
					</Button>
				</div>
			</div>
			{agent.description && (
				<p className="mt-1 text-xs text-muted">{agent.description}</p>
			)}
			{agent.instruction && (
				<div className="mt-2 overflow-x-auto rounded-md border border-separator bg-surface-secondary px-2 py-1.5">
					<code className="block whitespace-pre-wrap break-words font-mono text-xs leading-5 text-foreground">
						{agent.instruction.length > 200
							? `${agent.instruction.slice(0, 200)}…`
							: agent.instruction}
					</code>
				</div>
			)}
		</div>
	);
}

interface InlineCreateValues {
	agentId: string;
	name: string;
	description: string;
	instruction: string;
}

function SubAgentInlineForm({
	agents,
	onSubmit,
	isLoading,
	onCancel,
}: {
	agents: { id: string; name: string }[];
	onSubmit: (v: InlineCreateValues) => void;
	isLoading: boolean;
	onCancel: () => void;
}) {
	const { t } = useTranslation();

	const {
		control,
		handleSubmit,
		formState: { isSubmitting },
	} = useForm<InlineCreateValues>({
		mode: "onSubmit",
		reValidateMode: "onChange",
		defaultValues: {
			agentId: agents[0]?.id ?? "",
			name: "",
			description: "",
			instruction: "",
		},
	});

	const onFormSubmit = (values: InlineCreateValues) => {
		onSubmit({
			agentId: values.agentId,
			name: values.name.trim(),
			description: values.description.trim(),
			instruction: values.instruction.trim(),
		});
	};

	return (
		<div className="flex flex-col gap-3 rounded-lg border border-border p-3">
			<h4 className="text-sm font-medium">{t("createSubAgent")}</h4>

			<Form
				validationBehavior="aria"
				onSubmit={handleSubmit(onFormSubmit)}
			>
				<Fieldset>
					<Fieldset.Group>
						{agents.length > 0 && (
							<Controller
								name="agentId"
								control={control}
								render={({ field }) => (
									<Select
										className="w-full"
										selectedKey={field.value}
										onSelectionChange={(key) =>
											field.onChange(String(key))
										}
										variant="secondary"
									>
										<Label>{t("agentManagement")}</Label>
										<Select.Trigger>
											<Select.Value />
											<Select.Indicator />
										</Select.Trigger>
										<Select.Popover>
											<ListBox>
												{agents.map((a) => (
													<ListBox.Item
														key={a.id}
														id={a.id}
														textValue={a.name}
													>
														{a.name}
													</ListBox.Item>
												))}
											</ListBox>
										</Select.Popover>
									</Select>
								)}
							/>
						)}
						<Controller
							name="name"
							control={control}
							rules={{
								required: t("validationNameRequired"),
								validate: (v) =>
									v.trim()
										? true
										: t("validationNameRequired"),
							}}
							render={({ field, fieldState }) => (
								<TextField
									className="w-full"
									variant="secondary"
									isRequired
									validationBehavior="aria"
									isInvalid={Boolean(fieldState.error)}
								>
									<Label>{t("subAgentName")}</Label>
									<Input
										value={field.value}
										onChange={(e) =>
											field.onChange(e.target.value)
										}
										onBlur={field.onBlur}
										placeholder={t(
											"subAgentNamePlaceholder",
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
							rules={{
								required: t("validationDescriptionRequired"),
								validate: (v) =>
									v.trim()
										? true
										: t("validationDescriptionRequired"),
							}}
							render={({ field, fieldState }) => (
								<TextField
									className="w-full"
									variant="secondary"
									isRequired
									validationBehavior="aria"
									isInvalid={Boolean(fieldState.error)}
								>
									<Label>{t("subAgentDescription")}</Label>
									<Input
										value={field.value}
										onChange={(e) =>
											field.onChange(e.target.value)
										}
										onBlur={field.onBlur}
										placeholder={t(
											"subAgentDescriptionPlaceholder",
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
							name="instruction"
							control={control}
							rules={{
								required: t("validationInstructionRequired"),
								validate: (v) =>
									v.trim()
										? true
										: t("validationInstructionRequired"),
							}}
							render={({ field, fieldState }) => (
								<TextField
									className="w-full"
									variant="secondary"
									isRequired
									validationBehavior="aria"
									isInvalid={Boolean(fieldState.error)}
								>
									<Label>{t("subAgentInstruction")}</Label>
									<TextArea
										value={field.value}
										onChange={(e) =>
											field.onChange(e.target.value)
										}
										onBlur={field.onBlur}
										placeholder={t(
											"subAgentInstructionPlaceholder",
										)}
										className="min-h-24"
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
					</Fieldset.Group>
				</Fieldset>

				<div className="flex justify-end gap-2 pt-2">
					<Button
						type="button"
						variant="secondary"
						onPress={onCancel}
					>
						{t("cancel")}
					</Button>
					<Button
						type="submit"
						isDisabled={
							isLoading || isSubmitting || agents.length === 0
						}
					>
						{isLoading ? t("creating") : t("createSubAgent")}
					</Button>
				</div>
			</Form>
		</div>
	);
}

interface InlineEditValues {
	name: string;
	description: string;
	instruction: string;
}

function SubAgentInlineEditForm({
	agent: initial,
	onSubmit,
	isLoading,
	onCancel,
}: {
	agent: SubAgentResponse;
	onSubmit: (v: {
		name: string | null;
		description: string;
		instruction: string;
	}) => void;
	isLoading: boolean;
	onCancel: () => void;
}) {
	const { t } = useTranslation();

	const {
		control,
		handleSubmit,
		formState: { isSubmitting },
	} = useForm<InlineEditValues>({
		mode: "onSubmit",
		reValidateMode: "onChange",
		defaultValues: {
			name: initial.name,
			description: initial.description ?? "",
			instruction: initial.instruction ?? "",
		},
	});

	const onFormSubmit = (values: InlineEditValues) => {
		onSubmit({
			name: values.name.trim() || null,
			description: values.description.trim(),
			instruction: values.instruction.trim(),
		});
	};

	return (
		<div className="flex flex-col gap-3 rounded-lg border border-border p-3">
			<h4 className="text-sm font-medium">{t("editSubAgent")}</h4>

			<Form
				validationBehavior="aria"
				onSubmit={handleSubmit(onFormSubmit)}
			>
				<Fieldset>
					<Fieldset.Group>
						<Controller
							name="name"
							control={control}
							rules={{
								required: t("validationNameRequired"),
								validate: (v) =>
									v.trim()
										? true
										: t("validationNameRequired"),
							}}
							render={({ field, fieldState }) => (
								<TextField
									className="w-full"
									variant="secondary"
									isRequired
									validationBehavior="aria"
									isInvalid={Boolean(fieldState.error)}
								>
									<Label>{t("subAgentName")}</Label>
									<Input
										value={field.value}
										onChange={(e) =>
											field.onChange(e.target.value)
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
							name="description"
							control={control}
							rules={{
								required: t("validationDescriptionRequired"),
								validate: (v) =>
									v.trim()
										? true
										: t("validationDescriptionRequired"),
							}}
							render={({ field, fieldState }) => (
								<TextField
									className="w-full"
									variant="secondary"
									isRequired
									validationBehavior="aria"
									isInvalid={Boolean(fieldState.error)}
								>
									<Label>{t("subAgentDescription")}</Label>
									<Input
										value={field.value}
										onChange={(e) =>
											field.onChange(e.target.value)
										}
										onBlur={field.onBlur}
										placeholder={t(
											"subAgentDescriptionPlaceholder",
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
							name="instruction"
							control={control}
							rules={{
								required: t("validationInstructionRequired"),
								validate: (v) =>
									v.trim()
										? true
										: t("validationInstructionRequired"),
							}}
							render={({ field, fieldState }) => (
								<TextField
									className="w-full"
									variant="secondary"
									isRequired
									validationBehavior="aria"
									isInvalid={Boolean(fieldState.error)}
								>
									<Label>{t("subAgentInstruction")}</Label>
									<TextArea
										value={field.value}
										onChange={(e) =>
											field.onChange(e.target.value)
										}
										onBlur={field.onBlur}
										placeholder={t(
											"subAgentInstructionPlaceholder",
										)}
										className="min-h-24"
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
					</Fieldset.Group>
				</Fieldset>

				<div className="flex justify-end gap-2 pt-2">
					<Button
						type="button"
						variant="secondary"
						onPress={onCancel}
					>
						{t("cancel")}
					</Button>
					<Button
						type="submit"
						isDisabled={isLoading || isSubmitting}
					>
						{isLoading ? t("saving") : t("save")}
					</Button>
				</div>
			</Form>
		</div>
	);
}
