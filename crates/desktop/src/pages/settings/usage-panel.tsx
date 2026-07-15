import {
	Card,
	Input,
	Label,
	ListBox,
	Select,
	Switch,
	TextField,
	toast,
} from "@heroui/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	USAGE_SETTINGS_QUERY_KEY,
	useUsageSettings,
} from "../../hooks/use-usage-settings";
import {
	agentSettings,
	DEFAULT_USAGE_SETTINGS,
	HOME_STAT_IDS,
	type HomeStatId,
	HOME_WINDOW_IDS,
	type HomeWindowId,
	saveUsageSettings,
	USAGE_ALERT_THRESHOLDS_PCT,
	USAGE_POLL_INTERVALS_MS,
	USAGE_QUOTA_AGENTS,
	USAGE_TIMEOUT_SECS_OPTIONS,
	USAGE_WINDOW_DAYS_OPTIONS,
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

	const formatInterval = (ms: number): string => {
		if (ms === 0) return t("usagePollOff");
		if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
		return `${Math.round(ms / 60_000)}m`;
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

	return (
		<div className="space-y-4">
			{/* ccusage sidecar — the one group wired to the backend today. */}
			<Card className="p-0">
				<Card.Content className="space-y-4 p-4">
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
					{!current.sidecar.autoDiscover && (
						<LabeledTextField
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
					<LabeledTextField
						label={t("usageConfigPath")}
						value={current.ccusageConfigPath}
						onChange={(value) =>
							update({ ccusageConfigPath: value })
						}
						placeholder={t("usageConfigPathPlaceholder")}
						hint={t("usageConfigPathDescription")}
					/>
				</Card.Content>
			</Card>

			{/* Data collection — feeds the usage queries on the home cards. */}
			<Card className="p-0">
				<Card.Content className="space-y-4 p-4">
					<p className="text-xs text-muted">
						{t("usageDashboardHint")}
					</p>
					<SettingRow
						title={t("usagePollInterval")}
						description={t("usagePollIntervalDescription")}
						control={
							<SettingSelect
								value={String(current.pollIntervalMs)}
								onChange={(key) =>
									update({ pollIntervalMs: Number(key) })
								}
								ariaLabel={t("usagePollInterval")}
								options={USAGE_POLL_INTERVALS_MS.map((ms) => ({
									id: String(ms),
									label: formatInterval(ms),
								}))}
							/>
						}
					/>
					<SettingRow
						title={t("usageTimezone")}
						description={t("usageTimezoneDescription")}
						control={
							<SettingSelect
								value={current.timezone}
								onChange={(key) => update({ timezone: key })}
								ariaLabel={t("usageTimezone")}
								options={timezoneOptions}
							/>
						}
					/>
					<SettingRow
						title={t("usageOfflinePricing")}
						description={t("usageOfflinePricingDescription")}
						control={
							<SettingSwitch
								isSelected={current.offlinePricing}
								onChange={(checked) =>
									update({ offlinePricing: checked })
								}
								ariaLabel={t("usageOfflinePricing")}
							/>
						}
					/>
					<SettingRow
						title={t("usageRequestTimeout")}
						description={t("usageRequestTimeoutDescription")}
						control={
							<SettingSelect
								value={String(current.requestTimeoutSecs)}
								onChange={(key) =>
									update({ requestTimeoutSecs: Number(key) })
								}
								ariaLabel={t("usageRequestTimeout")}
								options={USAGE_TIMEOUT_SECS_OPTIONS.map(
									(s) => ({
										id: String(s),
										label: formatInterval(s * 1000),
									}),
								)}
							/>
						}
					/>
				</Card.Content>
			</Card>

			{/* Home display — what the usage block on the home agent cards shows. */}
			<Card className="p-0">
				<Card.Content className="space-y-4 p-4">
					<SettingRow
						title={t("usageHomeShow")}
						description={t("usageHomeShowDescription")}
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
							<SettingSelect
								value={String(home.windowDays)}
								onChange={(key) =>
									updateHome({ windowDays: Number(key) })
								}
								isDisabled={!home.showUsageOnHome}
								ariaLabel={t("usageHomeWindow")}
								options={USAGE_WINDOW_DAYS_OPTIONS.map(
									(days) => ({
										id: String(days),
										label: t("usageWindowDaysOption", {
											days,
										}),
									}),
								)}
							/>
						}
					/>
				</Card.Content>
			</Card>

			{/* Home card layout — drag to reorder + show/hide bars and stats. */}
			<Card className="p-0">
				<Card.Content className="space-y-4 p-4">
					<div className="space-y-0.5">
						<span className="text-sm font-medium text-(--foreground)">
							{t("usageHomeLayout")}
						</span>
						<span className="block text-xs text-muted">
							{t("usageHomeLayoutDescription")}
						</span>
					</div>

					{/* Which agent's layout is being edited — the shared default,
					    or a per-agent override. */}
					<div className="flex items-center justify-between gap-3">
						<span className="text-xs text-muted">
							{t("usageLayoutTarget")}
						</span>
						<div className="flex items-center gap-3">
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
						labels={{
							preview: t("usageLayoutPreview"),
							available: t("usageLayoutAvailable"),
							bars: t("usageHomeWindowsLabel"),
							stats: t("usageHomeStatsLabel"),
							empty: t("usageLayoutEmptyZone"),
						}}
					/>
				</Card.Content>
			</Card>

			{/* Tracking & alert thresholds — global default plus per-agent
			    overrides for the closed Claude/Codex set. */}
			<Card className="p-0">
				<Card.Content className="space-y-4 p-4">
					<SettingRow
						title={t("usageGlobalAlertThreshold")}
						description={t("usageGlobalAlertThresholdDescription")}
						control={
							<SettingSelect
								value={String(current.globalAlertThresholdPct)}
								onChange={(key) =>
									update({
										globalAlertThresholdPct: Number(key),
									})
								}
								ariaLabel={t("usageGlobalAlertThreshold")}
								options={THRESHOLD_OPTIONS}
							/>
						}
					/>

					{USAGE_QUOTA_AGENTS.map((agent) => {
						const config = agentSettings(current, agent);
						return (
							<div
								key={agent}
								className="
									space-y-3 rounded-lg border border-border
									bg-surface-secondary px-3 py-3
								"
							>
								<div className="flex items-center justify-between gap-4">
									<span className="text-sm font-medium text-(--foreground)">
										{AGENT_LABELS[agent]}
									</span>
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
								<div className="space-y-1">
									<SettingRow
										title={t("usageAgentAlert")}
										control={
											<SettingSelect
												value={
													config.alertThresholdPct ===
													null
														? GLOBAL_THRESHOLD_KEY
														: String(
																config.alertThresholdPct,
															)
												}
												onChange={(key) =>
													updateAgent(agent, {
														alertThresholdPct:
															key ===
															GLOBAL_THRESHOLD_KEY
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
														),
													},
													...THRESHOLD_OPTIONS,
												]}
											/>
										}
									/>
									{config.tracked &&
										config.alertThresholdPct === null && (
											<p className="text-right text-[11px] text-muted">
												{t("usageAgentAlertResolved", {
													pct: current.globalAlertThresholdPct,
												})}
											</p>
										)}
								</div>
							</div>
						);
					})}
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

function LabeledTextField({
	label,
	value,
	onChange,
	placeholder,
	hint,
}: {
	label: string;
	value: string;
	onChange: (value: string) => void;
	placeholder?: string;
	hint?: string;
}) {
	return (
		<TextField
			variant="secondary"
			value={value}
			onChange={onChange}
			className="w-full"
		>
			<Label>{label}</Label>
			<Input variant="secondary" placeholder={placeholder} />
			{hint && (
				<span className="mt-1 block text-xs text-muted">{hint}</span>
			)}
		</TextField>
	);
}
