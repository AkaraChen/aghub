import {
	CpuChipIcon,
	ExclamationTriangleIcon,
	PencilIcon,
	PlusIcon,
	TrashIcon,
} from "@heroicons/react/24/solid";
import {
	Button,
	Card,
	Chip,
	FieldError,
	Fieldset,
	Form,
	Input,
	Label,
	ListBox,
	Modal,
	Select,
	Spinner,
	TextArea,
	TextField,
	Tooltip,
	toast,
} from "@heroui/react";
import {
	useMutation,
	useQueryClient,
	useSuspenseQuery,
} from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { ListSearchHeader } from "../../components/list-search-header";
import type { SubAgentResponse } from "../../generated/dto";
import { useAgentAvailability } from "../../hooks/use-agent-availability";
import { useApi } from "../../hooks/use-api";
import { supportsSubAgent } from "../../lib/agent-capabilities";
import { cn } from "../../lib/utils";
import {
	createSubAgentMutationOptions,
	deleteSubAgentMutationOptions,
	subAgentListQueryOptions,
	updateSubAgentMutationOptions,
} from "../../requests/sub-agents";

type PanelState =
	| { type: "empty" }
	| { type: "create" }
	| { type: "detail"; agent: SubAgentResponse }
	| { type: "edit"; agent: SubAgentResponse };

