const { prisma } = require("../../config/database");

/**
 * Dashboard aggregation repository. All aggregates are computed by the
 * database — order rows are never hydrated into JavaScript for summing.
 *
 * RECOGNIZED REVENUE predicate (see dashboard.service.js for the full
 * definition): an order counts iff `orders.status` is DELIVERED or
 * COMPLETED AND its latest payment (by `created_at`) has `status =
 * 'PAID'`. COMPLETED is the lifecycle-closure state entered only from
 * DELIVERED, so both prove handover; counting both (not double
 * counting — one row matches one predicate) keeps revenue stable as
 * orders graduate from DELIVERED to COMPLETED. Checkout creates
 * exactly one COD/PENDING payment row per order and admin payment
 * updates mutate that row in place, so in practice the join is 1:1;
 * the NOT EXISTS guard keeps the predicate correct if a second row
 * ever appears.
 */

const RECOGNIZED_JOIN = `
  LEFT JOIN payments p ON p.order_id = o.id
    AND p.status = 'PAID'
    AND NOT EXISTS (
      SELECT 1 FROM payments p2
      WHERE p2.order_id = o.id AND p2.created_at > p.created_at
    )
`;

// NOTE: the physical column is camelCase `grandTotal` — the Prisma
// field declares no @map (verified in
// prisma/migrations/20260916115156_init/migration.sql:231).
const RECOGNIZED_CASE = `CASE WHEN o.status IN ('DELIVERED', 'COMPLETED') AND p.id IS NOT NULL THEN o.grandTotal ELSE 0 END`;

// Bucket key expressions (UTC; created_at is stored UTC). Keys are fixed
// code constants selected by granularity — never user input.
const BUCKET_EXPRESSIONS = {
  hour: "DATE_FORMAT(o.created_at, '%Y-%m-%dT%H:00:00.000Z')",
  day: "DATE_FORMAT(o.created_at, '%Y-%m-%d')",
  month: "DATE_FORMAT(o.created_at, '%Y-%m-01')",
};

function toCount(value) {
  return Number(value ?? 0);
}

function toDecimalString(value) {
  if (value === null || value === undefined) {
    return "0.00";
  }
  return String(value);
}

/**
 * Phase 2C-2 company scoping: every aggregate below takes the
 * server-resolved `companyId` and restricts to that company — order
 * aggregates via the owning user, the inventory snapshot via the
 * variant's denormalized tenant column (bound parameter, never
 * interpolated). Prisma groupBy uses the relation filter; raw SQL
 * joins with a bound company parameter.
 */
async function getOrderStatusCounts(companyId) {
  const rows = await prisma.order.groupBy({
    by: ["status"],
    where: { user: { companyId } },
    _count: { _all: true },
  });
  const counts = {};
  for (const row of rows) {
    counts[row.status] = row._count._all;
  }
  return counts;
}

async function getRecognizedRevenueTotal(companyId) {
  const rows = await prisma.$queryRawUnsafe(
    `
    SELECT COALESCE(SUM(${RECOGNIZED_CASE}), 0) AS revenue
    FROM orders o
    ${RECOGNIZED_JOIN}
    JOIN users u ON u.id = o.user_id
    WHERE u.company_id = ?
  `,
    companyId
  );
  return toDecimalString(rows[0]?.revenue);
}

async function getPeriodAggregates(companyId, from, now) {
  const rows = await prisma.$queryRawUnsafe(
    `
    SELECT COUNT(*) AS orders,
      COALESCE(SUM(${RECOGNIZED_CASE}), 0) AS revenue
    FROM orders o
    ${RECOGNIZED_JOIN}
    JOIN users u ON u.id = o.user_id
    WHERE u.company_id = ? AND o.created_at >= ? AND o.created_at < ?
  `,
    companyId,
    from,
    now
  );
  return {
    orders: toCount(rows[0]?.orders),
    revenue: toDecimalString(rows[0]?.revenue),
  };
}

