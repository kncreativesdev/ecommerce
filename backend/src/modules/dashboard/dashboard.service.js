const dashboardRepository = require("./dashboard.repository");
const { priceToCents, centsToString } = require("../orders/orders.utils");

/**
 * Dashboard summary service.
 *
 * RECOGNIZED REVENUE DEFINITION (evidence-based, see orders + payments
 * modules):
 * - INCLUDED: SUM(orders.grandTotal) over orders with status DELIVERED
 *   or COMPLETED whose latest payment row has status PAID. COMPLETED is
 *   entered only from DELIVERED (lifecycle closure after handover), so
 *   both prove the sale; DELIVERED-only orders keep counting exactly as
 *   before the workflow expansion.
 * - EXCLUDED: CANCELLED always (stock is restored, proving no sale);
 *   PENDING/CONFIRMED/PROCESSING/DISPATCHED/IN_TRANSIT/ARRIVED_IN_CITY/
 *   OUT_FOR_DELIVERY/SHIPPED-legacy (in-flight, cash not earned);
 *   payment PENDING (COD created, not collected) or FAILED; REFUNDED
 *   (PAID → REFUNDED is a recorded manual refund with no gateway payout —
 *   the row keeps its amount, so the PAID-only predicate nets it to
 *   zero instead of overcounting).
 * - Timing: attributed to orders.createdAt (UTC). There is no paidAt
 *   column, and payments.updatedAt is overwritten by REFUNDED, so it
 *   cannot date cash collection.
 *
 * DATE-RANGE CONVENTION (UTC; created_at is stored UTC; no week
 * convention existed, so ISO Monday-start is chosen and documented):
 * - today: [00:00 UTC today, now); buckets: 24 hourly.
 * - week: [Monday 00:00 UTC, now); buckets: 7 daily Mon–Sun.
 * - month: [1st 00:00 UTC, now); buckets: every calendar day of the
 *   month (future days read zero).
 * - year: [Jan 1 00:00 UTC, now); buckets: 12 monthly.
 * The frontend sends only the range enum — boundaries are computed here
 * from a single server `now`, so both sides can never disagree or drift.
 * Empty buckets are explicit zeros (measured absence, never invented
 * values): bucket revenue/orders always sum exactly to the frame totals.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDayUTC(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function startOfISOWeekUTC(date) {
  const day = startOfDayUTC(date);
  // getUTCDay: 0=Sunday..6=Saturday; ISO weeks start Monday.
  const offset = (day.getUTCDay() + 6) % 7;
  return new Date(day.getTime() - offset * DAY_MS);
}

function startOfMonthUTC(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function startOfYearUTC(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function toISODateUTC(date) {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

function bucketStartsFor(range, now) {
  if (range === "today") {
    const start = startOfDayUTC(now);
    return Array.from({ length: 24 }, (_, hour) => {
      const slot = new Date(start.getTime() + hour * 60 * 60 * 1000);
      return `${toISODateUTC(slot)}T${pad2(slot.getUTCHours())}:00:00.000Z`;
    });
  }
  if (range === "week") {
    const start = startOfISOWeekUTC(now);
    return Array.from({ length: 7 }, (_, day) => toISODateUTC(new Date(start.getTime() + day * DAY_MS)));
  }
  if (range === "month") {
    const start = startOfMonthUTC(now);
    const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
    return Array.from({ length: daysInMonth }, (_, day) =>
      toISODateUTC(new Date(start.getTime() + day * DAY_MS))
    );
  }
  const year = now.getUTCFullYear();
  return Array.from({ length: 12 }, (_, month) => `${year}-${pad2(month + 1)}-01`);
}

function rangeFrame(range, now) {
  if (range === "week") {
    const from = startOfISOWeekUTC(now);
    return { from, frameEnd: new Date(from.getTime() + 7 * DAY_MS), granularity: "day" };
  }
  if (range === "month") {
    const from = startOfMonthUTC(now);
    const frameEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    return { from, frameEnd, granularity: "day" };
  }
  if (range === "year") {
    const from = startOfYearUTC(now);
    return { from, frameEnd: new Date(Date.UTC(now.getUTCFullYear() + 1, 0, 1)), granularity: "month" };
  }
  const from = startOfDayUTC(now);
  return { from, frameEnd: new Date(from.getTime() + DAY_MS), granularity: "hour" };
}

function toMoneyString(value) {
  return centsToString(priceToCents(String(value ?? "0")));
}

async function getSummary(range = "today", now = new Date()) {
  const { from, frameEnd, granularity } = rangeFrame(range, now);

  const [statusCounts, revenueTotal, period, completedInPeriod, rows, inventory] = await Promise.all([
    dashboardRepository.getOrderStatusCounts(),
    dashboardRepository.getRecognizedRevenueTotal(),
    dashboardRepository.getPeriodAggregates(from, now),
    dashboardRepository.getCompletedInPeriodCount(from, now),
    dashboardRepository.getBuckets(granularity, from, frameEnd),
    dashboardRepository.getInventorySnapshot(),
  ]);

  const byBucket = new Map(rows.map((row) => [row.bucketStart, row]));
  // Zero-fill every expected slot so charts render the true frame shape.
  // Zeros are measured absence (the aggregation saw no rows), not data.
  const buckets = bucketStartsFor(range, now).map((bucketStart) => {
    const row = byBucket.get(bucketStart);
    return {
      bucketStart,
      orders: row ? row.orders : 0,
      revenue: row ? toMoneyString(row.revenue) : "0.00",
    };
  });

  const total = (statusCounts.PENDING ?? 0) + (statusCounts.CONFIRMED ?? 0) + (statusCounts.PROCESSING ?? 0) + (statusCounts.SHIPPED ?? 0) + (statusCounts.DISPATCHED ?? 0) + (statusCounts.IN_TRANSIT ?? 0) + (statusCounts.ARRIVED_IN_CITY ?? 0) + (statusCounts.OUT_FOR_DELIVERY ?? 0) + (statusCounts.DELIVERED ?? 0) + (statusCounts.COMPLETED ?? 0) + (statusCounts.CANCELLED ?? 0);

  return {
    range,
    periodStart: from.toISOString(),
    periodEnd: now.toISOString(),
    generatedAt: new Date().toISOString(),
    granularity,
    orders: {
      total,
      pending: statusCounts.PENDING ?? 0,
      confirmed: statusCounts.CONFIRMED ?? 0,
      processing: statusCounts.PROCESSING ?? 0,
      // Legacy SHIPPED rows merge into the dispatched bucket (same
      // fulfilment step) so old orders stay visible without a dead card.
      dispatched: (statusCounts.DISPATCHED ?? 0) + (statusCounts.SHIPPED ?? 0),
      inTransit: statusCounts.IN_TRANSIT ?? 0,
      arrivedInCity: statusCounts.ARRIVED_IN_CITY ?? 0,
      outForDelivery: statusCounts.OUT_FOR_DELIVERY ?? 0,
      delivered: statusCounts.DELIVERED ?? 0,
      completed: statusCounts.COMPLETED ?? 0,
      cancelled: statusCounts.CANCELLED ?? 0,
    },
    revenue: {
      // All-time recognized revenue (DELIVERED + PAID). Money arrives and
      // leaves as backend decimal strings — never floats.
      total: toMoneyString(revenueTotal),
    },
    period: {
      orders: period.orders,
      revenue: toMoneyString(period.revenue),
      // Orders whose COMPLETED history event happened inside the period
      // (UTC). For `range=today` this is "completed today" — distinct from
      // all-time `orders.completed` below. Determined by history timestamp,
      // never by creation date or current status alone.
      completed: completedInPeriod,
    },
    buckets,
    inventory,
  };
}

module.exports = {
  getSummary,
  // Pure UTC frame helpers (exported for deterministic unit tests; the
  // service itself always calls them with the live server `now`).
  startOfDayUTC,
  startOfISOWeekUTC,
  startOfMonthUTC,
  startOfYearUTC,
  bucketStartsFor,
  rangeFrame,
};
