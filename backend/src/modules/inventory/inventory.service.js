const { AppError } = require("../../utils/appError");
const inventoryRepository = require("./inventory.repository");
const { findVariantByIdAndProductId } = require("../products/products.repository");
const { toSafeInventory } = require("./inventory.utils");
const { formatDecimal } = require("../orders/orders.utils");
const { resolveActorSnapshot, assertAuditInput } = require("../audit/audit.service");

const ADMIN_DEFAULT_PAGE = 1;
const ADMIN_DEFAULT_LIMIT = 20;
const ADMIN_MAX_LIMIT = 100;

function toSafeTransaction(row) {
  return {
    id: row.id,
    variantId: row.variantId,
    quantity: row.quantity,
    type: row.type,
    referenceType: row.referenceType ?? null,
    referenceId: row.referenceId ?? null,
    note: row.note ?? null,
    createdAt: row.createdAt,
  };
}

function toSafeAdminItem(row) {
  const quantity = row.quantity === null || row.quantity === undefined ? null : Number(row.quantity);
  const reserved = row.reserved_quantity === null || row.reserved_quantity === undefined ? null : Number(row.reserved_quantity);
  return {
    product: {
      id: row.product_id_out,
      name: row.product_name,
      slug: row.product_slug,
      isActive: row.product_active === 1 || row.product_active === true,
    },
    variant: {
      id: row.variant_id,
      productId: row.product_id,
      sku: row.sku,
      name: row.variant_name,
      price: formatDecimal(row.variant_price, 2),
      isActive: row.variant_active === 1 || row.variant_active === true,
      createdAt: row.variant_created,
    },
    inventory:
      row.inventory_id === null || row.inventory_id === undefined
        ? null
        : {
            id: row.inventory_id,
            variantId: row.variant_id,
            quantity,
            reservedQuantity: reserved,
            availableQuantity: quantity - reserved,
            updatedAt: row.stock_updated,
          },
  };
}

/**
 * Phase 2C-3 request guard (mirrors the orders service): company-scoped
 * inventory operations need the server-resolved companyId.
 */
function assertRequestCompany(companyId) {
  if (typeof companyId !== "string" || companyId === "") {
    throw new AppError(403, "AUTH_COMPANY_REQUIRED", "Account is not associated with a company");
  }
  return companyId;
}

/**
 * Phase 2C-3 variant gate: the single choke point for all nested
 * inventory operations (detail, initialize, adjust, ledger history).
 * The (variantId, productId) pair must exist AND the variant's
 * denormalized company must match. Cross-company pairs fail with the
 * same 404 as unknown ids — no existence oracle. Variant company is
 * write-once (productId immutable), so the pre-transaction gate cannot
 * race the keyed inventory mutation below.
 */
async function assertVariant(productId, variantId, companyId) {
  assertRequestCompany(companyId);
  const variant = await findVariantByIdAndProductId(variantId, productId);
  if (!variant || variant.companyId !== companyId) {
    throw new AppError(404, "PRODUCT_VARIANT_NOT_FOUND", "Product variant not found");
  }
  return variant;
}

/**
 * Phase 2C-17 business-operation audit. Quantities/direction are safe
 * operational metadata (the ledger keeps per-unit detail); the audit
 * row represents the business operation. Payloads validate up front
 * and commit inside the ledger transaction.
 */
async function snapshotActor(actor) {
  return actor && actor.id ? resolveActorSnapshot(actor.id) : null;
}

function inventoryEvent(snapshot, companyId, action, details) {
  return assertAuditInput({
    actorId: snapshot ? snapshot.id : null,
    actorRole: snapshot ? snapshot.role : "SYSTEM",
    actorEmail: snapshot ? snapshot.email : null,
    companyId,
    action,
    resource: "INVENTORY",
    resourceId: null,
    outcome: "SUCCESS",
    details: details ?? null,
  });
}

async function getInventory(productId, variantId, companyId) {
  await assertVariant(productId, variantId, companyId);
  const record = await inventoryRepository.findByVariantId(variantId);
  if (!record) {
    throw new AppError(404, "INVENTORY_NOT_FOUND", "Inventory not found");
  }
  return toSafeInventory(record);
}

async function initializeInventory(productId, variantId, companyId, input, actor = null) {
  const variant = await assertVariant(productId, variantId, companyId);

  try {
    const record = await inventoryRepository.initializeWithLedger(
      variantId,
      input.quantity,
      input.note ?? null,
      inventoryEvent(await snapshotActor(actor), companyId, "CREATED", {
        variantId,
        sku: variant.sku ?? null,
        quantity: input.quantity,
      })
    );
    return toSafeInventory(record);
  } catch (err) {
    if (err.code === "P2002") {
      throw new AppError(409, "INVENTORY_ALREADY_EXISTS", "Inventory already exists for this variant");
    }
    throw err;
  }
}

async function adjustInventory(productId, variantId, companyId, input, actor = null) {
  const variant = await assertVariant(productId, variantId, companyId);

  const type = input.quantity > 0 ? "RESTOCK" : "ADJUSTMENT";
  const result = await inventoryRepository.adjustWithLedger(
    variantId,
    input.quantity,
    {
      type,
      note: input.note ?? null,
    },
    inventoryEvent(await snapshotActor(actor), companyId, "UPDATED", {
      variantId,
      sku: variant.sku ?? null,
      delta: input.quantity,
      type,
    })
  );

  if (result.outcome === "missing") {
    throw new AppError(404, "INVENTORY_NOT_FOUND", "Inventory not found");
  }
  if (result.outcome === "insufficient") {
    throw new AppError(409, "INSUFFICIENT_STOCK", "Insufficient stock");
  }
  if (result.outcome === "overflow") {
    throw new AppError(422, "VALIDATION_ERROR", "Adjustment exceeds the maximum supported stock");
  }
  return toSafeInventory(result.record);
}

async function listInventoryAdmin(companyId, query) {
  assertRequestCompany(companyId);
  const page = query.page ?? ADMIN_DEFAULT_PAGE;
  const limit = Math.min(query.limit ?? ADMIN_DEFAULT_LIMIT, ADMIN_MAX_LIMIT);
  const search = query.search ? query.search.trim() : "";
  const { rows, total } = await inventoryRepository.findInventoryAdmin({
    companyId,
    search: search === "" ? null : search,
    stock: query.stock ?? null,
    active: query.active === undefined ? null : query.active === "true",
    sortBy: query.sortBy ?? "createdAt",
    sortOrder: query.sortOrder ?? "desc",
    skip: (page - 1) * limit,
    take: limit,
  });
  return {
    items: rows.map(toSafeAdminItem),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}

async function listTransactionsAdmin(productId, variantId, companyId, query) {
  await assertVariant(productId, variantId, companyId);
  const page = query.page ?? ADMIN_DEFAULT_PAGE;
  const limit = Math.min(query.limit ?? ADMIN_DEFAULT_LIMIT, ADMIN_MAX_LIMIT);
  const { rows, total } = await inventoryRepository.findTransactionsByVariantId(
    variantId,
    (page - 1) * limit,
    limit
  );
  return {
    transactions: rows.map(toSafeTransaction),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}

module.exports = { getInventory, initializeInventory, adjustInventory, listInventoryAdmin, listTransactionsAdmin };
