import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { OrderTimeline } from '../OrderTimeline.jsx';
import { ORDER_STATUS_SEQUENCE } from '../../../lib/orderStatus.js';

function entry(status, createdAt, note = null) {
  return { id: `h-${status}`, status, previousStatus: null, note, createdAt };
}

const FLOW_HISTORY = [
  entry('PENDING', '2026-09-01T10:00:00.000Z'),
  entry('CONFIRMED', '2026-09-01T12:00:00.000Z'),
  entry('PROCESSING', '2026-09-02T09:30:00.000Z', 'Packed with care'),
];

function flowOrder() {
  return {
    id: 'order-1',
    orderNumber: 'ORD-2026-000001',
    status: 'PROCESSING',
    createdAt: '2026-09-01T10:00:00.000Z',
    statusHistory: FLOW_HISTORY,
  };
}

describe('OrderTimeline', () => {
  it('renders done steps with friendly labels, timestamps and notes', () => {
    render(<OrderTimeline order={flowOrder()} />);

    expect(screen.getByText('Order Placed')).toBeInTheDocument();
    expect(screen.getByText('Order Confirmed')).toBeInTheDocument();
    expect(screen.getByText('Preparing Your Order')).toBeInTheDocument();
    // Note from history renders verbatim.
    expect(screen.getByText('Packed with care')).toBeInTheDocument();
    // Done steps carry real timestamps.
    const times = document.querySelectorAll('time');
    expect(times.length).toBe(3);
    expect(times[0].getAttribute('dateTime')).toBe('2026-09-01T10:00:00.000Z');
  });

  it('shows future steps as Pending without timestamps and never invents rows', () => {
    render(<OrderTimeline order={flowOrder()} />);

    const items = screen.getAllByRole('listitem');
    // Exactly one row per canonical step — no more, no fewer.
    expect(items).toHaveLength(ORDER_STATUS_SEQUENCE.length);

    // Future steps (after PROCESSING) say Pending and carry no timestamp.
    const futureLabels = ['Shipped from Store', 'On the Way', 'Arrived in Your City', 'Out for Delivery', 'Delivered', 'Order Completed'];
    for (const label of futureLabels) {
      const row = items.find((item) => within(item).queryByText(label));
      expect(row).toBeDefined();
      expect(within(row).getByText('Pending')).toBeInTheDocument();
      expect(within(row).queryByRole('time')).toBeNull();
    }
  });

  it('normalizes legacy SHIPPED history onto the Shipped from Store step', () => {
    const order = {
      id: 'order-2',
      orderNumber: 'ORD-2026-000002',
      status: 'SHIPPED',
      createdAt: '2026-09-01T10:00:00.000Z',
      statusHistory: [entry('PENDING', '2026-09-01T10:00:00.000Z'), entry('SHIPPED', '2026-09-03T08:00:00.000Z')],
    };
    render(<OrderTimeline order={order} />);

    expect(screen.getByText('Shipped from Store')).toBeInTheDocument();
    // Still exactly one row per canonical step (no duplicate SHIPPED row).
    expect(screen.getAllByRole('listitem')).toHaveLength(ORDER_STATUS_SEQUENCE.length);
  });

  it('renders a legacy fallback without fabricated steps when history is empty', () => {
    const order = {
      id: 'order-3',
      orderNumber: 'ORD-2026-000003',
      status: 'CONFIRMED',
      createdAt: '2026-08-20T10:00:00.000Z',
      statusHistory: [],
    };
    render(<OrderTimeline order={order} />);

    expect(screen.getByText('Order Confirmed')).toBeInTheDocument();
    expect(screen.getByText(/isn't available for this order/)).toBeInTheDocument();
    // No timeline rows, no invented timestamps.
    expect(screen.queryByRole('list')).toBeNull();
    expect(document.querySelectorAll('time')).toHaveLength(0);
  });

  it('shows placed + cancelled steps with a banner for cancelled orders', () => {
    const order = {
      id: 'order-4',
      orderNumber: 'ORD-2026-000004',
      status: 'CANCELLED',
      createdAt: '2026-09-01T10:00:00.000Z',
      statusHistory: [
        entry('PENDING', '2026-09-01T10:00:00.000Z'),
        entry('CANCELLED', '2026-09-01T15:00:00.000Z', 'Requested by customer'),
      ],
    };
    render(<OrderTimeline order={order} />);

    expect(screen.getByRole('status')).toHaveTextContent('This order was cancelled');
    expect(screen.getByText('Order Placed')).toBeInTheDocument();
    expect(screen.getByText('Cancelled')).toBeInTheDocument();
    expect(screen.getByText('Requested by customer')).toBeInTheDocument();
    // History-driven only: exactly the two recorded steps.
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('renders nothing without an order', () => {
    const { container } = render(<OrderTimeline order={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
