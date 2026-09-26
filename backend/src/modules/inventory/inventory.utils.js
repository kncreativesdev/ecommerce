function toSafeInventory(record) {
  return {
    id: record.id,
    variantId: record.variantId,
    quantity: record.quantity,
    reservedQuantity: record.reservedQuantity,
    availableQuantity: record.quantity - record.reservedQuantity,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

module.exports = { toSafeInventory };
