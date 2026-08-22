import { parseDate } from "@internationalized/date";
import {
	DateField,
	DateRangePicker,
	Label,
	RangeCalendar,
} from "@heroui/react";
import { useTranslation } from "react-i18next";
import {
	USAGE_REPORT_RANGE_MODES,
	type UsageReportRangeMode,
} from "../../lib/store";
import { buildUsageDateRange } from "../../lib/usage-date-range";
import { SettingRow, SettingSelect } from "./usage-setting-controls";
import type { UsageSectionProps } from "./usage-setting-model";

export function UsageReportSection({
	current,
	updateSettings,
}: UsageSectionProps) {
	const { t } = useTranslation();
	const range = current.reportRange;
	const recent = buildUsageDateRange(30, current.timezone);
	const customSince = range.mode === "custom" ? range.since : recent.dates[0];
	const customUntil =
		range.mode === "custom"
			? range.until
			: recent.dates[recent.dates.length - 1];
	const updateRange = (reportRange: typeof current.reportRange) => {
		updateSettings((settings) => ({ ...settings, reportRange }));
	};
	const selectMode = (key: string) => {
		if (!USAGE_REPORT_RANGE_MODES.includes(key as UsageReportRangeMode)) {
			return;
		}
		const mode = key as UsageReportRangeMode;
		updateRange(
			mode === "custom"
				? { mode, since: customSince, until: customUntil }
				: { mode, since: "", until: "" },
		);
	};

	return (
		<section className="space-y-4 px-1 py-5">
			<div className="space-y-0.5">
				<span className="text-sm font-semibold text-(--foreground)">
					{t("usageSettingsReport")}
				</span>
				<span className="block text-xs text-muted">
					{t("usageSettingsReportDescription")}
				</span>
			</div>
			<SettingRow
				testId="usage-report-range-row"
				title={t("usageReportRange")}
				description={t("usageReportRangeDescription")}
				control={
					<SettingSelect
						value={range.mode}
						onChange={selectMode}
						ariaLabel={t("usageReportRange")}
						className="min-w-40"
						options={[
							{
								id: "last30",
								label: t("usageReportRangeLast30"),
							},
							{
								id: "all",
								label: t("usageReportRangeAll"),
							},
							{
								id: "custom",
								label: t("usageReportRangeCustom"),
							},
						]}
					/>
				}
			/>
			{range.mode === "custom" && (
				<div
					data-testid="usage-custom-date-range"
					className="ml-auto w-full max-w-md rounded-lg bg-surface-secondary p-3"
				>
					<DateRangePicker
						className="w-full"
						value={{
							start: parseDate(customSince),
							end: parseDate(customUntil),
						}}
						onChange={(value) => {
							if (!value) return;
							updateRange({
								mode: "custom",
								since: value.start.toString(),
								until: value.end.toString(),
							});
						}}
						aria-label={t("usageReportCustomDates")}
					>
						<Label className="sr-only">
							{t("usageReportCustomDates")}
						</Label>
						<DateField.Group variant="secondary" fullWidth>
							<DateField.InputContainer>
								<DateField.Input slot="start">
									{(segment) => (
										<DateField.Segment segment={segment} />
									)}
								</DateField.Input>
								<DateRangePicker.RangeSeparator />
								<DateField.Input slot="end">
									{(segment) => (
										<DateField.Segment segment={segment} />
									)}
								</DateField.Input>
							</DateField.InputContainer>
							<DateField.Suffix>
								<DateRangePicker.Trigger>
									<DateRangePicker.TriggerIndicator />
								</DateRangePicker.Trigger>
							</DateField.Suffix>
						</DateField.Group>
						<DateRangePicker.Popover>
							<RangeCalendar>
								<RangeCalendar.Header>
									<RangeCalendar.NavButton slot="previous" />
									<RangeCalendar.Heading />
									<RangeCalendar.NavButton slot="next" />
								</RangeCalendar.Header>
								<RangeCalendar.Grid>
									<RangeCalendar.GridHeader>
										{(day) => (
											<RangeCalendar.HeaderCell>
												{day}
											</RangeCalendar.HeaderCell>
										)}
									</RangeCalendar.GridHeader>
									<RangeCalendar.GridBody>
										{(date) => (
											<RangeCalendar.Cell date={date} />
										)}
									</RangeCalendar.GridBody>
								</RangeCalendar.Grid>
							</RangeCalendar>
						</DateRangePicker.Popover>
					</DateRangePicker>
				</div>
			)}
		</section>
	);
}
