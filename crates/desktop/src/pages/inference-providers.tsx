import {
	ArrowPathIcon,
	ClipboardDocumentIcon,
	CloudArrowDownIcon,
	CpuChipIcon,
	EyeIcon,
	EyeSlashIcon,
	PencilIcon,
	PlusIcon,
	QuestionMarkCircleIcon,
	ServerIcon,
	TrashIcon,
} from "@heroicons/react/24/solid";
import anthropicLogo from "@lobehub/icons-static-svg/icons/anthropic.svg?raw";
import openAiLogo from "@lobehub/icons-static-svg/icons/openai.svg?raw";
import {
	Accordion,
	Alert,
	AlertDialog,
	Avatar,
	Button,
	Card,
	Checkbox,
	FieldError,
	Fieldset,
	Form,
	Input,
	InputGroup,
	Label,
	ListBox,
	SearchField,
	Select,
	Spinner,
	TextField,
	Tooltip,
	toast,
} from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Fuse from "fuse.js";
import { pinyin } from "pinyin-pro";
import { type Key, useMemo, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { ListSearchHeader } from "../components/list-search-header";
import { ResourceSectionHeader } from "../components/resource-section-header";
import type {
	InferenceProviderFormatDto,
	InferenceProviderResponse,
} from "../generated/dto";
import { useApi } from "../hooks/use-api";
import { AgentIcon } from "../lib/agent-icons";
import { cn } from "../lib/utils";
import { ClaudeInferenceProviderPanel } from "./inference-providers/claude-panel";
import { CodexInferenceProviderPanel } from "./inference-providers/codex-panel";
import { OpenCodeInferenceProviderPanel } from "./inference-providers/opencode-panel";
import {
	createInferenceProviderMutationOptions,
	deleteInferenceProviderMutationOptions,
	inferenceProviderListQueryOptions,
	inferenceProviderPresetsQueryOptions,
	invalidateInferenceProviderQueries,
	updateInferenceProviderMutationOptions,
} from "../requests/inference-providers";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { openUrl } from "@tauri-apps/plugin-opener";
import type {
	AgentProviderResponse,
	InferenceProviderPresetResponse,
} from "../generated/dto";
import { useAgentAvailability } from "../hooks/use-agent-availability";

type CodingAgentId = "opencode" | "codex" | "claude";

type PanelMode =
	| { type: "detail" }
	| { type: "create" }
	| { type: "edit"; provider: InferenceProviderResponse }
	| { type: "agent"; agentId: CodingAgentId };

interface CodingAgentOption {
	id: CodingAgentId;
	label: string;
}

interface FormatOption {
	id: InferenceProviderFormatDto;
	labelKey: string;
	descriptionKey: string;
}

const FORMAT_OPTIONS: FormatOption[] = [
	{
		id: "anthropic",
		labelKey: "inferenceFormatAnthropic",
		descriptionKey: "inferenceFormatAnthropicDescription",
	},
	{
		id: "openai_completions",
		labelKey: "inferenceFormatOpenAiCompletions",
		descriptionKey: "inferenceFormatOpenAiCompletionsDescription",
	},
	{
		id: "openai_responses",
		labelKey: "inferenceFormatOpenAiResponses",
		descriptionKey: "inferenceFormatOpenAiResponsesDescription",
	},
];

function formatLabelKey(format: InferenceProviderFormatDto) {
	return (
		FORMAT_OPTIONS.find((option) => option.id === format)?.labelKey ??
		"providerFormat"
	);
}

const PROVIDER_ID_EXISTS_REGEX = /provider already exists:\s*(.+)/i;
const LATIN_NAME_REGEX = /^[a-z]+$/;
const SVG_FILE_EXTENSION_REGEX = /\.svg$/;
const VENDORED_PROVIDER_LOGOS = import.meta.glob(
	"../assets/inference-provider/*.svg",
	{
		eager: true,
		import: "default",
		query: "?url",
	},
) as Record<string, string>;
const VENDORED_PROVIDER_LOGO_URL_BY_ID = new Map(
	Object.entries(VENDORED_PROVIDER_LOGOS).map(([path, url]) => {
		const fileName = path.slice(path.lastIndexOf("/") + 1);
		return [fileName.replace(SVG_FILE_EXTENSION_REGEX, ""), url];
	}),
);

function makeLatinNameSuggestion(value: string) {
	return pinyin(value, { toneType: "none", type: "array" })
		.join("")
		.toLowerCase()
		.replace(/[^a-z]/g, "");
}

function makeProviderIdConflictExample(providerId: string) {
	return `${providerId}custom`;
}

const CODING_AGENT_OPTIONS: CodingAgentOption[] = [
	{
		id: "opencode",
		label: "OpenCode",
	},
	{
		id: "codex",
		label: "Codex",
	},
	{
		id: "claude",
		label: "Claude Code",
	},
];

interface InferenceProviderFormValues {
	displayName: string;
	latinName: string;
	format: InferenceProviderFormatDto;
	apiBaseUrl: string;
	apiKey: string;
	models: ProviderModelFormValue[];
}

interface ProviderModelFormValue {
	id: string;
	name: string;
	selected: boolean;
}

function createProviderModelFormValue(
	name = "",
	selected = false,
): ProviderModelFormValue {
	const id = `provider-model-${crypto.randomUUID()}`;
	return { id, name, selected };
}

function toProviderModelFormValues(models: string[], selected = true) {
	return models.map((model) => createProviderModelFormValue(model, selected));
}

function ProviderFormatIcon({
	format,
	className,
}: {
	format: InferenceProviderFormatDto;
	className?: string;
}) {
	const svg = format === "anthropic" ? anthropicLogo : openAiLogo;

	return (
		<span
			className={cn(
				"size-4 shrink-0 text-foreground [&>svg]:size-full",
				className,
			)}
			aria-hidden
			// eslint-disable-next-line @eslint-react/dom-no-dangerously-set-innerhtml
			dangerouslySetInnerHTML={{ __html: svg }}
		/>
	);
}

function modelsDevLogoUrl(logo: string) {
	return `https://models.dev/logos/${encodeURIComponent(logo)}.svg`;
}

function getPresetLogoUrl(logo: string) {
	return VENDORED_PROVIDER_LOGO_URL_BY_ID.get(logo) ?? modelsDevLogoUrl(logo);
}

function ProviderIcon({
	format,
	logo,
}: {
	format: InferenceProviderFormatDto;
	logo?: string | null;
}) {
	const logoUrl = logo ? getPresetLogoUrl(logo) : null;

	if (!logoUrl) return <ProviderFormatIcon format={format} />;

	return (
		<Avatar
			className="size-4 shrink-0 rounded-none bg-transparent"
			aria-hidden
		>
			<Avatar.Image
				alt=""
				className="size-4 rounded-none object-contain dark:invert"
				loading="lazy"
				src={logoUrl}
			/>
			<Avatar.Fallback className="size-4 rounded-none bg-transparent" />
		</Avatar>
	);
}

function PresetLogo({ logo }: { logo: string }) {
	return (
		<Avatar
			className="size-4 shrink-0 rounded-none bg-transparent"
			aria-hidden
		>
			<Avatar.Image
				alt=""
				className="size-4 rounded-none object-contain dark:invert"
				loading="lazy"
				src={getPresetLogoUrl(logo)}
			/>
			<Avatar.Fallback className="size-4 rounded-none bg-transparent" />
		</Avatar>
	);
}

function MonoValue({
	children,
	className,
}: {
	children: string;
	className?: string;
}) {
	return (
		<span
			className={cn(
				"block min-w-0 overflow-x-auto rounded-md bg-surface-secondary px-3 py-2 font-mono text-xs leading-5 text-foreground",
				className,
			)}
			title={children}
		>
			{children}
		</span>
	);
}

function normalizeModelNames(models: ProviderModelFormValue[]) {
	return models
		.filter((model) => model.selected)
		.map((model) => model.name.trim())
		.filter(Boolean);
}

function validateModelNames(models: ProviderModelFormValue[], message: string) {
	const seen = new Set<string>();

	for (const model of models) {
		if (!model.selected) continue;
		const name = model.name.trim();
		if (!name) continue;

		const key = name.toLowerCase();
		if (seen.has(key)) return message;
		seen.add(key);
	}

	return true;
}

function validateRequiredModelNames(
	models: ProviderModelFormValue[],
	message: string,
) {
	return normalizeModelNames(models).length > 0 || message;
}

type SyncAgentId = "opencode" | "codex" | "claude";

interface SyncAgentProviderTarget {
	agentId: SyncAgentId;
	providerId: string;
}

function isProviderBackedBy(
	provider: AgentProviderResponse,
	inferenceProviderId: string,
) {
	return (
		provider.source_provider_id === inferenceProviderId ||
		provider.matched_inference_provider?.id === inferenceProviderId
	);
}

const UNCATEGORIZED_GROUP_KEY = "__uncategorized__";

interface ProviderModelGroup {
	key: string;
	label: string;
	isUncategorized: boolean;
	items: ProviderModelFormValue[];
}

function groupProviderModels(
	models: ProviderModelFormValue[],
): ProviderModelGroup[] {
	const buckets = new Map<string, ProviderModelGroup>();
	for (const model of models) {
		const name = model.name.trim();
		const slashIndex = name.indexOf("/");
		const isPrefixed = slashIndex > 0 && slashIndex < name.length - 1;
		const key = isPrefixed
			? name.slice(0, slashIndex)
			: UNCATEGORIZED_GROUP_KEY;
		const existing = buckets.get(key);
		if (existing) {
			existing.items.push(model);
		} else {
			buckets.set(key, {
				key,
				label: isPrefixed ? key : "",
				isUncategorized: !isPrefixed,
				items: [model],
			});
		}
	}

	const groups = Array.from(buckets.values());
	groups.sort((a, b) => {
		if (a.isUncategorized) return 1;
		if (b.isUncategorized) return -1;
		return a.label.localeCompare(b.label);
	});
	return groups;
}

function ProviderModelsEditor({
	value,
	onChange,
	onBlur,
	errorMessage,
	onFetchModels,
	canFetchModels = false,
	fetchModelsDisabledReason,
}: {
	value: ProviderModelFormValue[];
	onChange: (value: ProviderModelFormValue[]) => void;
	onBlur: () => void;
	errorMessage?: string;
	onFetchModels?: () => Promise<string[]>;
	canFetchModels?: boolean;
	fetchModelsDisabledReason?: string;
}) {
	const { t } = useTranslation();
	const emptyModel = useMemo(
		() => createProviderModelFormValue("", true),
		[],
	);
	const [isFetching, setIsFetching] = useState(false);
	const [searchQuery, setSearchQuery] = useState("");
	const [isBatchDeleteOpen, setIsBatchDeleteOpen] = useState(false);
	const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
		() => new Set(),
	);

	const hasRealModels = value.length > 0;
	const trimmedQuery = searchQuery.trim().toLowerCase();
	const filteredModels = useMemo(() => {
		if (!hasRealModels) return [];
		if (!trimmedQuery) return value;
		return value.filter((model) =>
			model.name.toLowerCase().includes(trimmedQuery),
		);
	}, [hasRealModels, trimmedQuery, value]);

	const displayModels = hasRealModels ? filteredModels : [emptyModel];

	const filteredSelectedCount = filteredModels.reduce(
		(count, model) => count + (model.selected ? 1 : 0),
		0,
	);
	const totalSelectedCount = value.reduce(
		(count, model) => count + (model.selected ? 1 : 0),
		0,
	);
	const allFilteredSelected =
		filteredModels.length > 0 &&
		filteredSelectedCount === filteredModels.length;
	const someFilteredSelected =
		filteredSelectedCount > 0 && !allFilteredSelected;

	const filteredGroups = useMemo(
		() => groupProviderModels(filteredModels),
		[filteredModels],
	);
	const useAccordion = hasRealModels && filteredGroups.length > 1;
	const expandedGroupKeys = useMemo(
		() =>
			filteredGroups
				.map((group) => group.key)
				.filter((key) => !collapsedGroups.has(key)),
		[filteredGroups, collapsedGroups],
	);

	const handleExpandedChange = (next: Set<Key>) => {
		const visibleKeys = filteredGroups.map((group) => group.key);
		setCollapsedGroups((prev) => {
			const result = new Set(prev);
			for (const key of visibleKeys) {
				if (next.has(key)) result.delete(key);
				else result.add(key);
			}
			return result;
		});
	};

	const handleAdd = () => {
		onChange([...value, createProviderModelFormValue("", true)]);
	};

	const toggleSelected = (id: string, selected: boolean) => {
		if (value.length === 0) {
			onChange([{ ...emptyModel, selected }]);
			return;
		}
		onChange(
			value.map((model) =>
				model.id === id ? { ...model, selected } : model,
			),
		);
	};

	const handleToggleAllFiltered = (selected: boolean) => {
		const filteredIds = new Set(filteredModels.map((model) => model.id));
		onChange(
			value.map((model) =>
				filteredIds.has(model.id) ? { ...model, selected } : model,
			),
		);
	};

	const handleBatchDelete = () => {
		if (totalSelectedCount === 0) return;
		const remaining = value.filter((model) => !model.selected);
		onChange(remaining);
		setIsBatchDeleteOpen(false);
	};

	const handleFetch = async () => {
		if (!onFetchModels) return;
		setIsFetching(true);
		try {
			const fetched = await onFetchModels();
			const existing = new Set(
				value.map((model) => model.name.trim()).filter(Boolean),
			);
			const additions = fetched
				.filter((name) => !existing.has(name))
				.map((name) => createProviderModelFormValue(name));
			const baseline = value.filter((model) => model.name.trim());
			onChange([...baseline, ...additions]);
			if (additions.length === 0) {
				toast.success(
					t("fetchProviderModelsSuccessNoNew", {
						total: fetched.length,
					}),
				);
			} else {
				toast.success(
					t("fetchProviderModelsSuccess", {
						added: additions.length,
						total: fetched.length,
					}),
				);
			}
		} catch (error) {
			console.error("Failed to fetch provider models:", error);
			const reason =
				error instanceof Error && error.message
					? error.message
					: t("fetchProviderModelsUnknownError");
			toast.danger(t("fetchProviderModelsFailed", { reason }));
		} finally {
			setIsFetching(false);
		}
	};

	const handleRemove = (id: string) => {
		onChange(value.filter((model) => model.id !== id));
	};

	const handleChange = (id: string, modelName: string) => {
		const nextModels =
			value.length > 0
				? value.map((model) =>
						model.id === id ? { ...model, name: modelName } : model,
					)
				: [{ ...emptyModel, name: modelName }];
		onChange(nextModels);
	};

	const renderModelRow = (
		model: ProviderModelFormValue,
		options: { inAccordion?: boolean } = {},
	) => {
		const controlVariant = options.inAccordion ? undefined : "secondary";

		return (
			<div key={model.id} className="flex items-center gap-2">
				<Checkbox
					variant={controlVariant}
					aria-label={t("selectProviderModel", {
						name: model.name || t("providerModelName"),
					})}
					isSelected={model.selected}
					onChange={(selected) => toggleSelected(model.id, selected)}
					className="shrink-0"
				>
					<Checkbox.Control>
						<Checkbox.Indicator />
					</Checkbox.Control>
				</Checkbox>
				<Input
					value={model.name}
					onChange={(event) =>
						handleChange(model.id, event.target.value)
					}
					onBlur={onBlur}
					placeholder={t("providerModelNamePlaceholder")}
					aria-label={t("providerModelName")}
					variant={controlVariant}
					className="my-1.5 min-w-0 flex-1 text-sm"
				/>
				<Button
					type="button"
					isIconOnly
					variant="ghost"
					size="sm"
					className="shrink-0 text-muted"
					aria-label={t("remove")}
					isDisabled={value.length === 0}
					onPress={() => handleRemove(model.id)}
				>
					<TrashIcon className="size-4" />
				</Button>
			</div>
		);
	};

	const fetchModelsButton = onFetchModels ? (
		<Button
			type="button"
			variant="tertiary"
			size="sm"
			isPending={isFetching}
			isDisabled={!canFetchModels}
			onPress={handleFetch}
		>
			{({ isPending }) => (
				<>
					{isPending ? (
						<Spinner color="current" size="sm" />
					) : (
						<CloudArrowDownIcon className="size-4" />
					)}
					{isPending
						? t("fetchProviderModelsPending")
						: t("fetchProviderModels")}
				</>
			)}
		</Button>
	) : null;

	return (
		<>
			<div className="grid gap-2">
				<div className="flex items-start justify-between gap-3">
					<div className="grid gap-0.5">
						<Label>{t("providerModels")}</Label>
					</div>
					<div className="flex shrink-0 items-center gap-2">
						{fetchModelsButton &&
							(fetchModelsDisabledReason ? (
								<Tooltip delay={0}>
									<Tooltip.Trigger>
										{fetchModelsButton}
									</Tooltip.Trigger>
									<Tooltip.Content>
										{fetchModelsDisabledReason}
									</Tooltip.Content>
								</Tooltip>
							) : (
								fetchModelsButton
							))}
						<Button
							type="button"
							variant="secondary"
							size="sm"
							onPress={handleAdd}
						>
							<PlusIcon className="size-4" />
							{t("addProviderModel")}
						</Button>
					</div>
				</div>

				<SearchField
					value={searchQuery}
					onChange={setSearchQuery}
					aria-label={t("searchProviderModels")}
					variant="secondary"
					className="w-full"
					isDisabled={!hasRealModels}
				>
					<SearchField.Group>
						<SearchField.SearchIcon />
						<SearchField.Input
							placeholder={t("searchProviderModelsPlaceholder")}
						/>
						<SearchField.ClearButton />
					</SearchField.Group>
				</SearchField>

				<div className="flex min-h-8 items-center justify-between gap-3 px-1">
					<Checkbox
						variant="secondary"
						aria-label={
							allFilteredSelected
								? t("deselectAllProviderModels")
								: t("selectAllProviderModels")
						}
						isSelected={allFilteredSelected}
						isIndeterminate={someFilteredSelected}
						isDisabled={filteredModels.length === 0}
						onChange={handleToggleAllFiltered}
					>
						<Checkbox.Control>
							<Checkbox.Indicator />
						</Checkbox.Control>
						<Checkbox.Content>
							<span className="text-xs text-muted">
								{t("selectedProviderModelsCount", {
									selected: totalSelectedCount,
									total: value.length,
								})}
							</span>
						</Checkbox.Content>
					</Checkbox>
					{totalSelectedCount > 0 && (
						<Button
							type="button"
							variant="danger"
							size="sm"
							onPress={() => setIsBatchDeleteOpen(true)}
						>
							<TrashIcon className="size-4" />
							{t("deleteSelectedProviderModels", {
								count: totalSelectedCount,
							})}
						</Button>
					)}
				</div>

				<div className="grid max-h-[420px] min-h-0 gap-2 overflow-y-auto pr-1">
					{hasRealModels && filteredModels.length === 0 ? (
						<p className="px-1 py-2 text-sm text-muted">
							{t("noProviderModelsMatch")}
						</p>
					) : useAccordion ? (
						<Accordion
							allowsMultipleExpanded
							expandedKeys={expandedGroupKeys}
							onExpandedChange={handleExpandedChange}
							hideSeparator
							className="rounded-lg bg-surface-secondary"
						>
							{filteredGroups.map((group) => {
								const groupSelected = group.items.reduce(
									(count, model) =>
										count + (model.selected ? 1 : 0),
									0,
								);
								const groupLabel = group.isUncategorized
									? t("providerModelGroupUncategorized")
									: group.label;
								return (
									<Accordion.Item
										key={group.key}
										id={group.key}
									>
										<Accordion.Heading>
											<Accordion.Trigger className="hover:bg-transparent focus:bg-transparent focus-visible:bg-transparent focus-visible:ring-0 focus-visible:outline-none">
												<span className="flex-1 text-left font-medium">
													{groupLabel}
												</span>
												<span className="mx-2 text-xs text-muted">
													{groupSelected > 0
														? t(
																"providerModelGroupCountWithSelected",
																{
																	selected:
																		groupSelected,
																	total: group
																		.items
																		.length,
																},
															)
														: t(
																"providerModelGroupCount",
																{
																	count: group
																		.items
																		.length,
																},
															)}
												</span>
												<Accordion.Indicator />
											</Accordion.Trigger>
										</Accordion.Heading>
										<Accordion.Panel>
											<Accordion.Body>
												<div className="grid gap-2">
													{group.items.map((model) =>
														renderModelRow(model, {
															inAccordion: true,
														}),
													)}
												</div>
											</Accordion.Body>
										</Accordion.Panel>
									</Accordion.Item>
								);
							})}
						</Accordion>
					) : (
						displayModels.map((model) => renderModelRow(model))
					)}
				</div>

				{errorMessage && (
					<p className="text-sm text-danger">{errorMessage}</p>
				)}
			</div>

			<AlertDialog.Backdrop
				isOpen={isBatchDeleteOpen}
				onOpenChange={setIsBatchDeleteOpen}
			>
				<AlertDialog.Container>
					<AlertDialog.Dialog className="sm:max-w-[420px]">
						<AlertDialog.CloseTrigger />
						<AlertDialog.Header>
							<AlertDialog.Icon status="danger" />
							<AlertDialog.Heading>
								{t("confirmDeleteProviderModels")}
							</AlertDialog.Heading>
						</AlertDialog.Header>
						<AlertDialog.Body>
							{t("confirmDeleteProviderModelsBody", {
								count: totalSelectedCount,
							})}
						</AlertDialog.Body>
						<AlertDialog.Footer>
							<Button
								variant="tertiary"
								onPress={() => setIsBatchDeleteOpen(false)}
							>
								{t("cancel")}
							</Button>
							<Button
								variant="danger"
								onPress={handleBatchDelete}
							>
								{t("delete")}
							</Button>
						</AlertDialog.Footer>
					</AlertDialog.Dialog>
				</AlertDialog.Container>
			</AlertDialog.Backdrop>
		</>
	);
}

