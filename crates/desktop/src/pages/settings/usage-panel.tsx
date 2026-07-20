import {
	ArrowPathIcon,
	ChevronDownIcon,
	ChevronUpIcon,
	FolderOpenIcon,
} from "@heroicons/react/24/solid";
import {
	Button,
	Disclosure,
	Input,
	ListBox,
	NumberField,
	Select,
	Switch,
	TextField,
} from "@heroui/react";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { useUsageSettingsEditor } from "../../hooks/use-usage-settings";
import { useAgentAvailability } from "../../hooks/use-agent-availability";
import { useApi } from "../../hooks/use-api";
import { AgentIcon } from "../../lib/agent-icons";
import { ccusageDiagnostics } from "../../lib/ccusage-diagnostics";
import { shortCcusageVersion } from "../../lib/usage-format";
import { cn } from "../../lib/utils";
import { usageStatusQueryOptions } from "../../requests/usage";
import {
	agentSettings,
	HOME_STAT_IDS,
	type HomeStatId,
	HOME_WINDOW_IDS,
	type HomeWindowId,
	USAGE_ALERT_THRESHOLDS_PCT,
	USAGE_QUOTA_AGENTS,
	type UsageSettings,
} from "../../lib/store";
import {
	HOME_STAT_AGENT_HINT,
	HOME_STAT_DEFINITIONS,
	HOME_WINDOW_LABEL_KEYS,
} from "../../lib/usage-home-fields";
import {
	type CardLayoutModel,
	InteractiveCardLayout,
	type LayoutField,
} from "./usage-layout-editor";

/** Fallback names for report agents not in the local registry; installed
 *  agents resolve their registry display name first. */
const AGENT_LABELS: Record<string, string> = {
	claude: "Claude",
	codex: "Codex",
	opencode: "OpenCode",
	amp: "Amp",
	droid: "Droid",
	codebuff: "Codebuff",
	hermes: "Hermes",
	pi: "Pi",
	goose: "Goose",
	kilo: "Kilo",
	copilot: "Copilot",
	gemini: "Gemini",
	kimi: "Kimi",
	qwen: "Qwen",
	openclaw: "OpenClaw",
};

const GLOBAL_THRESHOLD_KEY = "global";

/** ccusage's npm page — the target for the install / update actions. */
const CCUSAGE_NPM_URL = "https://www.npmjs.com/package/ccusage";

const THRESHOLD_OPTIONS = USAGE_ALERT_THRESHOLDS_PCT.map((pct) => ({
	id: String(pct),
	label: `${pct}%`,
}));

/** A short, geographically-spread set of common IANA zones for the picker. */
const COMMON_TIMEZONES = [
	"UTC",
	"America/Los_Angeles",
	"America/Denver",
	"America/Chicago",
	"America/New_York",
	"America/Sao_Paulo",
	"Europe/London",
	"Europe/Paris",
	"Europe/Berlin",
	"Europe/Moscow",
	"Africa/Cairo",
	"Africa/Johannesburg",
	"Asia/Dubai",
	"Asia/Kolkata",
	"Asia/Bangkok",
	"Asia/Shanghai",
	"Asia/Tokyo",
	"Asia/Singapore",
	"Australia/Sydney",
	"Pacific/Auckland",
];

