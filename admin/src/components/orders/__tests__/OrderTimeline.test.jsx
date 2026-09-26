import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { OrderTimeline } from '../OrderTimeline.jsx';

function historyEntry(overrides = {}) {
  return {
    id: `h-${overrides.status}`,
    status: 'PENDING',
    previousStatus: null,
    note: null,
    createdAt: '2026-09-01T10:00:00.000Z',
    ...overrides,
  };
}

describe('OrderTimeline', () => {
  it('renders done steps with timestamps and pending steps without timestamps', () => {
    const order = {
      id: 'o1',
      status: 'PROCESSING',
      createdAt: '2026-09-01T09:00:00.000Z',
      updatedAt: '2026-09-01T12:00:00.000Z',
      statusHistory: [
        historyEntry({ id: 'h-1', status: 'PENDING', createdAt: '2026-09-01T09:00:00.000Z' }),
        historyEntry({ id: 'h-2', status: 'CONFIRMED', previousStatus: 'PENDING', createdAt: '2026-09-01T10:00:00.000Z' }),
        historyEntry({ id: 'h-3', status: 'PROCESSING', previousStatus: 'CONFIRMED', createdAt: '2026-09-01T11:00:00.000Z' }),
      ],
    };
    const { container } = render(<OrderTimeline order={order} />);

    const timeline = screen.getByRole('list', { name: 'Order fulfilment timeline' });
    expect(timeline).toBeInTheDocument();
    // Friendly labels for done steps.
    expect(screen.getByText('Order Placed')).toBeInTheDocument();
    expect(screen.getByText('Order Confirmed')).toBeInTheDocument();
    // Current step is highlighted.
    expect(screen.getByText('Current')).toBeInTheDocument();
    // Pending steps render labels but carry no timestamps: only 3
    // tabular-nums timestamps exist (one per history record).
    const timestamps = container.querySelectorAll('.tabular-nums');
    expect(timestamps).toHaveLength(3);
    // A pending step label is present without inventing a row.
    expect(screen.getByText('Shipped from Store')).toBeInTheDocument();
    const items = within(timeline).getAllByRole('listitem');
    expect(items).toHaveLength(9);
  });

  it('renders recorded notes on their steps', () => {
    const order = {
      id: 'o2',
      status: 'CONFIRMED',
      createdAt: '2026-09-01T09:00:00.000Z',
      updatedAt: '2026-09-01T10:00:00.000Z',
      statusHistory: [
        historyEntry({ id: 'h-1', status: 'PENDING', createdAt: '2026-09-01T09:00:00.000Z' }),
        historyEntry({
          id: 'h-2',
          status: 'CONFIRMED',
          previousStatus: 'PENDING',
          note: 'Verified by phone.',
          createdAt: '2026-09-01T10:00:00.000Z',
        }),
      ],
    };
    render(<OrderTimeline order={order} />);
    expect(screen.getByText('Verified by phone.')).toBeInTheDocument();
  });

  it('normalizes legacy SHIPPED history onto the DISPATCHED step', () => {
    const order = {
      id: 'o3',
      status: 'SHIPPED',
      createdAt: '2026-09-01T09:00:00.000Z',
      updatedAt: '2026-09-01T13:00:00.000Z',
      statusHistory: [
        historyEntry({ id: 'h-1', status: 'PENDING', createdAt: '2026-09-01T09:00:00.000Z' }),
        historyEntry({ id: 'h-2', status: 'SHIPPED', previousStatus: 'PROCESSING', createdAt: '2026-09-01T13:00:00.000Z' }),
      ],
    };
    render(<OrderTimeline order={order} />);
    // DISPATCHED shares the friendly label — the legacy record marks it done.
    expect(screen.getByText('Shipped from Store')).toBeInTheDocument();
    expect(screen.getByText('Current')).toBeInTheDocument();
  });

  it('shows the legacy fallback when history is empty (never invents rows)', () => {
    const order = {
      id: 'o4',
      status: 'DELIVERED',
      createdAt: '2026-09-01T09:00:00.000Z',
      updatedAt: '2026-09-03T09:00:00.000Z',
      statusHistory: [],
    };
    render(<OrderTimeline order={order} />);
    expect(
      screen.getByText('Detailed tracking history is not available for this order.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('shows history plus a terminal banner for cancelled orders (no full pending chain)', () => {
    const order = {
      id: 'o5',
      status: 'CANCELLED',
      createdAt: '2026-09-01T09:00:00.000Z',
      updatedAt: '2026-09-01T11:00:00.000Z',
      statusHistory: [
        historyEntry({ id: 'h-1', status: 'PENDING', createdAt: '2026-09-01T09:00:00.000Z' }),
        historyEntry({
          id: 'h-2',
          status: 'CANCELLED',
          previousStatus: 'PENDING',
          note: 'Customer asked to cancel.',
          createdAt: '2026-09-01T11:00:00.000Z',
        }),
      ],
    };
    render(<OrderTimeline order={order} />);
    expect(screen.getByRole('list', { name: 'Order status history' })).toBeInTheDocument();
    expect(screen.getByText('Order cancelled')).toBeInTheDocument();
    expect(screen.getByText('Customer asked to cancel.')).toBeInTheDocument();
    // The full 9-step pending chain is not rendered for cancelled orders.
    expect(screen.queryByText('Out for Delivery')).not.toBeInTheDocument();
  });
});
