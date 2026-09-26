import { describe, expect, it } from 'vitest';
import {
  ORDER_NEXT_STATES,
  ORDER_STATUSES,
  ORDER_STATUS_LABELS,
  ORDER_STATUS_SEQUENCE,
  allowedOrderTransitions,
  normalizeLifecycleStatus,
  orderStatusLabel,
} from '../orderLifecycle.js';

describe('orderLifecycle machine', () => {
  it('exposes the full fulfilment status set (legacy SHIPPED kept for display)', () => {
    for (const status of [
      'PENDING',
      'CONFIRMED',
      'PROCESSING',
      'DISPATCHED',
      'IN_TRANSIT',
      'ARRIVED_IN_CITY',
      'OUT_FOR_DELIVERY',
      'DELIVERED',
      'COMPLETED',
      'CANCELLED',
      'SHIPPED',
    ]) {
      expect(ORDER_STATUSES).toContain(status);
    }
  });

  it('mirrors the backend ORDER_STATUS_TRANSITIONS map', () => {
    expect(ORDER_NEXT_STATES).toEqual({
      PENDING: ['CONFIRMED', 'CANCELLED'],
      CONFIRMED: ['PROCESSING', 'CANCELLED'],
      PROCESSING: ['DISPATCHED', 'CANCELLED'],
      DISPATCHED: ['IN_TRANSIT'],
      IN_TRANSIT: ['ARRIVED_IN_CITY'],
      ARRIVED_IN_CITY: ['OUT_FOR_DELIVERY'],
      OUT_FOR_DELIVERY: ['DELIVERED'],
      DELIVERED: ['COMPLETED'],
      COMPLETED: [],
      CANCELLED: [],
      SHIPPED: ['IN_TRANSIT', 'DELIVERED'],
    });
  });

  it('never transitions INTO shipped and never moves backwards', () => {
    const allNext = Object.values(ORDER_NEXT_STATES).flat();
    expect(allNext).not.toContain('SHIPPED');
    expect(allowedOrderTransitions('DELIVERED')).toEqual(['COMPLETED']);
    expect(allowedOrderTransitions('COMPLETED')).toEqual([]);
    expect(allowedOrderTransitions('CANCELLED')).toEqual([]);
  });

  it('defines the canonical oldest-first sequence without terminal/cancelled noise', () => {
    expect(ORDER_STATUS_SEQUENCE).toEqual([
      'PENDING',
      'CONFIRMED',
      'PROCESSING',
      'DISPATCHED',
      'IN_TRANSIT',
      'ARRIVED_IN_CITY',
      'OUT_FOR_DELIVERY',
      'DELIVERED',
      'COMPLETED',
    ]);
  });

  it('normalizes legacy SHIPPED to DISPATCHED and passes everything else through', () => {
    expect(normalizeLifecycleStatus('SHIPPED')).toBe('DISPATCHED');
    expect(normalizeLifecycleStatus('DISPATCHED')).toBe('DISPATCHED');
    expect(normalizeLifecycleStatus('DELIVERED')).toBe('DELIVERED');
  });

  it('labels every status with friendly copy', () => {
    expect(ORDER_STATUS_LABELS).toEqual({
      PENDING: 'Order Placed',
      CONFIRMED: 'Order Confirmed',
      PROCESSING: 'Preparing Your Order',
      SHIPPED: 'Shipped from Store',
      DISPATCHED: 'Shipped from Store',
      IN_TRANSIT: 'On the Way',
      ARRIVED_IN_CITY: 'Arrived in Your City',
      OUT_FOR_DELIVERY: 'Out for Delivery',
      DELIVERED: 'Delivered',
      COMPLETED: 'Order Completed',
      CANCELLED: 'Cancelled',
    });
    expect(orderStatusLabel('PENDING')).toBe('Order Placed');
    expect(orderStatusLabel('OUT_FOR_DELIVERY')).toBe('Out for Delivery');
    expect(orderStatusLabel('COMPLETED')).toBe('Order Completed');
    expect(orderStatusLabel('')).toBe('—');
  });
});
