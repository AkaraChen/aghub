import { describe, expect, it } from "vitest";
import {
	buildUsageReportDateRange,
	usageReportDates,
} from "./usage-date-range";

describe("buildUsageReportDateRange", () => {
	it("uses the last 30 calendar days by default", () => {
		const range = buildUsageReportDateRange(
			{ mode: "last30", since: "", until: "" },
			"UTC",
			new Date("2026-07-20T12:00:00Z"),
		);

		expect(range.since).toBe("20260621");
		expect(range.until).toBe("20260720");
		expect(range.dates).toHaveLength(30);
	});

	it("omits date bounds for all-time reports", () => {
		const range = buildUsageReportDateRange(
			{ mode: "all", since: "", until: "" },
			"UTC",
		);

		expect(range).toEqual({ timezone: "UTC", dates: [] });
	});

	it("uses an inclusive custom date range", () => {
		const range = buildUsageReportDateRange(
			{
				mode: "custom",
				since: "2026-07-01",
				until: "2026-07-03",
			},
			"Asia/Shanghai",
		);

		expect(range).toEqual({
			since: "20260701",
			until: "20260703",
			timezone: "Asia/Shanghai",
			dates: ["2026-07-01", "2026-07-02", "2026-07-03"],
		});
	});
});

describe("usageReportDates", () => {
	it("fills calendar gaps across all reported agents", () => {
		expect(
			usageReportDates([
				{ days: [{ date: "2026-07-03" }] },
				{ days: [{ date: "2026-07-01" }] },
			]),
		).toEqual(["2026-07-01", "2026-07-02", "2026-07-03"]);
	});
});
