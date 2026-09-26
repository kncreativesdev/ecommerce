const { prisma } = require("../../config/database");
const { AppError } = require("../../utils/appError");
const { priceToCents, centsToString } = require("./orders.utils");
const { tryConsumeUsageTx } = require("../coupons/coupons.repository");

const ORDER_ITEM_SELECT = {
  id: true,
  productId: true,
  variantId: true,
  productName: true,
  variantName: true,
  sku: true,
  unitPrice: true,
  discount: true,
  quantity: true,
  lineTotal: true,
  imageStoragePath: true,
  createdAt: true,
};

/**
 * Display-image pick shared by checkout snapshots and cart lines:
 * variant primary → variant first (sortOrder) → product primary →
 * product first → null. Callers pass pre-sorted image arrays.
 */
function pickDisplayImage(variantImages, productImages) {
  const ordered = (list) => [...(list || [])].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const vImages = ordered(variantImages);
  const pImages = ordered(productImages);
  const pick = vImages.find((image) => image.isPrimary) ?? vImages[0] ?? null;
  if (pick) return pick;
  return pImages.find((image) => image.isPrimary) ?? pImages[0] ?? null;
}

const TX_IMAGE_SELECT = {
  orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  select: { storagePath: true, altText: true, sortOrder: true, isPrimary: true },
};

const ORDER_ADDRESS_SELECT = {
  id: true,
  type: true,
  fullName: true,
  phone: true,
  addressLine1: true,
  addressLine2: true,
  city: true,
  state: true,
  postalCode: true,
  country: true,
};

const PAYMENT_SELECT = {
  id: true,
  method: true,
  status: true,
  amount: true,
  currency: true,
  transactionReference: true,
  createdAt: true,
  updatedAt: true,
};

const STATUS_HISTORY_SELECT = {
  id: true,
  status: true,
  previousStatus: true,
  note: true,
  createdAt: true,
};

const ORDER_WITH_DETAILS_SELECT = {
  id: true,
  orderNumber: true,
  status: true,
  subtotal: true,
  discountTotal: true,
  shippingTotal: true,
  taxTotal: true,
  grandTotal: true,
  currency: true,
  createdAt: true,
  updatedAt: true,
  items: {
    orderBy: { createdAt: "asc" },
    select: ORDER_ITEM_SELECT,
  },
  addresses: {
    select: ORDER_ADDRESS_SELECT,
  },
  payments: {
    orderBy: { createdAt: "asc" },
    select: PAYMENT_SELECT,
  },
  statusHistory: {
    orderBy: { createdAt: "asc" },
    select: STATUS_HISTORY_SELECT,
  },
};

const ADMIN_ORDER_WITH_DETAILS_SELECT = {
  ...ORDER_WITH_DETAILS_SELECT,
  userId: true,
  user: {
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      phone: true,
    },
  },
};

const ADDRESS_SNAPSHOT_SELECT = {
  id: true,
  fullName: true,
  phone: true,
  addressLine1: true,
  addressLine2: true,
  city: true,
  state: true,
  postalCode: true,
  country: true,
};

async function findAddressByIdAndUserId(id, userId) {
  return prisma.address.findFirst({
    where: { id, userId },
    select: ADDRESS_SNAPSHOT_SELECT,
  });
}

async function findOrdersByUserId(userId) {
  return prisma.order.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: ORDER_WITH_DETAILS_SELECT,
  });
}

async function findOrderByIdAndUserId(id, userId) {
  return prisma.order.findFirst({
    where: { id, userId },
    select: ORDER_WITH_DETAILS_SELECT,
  });
}

/**
 * Admin order list. Every filter is explicit — callers pass a normalized
 * filter object (service layer), never raw query params. No ownership
 * predicate: ADMIN authorization is enforced by route middleware.
 */
