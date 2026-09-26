const { AppError } = require("../../utils/appError");
const inventoryRepository = require("./inventory.repository");
const { findVariantByIdAndProductId } = require("../products/products.repository");
const { toSafeInventory } = require("./inventory.utils");
const { formatDecimal } = require("../orders/orders.utils");

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

async function assertVariant(productId, variantId) {
  const variant = await findVariantByIdAndProductId(variantId, productId);
  if (!variant) {
    throw new AppError(404, "PRODUCT_VARIANT_NOT_FOUND", "Product variant not found");
  }
  return variant;
}

async function getInventory(productId, variantId) {
  await assertVariant(productId, variantId);
  const record = await inventoryRepository.findByVariantId(variantId);
  if (!record) {
    throw new AppError(404, "INVENTORY_NOT_FOUND", "Inventory not found");
  }
  return toSafeInventory(record);
}

async function initializeInventory(productId, variantId, input) {
  await assertVariant(productId, variantId);

  try {
    const record = await inventoryRepository.initializeWithLedger(
      variantId,
      input.quantity,
      input.note ?? null
    );
    return toSafeInventory(record);
  } catch (err) {
    if (err.code === "P2002") {
      throw new AppError(409, "INVENTORY_ALREADY_EXISTS", "Inventory already exists for this variant");
    }
    throw err;
  }
}

async function adjustInventory(productId, variantId, input) {
  await assertVariant(productId, variantId);

  const type = input.quantity > 0 ? "RESTOCK" : "ADJUSTMENT";
  const result = await inventoryRepository.adjustWithLedger(variantId, input.quantity, {
    type,
    note: input.note ?? null,
  });

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

async function listInventoryAdmin(query) {
  const page = query.page ?? ADMIN_DEFAULT_PAGE;
  const limit = Math.min(query.limit ?? ADMIN_DEFAULT_LIMIT, ADMIN_MAX_LIMIT);
  const search = query.search ? query.search.trim() : "";
  const { rows, total } = await inventoryRepository.findInventoryAdmin({
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

async function listTransactionsAdmin(productId, variantId, query) {
  await assertVariant(productId, variantId);
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