export default function UsagePanel() {
	const { t } = useTranslation();
	const { availableAgents } = useAgentAvailability();

	const { data: current, update: updateSettings } = useUsageSettingsEditor();

	// Registry display name when the agent is known locally, else the static
	// label for report-only agents.
	const agentName = (id: string) =>
		availableAgents.find((a) => a.id === id)?.display_name ??
		AGENT_LABELS[id] ??
		id;

	const api = useApi();
	const statusQuery = useQuery(usageStatusQueryOptions({ api }));
	const diagnosticsQuery = useQuery({
		queryKey: ["ccusage-diagnostics"],
		queryFn: ccusageDiagnostics,
		staleTime: Number.POSITIVE_INFINITY,
	});
	const { data: status } = statusQuery;
	const { data: diag } = diagnosticsQuery;
	const isRechecking = statusQuery.isFetching || diagnosticsQuery.isFetching;
	const recheckStatus = async () => {
		await Promise.all([statusQuery.refetch(), diagnosticsQuery.refetch()]);
	};

	const update = (patch: Partial<UsageSettings>) => {
		updateSettings((settings) => ({ ...settings, ...patch }));
	};

	const updateAgent = (
		agent: string,
		patch: Partial<UsageSettings["agents"][string]>,
	) => {
		updateSettings((settings) => ({
			...settings,
			agents: {
				...settings.agents,
				[agent]: { ...agentSettings(settings, agent), ...patch },
			},
		}));
	};

	const updateHome = (patch: Partial<UsageSettings["home"]>) => {
		updateSettings((settings) => ({
			...settings,
			home: { ...settings.home, ...patch },
		}));
	};

	const home = current.home;

	// Which card layout the editor edits: the shared default or an agent's
	// override. Interaction state, so it lives here rather than in the store.
	const [layoutTarget, setLayoutTarget] = useState<string>("default");
	const editedLayout =
		layoutTarget === "default"
			? home.default
			: (home.perAgent[layoutTarget] ?? home.default);
	const hasOverride =
		layoutTarget !== "default" && layoutTarget in home.perAgent;

	// Keep a previously-set custom zone selectable even if it isn't common.
	const timezoneIds =
		current.timezone && !COMMON_TIMEZONES.includes(current.timezone)
			? [current.timezone, ...COMMON_TIMEZONES]
			: COMMON_TIMEZONES;
	const timezoneOptions = [
		{ id: "", label: t("usageTimezoneSystem") },
		...timezoneIds.map((id) => ({ id, label: id })),
	];

	// The editor works in fixed slots ((id | null)[]); persist them onto the
	// selected target. Store normalization validates the ids before writing.
	const onLayoutCommit = (next: CardLayoutModel) => {
		const layout = {
			windowSlots: next.windowSlots as (HomeWindowId | null)[],
			statSlots: next.statSlots as (HomeStatId | null)[],
		};
		if (layoutTarget === "default") {
			updateSettings((settings) => ({
				...settings,
				home: { ...settings.home, default: layout },
			}));
		} else {
			updateSettings((settings) => ({
				...settings,
				home: {
					...settings.home,
					perAgent: {
						...settings.home.perAgent,
						[layoutTarget]: layout,
					},
				},
			}));
		}
	};

	const resetOverride = () => {
		updateSettings((settings) => {
			const perAgent = { ...settings.home.perAgent };
			delete perAgent[layoutTarget];
			return {
				...settings,
				home: { ...settings.home, perAgent },
			};
		});
	};

	// A specific agent's editor only offers fields that agent reports;
	// agent-exclusive fields stay in the shared default layout, marked with
	// a hint, and the home card skips them where they don't apply.
	const fieldAgent = (
		id: HomeWindowId | HomeStatId,
	): "claude" | "codex" | undefined => {
		if (id === "weekly_opus") return "claude";
		const stat = HOME_STAT_IDS.find((s) => s === id);
		return stat ? HOME_STAT_AGENT_HINT[stat] : undefined;
	};
	const offeredTo = (id: HomeWindowId | HomeStatId) => {
		const only = fieldAgent(id);
		return layoutTarget === "default" || !only || only === layoutTarget;
	};
	const hintFor = (id: HomeWindowId | HomeStatId) => {
		const only = fieldAgent(id);
		return layoutTarget === "default" && only
			? t(
					only === "claude"
						? "usageStatClaudeOnly"
						: "usageStatCodexOnly",
				)
			: undefined;
	};
	const windowFields: LayoutField[] = HOME_WINDOW_IDS.filter(offeredTo).map(
		(id) => ({
			id,
			label: t(HOME_WINDOW_LABEL_KEYS[id]),
			hint: hintFor(id),
		}),
	);
	const statFields: LayoutField[] = HOME_STAT_IDS.filter(offeredTo).map(
		(id) => ({
			id,
			label: t(HOME_STAT_DEFINITIONS[id].labelKey),
			hint: hintFor(id),
		}),
	);

	const layoutDisabled = !home.showUsageOnHome;

	// The replica is cosmetic only — it shows whose layout is being edited
	// and renders fixed placeholders, never live data.
	const previewAgentId =
		layoutTarget === "default" ? USAGE_QUOTA_AGENTS[0] : layoutTarget;
	const preview = {
		agentId: previewAgentId,
		agentName: AGENT_LABELS[previewAgentId] ?? previewAgentId,
	};

	const statusDescription =
		status === undefined
			? t("usageStatusChecking")
			: status.reachable
				? `${status.version ? shortCcusageVersion(status.version) : "—"}${
						status.update_available && status.latest_version
							? ` · ${t("usageStatusUpdate", {
									version: shortCcusageVersion(
										status.latest_version,
									),
								})}`
							: ""
					}`
				: (status.error ?? t("usageStatusUnreachable"));

	return (
		<div className="divide-y divide-border">
			{/* ccusage sidecar — status, binary resolution, config file. */}
			<section className="space-y-4 px-1 pb-5">
				<div className="flex items-center justify-between gap-4">
					<div className="space-y-0.5">
						<span className="flex items-center gap-2 text-sm font-semibold text-(--foreground)">
							<span
								className={cn(
									"size-2 rounded-full",
									status === undefined
										? "bg-muted"
										: status.reachable
											? "bg-success"
											: "bg-danger",
								)}
							/>
							ccusage
							<Button
								isIconOnly
								isPending={isRechecking}
								size="sm"
								variant="ghost"
								onPress={recheckStatus}
								aria-label={t("usageStatusRecheck")}
								className="size-6 text-muted"
							>
								{({ isPending }) => (
									<ArrowPathIcon
										className={cn(
											"size-3.5",
											isPending && "animate-spin",
										)}
									/>
								)}
							</Button>
						</span>
						<span
							className={cn(
								"block text-xs tabular-nums",
								status && !status.reachable
									? "text-danger"
									: "text-muted",
							)}
						>
							{statusDescription}
						</span>
					</div>
					<div className="flex shrink-0 items-center gap-2">
						{status && !status.reachable ? (
							<Button
								size="sm"
								variant="secondary"
								onPress={() => openUrl(CCUSAGE_NPM_URL)}
							>
								{t("usageStatusInstall")}
							</Button>
						) : (
							status?.update_available && (
								<Button
									size="sm"
									variant="secondary"
									onPress={() => openUrl(CCUSAGE_NPM_URL)}
								>
									{t("usageStatusUpdateAction")}
								</Button>
							)
						)}
					</div>
				</div>
				<SettingRow
					title={t("usageSidecarAutoDiscover")}
					description={t("usageSidecarAutoDiscoverDescription")}
					control={
						<SettingSwitch
							isSelected={current.sidecar.autoDiscover}
							onChange={(checked) =>
								update({
									sidecar: {
										...current.sidecar,
										autoDiscover: checked,
									},
								})
							}
							ariaLabel={t("usageSidecarAutoDiscover")}
						/>
					}
				/>
				{/* Only worth showing when discovery resolved an actual
					    path — a bare binary name carries no information. */}
				{current.sidecar.autoDiscover &&
					diag &&
					/[/\\]/.test(diag.path) && (
						<p
							className="truncate font-mono text-[11px] text-muted"
							title={diag.path}
						>
							{t("usageSidecarResolved", { path: diag.path })}
						</p>
					)}
				{!current.sidecar.autoDiscover && (
					<PathField
						label={t("usageSidecarPath")}
						value={current.sidecar.binPath}
						onChange={(value) =>
							update({
								sidecar: {
									...current.sidecar,
									binPath: value,
								},
							})
						}
						placeholder={t("usageSidecarPathPlaceholder")}
						hint={t("usageSidecarPathDescription")}
					/>
				)}
				<PathField
					label={t("usageConfigPath")}
					value={current.ccusageConfigPath}
					onChange={(value) => update({ ccusageConfigPath: value })}
					placeholder={t("usageConfigPathPlaceholder")}
					hint={t("usageConfigPathDescription")}
					filters={[{ name: "JSON", extensions: ["json"] }]}
				/>
			</section>

			{/* Home cards — what the usage block on the home agent cards shows,
			    plus the per-card layout editor. */}
			<section className="space-y-4 px-1 py-5">
				<div className="space-y-0.5">
					<span className="text-sm font-semibold text-(--foreground)">
						{t("usageSettingsHomeCards")}
					</span>
					<span className="block text-xs text-muted">
						{t("usageHomeShowDescription")}
					</span>
				</div>
				<SettingRow
					title={t("usageHomeShow")}
					control={
						<SettingSwitch
							isSelected={home.showUsageOnHome}
							onChange={(checked) =>
								updateHome({ showUsageOnHome: checked })
							}
							ariaLabel={t("usageHomeShow")}
						/>
					}
				/>
				<SettingRow
					title={t("usageHomeWindow")}
					description={t("usageHomeWindowDescription")}
					control={
						<SettingNumber
							value={home.windowDays}
							onChange={(d) => updateHome({ windowDays: d })}
							isDisabled={!home.showUsageOnHome}
							ariaLabel={t("usageHomeWindow")}
							minValue={1}
							formatOptions={{
								style: "unit",
								unit: "day",
								unitDisplay: "narrow",
							}}
						/>
					}
				/>

				{/* Card layout — target picker above the live card replica and
					    its adjacent drawer of hidden fields. */}
				<div className="max-w-2xl space-y-3 border-t border-border pt-4">
					<div className="flex items-center justify-between gap-3">
						<div className="space-y-0.5">
							<span className="text-sm font-medium text-(--foreground)">
								{t("usageHomeLayout")}
							</span>
							<span className="block text-xs text-muted">
								{t("usageHomeLayoutDescription")}
							</span>
						</div>
						<div className="flex shrink-0 items-center gap-3">
							{hasOverride && (
								<Button
									size="sm"
									variant="ghost"
									onPress={resetOverride}
									className="h-7 px-2 text-xs text-muted"
								>
									{t("usageLayoutResetOverride")}
								</Button>
							)}
							<SettingSelect
								value={layoutTarget}
								onChange={setLayoutTarget}
								ariaLabel={t("usageLayoutTarget")}
								options={[
									{
										id: "default",
										label: t("usageLayoutTargetDefault"),
									},
									...USAGE_QUOTA_AGENTS.map((id) => ({
										id,
										label: AGENT_LABELS[id] ?? id,
									})),
								]}
							/>
						</div>
					</div>

					<InteractiveCardLayout
						windowFields={windowFields}
						statFields={statFields}
						windowSlots={editedLayout.windowSlots}
						statSlots={editedLayout.statSlots}
						isDisabled={layoutDisabled}
						onCommit={onLayoutCommit}
						preview={preview}
					/>
				</div>
			</section>

			{/* Alerts — the global threshold plus per-agent overrides for the
			    quota agents (the only ones with rate-limit windows). */}
			<section className="space-y-4 px-1 py-5">
				<div className="space-y-0.5">
					<span className="text-sm font-semibold text-(--foreground)">
						{t("usageSettingsAlerts")}
					</span>
					<span className="block text-xs text-muted">
						{t("usageSettingsAlertsDescription")}
					</span>
				</div>
				<SettingRow
					title={t("usageGlobalAlertThreshold")}
					control={
						// The store keeps 0–100; percent formatting wants 0–1.
						<SettingNumber
							value={current.globalAlertThresholdPct / 100}
							onChange={(pct) =>
								update({
									globalAlertThresholdPct: Math.round(
										pct * 100,
									),
								})
							}
							ariaLabel={t("usageGlobalAlertThreshold")}
							minValue={0}
							maxValue={1}
							step={0.05}
							formatOptions={{ style: "percent" }}
						/>
					}
				/>

				{/* One threshold row per quota agent. Agent enablement is
					    managed centrally in Settings → Agents. */}
				{USAGE_QUOTA_AGENTS.map((agent) => {
					const config = agentSettings(current, agent);
					return (
						<div
							key={agent}
							className="flex items-center justify-between gap-4 border-t border-border pt-4"
						>
							<span className="flex items-center gap-2 text-sm font-medium text-(--foreground)">
								<AgentIcon
									id={agent}
									name={agentName(agent)}
									size="xs"
								/>
								{agentName(agent)}
							</span>
							<SettingSelect
								value={
									config.alertThresholdPct === null
										? GLOBAL_THRESHOLD_KEY
										: String(config.alertThresholdPct)
								}
								onChange={(key) =>
									updateAgent(agent, {
										alertThresholdPct:
											key === GLOBAL_THRESHOLD_KEY
												? null
												: Number(key),
									})
								}
								ariaLabel={t("usageAgentAlert")}
								options={[
									{
										id: GLOBAL_THRESHOLD_KEY,
										label: t("usageAlertUseGlobal", {
											pct: current.globalAlertThresholdPct,
										}),
									},
									...THRESHOLD_OPTIONS,
								]}
							/>
						</div>
					);
				})}
			</section>

			{/* Advanced — low-frequency collection knobs, collapsed by default. */}
			<section className="px-1 py-3">
				<Disclosure>
					<Disclosure.Heading>
						<Button
							slot="trigger"
							variant="ghost"
							className="w-full justify-between px-2 text-sm font-semibold"
						>
							{t("usageSettingsAdvanced")}
							<Disclosure.Indicator />
						</Button>
					</Disclosure.Heading>
					<Disclosure.Content>
						<Disclosure.Body className="space-y-4 p-2 pt-3">
							<SettingRow
								title={t("usagePollInterval")}
								description={t("usagePollIntervalDescription")}
								control={
									<SettingNumber
										value={Math.round(
											current.pollIntervalMs / 1000,
										)}
										onChange={(s) =>
											update({
												pollIntervalMs: s * 1000,
											})
										}
										ariaLabel={t("usagePollInterval")}
										minValue={0}
										formatOptions={{
											style: "unit",
											unit: "second",
											unitDisplay: "narrow",
										}}
									/>
								}
							/>
							<SettingRow
								title={t("usageTimezone")}
								description={t("usageTimezoneDescription")}
								control={
									<SettingSelect
										value={current.timezone}
										onChange={(key) =>
											update({ timezone: key })
										}
										ariaLabel={t("usageTimezone")}
										options={timezoneOptions}
									/>
								}
							/>
							<SettingRow
								title={t("usageOfflinePricing")}
								description={t(
									"usageOfflinePricingDescription",
								)}
								control={
									<SettingSwitch
										isSelected={current.offlinePricing}
										onChange={(checked) =>
											update({
												offlinePricing: checked,
											})
										}
										ariaLabel={t("usageOfflinePricing")}
									/>
								}
							/>
							<SettingRow
								title={t("usageRequestTimeout")}
								description={t(
									"usageRequestTimeoutDescription",
								)}
								control={
									<SettingNumber
										value={current.requestTimeoutSecs}
										onChange={(s) =>
											update({
												requestTimeoutSecs: s,
											})
										}
										ariaLabel={t("usageRequestTimeout")}
										minValue={1}
										formatOptions={{
											style: "unit",
											unit: "second",
											unitDisplay: "narrow",
										}}
									/>
								}
							/>
							<div className="flex flex-col gap-1">
								<span className="text-sm font-medium text-(--foreground)">
									{t("usageExtraArgs")}
								</span>
								<TextField
									variant="secondary"
									value={current.extraArgs}
									onChange={(value) =>
										update({ extraArgs: value })
									}
									aria-label={t("usageExtraArgs")}
								>
									<Input
										variant="secondary"
										placeholder="--jsonl --breakdown"
										className="font-mono text-xs"
									/>
								</TextField>
								<span className="text-xs text-muted">
									{t("usageExtraArgsDescription")}
								</span>
							</div>
						</Disclosure.Body>
					</Disclosure.Content>
				</Disclosure>
			</section>
		</div>
	);
}