async function findOrdersAdmin(filters) {
  const { status, paymentStatus, search, city, state, fromDate, toDate, sortBy, sortOrder, skip, take } =
    filters;

  const and = [];
  if (status) {
    and.push({ status });
  }
  if (paymentStatus) {
    and.push({ payments: { some: { status: paymentStatus } } });
  }
  // Geographic filter over the immutable order address snapshots. City/state
  // match the same address row (shipping or billing) via substring, so
  // filtering by both narrows to one destination rather than matching
  // across two different addresses.
  if (city || state) {
    const addressFilter = {};
    if (city) addressFilter.city = { contains: city };
    if (state) addressFilter.state = { contains: state };
    and.push({ addresses: { some: addressFilter } });
  }
  if (fromDate || toDate) {
    const createdAt = {};
    if (fromDate) {
      createdAt.gte = fromDate;
    }
    if (toDate) {
      createdAt.lte = toDate;
    }
    and.push({ createdAt });
  }
  if (search) {
    and.push({
      OR: [
        { orderNumber: { contains: search } },
        { items: { some: { sku: { contains: search } } } },
        { user: { email: { contains: search } } },
        { user: { firstName: { contains: search } } },
        { user: { lastName: { contains: search } } },
      ],
    });
  }

  const where = and.length > 0 ? { AND: and } : {};
  const orderBy =
    sortBy === "grandTotal" ? [{ grandTotal: sortOrder }, { createdAt: "desc" }] : [{ createdAt: sortOrder }];

  const [rows, total] = await Promise.all([
    prisma.order.findMany({
      where,
      orderBy,
      skip,
      take,
      select: ADMIN_ORDER_WITH_DETAILS_SELECT,
    }),
    prisma.order.count({ where }),
  ]);
  return { rows, total };
}

async function findOrderByIdAdmin(id) {
  return prisma.order.findUnique({
    where: { id },
    select: ADMIN_ORDER_WITH_DETAILS_SELECT,
  });
}

async function findLatestOrderNumberForYear(year) {
  const prefix = `ORD-${year}-`;
  const row = await prisma.order.findFirst({
    where: { orderNumber: { startsWith: prefix } },
    orderBy: { orderNumber: "desc" },
    select: { orderNumber: true },
  });
  return row ? row.orderNumber : null;
}

function buildOrderNumber(year, sequence) {
  return `ORD-${year}-${String(sequence).padStart(6, "0")}`;
}

