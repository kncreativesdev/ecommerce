const { AppError } = require("../../utils/appError");
const paymentsRepository = require("./payments.repository");
const { toSafePayment } = require("./payments.utils");
const { getSupportedPaymentMethods, resolveProvider } = require("./payments.providers");
const { paymentMethodSchema } = require("./payments.validation");

function parseMethod(method) {
  const result = paymentMethodSchema.safeParse(method);
  if (!result.success) {
    throw new AppError(422, "PAYMENT_METHOD_NOT_SUPPORTED", "Payment method is not supported");
  }
  return result.data;
}

function getSupportedMethods() {
  return getSupportedPaymentMethods();
}

function resolvePaymentProvider(method) {
  return resolveProvider(parseMethod(method));
}

function assertTransitionAllowed(currentStatus, nextStatus) {
  void currentStatus;
  void nextStatus;
  throw new AppError(422, "PAYMENT_INVALID_STATE", "Payment state transition is not allowed");
}

function assertPaymentAmountMatchesOrder(payment, order) {
  const paymentAmount = toSafePayment(payment).amount;
  const orderTotal =
    order !== null &&
    typeof order === "object" &&
    typeof order.grandTotal === "object" &&
    typeof order.grandTotal.toFixed === "function"
      ? order.grandTotal.toFixed(2)
      : String(order.grandTotal);
  if (paymentAmount !== orderTotal || payment.currency !== order.currency) {
    throw new AppError(422, "PAYMENT_AMOUNT_MISMATCH", "Payment amount does not match the order total");
  }
}

async function getPaymentsForOrder(userId, orderId) {
  const order = await paymentsRepository.findOrderWithPaymentsByIdAndUserId(orderId, userId);
  if (!order) {
    throw new AppError(404, "PAYMENT_ORDER_NOT_FOUND", "Order not found");
  }
  for (const payment of order.payments) {
    assertPaymentAmountMatchesOrder(payment, order);
  }
  return order.payments.map(toSafePayment);
}

module.exports = {
  getSupportedMethods,
  resolvePaymentProvider,
  assertTransitionAllowed,
  assertPaymentAmountMatchesOrder,
  getPaymentsForOrder,
};