function ProviderForm({
	mode,
	provider,
	providers,
	presets,
	isPresetsLoading,
	onCancel,
	onSuccess,
}: {
	mode: "create" | "edit";
	provider?: InferenceProviderResponse;
	providers: InferenceProviderResponse[];
	presets: InferenceProviderPresetResponse[];
	isPresetsLoading: boolean;
	onCancel: () => void;
	onSuccess: (provider: InferenceProviderResponse) => void;
}) {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();
	const {
		control,
		handleSubmit,
		setError,
		setValue,
		formState: { isSubmitting },
	} = useForm<InferenceProviderFormValues>({
		mode: "onSubmit",
		reValidateMode: "onChange",
		defaultValues: {
			displayName: provider?.display_name ?? "",
			latinName: provider?.latin_name ?? "",
			format: provider?.format ?? "openai_responses",
			apiBaseUrl: provider?.api_base_url ?? "",
			apiKey: "",
			models: toProviderModelFormValues(provider?.models ?? []),
		},
	});

	const [selectedPresetId, setSelectedPresetId] = useState<string | null>(
		provider?.preset ?? null,
	);
	const [presetSearchQuery, setPresetSearchQuery] = useState("");
	const [pendingEditValues, setPendingEditValues] =
		useState<InferenceProviderFormValues | null>(null);
	const [isSyncPromptOpen, setIsSyncPromptOpen] = useState(false);
	const [isSavingProvider, setIsSavingProvider] = useState(false);
	const [hasEditedLatinName, setHasEditedLatinName] = useState(false);
	const selectedPreset = useMemo(
		() => presets.find((preset) => preset.id === selectedPresetId) ?? null,
		[presets, selectedPresetId],
	);
	const existingProviderIds = useMemo(
		() => new Set(providers.map((item) => item.latin_name)),
		[providers],
	);
	const presetFuse = useMemo(
		() =>
			new Fuse(presets, {
				keys: ["name"],
				threshold: 0.3,
				ignoreLocation: true,
			}),
		[presets],
	);
	const filteredPresets = useMemo(() => {
		const query = presetSearchQuery.trim();
		if (!query) return presets;
		return presetFuse.search(query).map((result) => result.item);
	}, [presetFuse, presetSearchQuery, presets]);

	const formatDuplicateProviderIdError = (providerId: string) =>
		t("validationProviderLatinNameDuplicate", {
			providerId,
			exampleId: makeProviderIdConflictExample(providerId),
		});

	const handleApplyPreset = (preset: InferenceProviderPresetResponse) => {
		setValue("displayName", preset.name, { shouldDirty: true });
		if (!hasEditedLatinName && mode === "create") {
			setValue("latinName", makeLatinNameSuggestion(preset.id), {
				shouldDirty: true,
				shouldValidate: true,
			});
		}
		setValue("apiBaseUrl", preset.api_base_url, { shouldDirty: true });
		setValue("format", preset.format, { shouldDirty: true });
		setValue("models", toProviderModelFormValues(preset.models), {
			shouldDirty: true,
		});
		setSelectedPresetId(preset.id);
	};

	const handlePresetSelectionChange = (key: string | null) => {
		if (!key || key === "__none__") {
			setSelectedPresetId(null);
			return;
		}
		const preset = presets.find((candidate) => candidate.id === key);
		if (preset) handleApplyPreset(preset);
	};

	const handleFormatChange = (
		nextFormat: InferenceProviderFormatDto,
		currentFormat: InferenceProviderFormatDto,
		onChange: (value: InferenceProviderFormatDto) => void,
	) => {
		if (
			selectedPresetId &&
			nextFormat !== currentFormat &&
			(!selectedPreset || nextFormat !== selectedPreset.format)
		) {
			toast.warning(t("providerPresetFormatChanged"));
		}
		onChange(nextFormat);
	};

	const handleNameChange = (
		value: string,
		onChange: (value: string) => void,
	) => {
		onChange(value);
		if (!hasEditedLatinName && mode === "create") {
			setValue("latinName", makeLatinNameSuggestion(value), {
				shouldDirty: true,
				shouldValidate: true,
			});
		}
	};

	const handleLatinNameChange = (
		value: string,
		onChange: (value: string) => void,
	) => {
		setHasEditedLatinName(true);
		onChange(value);
	};

	const [showApiKey, setShowApiKey] = useState(false);
	const canFetchModels = Boolean(selectedPreset);
	const fetchModelsDisabledReason = selectedPreset
		? undefined
		: t("fetchProviderModelsRequiresPreset");

	const handleFetchModels = async () => {
		if (!selectedPreset) {
			throw new Error(t("fetchProviderModelsRequiresPreset"));
		}
		return selectedPreset.models;
	};

	const createMutation = useMutation({
		...createInferenceProviderMutationOptions({
			api,
			queryClient,
		}),
	});
	const updateMutation = useMutation({
		...updateInferenceProviderMutationOptions({
			api,
			queryClient,
		}),
	});

	const activeError =
		mode === "create" ? createMutation.error : updateMutation.error;
	const isPending =
		createMutation.isPending ||
		updateMutation.isPending ||
		isSubmitting ||
		isSavingProvider;

	const findAgentProviderSyncTargets = async (
		inferenceProviderId: string,
	): Promise<SyncAgentProviderTarget[]> => {
		const [openCodeProviders, codexState, claudeState] = await Promise.all([
			api.inferenceProviders.listOpenCode(),
			api.inferenceProviders.getCodexState(),
			api.inferenceProviders.getClaudeState(),
		]);

		return [
			...openCodeProviders
				.filter((item) => isProviderBackedBy(item, inferenceProviderId))
				.map((item) => ({
					agentId: "opencode" as const,
					providerId: item.id,
				})),
			...codexState.providers
				.filter((item) => isProviderBackedBy(item, inferenceProviderId))
				.map((item) => ({
					agentId: "codex" as const,
					providerId: item.id,
				})),
			...claudeState.providers
				.filter((item) => isProviderBackedBy(item, inferenceProviderId))
				.map((item) => ({
					agentId: "claude" as const,
					providerId: item.id,
				})),
		];
	};

	const syncAgentProviders = async (targets: SyncAgentProviderTarget[]) => {
		const results = await Promise.allSettled(
			targets.map((target) => {
				if (target.agentId === "opencode") {
					return api.inferenceProviders.syncOpenCode(
						target.providerId,
					);
				}
				if (target.agentId === "codex") {
					return api.inferenceProviders.syncCodex(target.providerId);
				}
				return api.inferenceProviders.syncClaude(target.providerId);
			}),
		);
		return results.filter((result) => result.status === "rejected").length;
	};

	const saveProvider = async (
		values: InferenceProviderFormValues,
		syncAgents: boolean,
	) => {
		setIsSavingProvider(true);
		const displayName = values.displayName.trim();
		const latinName = values.latinName.trim();
		const apiBaseUrl = values.apiBaseUrl.trim();
		const apiKey = values.apiKey.trim();
		const models = normalizeModelNames(values.models);
		if (models.length === 0) {
			setIsSavingProvider(false);
			return;
		}

		try {
			if (mode === "create") {
				const created = await createMutation.mutateAsync({
					latin_name: latinName,
					display_name: displayName,
					format: values.format,
					api_base_url: apiBaseUrl,
					preset: selectedPresetId,
					api_key: apiKey,
					models,
				});
				toast.success(t("inferenceProviderCreated"));
				onSuccess(created);
				return;
			}

			if (!provider) return;
			const syncTargets = syncAgents
				? await findAgentProviderSyncTargets(provider.id)
				: [];
			const updated = await updateMutation.mutateAsync({
				name: provider.latin_name,
				body: {
					latin_name: null,
					display_name: displayName,
					format: values.format,
					api_base_url: apiBaseUrl,
					api_key: apiKey || null,
					models,
				},
			});
			if (syncTargets.length > 0) {
				const failedCount = await syncAgentProviders(syncTargets);
				await invalidateInferenceProviderQueries(queryClient);
				if (failedCount > 0) {
					toast.danger(
						t("inferenceProviderAgentSyncPartialError", {
							count: failedCount,
							total: syncTargets.length,
						}),
					);
				} else {
					toast.success(
						t("inferenceProviderUpdatedAndAgentSynced", {
							count: syncTargets.length,
						}),
					);
				}
			} else {
				toast.success(t("inferenceProviderUpdated"));
			}
			onSuccess(updated);
		} catch (error) {
			const message =
				error instanceof Error ? error.message : String(error);
			const duplicateProviderId = message
				.match(PROVIDER_ID_EXISTS_REGEX)?.[1]
				?.trim();
			if (duplicateProviderId && mode === "create") {
				setError(
					"latinName",
					{
						type: "server",
						message:
							formatDuplicateProviderIdError(duplicateProviderId),
					},
					{ shouldFocus: true },
				);
			}
			console.error("Failed to save inference provider:", error);
		} finally {
			setIsSavingProvider(false);
		}
	};

	const onSubmit = async (values: InferenceProviderFormValues) => {
		if (mode === "edit") {
			setPendingEditValues(values);
			setIsSyncPromptOpen(true);
			return;
		}
		await saveProvider(values, false);
	};

	const handleConfirmEditSave = async (syncAgents: boolean) => {
		if (!pendingEditValues) return;
		await saveProvider(pendingEditValues, syncAgents);
		setIsSyncPromptOpen(false);
		setPendingEditValues(null);
	};

	const rawErrorMessage =
		activeError instanceof Error
			? activeError.message
			: activeError
				? String(activeError)
				: "";
	const duplicateProviderId = rawErrorMessage
		.match(PROVIDER_ID_EXISTS_REGEX)?.[1]
		?.trim();
	const friendlyErrorMessage = duplicateProviderId
		? formatDuplicateProviderIdError(duplicateProviderId)
		: rawErrorMessage;
	const showActiveError = Boolean(
		activeError && !(mode === "create" && duplicateProviderId),
	);

	return (
		<>
			<div className="h-full overflow-y-auto p-4 sm:p-6">
				{showActiveError && (
					<Alert className="mb-4" status="danger">
						<Alert.Indicator />
						<Alert.Content>
							<Alert.Description>
								{friendlyErrorMessage}
							</Alert.Description>
						</Alert.Content>
					</Alert>
				)}

				{mode === "create" && (
					<Card className="mb-4">
						<Card.Header>
							<div>
								<Card.Title>
									{t("providerPresetsTitle")}
								</Card.Title>
								<Card.Description>
									{t("providerPresetsDescription")}
								</Card.Description>
							</div>
						</Card.Header>
						<Card.Content>
							<Select
								className="w-full"
								variant="secondary"
								aria-label={t("providerPresetsTitle")}
								placeholder={t("providerPresetsPlaceholder")}
								selectedKey={selectedPresetId ?? "__none__"}
								onSelectionChange={(key) =>
									handlePresetSelectionChange(
										key === null ? null : String(key),
									)
								}
							>
								<Select.Trigger>
									<Select.Value>
										{selectedPreset ? (
											<span className="flex min-w-0 items-center gap-2">
												<PresetLogo
													logo={selectedPreset.logo}
												/>
												<span className="truncate">
													{selectedPreset.name}
												</span>
											</span>
										) : (
											<span className="text-muted">
												{t("providerPresetsNone")}
											</span>
										)}
									</Select.Value>
									<Select.Indicator />
								</Select.Trigger>
								<Select.Popover>
									{isPresetsLoading ? (
										<ListBox>
											<ListBox.Item
												id="__none__"
												textValue={t(
													"providerPresetsNone",
												)}
											>
												<span className="text-muted">
													{t("providerPresetsNone")}
												</span>
												<ListBox.ItemIndicator />
											</ListBox.Item>
											<ListBox.Item
												id="__loading__"
												textValue={t(
													"providerPresetsLoading",
												)}
												className="pointer-events-none"
											>
												<div className="flex items-center gap-2 text-sm text-muted">
													<Spinner
														color="current"
														size="sm"
													/>
													<span>
														{t(
															"providerPresetsLoading",
														)}
													</span>
												</div>
											</ListBox.Item>
										</ListBox>
									) : (
										<>
											<div className="sticky top-0 z-10 bg-overlay p-2">
												<SearchField
													value={presetSearchQuery}
													onChange={
														setPresetSearchQuery
													}
													aria-label={t(
														"searchProviderPresets",
													)}
													variant="secondary"
													className="w-full"
												>
													<SearchField.Group>
														<SearchField.SearchIcon />
														<SearchField.Input
															placeholder={t(
																"searchProviderPresetsPlaceholder",
															)}
														/>
														<SearchField.ClearButton />
													</SearchField.Group>
												</SearchField>
											</div>
											<ListBox>
												<ListBox.Item
													id="__none__"
													textValue={t(
														"providerPresetsNone",
													)}
												>
													<span className="text-muted">
														{t(
															"providerPresetsNone",
														)}
													</span>
													<ListBox.ItemIndicator />
												</ListBox.Item>
												{filteredPresets.map(
													(preset) => (
														<ListBox.Item
															key={preset.id}
															id={preset.id}
															textValue={
																preset.name
															}
														>
															<div className="flex min-w-0 flex-1 items-center justify-between gap-3">
																<div className="flex min-w-0 items-center gap-2">
																	<PresetLogo
																		logo={
																			preset.logo
																		}
																	/>
																	<div className="min-w-0 grid gap-0.5">
																		<span className="truncate">
																			{
																				preset.name
																			}
																		</span>
																		{preset.description && (
																			<span className="truncate text-xs text-muted">
																				{
																					preset.description
																				}
																			</span>
																		)}
																	</div>
																</div>
																<span className="shrink-0 text-xs text-muted">
																	{t(
																		formatLabelKey(
																			preset.format,
																		),
																	)}
																</span>
															</div>
															<ListBox.ItemIndicator />
														</ListBox.Item>
													),
												)}
											</ListBox>
											{filteredPresets.length === 0 && (
												<p className="px-3 py-2 text-sm text-muted">
													{t(
														"noProviderPresetsMatch",
													)}
												</p>
											)}
										</>
									)}
								</Select.Popover>
							</Select>
						</Card.Content>
					</Card>
				)}

				<Card>
					<Card.Header>
						<div>
							<Card.Title>
								{mode === "create"
									? t("createInferenceProvider")
									: t("editInferenceProvider")}
							</Card.Title>
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
										name="displayName"
										control={control}
										rules={{
											required: t(
												"validationProviderNameRequired",
											),
											validate: (value) =>
												value.trim()
													? true
													: t(
															"validationProviderNameRequired",
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
													<span className="inline-flex items-center gap-1">
														{t(
															"providerDisplayName",
														)}
														<Tooltip delay={0}>
															<Tooltip.Trigger>
																<span
																	tabIndex={0}
																	aria-label={t(
																		"providerDisplayNameHelp",
																	)}
																	className="relative top-0.5 inline-flex size-4 items-center justify-center text-muted"
																>
																	<QuestionMarkCircleIcon className="size-4" />
																</span>
															</Tooltip.Trigger>
															<Tooltip.Content className="max-w-72">
																{t(
																	"providerDisplayNameHelp",
																)}
															</Tooltip.Content>
														</Tooltip>
													</span>
												</Label>
												<Input
													value={field.value}
													onChange={(event) =>
														handleNameChange(
															event.target.value,
															field.onChange,
														)
													}
													onBlur={field.onBlur}
													placeholder={t(
														"providerNamePlaceholder",
													)}
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

									{mode === "create" && (
										<Controller
											name="latinName"
											control={control}
											rules={{
												required: t(
													"validationProviderLatinNameRequired",
												),
												validate: (value) => {
													const providerId =
														value.trim();
													if (!providerId) {
														return t(
															"validationProviderLatinNameRequired",
														);
													}
													if (
														!LATIN_NAME_REGEX.test(
															providerId,
														)
													) {
														return t(
															"validationProviderLatinNameInvalid",
														);
													}
													if (
														existingProviderIds.has(
															providerId,
														)
													) {
														return formatDuplicateProviderIdError(
															providerId,
														);
													}
													return true;
												},
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
														<span className="inline-flex items-center gap-1">
															{t(
																"providerLatinName",
															)}
															<Tooltip delay={0}>
																<Tooltip.Trigger>
																	<span
																		tabIndex={
																			0
																		}
																		aria-label={t(
																			"providerLatinNameHelp",
																		)}
																		className="relative top-0.5 inline-flex size-4 items-center justify-center text-muted"
																	>
																		<QuestionMarkCircleIcon className="size-4" />
																	</span>
																</Tooltip.Trigger>
																<Tooltip.Content className="max-w-72">
																	{t(
																		"providerLatinNameHelp",
																	)}
																</Tooltip.Content>
															</Tooltip>
														</span>
													</Label>
													<Input
														value={field.value}
														onChange={(event) =>
															handleLatinNameChange(
																event.target
																	.value,
																field.onChange,
															)
														}
														onBlur={field.onBlur}
														placeholder={t(
															"providerLatinNamePlaceholder",
														)}
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
									)}

									<Controller
										name="apiBaseUrl"
										control={control}
										rules={{
											required: t(
												"validationProviderApiBaseUrlRequired",
											),
											validate: (value) =>
												value.trim()
													? true
													: t(
															"validationProviderApiBaseUrlRequired",
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
													<span className="inline-flex items-center gap-1">
														{t(
															"providerApiBaseUrl",
														)}
														<Tooltip delay={0}>
															<Tooltip.Trigger>
																<span
																	tabIndex={0}
																	aria-label={t(
																		"providerApiBaseUrlHelp",
																	)}
																	className="relative top-0.5 inline-flex size-4 items-center justify-center text-muted"
																>
																	<QuestionMarkCircleIcon className="size-4" />
																</span>
															</Tooltip.Trigger>
															<Tooltip.Content className="max-w-72">
																{t(
																	"providerApiBaseUrlHelp",
																)}
															</Tooltip.Content>
														</Tooltip>
													</span>
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
														"providerApiBaseUrlPlaceholder",
													)}
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

									{mode === "create" && (
										<Controller
											name="format"
											control={control}
											render={({ field }) => (
												<Select
													className="w-full"
													selectedKey={field.value}
													onSelectionChange={(
														key,
													) => {
														if (!key) return;
														handleFormatChange(
															key as InferenceProviderFormatDto,
															field.value,
															field.onChange,
														);
													}}
													variant="secondary"
												>
													<Label>
														{t("providerFormat")}
													</Label>
													<Select.Trigger>
														<Select.Value />
														<Select.Indicator />
													</Select.Trigger>
													<Select.Popover>
														<ListBox>
															{FORMAT_OPTIONS.map(
																(option) => (
																	<ListBox.Item
																		key={
																			option.id
																		}
																		id={
																			option.id
																		}
																		textValue={t(
																			option.labelKey,
																		)}
																	>
																		<div className="grid gap-0.5">
																			<Label>
																				{t(
																					option.labelKey,
																				)}
																			</Label>
																			<span className="text-xs text-muted">
																				{t(
																					option.descriptionKey,
																				)}
																			</span>
																		</div>
																	</ListBox.Item>
																),
															)}
														</ListBox>
													</Select.Popover>
												</Select>
											)}
										/>
									)}

									<Controller
										name="apiKey"
										control={control}
										rules={{
											validate: (value) => {
												if (mode === "edit")
													return true;
												return value.trim()
													? true
													: t(
															"validationProviderApiKeyRequired",
														);
											},
										}}
										render={({ field, fieldState }) => (
											<TextField
												className="w-full"
												variant="secondary"
												isRequired={mode === "create"}
												validationBehavior="aria"
												isInvalid={Boolean(
													fieldState.error,
												)}
											>
												<div className="flex items-center justify-between gap-2">
													<Label>
														{t("providerApiKey")}
													</Label>
													{selectedPreset?.homepage && (
														<button
															type="button"
															className="text-xs text-accent hover:underline focus:underline focus:outline-none"
															onClick={() => {
																if (
																	selectedPreset?.homepage
																) {
																	openUrl(
																		selectedPreset.homepage,
																	);
																}
															}}
														>
															{t(
																"providerGetApiKey",
															)}
														</button>
													)}
												</div>
												<InputGroup variant="secondary">
													<InputGroup.Input
														type={
															showApiKey
																? "text"
																: "password"
														}
														value={field.value}
														onChange={(event) =>
															field.onChange(
																event.target
																	.value,
															)
														}
														onBlur={field.onBlur}
														placeholder={
															mode === "create"
																? t(
																		"providerApiKeyPlaceholder",
																	)
																: t(
																		"providerApiKeyEditPlaceholder",
																	)
														}
													/>
													<InputGroup.Suffix className="pr-0">
														<Button
															isIconOnly
															aria-label={
																showApiKey
																	? "Hide"
																	: "Show"
															}
															size="sm"
															variant="ghost"
															onPress={() =>
																setShowApiKey(
																	(v) => !v,
																)
															}
														>
															{showApiKey ? (
																<EyeSlashIcon className="size-4" />
															) : (
																<EyeIcon className="size-4" />
															)}
														</Button>
													</InputGroup.Suffix>
												</InputGroup>
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
										name="models"
										control={control}
										rules={{
											validate: {
												required: (value) =>
													validateRequiredModelNames(
														value,
														t(
															"validationProviderModelsRequired",
														),
													),
												unique: (value) =>
													validateModelNames(
														value,
														t(
															"validationProviderModelNameUnique",
														),
													),
											},
										}}
										render={({ field, fieldState }) => (
											<ProviderModelsEditor
												value={field.value}
												onChange={field.onChange}
												onBlur={field.onBlur}
												errorMessage={
													fieldState.error?.message
												}
												onFetchModels={
													handleFetchModels
												}
												canFetchModels={canFetchModels}
												fetchModelsDisabledReason={
													fetchModelsDisabledReason
												}
											/>
										)}
									/>
								</Fieldset.Group>
							</Fieldset>

							<div className="mt-4 flex justify-end gap-2">
								<Button
									type="button"
									variant="tertiary"
									onPress={onCancel}
									isDisabled={isPending}
								>
									{t("cancel")}
								</Button>
								<Button type="submit" isPending={isPending}>
									{mode === "create"
										? t("create")
										: t("save")}
								</Button>
							</div>
						</Form>
					</Card.Content>
				</Card>
			</div>

			<AlertDialog.Backdrop
				isOpen={isSyncPromptOpen}
				onOpenChange={(open) => {
					if (isPending) return;
					setIsSyncPromptOpen(open);
					if (!open) setPendingEditValues(null);
				}}
			>
				<AlertDialog.Container>
					<AlertDialog.Dialog className="sm:max-w-[460px]">
						<AlertDialog.CloseTrigger />
						<AlertDialog.Header>
							<AlertDialog.Heading>
								{t("confirmInferenceProviderAgentSyncTitle")}
							</AlertDialog.Heading>
						</AlertDialog.Header>
						<AlertDialog.Body>
							<div className="grid gap-2 text-sm text-muted">
								<p>
									{t("confirmInferenceProviderAgentSyncBody")}
								</p>
								<p>
									{t(
										"confirmInferenceProviderAgentSyncManualHint",
									)}
								</p>
							</div>
						</AlertDialog.Body>
						<AlertDialog.Footer>
							<Button
								variant="tertiary"
								isDisabled={isPending}
								onPress={() => {
									setIsSyncPromptOpen(false);
									setPendingEditValues(null);
								}}
							>
								{t("cancel")}
							</Button>
							<Button
								variant="secondary"
								isDisabled={isPending}
								onPress={() => handleConfirmEditSave(false)}
							>
								{t("saveWithoutAgentSync")}
							</Button>
							<Button
								isPending={isPending}
								onPress={() => handleConfirmEditSave(true)}
							>
								{t("saveAndSyncAgentProviders")}
							</Button>
						</AlertDialog.Footer>
					</AlertDialog.Dialog>
				</AlertDialog.Container>
			</AlertDialog.Backdrop>
		</>
	);
}

function ProviderDetail({
	provider,
	onEdit,
	onDeleted,
}: {
	provider: InferenceProviderResponse;
	onEdit: () => void;
	onDeleted: () => void;
}) {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();
	const [isDeleteOpen, setIsDeleteOpen] = useState(false);
	const [revealedKey, setRevealedKey] = useState<string | null>(null);
	const [isCopying, setIsCopying] = useState(false);
	const previewKey = provider.masked_api_key || "••••••••••••••••••••••••";

	const passwordMutation = useMutation({
		mutationFn: (name: string) => api.inferenceProviders.getPassword(name),
		onSuccess: (data) => {
			setRevealedKey(data.api_key);
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

	const deleteMutation = useMutation({
		...deleteInferenceProviderMutationOptions({
			api,
			queryClient,
			onSuccess: async () => {
				setIsDeleteOpen(false);
				toast.success(t("inferenceProviderDeleted"));
				onDeleted();
			},
		}),
		onError: (error) => {
			console.error("Failed to delete inference provider:", error);
			toast.danger(
				error instanceof Error
					? error.message
					: t("deleteInferenceProviderError"),
			);
		},
	});

	const handleReveal = () => {
		if (revealedKey) {
			setRevealedKey(null);
			return;
		}
		passwordMutation.mutate(provider.latin_name);
	};

	const handleCopyKey = async () => {
		setIsCopying(true);
		try {
			const password = revealedKey
				? { api_key: revealedKey }
				: await api.inferenceProviders.getPassword(provider.latin_name);
			await writeText(password.api_key);
			toast.success(t("providerApiKeyCopied"));
		} catch (error) {
			console.error("Failed to copy inference provider key:", error);
			toast.danger(
				error instanceof Error
					? error.message
					: t("providerApiKeyCopyFailed"),
			);
		} finally {
			setIsCopying(false);
		}
	};

	const handleCopyModel = async (modelName: string) => {
		try {
			await writeText(modelName);
			toast.success(t("providerModelNameCopied"));
		} catch (error) {
			console.error("Failed to copy inference model name:", error);
			toast.danger(
				error instanceof Error
					? error.message
					: t("providerModelNameCopyFailed"),
			);
		}
	};

	return (
		<>
			<div className="h-full overflow-y-auto">
				<div className="w-full p-4 sm:p-6">
					<Card>
						<Card.Header className="flex flex-row items-start justify-between gap-3">
							<div className="flex min-w-0 items-center gap-3">
								<ProviderIcon
									format={provider.format}
									logo={provider.preset}
								/>
								<div className="min-w-0">
									<h2 className="truncate text-xl font-semibold text-foreground">
										{provider.display_name}
									</h2>
								</div>
							</div>
							<div className="flex shrink-0 items-center gap-2">
								<Tooltip delay={0}>
									<Tooltip.Trigger>
										<Button
											isIconOnly
											variant="ghost"
											size="md"
											className="min-h-[44px] min-w-[44px] text-muted"
											aria-label={t(
												"editInferenceProvider",
											)}
											onPress={onEdit}
										>
											<PencilIcon className="size-4" />
										</Button>
									</Tooltip.Trigger>
									<Tooltip.Content>
										{t("edit")}
									</Tooltip.Content>
								</Tooltip>
								<Tooltip delay={0}>
									<Tooltip.Trigger>
										<Button
											isIconOnly
											variant="ghost"
											size="md"
											className="min-h-[44px] min-w-[44px] text-muted hover:text-danger"
											aria-label={t(
												"deleteInferenceProvider",
											)}
											onPress={() =>
												setIsDeleteOpen(true)
											}
										>
											<TrashIcon className="size-4" />
										</Button>
									</Tooltip.Trigger>
									<Tooltip.Content>
										{t("delete")}
									</Tooltip.Content>
								</Tooltip>
							</div>
						</Card.Header>

						<Card.Content className="flex flex-col gap-4">
							<div className="grid gap-1.5 py-1">
								<h3 className="text-xs font-medium tracking-wider text-muted uppercase">
									{t("providerFormat")}
								</h3>
								<MonoValue>
									{t(formatLabelKey(provider.format))}
								</MonoValue>
							</div>

							<div className="grid gap-1.5 py-1">
								<h3 className="text-xs font-medium tracking-wider text-muted uppercase">
									{t("providerApiBaseUrl")}
								</h3>
								<MonoValue>{provider.api_base_url}</MonoValue>
							</div>

							<div className="grid gap-1.5 py-1">
								<h3 className="text-xs font-medium tracking-wider text-muted uppercase">
									{t("providerApiKey")}
								</h3>
								<div className="flex min-w-0 items-center gap-2">
									<MonoValue className="flex-1">
										{revealedKey ?? previewKey}
									</MonoValue>
									<Button
										isIconOnly
										variant="tertiary"
										size="sm"
										aria-label={
											revealedKey
												? t("hideProviderApiKey")
												: t("revealProviderApiKey")
										}
										isPending={passwordMutation.isPending}
										onPress={handleReveal}
									>
										{revealedKey ? (
											<EyeSlashIcon className="size-4" />
										) : (
											<EyeIcon className="size-4" />
										)}
									</Button>
									<Button
										isIconOnly
										variant="tertiary"
										size="sm"
										aria-label={t("copyProviderApiKey")}
										isPending={isCopying}
										onPress={handleCopyKey}
									>
										<ClipboardDocumentIcon className="size-4" />
									</Button>
								</div>
							</div>

							<div className="grid gap-1.5 py-1">
								<h3 className="text-xs font-medium tracking-wider text-muted uppercase">
									{t("providerModels")}
								</h3>
								{provider.models.length === 0 ? (
									<p className="text-sm text-muted">
										{t("noProviderModels")}
									</p>
								) : (
									<div className="flex flex-wrap gap-2">
										{provider.models.map((model) => (
											<button
												key={model}
												type="button"
												className="max-w-full cursor-pointer truncate rounded-md bg-surface-secondary px-2.5 py-1 font-mono text-xs leading-5 text-foreground transition-colors hover:bg-default focus:ring-2 focus:ring-accent/40 focus:outline-none"
												aria-label={t(
													"copyProviderModelName",
													{ name: model },
												)}
												title={model}
												onClick={() =>
													handleCopyModel(model)
												}
											>
												{model}
											</button>
										))}
									</div>
								)}
							</div>
						</Card.Content>
					</Card>
				</div>
			</div>

			<AlertDialog.Backdrop
				isOpen={isDeleteOpen}
				onOpenChange={setIsDeleteOpen}
			>
				<AlertDialog.Container>
					<AlertDialog.Dialog className="sm:max-w-[420px]">
						<AlertDialog.CloseTrigger />
						<AlertDialog.Header>
							<AlertDialog.Icon status="danger" />
							<AlertDialog.Heading>
								{t("deleteInferenceProvider")}
							</AlertDialog.Heading>
						</AlertDialog.Header>
						<AlertDialog.Body>
							{t("deleteInferenceProviderConfirm", {
								name: provider.display_name,
							})}
						</AlertDialog.Body>
						<AlertDialog.Footer>
							<Button
								variant="tertiary"
								onPress={() => setIsDeleteOpen(false)}
							>
								{t("cancel")}
							</Button>
							<Button
								variant="danger"
								isPending={deleteMutation.isPending}
								onPress={() =>
									deleteMutation.mutate(provider.latin_name)
								}
							>
								{t("delete")}
							</Button>
						</AlertDialog.Footer>
					</AlertDialog.Dialog>
				</AlertDialog.Container>
			</AlertDialog.Backdrop>
		</>
	);
}

export default function InferenceProvidersPage() {
	const { t } = useTranslation();
	const api = useApi();
	const { availableAgents } = useAgentAvailability();
	const [searchQuery, setSearchQuery] = useState("");
	const [selectedLatinName, setSelectedLatinName] = useState<string | null>(
		null,
	);
	const [panel, setPanel] = useState<PanelMode>({ type: "detail" });

	const {
		data: providers = [],
		isLoading,
		isFetching,
		refetch,
	} = useQuery({
		...inferenceProviderListQueryOptions({ api }),
	});
	const { data: presets = [], isLoading: isPresetsLoading } = useQuery({
		...inferenceProviderPresetsQueryOptions({ api }),
	});

	const codingAgents = useMemo(
		() =>
			availableAgents
				.filter((agent) => agent.isUsable)
				.flatMap((agent) => {
					const option = CODING_AGENT_OPTIONS.find(
						(candidate) => candidate.id === agent.id,
					);
					return option
						? [
								{
									...option,
									label: agent.display_name,
								},
							]
						: [];
				}),
		[availableAgents],
	);

	const codingAgentFuse = useMemo(
		() =>
			new Fuse(codingAgents, {
				keys: [
					{ name: "label", weight: 2 },
					{ name: "id", weight: 1 },
				],
				threshold: 0.4,
				ignoreLocation: true,
			}),
		[codingAgents],
	);

	const filteredCodingAgents = useMemo(() => {
		const query = searchQuery.trim();
		if (!query) return codingAgents;

		return codingAgentFuse.search(query).map((result) => result.item);
	}, [codingAgentFuse, codingAgents, searchQuery]);

	const providerFuse = useMemo(
		() =>
			new Fuse(providers, {
				keys: [
					{ name: "display_name", weight: 2 },
					{ name: "models", weight: 2 },
					{ name: "latin_name", weight: 1 },
					{ name: "api_base_url", weight: 1 },
					{ name: "format", weight: 1 },
				],
				threshold: 0.4,
				ignoreLocation: true,
			}),
		[providers],
	);

	const filteredProviders = useMemo(() => {
		const query = searchQuery.trim();
		if (!query) return providers;

		return providerFuse.search(query).map((result) => result.item);
	}, [providerFuse, providers, searchQuery]);

	const activeProvider = useMemo(() => {
		if (selectedLatinName) {
			const selected = providers.find(
				(provider) => provider.latin_name === selectedLatinName,
			);
			if (selected) return selected;
		}
		return providers[0] ?? null;
	}, [providers, selectedLatinName]);

	const hasCodingAgent = (agentId: CodingAgentId) =>
		codingAgents.some((agent) => agent.id === agentId);

	const resolvedPanel: PanelMode =
		panel.type === "agent" && !hasCodingAgent(panel.agentId)
			? { type: "detail" }
			: panel;

	const selectedAgentId =
		resolvedPanel.type === "agent" ? resolvedPanel.agentId : null;

	const selectedAgentKeys = useMemo(() => {
		return selectedAgentId ? new Set([selectedAgentId]) : new Set<string>();
	}, [selectedAgentId]);

	const selectedProviderKeys = useMemo(() => {
		return activeProvider &&
			(resolvedPanel.type === "detail" || resolvedPanel.type === "edit")
			? new Set([activeProvider.latin_name])
			: new Set<string>();
	}, [activeProvider, resolvedPanel.type]);

	const handleCreatedOrUpdated = (provider: InferenceProviderResponse) => {
		setSelectedLatinName(provider.latin_name);
		setPanel({ type: "detail" });
	};

	const handleAgentClick = (agentId: CodingAgentId) => {
		if (!hasCodingAgent(agentId)) return;
		setSelectedLatinName(null);
		setPanel({ type: "agent", agentId });
	};

	const handleProviderClick = (latinName: string) => {
		setSelectedLatinName(latinName);
		setPanel({ type: "detail" });
	};

	const handleEditProviderByName = (latinName: string) => {
		const provider = providers.find(
			(provider) => provider.latin_name === latinName,
		);
		setSelectedLatinName(latinName);
		setPanel(provider ? { type: "edit", provider } : { type: "detail" });
	};

	if (isLoading) {
		return (
			<div className="flex h-full items-center justify-center">
				<Spinner size="lg" />
			</div>
		);
	}

	return (
		<div className="flex h-full">
			<div className="relative flex w-80 shrink-0 flex-col border-r border-border">
				<ListSearchHeader
					searchValue={searchQuery}
					onSearchChange={setSearchQuery}
					placeholder={t("searchInferenceProviderResources")}
					ariaLabel={t("searchInferenceProviderResources")}
				>
					<Tooltip delay={0}>
						<Tooltip.Trigger>
							<Button
								isIconOnly
								variant="ghost"
								size="sm"
								aria-label={t("createInferenceProvider")}
								onPress={() => {
									setSelectedLatinName(null);
									setPanel({ type: "create" });
								}}
							>
								<PlusIcon className="size-4" />
							</Button>
						</Tooltip.Trigger>
						<Tooltip.Content>{t("add")}</Tooltip.Content>
					</Tooltip>
					<Tooltip delay={0}>
						<Tooltip.Trigger>
							<Button
								isIconOnly
								variant="ghost"
								size="sm"
								aria-label={t("refreshInferenceProviders")}
								onPress={() => refetch()}
							>
								<ArrowPathIcon
									className={cn(
										"size-4",
										isFetching && "animate-spin",
									)}
								/>
							</Button>
						</Tooltip.Trigger>
						<Tooltip.Content>{t("refresh")}</Tooltip.Content>
					</Tooltip>
				</ListSearchHeader>

				<div className="flex-1 overflow-y-auto">
					<ResourceSectionHeader
						title={t("codingAgents")}
						count={filteredCodingAgents.length}
						icon={<CpuChipIcon className="size-3.5" />}
					/>
					{filteredCodingAgents.length === 0 ? (
						<div className="px-4 py-4 text-center">
							<p className="text-sm text-muted">
								{searchQuery.trim()
									? t("noCodingAgentsMatch")
									: t("noAgentsAvailable")}
							</p>
						</div>
					) : (
						<ListBox
							aria-label={t("codingAgents")}
							selectionMode="single"
							selectionBehavior="replace"
							selectedKeys={selectedAgentKeys}
							onSelectionChange={(keys) => {
								if (keys === "all") return;
								const agentId = [...keys][0] as
									| CodingAgentId
									| undefined;
								if (!agentId) return;
								handleAgentClick(agentId);
							}}
							className="p-2"
						>
							{filteredCodingAgents.map((agent) => (
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
									</div>
								</ListBox.Item>
							))}
						</ListBox>
					)}

					<ResourceSectionHeader
						title={t("inferenceProviders")}
						count={filteredProviders.length}
						icon={<ServerIcon className="size-3.5" />}
					/>
					{filteredProviders.length === 0 ? (
						<div className="px-4 py-4 text-center">
							<p className="text-sm text-muted">
								{providers.length === 0
									? t("noInferenceProviders")
									: t("noInferenceProvidersMatch")}
							</p>
						</div>
					) : (
						<ListBox
							aria-label={t("inferenceProviders")}
							selectionMode="single"
							selectionBehavior="replace"
							selectedKeys={selectedProviderKeys}
							onSelectionChange={(keys) => {
								if (keys === "all") return;
								const latinName = [...keys][0];
								if (!latinName) return;
								handleProviderClick(String(latinName));
							}}
							className="p-2"
						>
							{filteredProviders.map((provider) => (
								<ListBox.Item
									key={provider.latin_name}
									id={provider.latin_name}
									textValue={`${provider.display_name} ${provider.latin_name}`}
									className="data-selected:bg-surface"
								>
									<div className="flex min-w-0 items-center gap-2">
										<ProviderIcon
											format={provider.format}
											logo={provider.preset}
										/>
										<div className="min-w-0 flex-1">
											<Label className="block truncate">
												{provider.display_name}
											</Label>
										</div>
									</div>
								</ListBox.Item>
							))}
						</ListBox>
					)}
				</div>
			</div>

			<div className="relative flex-1 overflow-hidden">
				{resolvedPanel.type === "agent" &&
					resolvedPanel.agentId === "opencode" && (
						<OpenCodeInferenceProviderPanel
							onEditInferenceProvider={handleEditProviderByName}
						/>
					)}

				{resolvedPanel.type === "agent" &&
					resolvedPanel.agentId === "codex" && (
						<CodexInferenceProviderPanel
							onEditInferenceProvider={handleEditProviderByName}
						/>
					)}

				{resolvedPanel.type === "agent" &&
					resolvedPanel.agentId === "claude" && (
						<ClaudeInferenceProviderPanel
							onEditInferenceProvider={handleEditProviderByName}
						/>
					)}

				{resolvedPanel.type === "create" && (
					<ProviderForm
						mode="create"
						providers={providers}
						presets={presets}
						isPresetsLoading={isPresetsLoading}
						onCancel={() => setPanel({ type: "detail" })}
						onSuccess={handleCreatedOrUpdated}
					/>
				)}

				{resolvedPanel.type === "edit" && (
					<ProviderForm
						key={resolvedPanel.provider.latin_name}
						mode="edit"
						provider={resolvedPanel.provider}
						providers={providers}
						presets={presets}
						isPresetsLoading={isPresetsLoading}
						onCancel={() => setPanel({ type: "detail" })}
						onSuccess={handleCreatedOrUpdated}
					/>
				)}

				{resolvedPanel.type === "detail" && activeProvider && (
					<ProviderDetail
						key={activeProvider.latin_name}
						provider={activeProvider}
						onEdit={() =>
							setPanel({
								type: "edit",
								provider: activeProvider,
							})
						}
						onDeleted={() => {
							setSelectedLatinName(null);
							setPanel({ type: "detail" });
						}}
					/>
				)}

				{resolvedPanel.type === "detail" && !activeProvider && (
					<div className="flex h-full flex-col items-center justify-center gap-4">
						<div className="text-center">
							<p className="mb-2 text-sm text-muted">
								{t("noInferenceProviders")}
							</p>
						</div>
						<Button onPress={() => setPanel({ type: "create" })}>
							<PlusIcon className="mr-2 size-4" />
							{t("createInferenceProvider")}
						</Button>
					</div>
				)}
			</div>
		</div>
	);
}
