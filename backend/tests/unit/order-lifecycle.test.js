import { describe, it, expect } from "vitest";

import {
  ORDER_STATUS_TRANSITIONS,
  ORDER_STATUS_SEQUENCE,
  PAYMENT_STATUS_TRANSITIONS,
  normalizeLifecycleStatus,
  orderStatusNotification,
} from "../../src/modules/orders/orders.service.js";
import {
  orderStatusSchema,
  updateOrderStatusSchema,
} from "../../src/modules/orders/orders.validation.js";

/**
 * Order lifecycle contract (pure, no DB): the canonical fulfilment
 * chain, terminal states, cancellation scope, legacy SHIPPED handling,
 * server-centralized notification copy, and strict status validation.
 */

const FULL_CHAIN = [
  "PENDING",
  "CONFIRMED",
  "PROCESSING",
  "DISPATCHED",
  "IN_TRANSIT",
  "ARRIVED_IN_CITY",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "COMPLETED",
];

describe("order state machine", () => {
  it("walks the full fulfilment chain forward exactly once", () => {
    for (let index = 0; index < FULL_CHAIN.length - 1; index += 1) {
      const from = FULL_CHAIN[index];
      const to = FULL_CHAIN[index + 1];
      expect(ORDER_STATUS_TRANSITIONS[from]).toContain(to);
    }
  });

  it("exposes the canonical sequence in lifecycle order", () => {
    expect(ORDER_STATUS_SEQUENCE).toEqual(FULL_CHAIN);
  });

  it("keeps COMPLETED and CANCELLED terminal", () => {
    expect(ORDER_STATUS_TRANSITIONS.COMPLETED).toEqual([]);
    expect(ORDER_STATUS_TRANSITIONS.CANCELLED).toEqual([]);
  });

  it("allows cancellation only before dispatch", () => {
    expect(ORDER_STATUS_TRANSITIONS.PENDING).toContain("CANCELLED");
    expect(ORDER_STATUS_TRANSITIONS.CONFIRMED).toContain("CANCELLED");
    expect(ORDER_STATUS_TRANSITIONS.PROCESSING).toContain("CANCELLED");
    for (const state of [
      "DISPATCHED",
      "IN_TRANSIT",
      "ARRIVED_IN_CITY",
      "OUT_FOR_DELIVERY",
      "DELIVERED",
      "COMPLETED",
    ]) {
      expect(ORDER_STATUS_TRANSITIONS[state]).not.toContain("CANCELLED");
    }
  });

  it("never moves backwards", () => {
    const rank = new Map(FULL_CHAIN.map((status, index) => [status, index]));
    for (const [from, targets] of Object.entries(ORDER_STATUS_TRANSITIONS)) {
      if (from === "SHIPPED" || from === "CANCELLED") continue;
      for (const to of targets) {
        if (to === "CANCELLED") continue;
        expect(rank.get(to)).toBeGreaterThan(rank.get(from));
      }
    }
  });

  it("keeps DELIVERED and COMPLETED distinct", () => {
    expect(ORDER_STATUS_TRANSITIONS.DELIVERED).toEqual(["COMPLETED"]);
    expect(ORDER_STATUS_SEQUENCE).toContain("DELIVERED");
    expect(ORDER_STATUS_SEQUENCE).toContain("COMPLETED");
  });

  it("confines legacy SHIPPED to a forward-only compatibility path", () => {
    // No state transitions INTO shipped any more.
    for (const [from, targets] of Object.entries(ORDER_STATUS_TRANSITIONS)) {
      if (from === "SHIPPED") continue;
      expect(targets).not.toContain("SHIPPED");
    }
    expect(ORDER_STATUS_TRANSITIONS.SHIPPED).toEqual(["IN_TRANSIT", "DELIVERED"]);
    expect(normalizeLifecycleStatus("SHIPPED")).toBe("DISPATCHED");
    expect(normalizeLifecycleStatus("DELIVERED")).toBe("DELIVERED");
  });

  it("leaves the COD payment machine untouched", () => {
    expect(PAYMENT_STATUS_TRANSITIONS).toEqual({
      PENDING: ["PAID", "FAILED"],
      FAILED: ["PAID"],
      PAID: ["REFUNDED"],
      REFUNDED: [],
    });
  });
});

describe("order status notifications (server-centralized copy)", () => {
  it("generates a distinct message per lifecycle state", () => {
    const messages = new Map();
    for (const status of [...FULL_CHAIN, "CANCELLED"]) {
      if (status === "PENDING") continue;
      const copy = orderStatusNotification("ORD-2026-000001", status);
      expect(copy.title.length).toBeGreaterThan(0);
      expect(copy.message).toContain("ORD-2026-000001");
      messages.set(status, copy.message);
    }
    // Every state must read differently to the customer.
    expect(new Set(messages.values()).size).toBe(messages.size);
  });

  it("covers the legacy SHIPPED state with dispatch copy", () => {
    expect(orderStatusNotification("ORD-1", "SHIPPED").message).toContain("left our store");
  });
});

describe("order status validation", () => {
  it("accepts every lifecycle state including the new ones", () => {
    for (const status of [...FULL_CHAIN, "SHIPPED", "CANCELLED"]) {
      expect(orderStatusSchema.parse(status)).toBe(status);
    }
  });

  it("rejects unknown statuses and accepts an optional transition note", () => {
    expect(() => orderStatusSchema.parse("ON_THE_MOON")).toThrow();
    expect(updateOrderStatusSchema.parse({ status: "CONFIRMED" })).toEqual({
      status: "CONFIRMED",
    });
    expect(
      updateOrderStatusSchema.parse({ status: "DISPATCHED", note: "Handed to courier" })
    ).toEqual({ status: "DISPATCHED", note: "Handed to courier" });
  });

  it("rejects empty and oversized notes", () => {
    expect(() => updateOrderStatusSchema.parse({ status: "CONFIRMED", note: "  " })).toThrow();
    expect(() =>
      updateOrderStatusSchema.parse({ status: "CONFIRMED", note: "x".repeat(501) })
    ).toThrow();
  });
});