/**
 * Orders completed in a period (UTC boundaries).
 *
 * Intended meaning (product semantics): orders whose current status is
 * COMPLETED AND whose completion event (immutable OrderStatusHistory row
 * with status COMPLETED) happened inside [from, now). Completion is
 * determined by the history/event timestamp — never by `orders.created_at`
 * (which dates placement) and never by current status alone (which would
 * count historical completions as "today").
 *
 * COMPLETED is terminal (entered only from DELIVERED), so the join on
 * current status plus the history timestamp is both precise and stable.
 */
async function getCompletedInPeriodCount(companyId, from, now) {
  const rows = await prisma.$queryRawUnsafe(
    `
    SELECT COUNT(DISTINCT h.order_id) AS completed
    FROM order_status_history h
    JOIN orders o ON o.id = h.order_id AND o.status = 'COMPLETED'
    JOIN users u ON u.id = o.user_id
    WHERE h.status = 'COMPLETED' AND u.company_id = ? AND h.created_at >= ? AND h.created_at < ?
  `,
    companyId,
    from,
    now
  );
  return toCount(rows[0]?.completed);
}

async function getBuckets(companyId, granularity, from, frameEnd) {
  const bucketExpression = BUCKET_EXPRESSIONS[granularity];
  if (!bucketExpression) {
    throw new Error(`Unknown bucket granularity: ${granularity}`);
  }
  const rows = await prisma.$queryRawUnsafe(
    `
    SELECT ${bucketExpression} AS bucket, COUNT(*) AS orders,
      COALESCE(SUM(${RECOGNIZED_CASE}), 0) AS revenue
    FROM orders o
    ${RECOGNIZED_JOIN}
    JOIN users u ON u.id = o.user_id
    WHERE u.company_id = ? AND o.created_at >= ? AND o.created_at < ?
    GROUP BY bucket
    ORDER BY bucket ASC
  `,
    companyId,
    from,
    frameEnd
  );
  return rows.map((row) => ({
    bucketStart: String(row.bucket),
    orders: toCount(row.orders),
    revenue: toDecimalString(row.revenue),
  }));
}

/**
 * Actionable stock snapshot over ACTIVE variants of ACTIVE products only
 * (inactive catalogue cannot sell, so it must not inflate the alert).
 * Out of stock = available (quantity - reservedQuantity) <= 0. Variants
 * with no stock record cannot be purchased, so they count as out of
 * stock and are reported separately as uninitialized.
 *
 * Served EXCLUSIVELY on the ADMIN-only operational dashboard (`GET
 * /dashboard/summary`, which rejects SUPER_ADMIN via
 * `authorize("ADMIN")`) — a company operator's stock alert, scoped to
 * the admin's company via the bound parameter above. No SUPER_ADMIN
 * platform aggregate exists yet; one will be built separately when
 * platform statistics land.
 */
async function getInventorySnapshot(companyId) {
  const rows = await prisma.$queryRawUnsafe(
    `
    SELECT
      COUNT(*) AS tracked,
      COALESCE(SUM(CASE WHEN i.variant_id IS NULL THEN 1 ELSE 0 END), 0) AS uninitialized,
      COALESCE(SUM(CASE WHEN i.variant_id IS NOT NULL AND (i.quantity - i.reserved_quantity) <= 0 THEN 1 ELSE 0 END), 0) AS emptyRows
    FROM product_variants v
    JOIN products p ON p.id = v.product_id AND p.is_active = 1
    LEFT JOIN inventory i ON i.variant_id = v.id
    WHERE v.is_active = 1 AND v.company_id = ?
  `,
    companyId
  );
  const row = rows[0] ?? {};
  const uninitialized = toCount(row.uninitialized);
  const emptyRows = toCount(row.emptyRows);
  return {
    tracked: toCount(row.tracked),
    outOfStock: uninitialized + emptyRows,
    uninitialized,
  };
}

module.exports = {
  getOrderStatusCounts,
  getRecognizedRevenueTotal,
  getPeriodAggregates,
  getCompletedInPeriodCount,
  getBuckets,
  getInventorySnapshot,
};