interface SelectOption {
	id: string;
	label: string;
}

/** Label + optional description on the left, a control on the right. */
function SettingRow({
	title,
	description,
	control,
}: {
	title: string;
	description?: string;
	control: ReactNode;
}) {
	return (
		<div className="flex items-center justify-between gap-4">
			<div className="space-y-0.5">
				<span className="text-sm font-medium text-(--foreground)">
					{title}
				</span>
				{description && (
					<span className="block text-xs text-muted">
						{description}
					</span>
				)}
			</div>
			{control}
		</div>
	);
}

function SettingSwitch({
	isSelected,
	onChange,
	ariaLabel,
	isDisabled,
}: {
	isSelected: boolean;
	onChange: (checked: boolean) => void;
	ariaLabel: string;
	isDisabled?: boolean;
}) {
	return (
		<Switch
			isSelected={isSelected}
			onChange={onChange}
			isDisabled={isDisabled}
			aria-label={ariaLabel}
		>
			<Switch.Control>
				<Switch.Thumb />
			</Switch.Control>
		</Switch>
	);
}

function SettingSelect({
	value,
	onChange,
	ariaLabel,
	options,
	isDisabled,
}: {
	value: string;
	onChange: (key: string) => void;
	ariaLabel: string;
	options: SelectOption[];
	isDisabled?: boolean;
}) {
	return (
		<Select
			variant="secondary"
			value={value}
			onChange={(key) => onChange(String(key))}
			isDisabled={isDisabled}
			aria-label={ariaLabel}
			className="min-w-32"
		>
			<Select.Trigger>
				<Select.Value />
				<Select.Indicator />
			</Select.Trigger>
			<Select.Popover>
				<ListBox>
					{options.map((opt) => (
						<ListBox.Item
							key={opt.id}
							id={opt.id}
							textValue={opt.label}
						>
							{opt.label}
						</ListBox.Item>
					))}
				</ListBox>
			</Select.Popover>
		</Select>
	);
}

