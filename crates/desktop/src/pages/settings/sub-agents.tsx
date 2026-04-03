import {
	CpuChipIcon,
	PlusIcon,
} from "@heroicons/react/24/solid";
import {
	Button,
	Card,
	FieldError,
	Fieldset,
	Form,
	Input,
	Label,
	ListBox,
	Select,
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
import { SubAgentDetail } from "../../components/sub-agent-detail";
import type { SubAgentGroup } from "../../components/sub-agent-detail";
import type { SubAgentResponse, UpdateSubAgentRequest } from "../../generated/dto";
import { useAgentAvailability } from "../../hooks/use-agent-availability";
import { useApi } from "../../hooks/use-api";
import { supportsSubAgent } from "../../lib/agent-capabilities";
import { AgentIcon } from "../../lib/agent-icons";
import {
	getSubAgentMergeKey,
	sortAgents,
} from "../../lib/utils";
import {
	createSubAgentMutationOptions,
	invalidateSubAgentQueries,
	subAgentListQueryOptions,
} from "../../requests/sub-agents";

type PanelState =
	| { type: "empty" }
	| { type: "create" }
	| { type: "detail"; mergeKey: string }
	| { type: "edit"; mergeKey: string };

function formatAgentName(agent: string): string {
	return agent.charAt(0).toUpperCase() + agent.slice(1).toLowerCase();
}

function SubAgentAgentIcons({ items }: { items: SubAgentResponse[] }) {
	const { allAgents } = useAgentAvailability();
	const agents = useMemo(() => {
		const set = new Set<string>();
		for (const item of items) {
			if (item.agent) set.add(item.agent);
		}
		return sortAgents(Array.from(set), allAgents);
	}, [items, allAgents]);

	if (agents.length === 0) return null;

	return (
		<div className="flex shrink-0 items-center -space-x-1">
			{agents.slice(0, 3).map((agentId, idx) => (
				<Tooltip key={agentId} delay={0}>
					<div
						className="relative rounded-full bg-surface ring-1 ring-surface transition-transform hover:scale-110"
						style={{ zIndex: 3 - idx }}
					>
						<AgentIcon
							id={agentId}
							name={formatAgentName(agentId)}
							size="xs"
							variant="ghost"
						/>
					</div>
					<Tooltip.Content>
						{formatAgentName(agentId)}
					</Tooltip.Content>
				</Tooltip>
			))}
			{agents.length > 3 && (
				<div className="relative z-0 flex size-5 items-center justify-center rounded-full bg-default text-[10px] font-medium text-muted ring-1 ring-surface">
					+{agents.length - 3}
				</div>
			)}
		</div>
	);
}

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

	const groupedSubAgents = useMemo(() => {
		const map = new Map<string, SubAgentGroup>();
		for (const agent of subAgents) {
			const key = getSubAgentMergeKey(agent);
			const existing = map.get(key);
			if (existing) {
				existing.items.push(agent);
			} else {
				map.set(key, { mergeKey: key, items: [agent] });
			}
		}
		return Array.from(map.values());
	}, [subAgents]);

	const activeGroup = useMemo(() => {
		if (panel.type === "detail" || panel.type === "edit") {
			return (
				groupedSubAgents.find((g) => g.mergeKey === panel.mergeKey) ??
				null
			);
		}
		return null;
	}, [panel, groupedSubAgents]);

	const filteredGroups = useMemo(() => {
		if (!searchQuery) return groupedSubAgents;
		const q = searchQuery.toLowerCase();
		return groupedSubAgents.filter((g) =>
			g.items[0].name.toLowerCase().includes(q),
		);
	}, [groupedSubAgents, searchQuery]);

	const selectedListKey = useMemo(() => {
		if (panel.type === "detail" || panel.type === "edit") {
			return new Set([panel.mergeKey]);
		}
		return new Set<string>();
	}, [panel]);

	const createMutation = useMutation({
		...createSubAgentMutationOptions({
			api,
			queryClient,
			onSuccess: (data) => {
				toast.success(t("subAgentCreated"));
				setPanel({
					type: "detail",
					mergeKey: getSubAgentMergeKey(data),
				});
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
		mutationFn: async ({
			group,
			body,
		}: {
			group: SubAgentGroup;
			body: UpdateSubAgentRequest;
		}) => {
			const results = await Promise.all(
				group.items.map((item) => {
					if (!item.agent)
						return Promise.resolve<SubAgentResponse | null>(null);
					return api.subAgents.update(
						item.name,
						item.agent,
						item.source === "project" ? "project" : "global",
						body,
					);
				}),
			);
			return results.find((r): r is SubAgentResponse => r !== null);
		},
		onSuccess: async (data) => {
			await invalidateSubAgentQueries(queryClient);
			toast.success(t("subAgentUpdated"));
			if (data) {
				setPanel({
					type: "detail",
					mergeKey: getSubAgentMergeKey(data),
				});
			} else {
				setPanel({ type: "empty" });
			}
		},
		onError: (error) => {
			toast.danger(
				error instanceof Error
					? error.message
					: t("updateSubAgentError"),
			);
		},
	});

	const deleteMutation = useMutation({
		mutationFn: async (group: SubAgentGroup) => {
			await Promise.all(
				group.items.map((item) => {
					if (!item.agent) return Promise.resolve(null);
					return api.subAgents.delete(
						item.name,
						item.agent,
						item.source === "project" ? "project" : "global",
					);
				}),
			);
		},
		onSuccess: async () => {
			await invalidateSubAgentQueries(queryClient);
			toast.success(t("subAgentDeleted"));
			setPanel({ type: "empty" });
		},
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
					{filteredGroups.length === 0 ? (
						<div className="flex h-full flex-col items-center justify-center gap-3 p-6">
							<CpuChipIcon className="size-8 text-muted" />
							<p className="text-center text-sm text-muted">
								{t("noSubAgents")}
							</p>
						</div>
					) : (
						<ListBox
							aria-label={t("subAgents")}
							selectionMode="single"
							selectionBehavior="replace"
							selectedKeys={selectedListKey}
							onSelectionChange={(keys) => {
								if (keys === "all") return;
								const key = [
									...keys,
								][0] as string | undefined;
								if (!key) return;
								setPanel({
									type: "detail",
									mergeKey: key,
								});
							}}
							className="p-2"
						>
							{filteredGroups.map((group) => (
								<ListBox.Item
									key={group.mergeKey}
									id={group.mergeKey}
									textValue={group.items[0].name}
									className="data-selected:bg-surface"
								>
									<div className="flex w-full items-center gap-2">
										<CpuChipIcon className="size-4 shrink-0 text-muted" />
										<Label className="flex-1 truncate">
											{group.items[0].name}
										</Label>
										<SubAgentAgentIcons
											items={group.items}
										/>
									</div>
								</ListBox.Item>
							))}
						</ListBox>
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
									description,
									instruction,
								},
							})
						}
						isLoading={createMutation.isPending}
						onCancel={() => setPanel({ type: "empty" })}
					/>
				)}

				{panel.type === "detail" && activeGroup && (
					<SubAgentDetail
						group={activeGroup}
						onEdit={() =>
							setPanel({
								type: "edit",
								mergeKey: panel.mergeKey,
							})
						}
						onDelete={() => deleteMutation.mutate(activeGroup)}
						isDeleting={deleteMutation.isPending}
					/>
				)}

				{panel.type === "edit" && activeGroup && (
					<SubAgentEditForm
						agent={activeGroup.items[0]}
						onSave={(body) => {
							updateMutation.mutate({
								group: activeGroup,
								body,
							});
						}}
						isLoading={updateMutation.isPending}
						onCancel={() =>
							setPanel({
								type: "detail",
								mergeKey: panel.mergeKey,
							})
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
									rules={{
										required: t(
											"validationDescriptionRequired",
										),
										validate: (v) =>
											v.trim()
												? true
												: t(
														"validationDescriptionRequired",
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

						<Fieldset>
							<Fieldset.Group>
								<Controller
									name="instruction"
									control={control}
									rules={{
										required: t(
											"validationInstructionRequired",
										),
										validate: (v) =>
											v.trim()
												? true
												: t(
														"validationInstructionRequired",
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
			name: values.name.trim() || null,
			description: values.description.trim(),
			instruction: values.instruction.trim(),
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
									rules={{
										required: t(
											"validationDescriptionRequired",
										),
										validate: (v) =>
											v.trim()
												? true
												: t(
														"validationDescriptionRequired",
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

						<Fieldset>
							<Fieldset.Group>
								<Controller
									name="instruction"
									control={control}
									rules={{
										required: t(
											"validationInstructionRequired",
										),
										validate: (v) =>
											v.trim()
												? true
												: t(
														"validationInstructionRequired",
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
				</Card.Content>
			</Card>
		</div>
	);
}

