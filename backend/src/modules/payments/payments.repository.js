const { prisma } = require("../../config/database");

const PAYMENT_SELECT = {
  id: true,
  orderId: true,
  method: true,
  status: true,
  amount: true,
  currency: true,
  transactionReference: true,
  createdAt: true,
  updatedAt: true,
};

async function findOrderWithPaymentsByIdAndUserId(orderId, userId) {
  return prisma.order.findFirst({
    where: { id: orderId, userId },
    select: {
      id: true,
      userId: true,
      orderNumber: true,
      status: true,
      grandTotal: true,
      currency: true,
      payments: {
        orderBy: { createdAt: "asc" },
        select: PAYMENT_SELECT,
      },
    },
  });
}

module.exports = { findOrderWithPaymentsByIdAndUserId };
