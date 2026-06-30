import {
	BoltIcon,
	PencilSquareIcon,
	PlusIcon,
	TrashIcon,
} from "@heroicons/react/24/solid";
import {
	AlertDialog,
	Button,
	Card,
	Checkbox,
	FieldError,
	Fieldset,
	Form,
	Input,
	Label,
	ListBox,
	SearchField,
	Select,
	Spinner,
	TextArea,
	TextField,
	toast,
} from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import type {
	CreateHookRequest,
	HookActionDto,
	HookResponse,
} from "../generated/dto";
import { useApi } from "../hooks/use-api";
import { AgentIcon } from "../lib/agent-icons";
import {
	createHookMutationOptions,
	deleteHookMutationOptions,
	hookListQueryOptions,
	updateHookMutationOptions,
} from "../requests/hooks";

type HookAgentId = "claude" | "codex";

type PanelState =
	| { type: "list" }
	| { type: "create" }
	| { type: "edit"; hook: HookResponse };

interface HookAgentOption {
	id: HookAgentId;
	label: string;
}

interface HookFormValues {
	event: string;
	matcher: string;
	type: string;
	command: string;
	url: string;
	prompt: string;
	server: string;
	tool: string;
	timeout: string;
	statusMessage: string;
	isAsync: boolean;
	ifCondition: string;
}

const AGENT_OPTIONS: HookAgentOption[] = [
	{ id: "claude", label: "Claude Code" },
	{ id: "codex", label: "Codex" },
];

const CLAUDE_ACTION_TYPES = [
	"command",
	"http",
	"mcp_tool",
	"prompt",
	"agent",
] as const;

function getDefaultValues(hook?: HookResponse): HookFormValues {
	const action = hook?.action;
	return {
		event: hook?.event ?? "PreToolUse",
		matcher: hook?.matcher ?? "",
		type: action?.type ?? "command",
		command: action?.command ?? "",
		url: action?.url ?? "",
		prompt: action?.prompt ?? "",
		server: action?.server ?? "",
		tool: action?.tool ?? "",
		timeout: action?.timeout ? String(action.timeout) : "",
		statusMessage: action?.statusMessage ?? "",
		isAsync: Boolean(action?.async),
		ifCondition: action?.if ?? "",
	};
}

function trimOrUndefined(value: string): string | undefined {
	const trimmed = value.trim();
	return trimmed ? trimmed : undefined;
}

function buildHookRequest(values: HookFormValues): CreateHookRequest {
	const action: HookActionDto = {
		type: values.type,
	};
	const timeout = Number(values.timeout);

	if (values.type === "command") {
		action.command = trimOrUndefined(values.command);
	}
	if (values.type === "http") {
		action.url = trimOrUndefined(values.url);
	}
	if (values.type === "prompt" || values.type === "agent") {
		action.prompt = trimOrUndefined(values.prompt);
	}
	if (values.type === "mcp_tool") {
		action.server = trimOrUndefined(values.server);
		action.tool = trimOrUndefined(values.tool);
	}
	if (Number.isFinite(timeout) && timeout > 0) {
		action.timeout = timeout;
	}
	action.statusMessage = trimOrUndefined(values.statusMessage);
	if (values.isAsync) {
		action.async = true;
	}
	action.if = trimOrUndefined(values.ifCondition);

	return {
		event: values.event.trim(),
		matcher: trimOrUndefined(values.matcher),
		action,
	};
}

function getActionSummary(action: HookActionDto): string {
	const summary =
		action.command ??
		action.url ??
		action.prompt ??
		[action.server, action.tool].filter(Boolean).join(" / ");
	return summary || action.type;
}

function getSourceLabel(hook: HookResponse): string {
	switch (hook.source_kind) {
		case "claude_settings":
			return "settings.json";
		case "codex_hooks_json":
			return "hooks.json";
		case "codex_config_toml":
			return "config.toml";
	}
}

