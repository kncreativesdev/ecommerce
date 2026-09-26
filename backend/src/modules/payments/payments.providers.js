const { AppError } = require("../../utils/appError");

const SUPPORTED_PAYMENT_METHODS = ["CASH_ON_DELIVERY"];

const cashOnDeliveryProvider = {
  name: "cashOnDelivery",
  method: "CASH_ON_DELIVERY",
  isManual: true,
  isOnline: false,
  initialStatus: "PENDING",
  describe() {
    return {
      method: this.method,
      isManual: this.isManual,
      isOnline: this.isOnline,
      initialStatus: this.initialStatus,
    };
  },
};

const providerRegistry = {
  CASH_ON_DELIVERY: cashOnDeliveryProvider,
};

function getSupportedPaymentMethods() {
  return [...SUPPORTED_PAYMENT_METHODS];
}

function resolveProvider(method) {
  const provider = providerRegistry[method];
  if (!provider) {
    throw new AppError(422, "PAYMENT_METHOD_NOT_SUPPORTED", "Payment method is not supported");
  }
  return provider;
}

module.exports = {
  SUPPORTED_PAYMENT_METHODS,
  cashOnDeliveryProvider,
  providerRegistry,
  getSupportedPaymentMethods,
  resolveProvider,
};
