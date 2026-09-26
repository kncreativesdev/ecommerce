import { describe, it, expect } from "vitest";

import {
  bucketStartsFor,
  rangeFrame,
  startOfDayUTC,
  startOfISOWeekUTC,
  startOfMonthUTC,
  startOfYearUTC,
} from "../../src/modules/dashboard/dashboard.service.js";

/**
 * Deterministic date-range semantics for GET /dashboard/summary.
 * Fixed timestamps (no sleeps, no live clock): every boundary,
 * granularity, bucket count, bucket order, and UTC convention is asserted
 * against the REAL helpers used by `getSummary` — no repository mocks,
 * no duplicated business logic.
 *
 * Aggregation behavior itself (bucket sums equal period totals, genuine
 * zeros, recognized-revenue predicate) is covered by the live-MySQL
 * suite `tests/integration/admin-dashboard-inventory.test.js`, which runs
 * against the real repository.
 */

const NOW = new Date("2026-09-19T12:34:56.000Z"); // a Saturday (UTC)

describe("dashboard UTC boundaries (fixed clock)", () => {
  it("today starts at 00:00 UTC of the same day", () => {
    expect(startOfDayUTC(NOW).toISOString()).toBe("2026-09-19T00:00:00.000Z");
  });

  it("week starts on ISO Monday 00:00 UTC", () => {
    // 2026-09-19 is a Saturday; Monday of that ISO week is 2026-09-14.
    expect(startOfISOWeekUTC(NOW).toISOString()).toBe("2026-09-14T00:00:00.000Z");
    expect(startOfISOWeekUTC(NOW).getUTCDay()).toBe(1);
    // A Sunday still belongs to the Monday-started week.
    expect(startOfISOWeekUTC(new Date("2026-09-20T23:59:59.000Z")).toISOString()).toBe(
      "2026-09-14T00:00:00.000Z"
    );
    // Monday itself is exact.
    expect(startOfISOWeekUTC(new Date("2026-09-14T00:00:00.000Z")).toISOString()).toBe(
      "2026-09-14T00:00:00.000Z"
    );
  });

  it("month starts on the 1st at 00:00 UTC", () => {
    expect(startOfMonthUTC(NOW).toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });

  it("year starts on Jan 1st at 00:00 UTC", () => {
    expect(startOfYearUTC(NOW).toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("dashboard range frames (fixed clock)", () => {
  it("today: UTC day frame with hourly granularity", () => {
    const { from, frameEnd, granularity } = rangeFrame("today", NOW);
    expect(granularity).toBe("hour");
    expect(from.toISOString()).toBe("2026-09-19T00:00:00.000Z");
    expect(frameEnd.toISOString()).toBe("2026-09-20T00:00:00.000Z");
  });

  it("week: 7-day Monday-started frame with daily granularity", () => {
    const { from, frameEnd, granularity } = rangeFrame("week", NOW);
    expect(granularity).toBe("day");
    expect(from.toISOString()).toBe("2026-09-14T00:00:00.000Z");
    expect(frameEnd.toISOString()).toBe("2026-09-21T00:00:00.000Z");
  });

  it("month: full calendar-month frame with daily granularity", () => {
    const { from, frameEnd, granularity } = rangeFrame("month", NOW);
    expect(granularity).toBe("day");
    expect(from.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(frameEnd.toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });

  it("year: full calendar-year frame with monthly granularity", () => {
    const { from, frameEnd, granularity } = rangeFrame("year", NOW);
    expect(granularity).toBe("month");
    expect(from.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(frameEnd.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });
});

describe("dashboard bucket frames (fixed clock)", () => {
  it("today: 24 ordered hourly buckets covering the UTC day", () => {
    const buckets = bucketStartsFor("today", NOW);
    expect(buckets).toHaveLength(24);
    expect(buckets[0]).toBe("2026-09-19T00:00:00.000Z");
    expect(buckets[23]).toBe("2026-09-19T23:00:00.000Z");
    expect([...buckets].sort()).toEqual(buckets);
    expect(new Set(buckets).size).toBe(24);
  });

  it("week: 7 ordered daily buckets Monday to Sunday", () => {
    const buckets = bucketStartsFor("week", NOW);
    expect(buckets).toHaveLength(7);
    expect(buckets[0]).toBe("2026-09-14");
    expect(buckets[6]).toBe("2026-09-20");
    expect([...buckets].sort()).toEqual(buckets);
  });

  it("month: one bucket per calendar day (September = 30, February 2026 = 28)", () => {
    const september = bucketStartsFor("month", NOW);
    expect(september).toHaveLength(30);
    expect(september[0]).toBe("2026-09-01");
    expect(september[29]).toBe("2026-09-30");

    const february = bucketStartsFor("month", new Date("2026-02-15T08:00:00.000Z"));
    expect(february).toHaveLength(28);
    expect(february[0]).toBe("2026-02-01");
    expect(february[27]).toBe("2026-02-28");
  });

  it("year: 12 ordered monthly buckets", () => {
    const buckets = bucketStartsFor("year", NOW);
    expect(buckets).toHaveLength(12);
    expect(buckets[0]).toBe("2026-01-01");
    expect(buckets[11]).toBe("2026-12-01");
    expect([...buckets].sort()).toEqual(buckets);
  });
});