function HookFormPanel({
	agent,
	mode,
	hook,
	onCancel,
	onSaved,
}: {
	agent: HookAgentId;
	mode: "create" | "edit";
	hook?: HookResponse;
	onCancel: () => void;
	onSaved: (hook: HookResponse) => void;
}) {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();
	const defaultValues = useMemo(() => getDefaultValues(hook), [hook]);
	const {
		control,
		handleSubmit,
		watch,
		setValue,
		formState: { isSubmitting },
	} = useForm<HookFormValues>({ defaultValues });
	const actionType = watch("type");
	const isCodex = agent === "codex";

	useEffect(() => {
		if (isCodex && actionType !== "command") {
			setValue("type", "command");
		}
	}, [actionType, isCodex, setValue]);

	const showError = (error: unknown) => {
		toast.danger(
			error instanceof Error ? error.message : t("hookSaveError"),
		);
	};

	const createMutation = useMutation({
		...createHookMutationOptions({
			api,
			queryClient,
			onSuccess: (data) => {
				toast.success(t("hookCreated"));
				onSaved(data);
			},
		}),
		onError: showError,
	});
	const updateMutation = useMutation({
		...updateHookMutationOptions({
			api,
			queryClient,
			onSuccess: (data) => {
				toast.success(t("hookUpdated"));
				onSaved(data);
			},
		}),
		onError: showError,
	});
	const isSaving =
		isSubmitting || createMutation.isPending || updateMutation.isPending;
	const actionTypes = isCodex ? ["command"] : [...CLAUDE_ACTION_TYPES];

	const onSubmit = (values: HookFormValues) => {
		const body = buildHookRequest(values);
		if (mode === "create") {
			createMutation.mutate({ agent, body });
			return;
		}
		if (!hook) return;
		updateMutation.mutate({ agent, id: hook.id, body });
	};

	return (
		<div className="h-full overflow-y-auto p-4 lg:p-6">
			<Card className="mx-auto max-w-3xl">
				<Card.Header className="flex items-center justify-between gap-3">
					<div>
						<h2 className="text-lg font-semibold text-foreground">
							{mode === "create"
								? t("createHook")
								: t("editHook")}
						</h2>
						<p className="mt-1 text-sm text-muted">
							{agent === "codex"
								? t("codexGlobalHookTarget")
								: t("claudeGlobalHookTarget")}
						</p>
					</div>
				</Card.Header>
				<Card.Content>
					<Form
						validationBehavior="aria"
						onSubmit={handleSubmit(onSubmit)}
					>
						<Fieldset>
							<Fieldset.Group>
								<Controller
									name="event"
									control={control}
									rules={{
										required: t("hookEventRequired"),
										validate: (value) =>
											value.trim()
												? true
												: t("hookEventRequired"),
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
											<Label>{t("hookEvent")}</Label>
											<Input
												value={field.value}
												onChange={(event) =>
													field.onChange(
														event.target.value,
													)
												}
												onBlur={field.onBlur}
												placeholder="PreToolUse"
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
									name="matcher"
									control={control}
									render={({ field }) => (
										<TextField
											className="w-full"
											variant="secondary"
											validationBehavior="aria"
										>
											<Label>{t("hookMatcher")}</Label>
											<Input
												value={field.value}
												onChange={(event) =>
													field.onChange(
														event.target.value,
													)
												}
												onBlur={field.onBlur}
												placeholder="Bash"
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
									name="type"
									control={control}
									render={({ field }) => (
										<Select
											className="w-full"
											selectedKey={field.value}
											onSelectionChange={(key) => {
												if (!key) return;
												field.onChange(String(key));
											}}
											variant="secondary"
										>
											<Label>{t("hookActionType")}</Label>
											<Select.Trigger>
												<Select.Value />
												<Select.Indicator />
											</Select.Trigger>
											<Select.Popover>
												<ListBox>
													{actionTypes.map((type) => (
														<ListBox.Item
															key={type}
															id={type}
															textValue={type}
														>
															{type}
														</ListBox.Item>
													))}
												</ListBox>
											</Select.Popover>
										</Select>
									)}
								/>
								<Controller
									name="timeout"
									control={control}
									rules={{
										validate: (value) =>
											!value.trim() ||
											(Number(value) > 0 &&
												Number.isFinite(Number(value)))
												? true
												: t("hookTimeoutInvalid"),
									}}
									render={({ field, fieldState }) => (
										<TextField
											className="w-full"
											variant="secondary"
											validationBehavior="aria"
											isInvalid={Boolean(
												fieldState.error,
											)}
										>
											<Label>{t("hookTimeout")}</Label>
											<Input
												value={field.value}
												onChange={(event) =>
													field.onChange(
														event.target.value,
													)
												}
												onBlur={field.onBlur}
												type="number"
												min={1}
												placeholder="30"
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

						{actionType === "command" && (
							<Controller
								name="command"
								control={control}
								rules={{
									validate: (value) =>
										value.trim()
											? true
											: t("hookCommandRequired"),
								}}
								render={({ field, fieldState }) => (
									<TextField
										className="w-full"
										variant="secondary"
										isRequired
										validationBehavior="aria"
										isInvalid={Boolean(fieldState.error)}
									>
										<Label>{t("hookCommand")}</Label>
										<TextArea
											value={field.value}
											onChange={(event) =>
												field.onChange(
													event.target.value,
												)
											}
											onBlur={field.onBlur}
											placeholder="node ~/.config/hooks/check.js"
											variant="secondary"
											rows={4}
										/>
										{fieldState.error && (
											<FieldError>
												{fieldState.error.message}
											</FieldError>
										)}
									</TextField>
								)}
							/>
						)}

						{actionType === "http" && (
							<Controller
								name="url"
								control={control}
								rules={{
									validate: (value) =>
										value.trim()
											? true
											: t("hookUrlRequired"),
								}}
								render={({ field, fieldState }) => (
									<TextField
										className="w-full"
										variant="secondary"
										isRequired
										validationBehavior="aria"
										isInvalid={Boolean(fieldState.error)}
									>
										<Label>{t("hookUrl")}</Label>
										<Input
											value={field.value}
											onChange={(event) =>
												field.onChange(
													event.target.value,
												)
											}
											onBlur={field.onBlur}
											placeholder="https://example.com/hook"
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
						)}

						{(actionType === "prompt" ||
							actionType === "agent") && (
							<Controller
								name="prompt"
								control={control}
								rules={{
									validate: (value) =>
										value.trim()
											? true
											: t("hookPromptRequired"),
								}}
								render={({ field, fieldState }) => (
									<TextField
										className="w-full"
										variant="secondary"
										isRequired
										validationBehavior="aria"
										isInvalid={Boolean(fieldState.error)}
									>
										<Label>{t("hookPrompt")}</Label>
										<TextArea
											value={field.value}
											onChange={(event) =>
												field.onChange(
													event.target.value,
												)
											}
											onBlur={field.onBlur}
											placeholder={t(
												"hookPromptPlaceholder",
											)}
											variant="secondary"
											rows={5}
										/>
										{fieldState.error && (
											<FieldError>
												{fieldState.error.message}
											</FieldError>
										)}
									</TextField>
								)}
							/>
						)}

						{actionType === "mcp_tool" && (
							<Fieldset>
								<Fieldset.Group>
									<Controller
										name="server"
										control={control}
										rules={{
											validate: (value) =>
												value.trim()
													? true
													: t("hookServerRequired"),
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
												<Label>{t("hookServer")}</Label>
												<Input
													value={field.value}
													onChange={(event) =>
														field.onChange(
															event.target.value,
														)
													}
													onBlur={field.onBlur}
													placeholder="github"
													variant="secondary"
												/>
												{fieldState.error && (
													<FieldError>
														{
															fieldState.error
																.message
														}
													</FieldError>
												)}
											</TextField>
										)}
									/>
									<Controller
										name="tool"
										control={control}
										rules={{
											validate: (value) =>
												value.trim()
													? true
													: t("hookToolRequired"),
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
												<Label>{t("hookTool")}</Label>
												<Input
													value={field.value}
													onChange={(event) =>
														field.onChange(
															event.target.value,
														)
													}
													onBlur={field.onBlur}
													placeholder="create_issue"
													variant="secondary"
												/>
												{fieldState.error && (
													<FieldError>
														{
															fieldState.error
																.message
														}
													</FieldError>
												)}
											</TextField>
										)}
									/>
								</Fieldset.Group>
							</Fieldset>
						)}

						<Fieldset>
							<Fieldset.Group>
								<Controller
									name="statusMessage"
									control={control}
									render={({ field }) => (
										<TextField
											className="w-full"
											variant="secondary"
											validationBehavior="aria"
										>
											<Label>
												{t("hookStatusMessage")}
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
													"hookStatusMessagePlaceholder",
												)}
												variant="secondary"
											/>
										</TextField>
									)}
								/>
								<Controller
									name="ifCondition"
									control={control}
									render={({ field }) => (
										<TextField
											className="w-full"
											variant="secondary"
											validationBehavior="aria"
										>
											<Label>
												{t("hookIfCondition")}
											</Label>
											<Input
												value={field.value}
												onChange={(event) =>
													field.onChange(
														event.target.value,
													)
												}
												onBlur={field.onBlur}
												placeholder="toolName == 'Bash'"
												variant="secondary"
											/>
										</TextField>
									)}
								/>
							</Fieldset.Group>
						</Fieldset>

						<Controller
							name="isAsync"
							control={control}
							render={({ field }) => (
								<Checkbox
									isSelected={field.value}
									onChange={field.onChange}
									variant="secondary"
								>
									<Checkbox.Control>
										<Checkbox.Indicator />
									</Checkbox.Control>
									<Checkbox.Content>
										{t("hookAsync")}
									</Checkbox.Content>
								</Checkbox>
							)}
						/>

						<div className="flex justify-end gap-2 pt-2">
							<Button
								type="button"
								variant="tertiary"
								onPress={onCancel}
								isDisabled={isSaving}
							>
								{t("cancel")}
							</Button>
							<Button type="submit" isPending={isSaving}>
								{mode === "create" ? t("create") : t("save")}
							</Button>
						</div>
					</Form>
				</Card.Content>
			</Card>
		</div>
	);
}

function HookList({
	agent,
	hooks,
	onCreate,
	onEdit,
	onDelete,
}: {
	agent: HookAgentId;
	hooks: HookResponse[];
	onCreate: () => void;
	onEdit: (hook: HookResponse) => void;
	onDelete: (hook: HookResponse) => void;
}) {
	const { t } = useTranslation();
	const [searchQuery, setSearchQuery] = useState("");
	const filteredHooks = useMemo(() => {
		const q = searchQuery.trim().toLowerCase();
		if (!q) return hooks;
		return hooks.filter((hook) => {
			const action = hook.action;
			return [
				hook.event,
				hook.matcher,
				action.type,
				action.command,
				action.url,
				action.prompt,
				action.server,
				action.tool,
				hook.source_path,
			]
				.filter(Boolean)
				.join(" ")
				.toLowerCase()
				.includes(q);
		});
	}, [hooks, searchQuery]);

	return (
		<div className="flex h-full flex-col">
			<div className="flex min-h-14 items-center justify-between border-b border-border px-4">
				<div className="flex min-w-0 items-center gap-2">
					<AgentIcon
						id={agent}
						name={agent === "claude" ? "Claude Code" : "Codex"}
						size="sm"
						variant="ghost"
					/>
					<div className="min-w-0">
						<h1 className="truncate text-base font-semibold">
							{agent === "claude" ? "Claude Code" : "Codex"}
						</h1>
						<p className="text-xs text-muted">
							{t("globalHooksCount", { count: hooks.length })}
						</p>
					</div>
				</div>
				<Button size="sm" onPress={onCreate}>
					<PlusIcon className="size-4" />
					{t("createHook")}
				</Button>
			</div>

			<div className="border-b border-border p-3">
				<SearchField
					value={searchQuery}
					onChange={setSearchQuery}
					aria-label={t("searchHooks")}
					variant="secondary"
				>
					<SearchField.Group>
						<SearchField.SearchIcon />
						<SearchField.Input placeholder={t("searchHooks")} />
						<SearchField.ClearButton />
					</SearchField.Group>
				</SearchField>
			</div>

			<div className="min-h-0 flex-1 overflow-y-auto p-3">
				{filteredHooks.length === 0 ? (
					<div className="flex h-full items-center justify-center">
						<div className="text-center">
							<BoltIcon className="mx-auto mb-3 size-8 text-muted" />
							<p className="text-sm text-muted">
								{hooks.length === 0
									? t("noHooks")
									: t("noHooksMatch")}
							</p>
						</div>
					</div>
				) : (
					<div className="grid gap-2">
						{filteredHooks.map((hook) => (
							<Card key={hook.id} className="overflow-hidden">
								<Card.Content className="p-3">
									<div className="flex items-start gap-3">
										<div className="min-w-0 flex-1">
											<div className="mb-1 flex flex-wrap items-center gap-2">
												<span className="rounded-md bg-surface px-2 py-0.5 text-xs font-medium text-foreground">
													{hook.event}
												</span>
												<span className="rounded-md bg-default px-2 py-0.5 text-xs text-muted">
													{hook.action.type}
												</span>
												<span className="rounded-md bg-default px-2 py-0.5 text-xs text-muted">
													{getSourceLabel(hook)}
												</span>
											</div>
											<p className="line-clamp-2 break-words text-sm text-foreground">
												{getActionSummary(hook.action)}
											</p>
											{hook.matcher && (
												<p className="mt-1 truncate text-xs text-muted">
													{t("hookMatcher")}:{" "}
													{hook.matcher}
												</p>
											)}
											<p className="mt-1 truncate text-xs text-muted">
												{hook.source_path}
											</p>
										</div>
										<div className="flex shrink-0 items-center gap-1">
											<Button
												isIconOnly
												size="sm"
												variant="ghost"
												aria-label={t("editHook")}
												onPress={() => onEdit(hook)}
											>
												<PencilSquareIcon className="size-4" />
											</Button>
											<Button
												isIconOnly
												size="sm"
												variant="ghost"
												aria-label={t("deleteHook")}
												className="text-danger"
												onPress={() => onDelete(hook)}
											>
												<TrashIcon className="size-4" />
											</Button>
										</div>
									</div>
								</Card.Content>
							</Card>
						))}
					</div>
				)}
			</div>
		</div>
	);
}

export default function HooksPage() {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();
	const [selectedAgent, setSelectedAgent] = useState<HookAgentId>("claude");
	const [panel, setPanel] = useState<PanelState>({ type: "list" });
	const [deleteTarget, setDeleteTarget] = useState<HookResponse | null>(null);
	const {
		data: hooks = [],
		isLoading,
		error: hooksError,
	} = useQuery({
		...hookListQueryOptions({ api }),
	});
	const selectedAgentHooks = useMemo(
		() => hooks.filter((hook) => hook.agent === selectedAgent),
		[hooks, selectedAgent],
	);
	const hookCounts = useMemo(() => {
		const counts = new Map<HookAgentId, number>();
		for (const agent of AGENT_OPTIONS) {
			counts.set(agent.id, 0);
		}
		for (const hook of hooks) {
			if (hook.agent === "claude" || hook.agent === "codex") {
				counts.set(hook.agent, (counts.get(hook.agent) ?? 0) + 1);
			}
		}
		return counts;
	}, [hooks]);
	const deleteMutation = useMutation({
		...deleteHookMutationOptions({
			api,
			queryClient,
			onSuccess: () => {
				toast.success(t("hookDeleted"));
				setDeleteTarget(null);
				setPanel({ type: "list" });
			},
		}),
		onError: (error) => {
			toast.danger(
				error instanceof Error ? error.message : t("hookDeleteError"),
			);
		},
	});

	useEffect(() => {
		if (!hooksError) return;
		toast.danger(
			hooksError instanceof Error
				? hooksError.message
				: t("hookLoadError"),
		);
	}, [hooksError, t]);

	return (
		<div className="flex h-full bg-background">
			<div className="flex w-80 shrink-0 flex-col border-r border-border">
				<div className="border-b border-border p-4">
					<h1 className="text-lg font-semibold text-foreground">
						{t("hooks")}
					</h1>
					<p className="mt-1 text-sm text-muted">
						{t("globalHooks")}
					</p>
				</div>
				{isLoading ? (
					<div className="flex flex-1 items-center justify-center">
						<Spinner />
					</div>
				) : hooksError ? (
					<div className="p-4 text-sm text-danger">
						{t("hookLoadError")}
					</div>
				) : (
					<ListBox
						aria-label={t("hooks")}
						selectionMode="single"
						selectionBehavior="replace"
						selectedKeys={new Set([selectedAgent])}
						onSelectionChange={(keys) => {
							if (keys === "all") return;
							const next = [...keys][0] as
								| HookAgentId
								| undefined;
							if (!next) return;
							setSelectedAgent(next);
							setPanel({ type: "list" });
						}}
						className="p-2"
					>
						{AGENT_OPTIONS.map((agent) => (
							<ListBox.Item
								key={agent.id}
								id={agent.id}
								textValue={agent.label}
								className="data-selected:bg-surface"
							>
								<div className="flex min-w-0 items-center gap-2">
									<AgentIcon
										id={agent.id}
										name={agent.label}
										size="xs"
										variant="ghost"
									/>
									<div className="min-w-0 flex-1">
										<Label className="block truncate">
											{agent.label}
										</Label>
									</div>
									<span className="rounded-md bg-default px-2 py-0.5 text-xs text-muted">
										{hookCounts.get(agent.id) ?? 0}
									</span>
								</div>
							</ListBox.Item>
						))}
					</ListBox>
				)}
			</div>

			<div className="min-w-0 flex-1">
				{panel.type === "create" && (
					<HookFormPanel
						key={`create-${selectedAgent}`}
						agent={selectedAgent}
						mode="create"
						onCancel={() => setPanel({ type: "list" })}
						onSaved={() => setPanel({ type: "list" })}
					/>
				)}
				{panel.type === "edit" && (
					<HookFormPanel
						key={panel.hook.id}
						agent={selectedAgent}
						mode="edit"
						hook={panel.hook}
						onCancel={() => setPanel({ type: "list" })}
						onSaved={() => setPanel({ type: "list" })}
					/>
				)}
				{panel.type === "list" && (
					<HookList
						agent={selectedAgent}
						hooks={selectedAgentHooks}
						onCreate={() => setPanel({ type: "create" })}
						onEdit={(hook) => setPanel({ type: "edit", hook })}
						onDelete={setDeleteTarget}
					/>
				)}
			</div>

			<AlertDialog.Backdrop
				isOpen={Boolean(deleteTarget)}
				onOpenChange={(open) => {
					if (!open) setDeleteTarget(null);
				}}
			>
				<AlertDialog.Container>
					<AlertDialog.Dialog className="sm:max-w-[420px]">
						<AlertDialog.CloseTrigger />
						<AlertDialog.Header>
							<AlertDialog.Icon status="danger" />
							<AlertDialog.Heading>
								{t("deleteHook")}
							</AlertDialog.Heading>
						</AlertDialog.Header>
						<AlertDialog.Body>
							{deleteTarget
								? t("deleteHookConfirm", {
										event: deleteTarget.event,
									})
								: null}
						</AlertDialog.Body>
						<AlertDialog.Footer>
							<Button
								variant="tertiary"
								onPress={() => setDeleteTarget(null)}
							>
								{t("cancel")}
							</Button>
							<Button
								variant="danger"
								isPending={deleteMutation.isPending}
								onPress={() => {
									if (!deleteTarget) return;
									deleteMutation.mutate({
										agent: deleteTarget.agent,
										id: deleteTarget.id,
									});
								}}
							>
								{t("delete")}
							</Button>
						</AlertDialog.Footer>
					</AlertDialog.Dialog>
				</AlertDialog.Container>
			</AlertDialog.Backdrop>
		</div>
	);
}