/** A compact numeric setting; units and percentages come from the field's
 *  Intl format options ("30d", "60s", "80%"), stepping from the buttons. */
function SettingNumber({
	value,
	onChange,
	ariaLabel,
	minValue = 0,
	maxValue,
	step,
	formatOptions,
	isDisabled,
}: {
	value: number;
	onChange: (n: number) => void;
	ariaLabel: string;
	minValue?: number;
	maxValue?: number;
	step?: number;
	formatOptions?: Intl.NumberFormatOptions;
	isDisabled?: boolean;
}) {
	return (
		<NumberField
			variant="secondary"
			value={value}
			onChange={(n) => {
				if (Number.isFinite(n)) onChange(n);
			}}
			minValue={minValue}
			maxValue={maxValue}
			step={step}
			formatOptions={formatOptions}
			isDisabled={isDisabled}
			aria-label={ariaLabel}
		>
			<NumberField.Group className="flex w-24">
				<NumberField.Input className="min-w-0 flex-1 px-2.5 text-right tabular-nums" />
				<div className="flex h-full w-6 shrink-0 flex-col border-l border-border">
					<NumberField.IncrementButton className="h-1/2 w-full rounded-none border-0 p-0">
						<ChevronUpIcon className="size-3" />
					</NumberField.IncrementButton>
					<NumberField.DecrementButton className="h-1/2 w-full rounded-none border-0 p-0">
						<ChevronDownIcon className="size-3" />
					</NumberField.DecrementButton>
				</div>
			</NumberField.Group>
		</NumberField>
	);
}

