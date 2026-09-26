const { z } = require("zod");

const paymentMethodSchema = z.enum(["CASH_ON_DELIVERY"]);

const paymentStatusSchema = z.enum(["PENDING", "PAID", "FAILED", "REFUNDED"]);

module.exports = { paymentMethodSchema, paymentStatusSchema };
