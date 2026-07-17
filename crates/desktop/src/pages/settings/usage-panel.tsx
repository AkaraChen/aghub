import {
	ArrowTopRightOnSquareIcon,
	FolderOpenIcon,
} from "@heroicons/react/24/solid";
import {
	Button,
	Card,
	Disclosure,
	Input,
	InputGroup,
	ListBox,
	Select,
	Switch,
	TextField,
	toast,
} from "@heroui/react";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	USAGE_SETTINGS_QUERY_KEY,
	useUsageSettings,
} from "../../hooks/use-usage-settings";
import { useApi } from "../../hooks/use-api";
import { AgentIcon } from "../../lib/agent-icons";
import { ccusageDiagnostics } from "../../lib/ccusage-diagnostics";
import {
	clampPct,
	formatCost,
	formatTokens,
	shortCcusageVersion,
} from "../../lib/usage-format";
import { cn } from "../../lib/utils";
import {
	usageLimitsQueryOptions,
	usageStatusQueryOptions,
	usageSummaryQueryOptions,
} from "../../requests/usage";
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
	// Live values for the layout editor's card replica — same query params as
	// the home page, so the cache is shared and this adds no extra fetches.
	const previewRange = useMemo(() => {
		const until = new Date();
		const since = new Date(until);
		since.setDate(since.getDate() - (current.home.windowDays - 1));
		const fmt = (d: Date) =>
			`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(
				d.getDate(),
			).padStart(2, "0")}`;
		return {
			since: fmt(since),
			until: fmt(until),
			timezone:
				current.timezone ||
				new Intl.DateTimeFormat().resolvedOptions().timeZone,
		};
	}, [current.home.windowDays, current.timezone]);
	const { data: previewReport } = useQuery(
		usageSummaryQueryOptions({
			api,
			...previewRange,
			offline: current.offlinePricing,
			config: current.ccusageConfigPath,
			timeoutSecs: current.requestTimeoutSecs,
			args: current.extraArgs,
		}),
	);
	const { data: previewLimits } = useQuery(usageLimitsQueryOptions({ api }));
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

	const windowFields: LayoutField[] = HOME_WINDOW_IDS.map((id) => ({
		id,
		label: t(HOME_WINDOW_LABEL_KEYS[id]),
		hint: id === "weekly_opus" ? t("usageStatClaudeOnly") : undefined,
	}));
	const statFields: LayoutField[] = HOME_STAT_IDS.map((id) => {
		const agentHint = HOME_STAT_AGENT_HINT[id];
		return {
			id,
			label: t(HOME_STAT_DEFINITIONS[id].labelKey),
			hint: agentHint
				? t(
						agentHint === "claude"
							? "usageStatClaudeOnly"
							: "usageStatCodexOnly",
					)
				: undefined,
		};
	});

	const layoutDisabled = !home.showUsageOnHome;

	// The replica previews the target agent's real numbers, falling back to
	// the first quota agent for the shared default layout.
	const previewAgentId =
		layoutTarget === "default" ? USAGE_QUOTA_AGENTS[0] : layoutTarget;
	const previewWindows = previewLimits?.agents.find(
		(entry) => entry.agent === previewAgentId,
	)?.windows;
	const previewTotals = previewReport?.agents.find(
		(entry) => entry.agent === previewAgentId,
	)?.totals;
	const previewWindowPct = (id: string): number | null => {
		const pct = previewWindows?.find((w) => w.kind === id)?.utilization_pct;
		return pct == null ? null : clampPct(pct);
	};
	const previewStatValue = (id: string): string | null => {
		const statId = HOME_STAT_IDS.find((s) => s === id);
		if (!statId) return null;
		const source = HOME_STAT_DEFINITIONS[statId].source;
		if (source.from === "window") {
			const pct = previewWindowPct(source.window);
			return pct == null ? null : `${Math.round(pct)}%`;
		}
		if (!previewTotals) return null;
		const raw = previewTotals[source.field];
		if (raw == null) return null;
		return source.fmt === "cost" ? formatCost(raw) : formatTokens(raw);
	};
	const preview = {
		agentId: previewAgentId,
		agentName: AGENT_LABELS[previewAgentId] ?? previewAgentId,
		windowPct: previewWindowPct,
		statValue: previewStatValue,
		alertThresholdPct: current.globalAlertThresholdPct,
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
							{/* Both actions open ccusage's npm page — the icon
							    signals leaving the app. */}
							{status && !status.reachable ? (
								<Button
									size="sm"
									variant="secondary"
									onPress={() => openUrl(CCUSAGE_NPM_URL)}
								>
									{t("usageStatusInstall")}
									<ArrowTopRightOnSquareIcon className="size-3.5" />
								</Button>
							) : (
								status?.update_available && (
									<Button
										size="sm"
										variant="secondary"
										onPress={() => openUrl(CCUSAGE_NPM_URL)}
									>
										{t("usageStatusUpdateAction")}
										<ArrowTopRightOnSquareIcon className="size-3.5" />
									</Button>
								)
							)}
							<Button
								size="sm"
								variant="ghost"
								onPress={recheckStatus}
							>
								{t("usageStatusRecheck")}
							</Button>
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
					{current.sidecar.autoDiscover && diag && (
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
								min={1}
								suffix="d"
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
							<SettingNumber
								value={current.globalAlertThresholdPct}
								onChange={(pct) =>
									update({ globalAlertThresholdPct: pct })
								}
								ariaLabel={t("usageGlobalAlertThreshold")}
								min={0}
								max={100}
								suffix="%"
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
											min={0}
											suffix="s"
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
											min={1}
											suffix="s"
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

/** A compact, right-aligned free numeric input with an optional unit suffix. */
function SettingNumber({
	value,
	onChange,
	ariaLabel,
	min = 0,
	max,
	suffix,
	isDisabled,
}: {
	value: number;
	onChange: (n: number) => void;
	ariaLabel: string;
	min?: number;
	max?: number;
	suffix?: string;
	isDisabled?: boolean;
}) {
	return (
		<TextField
			variant="secondary"
			value={String(value)}
			onChange={(raw) => {
				const n = Number(raw);
				if (!Number.isFinite(n)) return;
				const upper = max != null ? Math.min(max, n) : n;
				onChange(Math.round(Math.max(min, upper)));
			}}
			isDisabled={isDisabled}
			aria-label={ariaLabel}
			className="w-28"
		>
			<InputGroup variant="secondary">
				<InputGroup.Input
					type="number"
					inputMode="numeric"
					className="w-full min-w-0 text-right tabular-nums"
				/>
				{suffix && <InputGroup.Suffix>{suffix}</InputGroup.Suffix>}
			</InputGroup>
		</TextField>
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
