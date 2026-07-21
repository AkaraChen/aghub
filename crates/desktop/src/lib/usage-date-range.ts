const DAY_MS = 24 * 60 * 60 * 1_000;

interface UsageDateRange {
	since: string;
	until: string;
	timezone: string;
	dates: string[];
}

export function buildUsageDateRange(
	days: number,
	timezonePreference: string,
	now = new Date(),
): UsageDateRange {
	const timezone =
		timezonePreference ||
		new Intl.DateTimeFormat().resolvedOptions().timeZone;
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

function toIsoDate(date: Date): string {
	return [
		date.getUTCFullYear(),
		String(date.getUTCMonth() + 1).padStart(2, "0"),
		String(date.getUTCDate()).padStart(2, "0"),
	].join("-");
}
