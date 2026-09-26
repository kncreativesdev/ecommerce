const { prisma } = require("../../config/database");
const { MAX_INT32 } = require("./inventory.validation");

const INVENTORY_SELECT = {
  id: true,
  variantId: true,
  quantity: true,
  reservedQuantity: true,
  createdAt: true,
  updatedAt: true,
};

async function findByVariantId(variantId) {
  return prisma.inventory.findUnique({
    where: { variantId },
    select: INVENTORY_SELECT,
  });
}

async function initializeWithLedger(variantId, quantity, note) {
  return prisma.$transaction(async (tx) => {
    const record = await tx.inventory.create({
      data: { variantId, quantity },
      select: INVENTORY_SELECT,
    });
    await tx.inventoryTransaction.create({
      data: {
        variantId,
        quantity,
        type: "INITIAL_STOCK",
        referenceType: "ADMIN",
        note: note ?? null,
      },
    });
    return record;
  });
}

async function adjustWithLedger(variantId, delta, entry) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.inventory.findUnique({
      where: { variantId },
      select: INVENTORY_SELECT,
    });
    if (!current) {
      return { outcome: "missing" };
    }

    if (delta < 0) {
      const updated = await tx.inventory.updateMany({
        where: { variantId, quantity: { gte: -delta } },
        data: { quantity: { decrement: -delta } },
      });
      if (updated.count === 0) {
        return { outcome: "insufficient", record: current };
      }
    } else {
      if (current.quantity + delta > MAX_INT32) {
        return { outcome: "overflow", record: current };
      }
      const updated = await tx.inventory.updateMany({
        where: { variantId },
        data: { quantity: { increment: delta } },
      });
      if (updated.count === 0) {
        return { outcome: "missing" };
      }
    }

    await tx.inventoryTransaction.create({
      data: {
        variantId,
        quantity: delta,
        type: entry.type,
        referenceType: "ADMIN",
        note: entry.note ?? null,
      },
    });

    const record = await tx.inventory.findUniqueOrThrow({
      where: { variantId },
      select: INVENTORY_SELECT,
    });
    return { outcome: "ok", record };
  });
}

const TRANSACTION_SELECT = {
  id: true,
  variantId: true,
  quantity: true,
  type: true,
  referenceType: true,
  referenceId: true,
  note: true,
  createdAt: true,
};

/**
 * Admin stock list across ALL variants (variants without a stock record
 * are included with a null inventory so they can be initialized).
 * Search, stock, and active predicates are built from fixed fragments —
 * no user input ever reaches SQL as an identifier.
 */
async function findInventoryAdmin(filters) {
  const { search, stock, active, sortBy, sortOrder, skip, take } = filters;

  const conditions = [];
  const params = [];
  if (search) {
    // Escape LIKE wildcards so the search is a literal substring match
    // (Prisma `contains` escapes the same way for the orders admin list).
    const escaped = search.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
    conditions.push("(v.sku LIKE ? ESCAPE '\\\\' OR v.name LIKE ? ESCAPE '\\\\' OR p.name LIKE ? ESCAPE '\\\\')");
    const like = `%${escaped}%`;
    params.push(like, like, like);
  }
  if (active !== null && active !== undefined) {
    conditions.push("v.is_active = ?");
    params.push(active ? 1 : 0);
  }
  if (stock === "in") {
    conditions.push("i.variant_id IS NOT NULL AND (i.quantity - i.reserved_quantity) > 0");
  } else if (stock === "out") {
    conditions.push("(i.variant_id IS NULL OR (i.quantity - i.reserved_quantity) <= 0)");
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const sortColumns = {
    sku: "v.sku",
    createdAt: "v.created_at",
    updatedAt: "i.updated_at",
  };
  const sortColumn = sortColumns[sortBy] ?? "v.created_at";
  const direction = sortOrder === "asc" ? "ASC" : "DESC";

  const rows = await prisma.$queryRawUnsafe(
    `
    SELECT v.id AS variant_id, v.product_id, v.sku, v.name AS variant_name,
      v.price AS variant_price, v.is_active AS variant_active, v.created_at AS variant_created,
      p.id AS product_id_out, p.name AS product_name, p.slug AS product_slug, p.is_active AS product_active,
      i.id AS inventory_id, i.quantity, i.reserved_quantity, i.updated_at AS stock_updated
    FROM product_variants v
    JOIN products p ON p.id = v.product_id
    LEFT JOIN inventory i ON i.variant_id = v.id
    ${where}
    ORDER BY ${sortColumn} ${direction}, v.id ASC
    LIMIT ? OFFSET ?
  `,
    ...params,
    take,
    skip
  );
  const countRows = await prisma.$queryRawUnsafe(
    `
    SELECT COUNT(*) AS total
    FROM product_variants v
    JOIN products p ON p.id = v.product_id
    LEFT JOIN inventory i ON i.variant_id = v.id
    ${where}
  `,
    ...params
  );
  return { rows, total: Number(countRows[0]?.total ?? 0) };
}

async function findTransactionsByVariantId(variantId, skip, take) {
  const [rows, total] = await Promise.all([
    prisma.inventoryTransaction.findMany({
      where: { variantId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip,
      take,
      select: TRANSACTION_SELECT,
    }),
    prisma.inventoryTransaction.count({ where: { variantId } }),
  ]);
  return { rows, total };
}

module.exports = {
  findByVariantId,
  initializeWithLedger,
  adjustWithLedger,
  findInventoryAdmin,
  findTransactionsByVariantId,
};