/**
 * A file-path setting: a text input plus a native file picker, and a
 * "restore default" that clears back to auto-discovery (the empty default).
 */
function PathField({
	label,
	value,
	onChange,
	placeholder,
	hint,
	filters,
}: {
	label: string;
	value: string;
	onChange: (value: string) => void;
	placeholder?: string;
	hint?: string;
	/** File-dialog extension filters; omit to accept any file. */
	filters?: { name: string; extensions: string[] }[];
}) {
	const { t } = useTranslation();
	const browse = async () => {
		const selected = await open({
			directory: false,
			multiple: false,
			filters,
		});
		if (typeof selected === "string") onChange(selected);
	};
	return (
		<div className="flex flex-col gap-1">
			<div className="flex items-center justify-between gap-2">
				<span className="text-sm font-medium text-(--foreground)">
					{label}
				</span>
				{value && (
					<Button
						size="sm"
						variant="ghost"
						onPress={() => onChange("")}
						className="h-7 px-2 text-xs text-muted"
					>
						{t("usagePathReset")}
					</Button>
				)}
			</div>
			<div className="flex items-center gap-2">
				<TextField
					variant="secondary"
					value={value}
					onChange={onChange}
					aria-label={label}
					className="flex-1"
				>
					<Input variant="secondary" placeholder={placeholder} />
				</TextField>
				<Button
					variant="secondary"
					size="sm"
					onPress={browse}
					className="shrink-0"
				>
					<FolderOpenIcon className="size-4" />
					{t("usagePathBrowse")}
				</Button>
			</div>
			{hint && <span className="text-xs text-muted">{hint}</span>}
		</div>
	);
}
