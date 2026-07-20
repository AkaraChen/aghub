import { Button, Disclosure, Input, TextField } from "@heroui/react";
import { useTranslation } from "react-i18next";
import type { UsageSettings } from "../../lib/store";
import {
	PathField,
	SettingNumber,
	SettingRow,
	SettingSelect,
	SettingSwitch,
} from "./usage-setting-controls";
import type { UsageSectionProps } from "./usage-setting-model";

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

export function AdvancedSection({
	current,
	updateSettings,
}: UsageSectionProps) {
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
						<PathField
							label={t("usageConfigPath")}
							value={current.ccusageConfigPath}
							onChange={(ccusageConfigPath) =>
								update({ ccusageConfigPath })
							}
							placeholder={t("usageConfigPathPlaceholder")}
							hint={t("usageConfigPathDescription")}
							filters={[{ name: "JSON", extensions: ["json"] }]}
						/>
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
