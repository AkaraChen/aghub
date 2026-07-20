import { ArrowPathIcon, FolderOpenIcon } from "@heroicons/react/24/solid";
import {
	AlertDialog,
	Button,
	Card,
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
	createDefaultUsageSettings,
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

/** ccusage's npm page — this UI does not install or update the package. */
const CCUSAGE_NPM_URL = "https://www.npmjs.com/package/ccusage";

const THRESHOLD_OPTIONS = USAGE_ALERT_THRESHOLDS_PCT.map((pct) => ({
	id: String(pct),
	label: `${pct}%`,
}));

const USAGE_WINDOW_DAYS = [7, 14, 30, 90] as const;

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

type UsageSettingsUpdate = (
	apply: (current: UsageSettings) => UsageSettings,
) => void;

interface UsageSectionProps {
	current: UsageSettings;
	updateSettings: UsageSettingsUpdate;
}

export default function UsagePanel() {
	const { data: current, update: updateSettings } = useUsageSettingsEditor();
	const [isResetOpen, setIsResetOpen] = useState(false);
	const [layoutTarget, setLayoutTarget] = useState("default");

	const restoreDefaults = () => {
		updateSettings(() => createDefaultUsageSettings());
		setLayoutTarget("default");
		setIsResetOpen(false);
	};

	return (
		<>
			<Card className="gap-0 divide-y divide-border p-4">
				<CcusageSection
					current={current}
					updateSettings={updateSettings}
					onRestoreRequest={() => setIsResetOpen(true)}
				/>
				<HomeCardsSection
					current={current}
					updateSettings={updateSettings}
					layoutTarget={layoutTarget}
					onLayoutTargetChange={setLayoutTarget}
				/>
				<AlertsSection
					current={current}
					updateSettings={updateSettings}
				/>
				<AdvancedSection
					current={current}
					updateSettings={updateSettings}
				/>
			</Card>
			<UsageDefaultsDialog
				isOpen={isResetOpen}
				onOpenChange={setIsResetOpen}
				onRestore={restoreDefaults}
			/>
		</>
	);
}

function CcusageSection({
	current,
	updateSettings,
	onRestoreRequest,
}: UsageSectionProps & { onRestoreRequest: () => void }) {
	const { t } = useTranslation();
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
	const update = (patch: Partial<UsageSettings>) => {
		updateSettings((settings) => ({ ...settings, ...patch }));
	};
	const recheckStatus = async () => {
		await Promise.all([statusQuery.refetch(), diagnosticsQuery.refetch()]);
	};
	const installedVersion = status?.version
		? shortCcusageVersion(status.version)
		: "—";
	const availableVersion =
		status?.update_available && status.latest_version
			? t("usageStatusUpdate", {
					version: shortCcusageVersion(status.latest_version),
				})
			: "";
	const statusDescription =
		status === undefined
			? t("usageStatusChecking")
			: status.reachable
				? [installedVersion, availableVersion]
						.filter(Boolean)
						.join(" · ")
				: (status.error ?? t("usageStatusUnreachable"));
	const showPackagePage =
		(status !== undefined && !status.reachable) || status?.update_available;

	return (
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
					<Button
						size="sm"
						variant="ghost"
						onPress={onRestoreRequest}
						className="text-muted"
					>
						{t("usageRestoreDefaults")}
					</Button>
					{showPackagePage && (
						<Button
							size="sm"
							variant="secondary"
							onPress={() => openUrl(CCUSAGE_NPM_URL)}
						>
							{t("usageStatusPackagePage")}
						</Button>
					)}
				</div>
			</div>
			<SettingRow
				title={t("usageSidecarAutoDiscover")}
				description={t("usageSidecarAutoDiscoverDescription")}
				control={
					<SettingSwitch
						isSelected={current.sidecar.autoDiscover}
						onChange={(autoDiscover) =>
							update({
								sidecar: {
									...current.sidecar,
									autoDiscover,
								},
							})
						}
						ariaLabel={t("usageSidecarAutoDiscover")}
					/>
				}
			/>
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
					onChange={(binPath) =>
						update({
							sidecar: {
								...current.sidecar,
								binPath,
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
				onChange={(ccusageConfigPath) => update({ ccusageConfigPath })}
				placeholder={t("usageConfigPathPlaceholder")}
				hint={t("usageConfigPathDescription")}
				filters={[{ name: "JSON", extensions: ["json"] }]}
			/>
		</section>
	);
}

function HomeCardsSection({
	current,
	updateSettings,
	layoutTarget,
	onLayoutTargetChange,
}: UsageSectionProps & {
	layoutTarget: string;
	onLayoutTargetChange: (target: string) => void;
}) {
	const { t } = useTranslation();
	const home = current.home;
	const editedLayout =
		layoutTarget === "default"
			? home.default
			: (home.perAgent[layoutTarget] ?? home.default);
	const hasOverride =
		layoutTarget !== "default" && layoutTarget in home.perAgent;
	const updateHome = (patch: Partial<UsageSettings["home"]>) => {
		updateSettings((settings) => ({
			...settings,
			home: { ...settings.home, ...patch },
		}));
	};
	const commitLayout = (next: CardLayoutModel) => {
		const layout = {
			windowSlots: next.windowSlots as (HomeWindowId | null)[],
			statSlots: next.statSlots as (HomeStatId | null)[],
		};
		updateSettings((settings) => ({
			...settings,
			home:
				layoutTarget === "default"
					? { ...settings.home, default: layout }
					: {
							...settings.home,
							perAgent: {
								...settings.home.perAgent,
								[layoutTarget]: layout,
							},
						},
		}));
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
	const offeredToTarget = (id: HomeWindowId | HomeStatId) => {
		const agent = layoutFieldAgent(id);
		return layoutTarget === "default" || !agent || agent === layoutTarget;
	};
	const fieldHint = (id: HomeWindowId | HomeStatId) => {
		const agent = layoutFieldAgent(id);
		return layoutTarget === "default" && agent
			? t(
					agent === "claude"
						? "usageStatClaudeOnly"
						: "usageStatCodexOnly",
				)
			: undefined;
	};
	const windowFields: LayoutField[] = HOME_WINDOW_IDS.filter(
		offeredToTarget,
	).map((id) => ({
		id,
		label: t(HOME_WINDOW_LABEL_KEYS[id]),
		hint: fieldHint(id),
	}));
	const statFields: LayoutField[] = HOME_STAT_IDS.filter(offeredToTarget).map(
		(id) => ({
			id,
			label: t(HOME_STAT_DEFINITIONS[id].labelKey),
			hint: fieldHint(id),
		}),
	);
	const previewAgentId =
		layoutTarget === "default" ? USAGE_QUOTA_AGENTS[0] : layoutTarget;

	return (
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
						onChange={(showUsageOnHome) =>
							updateHome({ showUsageOnHome })
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
						onChange={(days) =>
							updateHome({ windowDays: Number(days) })
						}
						isDisabled={!home.showUsageOnHome}
						ariaLabel={t("usageHomeWindow")}
						options={includeSelectedOption(
							USAGE_WINDOW_DAYS.map((days) => ({
								id: String(days),
								label: t("usageWindowDaysOption", { days }),
							})),
							String(home.windowDays),
							t("usageWindowDaysOption", {
								days: home.windowDays,
							}),
						)}
					/>
				}
			/>
			<div className="w-full space-y-3 border-t border-border pt-4">
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
							onChange={onLayoutTargetChange}
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
					isDisabled={!home.showUsageOnHome}
					onCommit={commitLayout}
					preview={{
						agentId: previewAgentId,
						agentName:
							AGENT_LABELS[previewAgentId] ?? previewAgentId,
					}}
				/>
			</div>
		</section>
	);
}

function AlertsSection({ current, updateSettings }: UsageSectionProps) {
	const { t } = useTranslation();
	const { availableAgents } = useAgentAvailability();
	const agentName = (id: string) =>
		availableAgents.find((agent) => agent.id === id)?.display_name ??
		AGENT_LABELS[id] ??
		id;
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

	return (
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
					<SettingSelect
						value={String(current.globalAlertThresholdPct)}
						onChange={(globalAlertThresholdPct) =>
							update({
								globalAlertThresholdPct: Number(
									globalAlertThresholdPct,
								),
							})
						}
						ariaLabel={t("usageGlobalAlertThreshold")}
						options={includeSelectedOption(
							THRESHOLD_OPTIONS,
							String(current.globalAlertThresholdPct),
							`${current.globalAlertThresholdPct}%`,
						)}
					/>
				}
			/>
			{USAGE_QUOTA_AGENTS.map((agent) => {
				const config = agentSettings(current, agent);
				const selectedThreshold =
					config.alertThresholdPct === null
						? GLOBAL_THRESHOLD_KEY
						: String(config.alertThresholdPct);
				const thresholdOptions = [
					{
						id: GLOBAL_THRESHOLD_KEY,
						label: t("usageAlertUseGlobal", {
							pct: current.globalAlertThresholdPct,
						}),
					},
					...THRESHOLD_OPTIONS,
				];
				const displayName = agentName(agent);
				return (
					<div
						key={agent}
						className="flex items-center justify-between gap-4 border-t border-border pt-4"
					>
						<span className="flex items-center gap-2 text-sm font-medium text-(--foreground)">
							<AgentIcon
								id={agent}
								name={displayName}
								size="xs"
							/>
							{displayName}
						</span>
						<SettingSelect
							value={selectedThreshold}
							onChange={(key) =>
								updateAgent(agent, {
									alertThresholdPct:
										key === GLOBAL_THRESHOLD_KEY
											? null
											: Number(key),
								})
							}
							ariaLabel={t("usageAgentAlert")}
							options={includeSelectedOption(
								thresholdOptions,
								selectedThreshold,
								`${config.alertThresholdPct}%`,
							)}
						/>
					</div>
				);
			})}
		</section>
	);
}

function AdvancedSection({ current, updateSettings }: UsageSectionProps) {
	const { t } = useTranslation();
	const update = (patch: Partial<UsageSettings>) => {
		updateSettings((settings) => ({ ...settings, ...patch }));
	};
	const timezoneIds =
		current.timezone && !COMMON_TIMEZONES.includes(current.timezone)
			? [current.timezone, ...COMMON_TIMEZONES]
			: COMMON_TIMEZONES;
	const timezoneOptions = [
		{ id: "", label: t("usageTimezoneSystem") },
		...timezoneIds.map((id) => ({ id, label: id })),
	];

	return (
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
									onChange={(seconds) =>
										update({
											pollIntervalMs: seconds * 1000,
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
									onChange={(timezone) =>
										update({ timezone })
									}
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
									onChange={(offlinePricing) =>
										update({ offlinePricing })
									}
									ariaLabel={t("usageOfflinePricing")}
								/>
							}
						/>
						<SettingRow
							title={t("usageRequestTimeout")}
							description={t("usageRequestTimeoutDescription")}
							control={
								<SettingNumber
									value={current.requestTimeoutSecs}
									onChange={(requestTimeoutSecs) =>
										update({ requestTimeoutSecs })
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
								onChange={(extraArgs) => update({ extraArgs })}
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
	);
}

function UsageDefaultsDialog({
	isOpen,
	onOpenChange,
	onRestore,
}: {
	isOpen: boolean;
	onOpenChange: (isOpen: boolean) => void;
	onRestore: () => void;
}) {
	const { t } = useTranslation();
	return (
		<AlertDialog.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
			<AlertDialog.Container>
				<AlertDialog.Dialog className="sm:max-w-[420px]">
					<AlertDialog.CloseTrigger />
					<AlertDialog.Header>
						<AlertDialog.Heading>
							{t("usageRestoreDefaults")}
						</AlertDialog.Heading>
					</AlertDialog.Header>
					<AlertDialog.Body>
						{t("usageRestoreDefaultsConfirm")}
					</AlertDialog.Body>
					<AlertDialog.Footer>
						<Button
							variant="tertiary"
							onPress={() => onOpenChange(false)}
						>
							{t("cancel")}
						</Button>
						<Button variant="danger" onPress={onRestore}>
							{t("usageRestoreDefaultsAction")}
						</Button>
					</AlertDialog.Footer>
				</AlertDialog.Dialog>
			</AlertDialog.Container>
		</AlertDialog.Backdrop>
	);
}

function layoutFieldAgent(
	id: HomeWindowId | HomeStatId,
): "claude" | "codex" | undefined {
	if (id === "weekly_opus") return "claude";
	const stat = HOME_STAT_IDS.find((candidate) => candidate === id);
	return stat ? HOME_STAT_AGENT_HINT[stat] : undefined;
}

interface SelectOption {
	id: string;
	label: string;
}

function includeSelectedOption(
	options: SelectOption[],
	id: string,
	label: string,
): SelectOption[] {
	return options.some((option) => option.id === id)
		? options
		: [{ id, label }, ...options];
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
			<Switch.Content aria-label={ariaLabel}>
				<Switch.Control>
					<Switch.Thumb />
				</Switch.Control>
			</Switch.Content>
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
			<NumberField.Group className="w-36">
				<NumberField.DecrementButton />
				<NumberField.Input className="text-center tabular-nums" />
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
