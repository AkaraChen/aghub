import { ArrowPathIcon, FolderOpenIcon } from "@heroicons/react/24/solid";
import {
	Button,
	Card,
	Disclosure,
	Input,
	ListBox,
	NumberField,
	Select,
	Switch,
	TextField,
	toast,
} from "@heroui/react";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	USAGE_SETTINGS_QUERY_KEY,
	useUsageSettings,
} from "../../hooks/use-usage-settings";
import { useApi } from "../../hooks/use-api";
import { AgentIcon } from "../../lib/agent-icons";
import { ccusageDiagnostics } from "../../lib/ccusage-diagnostics";
import { shortCcusageVersion } from "../../lib/usage-format";
import { cn } from "../../lib/utils";
import { usageStatusQueryOptions } from "../../requests/usage";
import {
	agentSettings,
	DEFAULT_USAGE_SETTINGS,
	HOME_STAT_IDS,
	type HomeStatId,
	HOME_WINDOW_IDS,
	type HomeWindowId,
	saveUsageSettings,
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

const AGENT_LABELS: Record<string, string> = {
	claude: "Claude",
	codex: "Codex",
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
	const queryClient = useQueryClient();

	const { data: settings } = useUsageSettings();
	const current = settings ?? DEFAULT_USAGE_SETTINGS;

	const api = useApi();
	const { data: status } = useQuery(usageStatusQueryOptions({ api }));
	const { data: diag } = useQuery({
		queryKey: ["ccusage-diagnostics"],
		queryFn: ccusageDiagnostics,
		staleTime: Number.POSITIVE_INFINITY,
	});
	const recheckStatus = () => {
		queryClient.invalidateQueries({ queryKey: ["usage", "status"] });
		queryClient.invalidateQueries({ queryKey: ["ccusage-diagnostics"] });
	};

	const mutation = useMutation({
		mutationFn: saveUsageSettings,
		// Optimistically reflect the change so controls feel instant; roll back
		// on error and re-sync from the store afterwards.
		onMutate: async (next) => {
			await queryClient.cancelQueries({
				queryKey: USAGE_SETTINGS_QUERY_KEY,
			});
			const previous = queryClient.getQueryData<UsageSettings>(
				USAGE_SETTINGS_QUERY_KEY,
			);
			queryClient.setQueryData(USAGE_SETTINGS_QUERY_KEY, next);
			return { previous };
		},
		onError: (error, _next, context) => {
			if (context?.previous) {
				queryClient.setQueryData(
					USAGE_SETTINGS_QUERY_KEY,
					context.previous,
				);
			}
			toast.danger(
				error instanceof Error
					? error.message
					: t("usageSettingsSaveError"),
			);
		},
		onSettled: () => {
			queryClient.invalidateQueries({
				queryKey: USAGE_SETTINGS_QUERY_KEY,
			});
		},
	});

	const update = (patch: Partial<UsageSettings>) => {
		mutation.mutate({ ...current, ...patch });
	};

	const updateAgent = (
		agent: string,
		patch: Partial<UsageSettings["agents"][string]>,
	) => {
		mutation.mutate({
			...current,
			agents: {
				...current.agents,
				[agent]: { ...agentSettings(current, agent), ...patch },
			},
		});
	};

	const updateHome = (patch: Partial<UsageSettings["home"]>) => {
		mutation.mutate({ ...current, home: { ...current.home, ...patch } });
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
	// selected target. saveUsageSettings re-normalizes, so the cast is safe.
	const onLayoutCommit = (next: CardLayoutModel) => {
		const layout = {
			windowSlots: next.windowSlots as (HomeWindowId | null)[],
			statSlots: next.statSlots as (HomeStatId | null)[],
		};
		if (layoutTarget === "default") {
			updateHome({ default: layout });
		} else {
			updateHome({
				perAgent: { ...home.perAgent, [layoutTarget]: layout },
			});
		}
	};

	const resetOverride = () => {
		const next = { ...home.perAgent };
		delete next[layoutTarget];
		updateHome({ perAgent: next });
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
		<div className="space-y-4">
			{/* ccusage sidecar — status, binary resolution, config file. */}
			<Card className="p-0">
				<Card.Content className="space-y-4 p-4">
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
									size="sm"
									variant="ghost"
									onPress={recheckStatus}
									aria-label={t("usageStatusRecheck")}
									className="size-6 text-muted"
								>
									<ArrowPathIcon className="size-3.5" />
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
						onChange={(value) =>
							update({ ccusageConfigPath: value })
						}
						placeholder={t("usageConfigPathPlaceholder")}
						hint={t("usageConfigPathDescription")}
						filters={[{ name: "JSON", extensions: ["json"] }]}
					/>
				</Card.Content>
			</Card>

			{/* Home cards — what the usage block on the home agent cards shows,
			    plus the per-card layout editor. */}
			<Card className="p-0">
				<Card.Content className="space-y-4 p-4">
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

					{/* Card layout — a full-width heading row (target picker on
					    the right), then the editor's two panes on a canvas:
					    the live card replica ↔ the drawer of hidden fields. */}
					<div className="space-y-3 border-t border-border pt-4">
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
									<button
										type="button"
										onClick={resetOverride}
										className="text-xs text-muted transition-colors hover:text-accent"
									>
										{t("usageLayoutResetOverride")}
									</button>
								)}
								<SettingSelect
									value={layoutTarget}
									onChange={setLayoutTarget}
									ariaLabel={t("usageLayoutTarget")}
									options={[
										{
											id: "default",
											label: t(
												"usageLayoutTargetDefault",
											),
										},
										...USAGE_QUOTA_AGENTS.map((id) => ({
											id,
											label: AGENT_LABELS[id] ?? id,
										})),
									]}
								/>
							</div>
						</div>

						{/* A shrink-wrapped canvas so the replica + drawer sit as
						    one centered object instead of floating in a full-
						    width well. */}
						<div className="mx-auto w-fit max-w-full rounded-lg bg-surface-secondary p-4">
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
					</div>
				</Card.Content>
			</Card>

			{/* Tracking & alert thresholds — global default plus per-agent
			    overrides for the closed Claude/Codex set. */}
			<Card className="p-0">
				<Card.Content className="space-y-4 p-4">
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

					{/* One row per agent: identity, threshold, tracking. The
					    threshold select names the resolved global value, so no
					    expanding sub-row is needed. */}
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
										name={AGENT_LABELS[agent]}
										size="xs"
									/>
									{AGENT_LABELS[agent]}
								</span>
								<div className="flex items-center gap-3">
									<SettingSelect
										value={
											config.alertThresholdPct === null
												? GLOBAL_THRESHOLD_KEY
												: String(
														config.alertThresholdPct,
													)
										}
										onChange={(key) =>
											updateAgent(agent, {
												alertThresholdPct:
													key === GLOBAL_THRESHOLD_KEY
														? null
														: Number(key),
											})
										}
										isDisabled={!config.tracked}
										ariaLabel={t("usageAgentAlert")}
										options={[
											{
												id: GLOBAL_THRESHOLD_KEY,
												label: t(
													"usageAlertUseGlobal",
													{
														pct: current.globalAlertThresholdPct,
													},
												),
											},
											...THRESHOLD_OPTIONS,
										]}
									/>
									<SettingSwitch
										isSelected={config.tracked}
										onChange={(checked) =>
											updateAgent(agent, {
												tracked: checked,
											})
										}
										ariaLabel={t("usageAgentTracked", {
											agent: AGENT_LABELS[agent],
										})}
									/>
								</div>
							</div>
						);
					})}
				</Card.Content>
			</Card>

			{/* Advanced — low-frequency collection knobs, collapsed by default. */}
			<Card className="p-0">
				<Card.Content className="p-2">
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
									description={t(
										"usagePollIntervalDescription",
									)}
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
							</Disclosure.Body>
						</Disclosure.Content>
					</Disclosure>
				</Card.Content>
			</Card>
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
			<NumberField.Group>
				<NumberField.DecrementButton />
				<NumberField.Input className="w-16" />
				<NumberField.IncrementButton />
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
					<button
						type="button"
						onClick={() => onChange("")}
						className="text-xs text-muted transition-colors hover:text-accent"
					>
						{t("usagePathReset")}
					</button>
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
