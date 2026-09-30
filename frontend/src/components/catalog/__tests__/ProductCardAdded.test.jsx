import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { toast } from 'sonner';
import { ProductCard } from '../ProductCard.jsx';
import { useCartStore } from '../../../stores/useCartStore.js';
import { fetchProductImages } from '../../../services/media.service.js';

vi.mock('../../../services/media.service.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, fetchProductImages: vi.fn() };
});

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const PRODUCT = {
  id: 'p-added',
  name: 'Added Gadget',
  slug: 'added-gadget',
  brand: 'Tech Pulse',
  isActive: true,
  isFeatured: false,
  variants: [
    { id: 'v-a', productId: 'p-added', sku: 'ADDED-1', name: 'Black', price: '1299.00', compareAtPrice: null, isActive: true, inStock: true },
  ],
};

function renderCard(product = PRODUCT) {
  return render(
    <MemoryRouter>
      <ProductCard product={product} />
    </MemoryRouter>,
  );
}

function addButton() {
  return screen.getByRole('button', { name: /Added Gadget to cart/i });
}

function addedButton() {
  return screen.getByRole('button', { name: /Added Added Gadget to cart/i });
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  fetchProductImages.mockResolvedValue([]);
  useCartStore.setState({ bulkPending: false, addItem: vi.fn().mockResolvedValue({ ok: true }) });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ProductCard Added confirmation', () => {
  it('normally says Add to Cart', () => {
    renderCard();
    const button = addButton();
    expect(button).toHaveTextContent('Add to Cart');
    expect(button).toBeEnabled();
  });

  it('shows Added for ~2 seconds after a successful add', async () => {
    renderCard();
    vi.useFakeTimers();
    fireEvent.click(addButton());
    await act(async () => {});

    expect(addedButton()).toHaveTextContent('Added');

    // Still Added just before the window ends…
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1999);
    });
    expect(addedButton()).toHaveTextContent('Added');

    // …and back to normal right after.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(addButton()).toHaveTextContent('Add to Cart');
  });

  it('disables the button while Added and ignores repeat clicks', async () => {
    const addItem = vi.fn().mockResolvedValue({ ok: true });
    useCartStore.setState({ bulkPending: false, addItem });
    renderCard();
    vi.useFakeTimers();
    fireEvent.click(addButton());
    await act(async () => {});

    const added = addedButton();
    expect(added).toBeDisabled();
    fireEvent.click(added);
    fireEvent.click(added);
    expect(addItem).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(addButton()).toBeEnabled();
    expect(addItem).toHaveBeenCalledTimes(1);
  });

  it('disables the button while the request is pending (existing loading behavior)', async () => {
    const gate = deferred();
    useCartStore.setState({ bulkPending: false, addItem: vi.fn().mockReturnValue(gate.promise) });
    renderCard();
    vi.useFakeTimers();
    fireEvent.click(addButton());
    await act(async () => {});

    const pending = screen.getByRole('button', { name: /Add Added Gadget to cart/i });
    expect(pending).toBeDisabled();
    expect(pending).toHaveTextContent('Adding…');

    await act(async () => {
      gate.resolve({ ok: true });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(addedButton()).toHaveTextContent('Added');
  });

  it('never shows Added when the add fails', async () => {
    useCartStore.setState({
      bulkPending: false,
      addItem: vi.fn().mockResolvedValue({ ok: false, error: { code: 'INSUFFICIENT_STOCK', status: 409 } }),
    });
    renderCard();
    fireEvent.click(addButton());

    await vi.waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/out of stock/i));
    });
    expect(addButton()).toHaveTextContent('Add to Cart');
    expect(screen.queryByRole('button', { name: /Added Added Gadget to cart/i })).not.toBeInTheDocument();
  });

  it('cleans up the timer on unmount without state updates', async () => {
    const { unmount } = renderCard();
    vi.useFakeTimers();
    fireEvent.click(addButton());
    await act(async () => {});
    expect(addedButton()).toHaveTextContent('Added');

    // Unmount while the confirmation window is active, then let the timer
    // fire — no crash and no lingering timer.
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not leak Added state when the card is reused for another product', async () => {
    const other = {
      ...PRODUCT,
      id: 'p-other',
      name: 'Other Gadget',
      variants: [
        { id: 'v-other', productId: 'p-other', sku: 'OTHER-1', name: 'White', price: '999.00', compareAtPrice: null, isActive: true, inStock: true },
      ],
    };
    const { rerender, unmount } = render(
      <MemoryRouter>
        <ProductCard product={PRODUCT} />
      </MemoryRouter>,
    );
    fireEvent.click(addButton());
    await vi.waitFor(() => {
      expect(addedButton()).toHaveTextContent('Added');
    });

    rerender(
      <MemoryRouter>
        <ProductCard product={other} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('button', { name: /Other Gadget to cart/i })).toHaveTextContent('Add to Cart');
    unmount();
  });

  it('keeps out-of-stock behavior unchanged', () => {
    const outOfStock = {
      ...PRODUCT,
      variants: [
        { id: 'v-a', productId: 'p-added', sku: 'ADDED-1', name: 'Black', price: '1299.00', compareAtPrice: null, isActive: true, inStock: false },
      ],
    };
    renderCard(outOfStock);
    expect(screen.getByText('Out of Stock')).toBeInTheDocument();
  });
});