export default function SubAgentsPage() {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();
	const { availableAgents } = useAgentAvailability();
	const [searchQuery, setSearchQuery] = useState("");
	const [panel, setPanel] = useState<PanelState>({ type: "empty" });

	const subAgentCapableAgents = useMemo(
		() => availableAgents.filter((a) => a.isUsable && supportsSubAgent(a)),
		[availableAgents],
	);

	const { data: subAgents = [] } = useSuspenseQuery({
		...subAgentListQueryOptions({ api, scope: "global" }),
	});

	const filteredAgents = useMemo(
		() =>
			subAgents.filter((a) =>
				a.name.toLowerCase().includes(searchQuery.toLowerCase()),
			),
		[subAgents, searchQuery],
	);

	const createMutation = useMutation({
		...createSubAgentMutationOptions({
			api,
			queryClient,
			onSuccess: (data) => {
				toast.success(t("subAgentCreated"));
				setPanel({ type: "detail", agent: data });
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
				setPanel({ type: "detail", agent: data });
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
				setPanel({ type: "empty" });
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

	return (
		<div className="flex h-full">
			{/* List panel */}
			<div className="relative flex w-80 shrink-0 flex-col border-r border-border">
				<ListSearchHeader
					searchValue={searchQuery}
					onSearchChange={setSearchQuery}
					placeholder={t("searchSubAgents")}
					ariaLabel={t("searchSubAgents")}
				>
					<Button
						isIconOnly
						variant="ghost"
						size="sm"
						className="shrink-0"
						onPress={() => setPanel({ type: "create" })}
						aria-label={t("createSubAgent")}
					>
						<PlusIcon className="size-4" />
					</Button>
				</ListSearchHeader>

				<div className="flex-1 overflow-y-auto">
					{filteredAgents.length === 0 ? (
						<div className="flex h-full flex-col items-center justify-center gap-3 p-6">
							<CpuChipIcon className="size-8 text-muted" />
							<p className="text-center text-sm text-muted">
								{t("noSubAgents")}
							</p>
						</div>
					) : (
						<ul className="flex flex-col gap-0.5 p-2">
							{filteredAgents.map((agent) => {
								const isSelected =
									(panel.type === "detail" ||
										panel.type === "edit") &&
									panel.agent.name === agent.name &&
									panel.agent.agent === agent.agent;
								return (
									<li key={`${agent.agent}:${agent.name}`}>
										<button
											type="button"
											onClick={() =>
												setPanel({
													type: "detail",
													agent,
												})
											}
											className={cn(
												"w-full rounded-md px-3 py-2 text-left text-sm transition-colors",
												isSelected
													? "bg-surface font-medium text-foreground"
													: "text-foreground hover:bg-surface-secondary",
											)}
										>
											<div className="flex items-center justify-between gap-2">
												<span className="truncate font-medium">
													{agent.name}
												</span>
												{agent.agent && (
													<span className="shrink-0 rounded-full bg-surface-secondary px-1.5 py-0.5 text-xs text-muted">
														{agent.agent}
													</span>
												)}
											</div>
											{agent.description && (
												<p className="mt-0.5 truncate text-xs text-muted">
													{agent.description}
												</p>
											)}
										</button>
									</li>
								);
							})}
						</ul>
					)}
				</div>
			</div>

			{/* Detail / form panel */}
			<div className="relative flex-1 overflow-hidden">
				{panel.type === "empty" && (
					<div className="flex h-full flex-col items-center justify-center gap-4">
						<div className="text-center">
							<p className="mb-2 text-sm text-muted">
								{t("noSubAgentsDescription")}
							</p>
						</div>
						<Button onPress={() => setPanel({ type: "create" })}>
							<PlusIcon className="mr-2 size-4" />
							{t("createSubAgent")}
						</Button>
					</div>
				)}

				{panel.type === "create" && (
					<SubAgentCreateForm
						agents={subAgentCapableAgents.map((a) => ({
							id: a.id,
							name: a.display_name,
						}))}
						onCreate={({
							agentId,
							name,
							description,
							instruction,
						}) =>
							createMutation.mutate({
								agent: agentId,
								scope: "global",
								body: {
									name,
									description: description || null,
									instruction: instruction || null,
								},
							})
						}
						isLoading={createMutation.isPending}
						onCancel={() => setPanel({ type: "empty" })}
					/>
				)}

				{panel.type === "detail" && (
					<SubAgentDetail
						agent={panel.agent}
						onEdit={() =>
							setPanel({ type: "edit", agent: panel.agent })
						}
						onDelete={() => {
							if (!panel.agent.agent) return;
							deleteMutation.mutate({
								name: panel.agent.name,
								agent: panel.agent.agent,
								scope: "global",
							});
						}}
						isDeleting={deleteMutation.isPending}
					/>
				)}

				{panel.type === "edit" && (
					<SubAgentEditForm
						agent={panel.agent}
						onSave={(body) => {
							if (!panel.agent.agent) return;
							updateMutation.mutate({
								name: panel.agent.name,
								agent: panel.agent.agent,
								scope: "global",
								body,
							});
						}}
						isLoading={updateMutation.isPending}
						onCancel={() =>
							setPanel({ type: "detail", agent: panel.agent })
						}
					/>
				)}
			</div>
		</div>
	);
}

interface AgentOption {
	id: string;
	name: string;
}

interface CreateFormValues {
	agentId: string;
	name: string;
	description: string;
	instruction: string;
}

function SubAgentCreateForm({
	agents,
	onCreate,
	isLoading,
	onCancel,
}: {
	agents: AgentOption[];
	onCreate: (v: {
		agentId: string;
		name: string;
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
	} = useForm<CreateFormValues>({
		mode: "onSubmit",
		reValidateMode: "onChange",
		defaultValues: {
			agentId: agents[0]?.id ?? "",
			name: "",
			description: "",
			instruction: "",
		},
	});

	const onSubmit = (values: CreateFormValues) => {
		onCreate({
			agentId: values.agentId,
			name: values.name.trim(),
			description: values.description.trim(),
			instruction: values.instruction.trim(),
		});
	};

	return (
		<div className="h-full w-full overflow-y-auto p-4 sm:p-6">
			<Card>
				<Card.Header>
					<h2 className="text-xl font-semibold text-foreground">
						{t("createSubAgent")}
					</h2>
				</Card.Header>
				<Card.Content>
					<Form
						validationBehavior="aria"
						onSubmit={handleSubmit(onSubmit)}
					>
						<Fieldset>
							<Fieldset.Group>
								<Controller
									name="agentId"
									control={control}
									render={({ field }) => (
										<Select
											className="w-full"
											selectedKey={field.value}
											onSelectionChange={(key) =>
												field.onChange(key)
											}
											variant="secondary"
											isDisabled={agents.length === 0}
										>
											<Label>
												{t("agentManagement")}
											</Label>
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
							</Fieldset.Group>
						</Fieldset>

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
											isInvalid={Boolean(
												fieldState.error,
											)}
										>
											<Label>{t("subAgentName")}</Label>
											<Input
												value={field.value}
												onChange={(e) =>
													field.onChange(
														e.target.value,
													)
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
									render={({ field }) => (
										<TextField
											className="w-full"
											variant="secondary"
										>
											<Label>
												{t("subAgentDescription")}
											</Label>
											<Input
												value={field.value}
												onChange={(e) =>
													field.onChange(
														e.target.value,
													)
												}
												onBlur={field.onBlur}
												placeholder={t(
													"subAgentDescriptionPlaceholder",
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
									name="instruction"
									control={control}
									render={({ field }) => (
										<TextField
											className="w-full"
											variant="secondary"
										>
											<Label>
												{t("subAgentInstruction")}
											</Label>
											<TextArea
												value={field.value}
												onChange={(e) =>
													field.onChange(
														e.target.value,
													)
												}
												onBlur={field.onBlur}
												placeholder={t(
													"subAgentInstructionPlaceholder",
												)}
												variant="secondary"
												className="min-h-48"
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
								onPress={onCancel}
							>
								{t("cancel")}
							</Button>
							<Button
								type="submit"
								isDisabled={
									isLoading ||
									isSubmitting ||
									agents.length === 0
								}
							>
								{isLoading
									? t("creating")
									: t("createSubAgent")}
							</Button>
						</div>
					</Form>
				</Card.Content>
			</Card>
		</div>
	);
}

interface EditFormValues {
	name: string;
	description: string;
	instruction: string;
}

function SubAgentEditForm({
	agent: initial,
	onSave,
	isLoading,
	onCancel,
}: {
	agent: SubAgentResponse;
	onSave: (v: {
		name: string | null;
		description: string | null;
		instruction: string | null;
	}) => void;
	isLoading: boolean;
	onCancel: () => void;
}) {
	const { t } = useTranslation();

	const {
		control,
		handleSubmit,
		formState: { isSubmitting },
	} = useForm<EditFormValues>({
		mode: "onSubmit",
		reValidateMode: "onChange",
		defaultValues: {
			name: initial.name,
			description: initial.description ?? "",
			instruction: initial.instruction ?? "",
		},
	});

	const onSubmit = (values: EditFormValues) => {
		onSave({
			name: values.name || null,
			description: values.description || null,
			instruction: values.instruction || null,
		});
	};

	return (
		<div className="h-full w-full overflow-y-auto p-4 sm:p-6">
			<Card>
				<Card.Header>
					<h2 className="text-xl font-semibold text-foreground">
						{t("editSubAgent")}
					</h2>
				</Card.Header>
				<Card.Content>
					<Form
						validationBehavior="aria"
						onSubmit={handleSubmit(onSubmit)}
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
											isInvalid={Boolean(
												fieldState.error,
											)}
										>
											<Label>{t("subAgentName")}</Label>
											<Input
												value={field.value}
												onChange={(e) =>
													field.onChange(
														e.target.value,
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
									name="description"
									control={control}
									render={({ field }) => (
										<TextField
											className="w-full"
											variant="secondary"
										>
											<Label>
												{t("subAgentDescription")}
											</Label>
											<Input
												value={field.value}
												onChange={(e) =>
													field.onChange(
														e.target.value,
													)
												}
												onBlur={field.onBlur}
												placeholder={t(
													"subAgentDescriptionPlaceholder",
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
									name="instruction"
									control={control}
									render={({ field }) => (
										<TextField
											className="w-full"
											variant="secondary"
										>
											<Label>
												{t("subAgentInstruction")}
											</Label>
											<TextArea
												value={field.value}
												onChange={(e) =>
													field.onChange(
														e.target.value,
													)
												}
												onBlur={field.onBlur}
												placeholder={t(
													"subAgentInstructionPlaceholder",
												)}
												variant="secondary"
												className="min-h-48"
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
				</Card.Content>
			</Card>
		</div>
	);
}

function SubAgentDetail({
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
	const { t } = useTranslation();
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

	return (
		<>
			<div className="h-full overflow-y-auto">
				<div className="w-full space-y-4 p-4 sm:p-6">
					<Card>
						<Card.Header className="flex flex-row items-start justify-between gap-3">
							<div className="min-w-0 flex-1">
								<h2 className="truncate text-xl font-semibold text-foreground">
									{agent.name}
								</h2>
								{agent.description && (
									<p className="mt-1 text-sm text-muted">
										{agent.description}
									</p>
								)}
							</div>
							<div className="flex items-center gap-2">
								<Tooltip delay={0}>
									<Button
										isIconOnly
										variant="ghost"
										size="md"
										className="min-h-[44px] min-w-[44px] text-muted"
										aria-label={t("editSubAgent")}
										onPress={onEdit}
									>
										<PencilIcon className="size-4" />
									</Button>
									<Tooltip.Content>
										{t("editSubAgent")}
									</Tooltip.Content>
								</Tooltip>
								<Tooltip delay={0}>
									<Button
										isIconOnly
										variant="ghost"
										size="md"
										className="min-h-[44px] min-w-[44px] text-muted hover:text-danger"
										aria-label={t("deleteSubAgent")}
										onPress={() =>
											setDeleteDialogOpen(true)
										}
									>
										<TrashIcon className="size-4" />
									</Button>
									<Tooltip.Content>
										{t("deleteSubAgent")}
									</Tooltip.Content>
								</Tooltip>
							</div>
						</Card.Header>

						<Card.Content className="flex flex-col gap-6">
							{agent.agent && (
								<div className="space-y-3">
									<h3 className="text-xs font-medium uppercase tracking-wider text-muted">
										{t("agentManagement")}
									</h3>
									<Chip
										size="sm"
										variant="soft"
										color="default"
									>
										{agent.agent}
									</Chip>
								</div>
							)}

							<div className="space-y-3">
								<h3 className="text-xs font-medium uppercase tracking-wider text-muted">
									{t("subAgentInstruction")}
								</h3>
								{agent.instruction ? (
									<div className="overflow-x-auto rounded-lg border border-separator bg-surface-secondary px-3 py-2">
										<code className="block whitespace-pre-wrap break-words font-mono text-xs leading-5 text-foreground">
											{agent.instruction}
										</code>
									</div>
								) : (
									<p className="text-sm text-muted">
										{t("subAgentNoInstruction")}
									</p>
								)}
							</div>
						</Card.Content>
					</Card>
				</div>
			</div>

			<Modal.Backdrop
				isOpen={deleteDialogOpen}
				onOpenChange={setDeleteDialogOpen}
			>
				<Modal.Container>
					<Modal.Dialog>
						<Modal.CloseTrigger />
						<Modal.Header>
							<div className="flex items-center gap-2">
								<ExclamationTriangleIcon className="size-5 text-warning" />
								<Modal.Heading>
									{t("deleteSubAgent")}
								</Modal.Heading>
							</div>
						</Modal.Header>
						<Modal.Body>
							<p className="text-sm text-muted">
								{t("deleteSubAgentConfirm", {
									name: agent.name,
								})}
							</p>
						</Modal.Body>
						<Modal.Footer>
							<Button
								slot="close"
								variant="secondary"
								size="md"
								isDisabled={isDeleting}
								className="min-h-[44px]"
								onPress={() => setDeleteDialogOpen(false)}
							>
								{t("cancel")}
							</Button>
							<Button
								variant="danger"
								size="md"
								isDisabled={isDeleting}
								className="min-h-[44px] min-w-[120px]"
								onPress={() => {
									onDelete();
									setDeleteDialogOpen(false);
								}}
							>
								{isDeleting ? (
									<Spinner size="sm" />
								) : (
									t("deleteSubAgent")
								)}
							</Button>
						</Modal.Footer>
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</>
	);
}