async function createOrderTransaction(userId, orderNumber, shippingAddress, billingAddress, coupon) {
  return prisma.$transaction(async (tx) => {
    const cart = await tx.cart.findUnique({
      where: { userId },
      select: {
        id: true,
        items: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            variantId: true,
            quantity: true,
            variant: {
              select: {
                id: true,
                productId: true,
                sku: true,
                name: true,
                price: true,
                isActive: true,
                images: TX_IMAGE_SELECT,
                product: {
                  select: { id: true, name: true, isActive: true, images: TX_IMAGE_SELECT },
                },
                inventory: {
                  select: { quantity: true, reservedQuantity: true },
                },
              },
            },
          },
        },
      },
    });

    if (!cart || cart.items.length === 0) {
      return { outcome: "empty" };
    }

    for (const item of cart.items) {
      if (!item.variant.isActive || !item.variant.product.isActive) {
        return { outcome: "inactive", variantId: item.variantId };
      }
      if (!item.variant.inventory) {
        return { outcome: "insufficient", variantId: item.variantId };
      }
      const available = item.variant.inventory.quantity - item.variant.inventory.reservedQuantity;
      if (item.quantity > available) {
        return { outcome: "insufficient", variantId: item.variantId };
      }
    }

    let subtotalCents = 0n;
    const lines = cart.items.map((item) => {
      const unitCents = priceToCents(item.variant.price);
      const lineCents = unitCents * BigInt(item.quantity);
      subtotalCents += lineCents;
      // Immutable display-image snapshot at order time (see schema docs).
      // Later media edits, deactivations, or deletions never rewrite it.
      const displayImage = pickDisplayImage(item.variant.images, item.variant.product.images);
      return {
        productId: item.variant.productId,
        variantId: item.variantId,
        productName: item.variant.product.name,
        variantName: item.variant.name,
        sku: item.variant.sku,
        unitPrice: centsToString(unitCents),
        quantity: item.quantity,
        lineTotal: centsToString(lineCents),
        imageStoragePath: displayImage ? displayImage.storagePath : null,
      };
    });
    const subtotal = centsToString(subtotalCents);

    // Optional coupon discount (validated by the service just before this
    // transaction). Server-side math only: discountTotal is subtracted from
    // the subtotal for the grand total AND the COD payment amount. The
    // discount is bounded by construction (FIXED capped at eligible
    // subtotal, PERCENTAGE ≤ 100% of eligible ≤ subtotal), so the total
    // can never go negative. Per-item snapshots stay untouched — the order
    // discount is a historical order-level snapshot.
    const discountCents = coupon ? priceToCents(coupon.discountTotal) : 0n;
    const discountTotal = centsToString(discountCents);
    const grandTotal = centsToString(subtotalCents - discountCents);

    const order = await tx.order.create({
      data: {
        userId,
        orderNumber,
        status: "PENDING",
        subtotal,
        discountTotal,
        shippingTotal: "0.00",
        taxTotal: "0.00",
        grandTotal,
        currency: "INR",
      },
      select: { id: true },
    });

    for (const line of lines) {
      await tx.orderItem.create({
        data: {
          orderId: order.id,
          productId: line.productId,
          variantId: line.variantId,
          productName: line.productName,
          variantName: line.variantName,
          sku: line.sku,
          unitPrice: line.unitPrice,
          discount: "0.00",
          quantity: line.quantity,
          lineTotal: line.lineTotal,
          imageStoragePath: line.imageStoragePath,
        },
      });
    }

    await tx.orderAddress.create({
      data: {
        orderId: order.id,
        type: "SHIPPING",
        fullName: shippingAddress.fullName,
        phone: shippingAddress.phone,
        addressLine1: shippingAddress.addressLine1,
        addressLine2: shippingAddress.addressLine2 ?? null,
        city: shippingAddress.city,
        state: shippingAddress.state,
        postalCode: shippingAddress.postalCode,
        country: shippingAddress.country,
      },
    });

    if (billingAddress) {
      await tx.orderAddress.create({
        data: {
          orderId: order.id,
          type: "BILLING",
          fullName: billingAddress.fullName,
          phone: billingAddress.phone,
          addressLine1: billingAddress.addressLine1,
          addressLine2: billingAddress.addressLine2 ?? null,
          city: billingAddress.city,
          state: billingAddress.state,
          postalCode: billingAddress.postalCode,
          country: billingAddress.country,
        },
      });
    }

    await tx.payment.create({
      data: {
        orderId: order.id,
        method: "CASH_ON_DELIVERY",
        status: "PENDING",
        amount: grandTotal,
        currency: "INR",
      },
    });

    // Lifecycle seed: the authoritative first history row. Every later
    // transition appends exactly one row (see
    // updateOrderStatusTransaction), so the ledger is complete for all
    // orders created after this milestone.
    await tx.orderStatusHistory.create({
      data: {
        orderId: order.id,
        status: "PENDING",
        previousStatus: null,
        note: null,
        createdBy: null,
      },
    });

    // Coupon usage is consumed HERE — inside the order transaction — so a
    // failed order (stock race, address issue, number conflict retry) never
    // consumes usage, and concurrent checkouts serialize on the guarded
    // `usedCount < usageLimit` predicate (loser gets 409, order rolled back).
    if (coupon) {
      const consumed = await tryConsumeUsageTx(tx, coupon.couponId);
      if (consumed.outcome === "missing") {
        throw new AppError(404, "COUPON_NOT_FOUND", "Coupon not found");
      }
      if (consumed.outcome === "exhausted") {
        throw new AppError(409, "COUPON_USAGE_LIMIT_EXCEEDED", "Coupon usage limit has been exceeded");
      }
    }

    for (const item of cart.items) {
      const decremented = await tx.inventory.updateMany({
        where: { variantId: item.variantId, quantity: { gte: item.quantity } },
        data: { quantity: { decrement: item.quantity } },
      });
      if (decremented.count === 0) {
        throw new AppError(409, "ORDER_INSUFFICIENT_STOCK", "Insufficient stock for one or more items");
      }
      await tx.inventoryTransaction.create({
        data: {
          variantId: item.variantId,
          quantity: -item.quantity,
          type: "ORDER",
          referenceType: "ORDER",
          referenceId: order.id,
        },
      });
    }

    await tx.cartItem.deleteMany({ where: { cartId: cart.id } });

    return { outcome: "ok", orderId: order.id };
  });
}

