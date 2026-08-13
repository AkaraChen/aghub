import type { UsageReportRangeSettings } from "./store";

const DAY_MS = 24 * 60 * 60 * 1_000;

export interface UsageDateRange {
	since?: string;
	until?: string;
	timezone: string;
	dates: string[];
}

export function buildUsageDateRange(
	days: number,
	timezonePreference: string,
	now = new Date(),
): UsageDateRange {
	const timezone = resolveTimezone(timezonePreference);
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone: timezone,
		calendar: "gregory",
		numberingSystem: "latn",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).formatToParts(now);
	const valueOf = (type: Intl.DateTimeFormatPartTypes) =>
		Number(parts.find((part) => part.type === type)?.value);
	const end = Date.UTC(valueOf("year"), valueOf("month") - 1, valueOf("day"));
	const dates = Array.from({ length: days }, (_, index) =>
		toIsoDate(new Date(end - (days - index - 1) * DAY_MS)),
	);

	return {
		since: dates[0].replaceAll("-", ""),
		until: dates[dates.length - 1].replaceAll("-", ""),
		timezone,
		dates,
	};
}

export function buildUsageReportDateRange(
	range: UsageReportRangeSettings,
	timezonePreference: string,
	now = new Date(),
): UsageDateRange {
	if (range.mode === "last30") {
		return buildUsageDateRange(30, timezonePreference, now);
	}
	const timezone = resolveTimezone(timezonePreference);
	if (range.mode === "all") return { timezone, dates: [] };
	return {
		since: compactDate(range.since),
		until: compactDate(range.until),
		timezone,
		dates: buildDatesBetween(range.since, range.until),
	};
}

export function usageReportDates(
	agents: readonly { days: readonly { date: string }[] }[],
): string[] {
	const dates = agents.flatMap((agent) =>
		agent.days.map((entry) => entry.date),
	);
	if (dates.length === 0) return [];
	dates.sort();
	return buildDatesBetween(dates[0], dates[dates.length - 1]);
}

function resolveTimezone(timezonePreference: string): string {
	return (
		timezonePreference ||
		new Intl.DateTimeFormat().resolvedOptions().timeZone
	);
}

function compactDate(value: string): string {
	return value.replaceAll("-", "");
}

function buildDatesBetween(since: string, until: string): string[] {
	const start = Date.parse(`${since}T00:00:00Z`);
	const end = Date.parse(`${until}T00:00:00Z`);
	const days = Math.floor((end - start) / DAY_MS) + 1;
	return Array.from({ length: days }, (_, index) =>
		toIsoDate(new Date(start + index * DAY_MS)),
	);
}

function toIsoDate(date: Date): string {
	return [
		date.getUTCFullYear(),
		String(date.getUTCMonth() + 1).padStart(2, "0"),
		String(date.getUTCDate()).padStart(2, "0"),
	].join("-");
}