/**
 * Admin status mutation. Conditional on `expectedStatus` so a concurrent
 * admin action surfaces as a 409 conflict instead of silently winning.
 * Transition to CANCELLED atomically restores the quantities decremented
 * at checkout and writes ORDER_CANCELLED ledger rows (DATABASE.md §22).
 * The frontend never touches inventory directly.
 *
 * Atomicity (single Prisma transaction): order status write + exactly
 * one immutable history row + exactly one customer notification. If any
 * write fails the whole transition rolls back, so the current status,
 * the ledger, and the customer's inbox can never silently diverge.
 * Same-status retries are rejected by the service before reaching here,
 * so no duplicate history/notification rows can be produced.
 */
async function updateOrderStatusTransaction(orderId, expectedStatus, nextStatus, options = {}) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        userId: true,
        orderNumber: true,
        status: true,
        items: { select: { variantId: true, quantity: true } },
      },
    });
    if (!order) {
      return { outcome: "missing" };
    }
    if (order.status !== expectedStatus) {
      return { outcome: "conflict", status: order.status };
    }

    // Conditional write: a concurrent admin action that changed the status
    // first makes this update a no-op instead of double-applying (e.g.
    // restoring inventory twice for two racing cancellations).
    const updated = await tx.order.updateMany({
      where: { id: orderId, status: expectedStatus },
      data: { status: nextStatus },
    });
    if (updated.count === 0) {
      const fresh = await tx.order.findUnique({
        where: { id: orderId },
        select: { status: true },
      });
      return { outcome: "conflict", status: fresh ? fresh.status : order.status };
    }

    if (nextStatus === "CANCELLED") {
      for (const item of order.items) {
        const restored = await tx.inventory.updateMany({
          where: { variantId: item.variantId },
          data: { quantity: { increment: item.quantity } },
        });
        if (restored.count === 0) {
          throw new AppError(
            409,
            "ORDER_INVENTORY_MISSING",
            "Cannot cancel: inventory record is missing for an ordered variant"
          );
        }
        await tx.inventoryTransaction.create({
          data: {
            variantId: item.variantId,
            quantity: item.quantity,
            type: "ORDER_CANCELLED",
            referenceType: "ORDER",
            referenceId: orderId,
          },
        });
      }
    }

    await tx.orderStatusHistory.create({
      data: {
        orderId,
        status: nextStatus,
        previousStatus: expectedStatus,
        note: options.note ?? null,
        createdBy: options.createdBy ?? null,
      },
    });

    const notification = options.notification ?? null;
    if (notification) {
      await tx.notification.create({
        data: {
          userId: order.userId,
          type: "ORDER_STATUS",
          title: notification.title,
          message: notification.message,
          orderId,
        },
      });
    }

    return { outcome: "ok" };
  });
}

/**
 * Atomic bulk status mutation (all-or-nothing).
 *
 * `expectedById` maps orderId → expected current status (validated by the
 * service against ORDER_STATUS_TRANSITIONS before this transaction runs).
 * Inside ONE Prisma transaction, for every order:
 * - re-read + conditional `updateMany where:{id,status:expected}` so a
 *   concurrent change rolls back the whole bulk as a conflict instead of
 *   double-applying,
 * - CANCELLED restores checkout-decremented stock with ORDER_CANCELLED
 *   ledger rows (missing stock row aborts the whole bulk),
 * - exactly one immutable history row + exactly one customer notification.
 *
 * Any failure (missing order, status conflict, inventory gap) throws and
 * rolls back every order — never partial success reported as success.
 */
async function bulkUpdateOrderStatusTransaction(orderIds, expectedById, nextStatus, options = {}) {
  return prisma.$transaction(async (tx) => {
    const results = [];
    for (const orderId of orderIds) {
      const expectedStatus = expectedById[orderId];
      const order = await tx.order.findUnique({
        where: { id: orderId },
        select: {
          id: true,
          userId: true,
          orderNumber: true,
          status: true,
          items: { select: { variantId: true, quantity: true } },
        },
      });
      if (!order) {
        throw new AppError(404, "ORDER_NOT_FOUND", `Order not found: ${orderId}`);
      }
      if (order.status !== expectedStatus) {
        throw new AppError(
          409,
          "ORDER_CONCURRENT_UPDATE",
          `Order ${order.orderNumber} changed while updating (now ${order.status}). Reload and retry.`
        );
      }
      const updated = await tx.order.updateMany({
        where: { id: orderId, status: expectedStatus },
        data: { status: nextStatus },
      });
      if (updated.count === 0) {
        throw new AppError(
          409,
          "ORDER_CONCURRENT_UPDATE",
          `Order ${order.orderNumber} changed while updating. Reload and retry.`
        );
      }
      if (nextStatus === "CANCELLED") {
        for (const item of order.items) {
          const restored = await tx.inventory.updateMany({
            where: { variantId: item.variantId },
            data: { quantity: { increment: item.quantity } },
          });
          if (restored.count === 0) {
            throw new AppError(
              409,
              "ORDER_INVENTORY_MISSING",
              "Cannot cancel: inventory record is missing for an ordered variant"
            );
          }
          await tx.inventoryTransaction.create({
            data: {
              variantId: item.variantId,
              quantity: item.quantity,
              type: "ORDER_CANCELLED",
              referenceType: "ORDER",
              referenceId: orderId,
            },
          });
        }
      }
      await tx.orderStatusHistory.create({
        data: {
          orderId,
          status: nextStatus,
          previousStatus: expectedStatus,
          note: options.note ?? null,
          createdBy: options.createdBy ?? null,
        },
      });
      const notification = options.notificationFor
        ? options.notificationFor(order.orderNumber, nextStatus)
        : options.notification ?? null;
      if (notification) {
        await tx.notification.create({
          data: {
            userId: order.userId,
            type: "ORDER_STATUS",
            title: notification.title,
            message: notification.message,
            orderId,
          },
        });
      }
      results.push(orderId);
    }
    return { outcome: "ok", orderIds: results };
  });
}

/**
 * Admin payment-status mutation. Operates on the latest payment row
 * (checkout creates exactly one COD/PENDING row). Amount/currency are
 * never altered here — status only.
 */
async function updateOrderPaymentStatusTransaction(orderId, expectedPaymentStatus, nextStatus) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        payments: {
          orderBy: { createdAt: "desc" },
          select: { id: true, status: true },
        },
      },
    });
    if (!order) {
      return { outcome: "missing" };
    }
    const latest = order.payments[0];
    if (!latest) {
      return { outcome: "payment-missing" };
    }
    if (latest.status !== expectedPaymentStatus) {
      return { outcome: "conflict", status: latest.status };
    }

    // Conditional write: same anti-double-apply guard as order status.
    const updated = await tx.payment.updateMany({
      where: { id: latest.id, status: expectedPaymentStatus },
      data: { status: nextStatus },
    });
    if (updated.count === 0) {
      const fresh = await tx.payment.findUnique({
        where: { id: latest.id },
        select: { status: true },
      });
      return { outcome: "conflict", status: fresh ? fresh.status : latest.status };
    }
    return { outcome: "ok" };
  });
}

module.exports = {
  findAddressByIdAndUserId,
  findOrdersByUserId,
  findOrderByIdAndUserId,
  findOrdersAdmin,
  findOrderByIdAdmin,
  findLatestOrderNumberForYear,
  buildOrderNumber,
  createOrderTransaction,
  updateOrderStatusTransaction,
  bulkUpdateOrderStatusTransaction,
  updateOrderPaymentStatusTransaction,
};
