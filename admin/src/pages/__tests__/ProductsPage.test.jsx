import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { toast } from 'sonner';
import { ProductsPage } from '../ProductsPage.jsx';
import { useAuthStore } from '../../stores/useAuthStore.js';
import { useProductStore } from '../../stores/useProductStore.js';
import { useCategoryStore } from '../../stores/useCategoryStore.js';
import { fetchProductImages } from '../../services/media.service.js';
import { deactivateProduct, deleteProduct, fetchProducts } from '../../services/product.service.js';
vi.mock('../../services/media.service.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, fetchProductImages: vi.fn() };
});

vi.mock('../../services/product.service.js', () => ({
  fetchProducts: vi.fn(),
  fetchProductById: vi.fn(),
  createProduct: vi.fn(),
  updateProduct: vi.fn(),
  deactivateProduct: vi.fn(),
  deleteProduct: vi.fn(),
  activateProduct: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('../../services/category.service.js', () => ({
  fetchCategories: vi.fn().mockResolvedValue([]),
}));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/catalog/products']}>
      <Routes>
        <Route path="/catalog/products" element={<ProductsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

const PRODUCT = {
  id: 'p1',
  categoryId: 'c1',
  category: { id: 'c1', name: 'Audio', slug: 'audio' },
  name: 'Boom Speaker',
  slug: 'boom-speaker',
  brand: 'Boom',
  isActive: true,
  isFeatured: false,
  variants: [{ id: 'v1', sku: 'S1', name: 'Std', price: '5000.00', isActive: true }],
  createdAt: '2026-09-01T00:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ user: { id: 'a1', email: 'admin@example.test', roles: ['ADMIN'] } });
  useProductStore.setState({ products: [], status: 'idle', error: null, scope: 'active' });
  useCategoryStore.setState({ categories: [], status: 'idle', error: null, scope: 'active' });
  fetchProductImages.mockResolvedValue([
    { id: 'i1', productId: 'p1', variantId: 'v1', storagePath: 'products/p1/main.webp', sortOrder: 0, isPrimary: true },
  ]);
});

describe('ProductsPage row main image', () => {
  it("shows the product's default image immediately before the product name", async () => {
    useProductStore.setState({ products: [PRODUCT], status: 'success', error: null });
    const { container } = renderPage();
    expect(await screen.findByText('Boom Speaker')).toBeInTheDocument();
    await waitFor(() => expect(container.querySelector('img')).not.toBeNull());
    expect(container.querySelector('img').getAttribute('src')).toContain('products/p1/main.webp');
  });

  it('falls back gracefully when the product has no images', async () => {
    fetchProductImages.mockResolvedValue([]);
    useProductStore.setState({ products: [{ ...PRODUCT, id: 'p-empty' }], status: 'success', error: null });
    const { container } = renderPage();
    expect(await screen.findByText('Boom Speaker')).toBeInTheDocument();
    await waitFor(() => expect(fetchProductImages).toHaveBeenCalledWith('p-empty'));
    expect(container.querySelector('img')).toBeNull();
  });
});

describe('ProductsPage lifecycle actions', () => {
  it('offers Deactivate but no Delete for an active product', async () => {
    useProductStore.setState({ products: [{ ...PRODUCT, isActive: true }], status: 'success', error: null });
    renderPage();
    await screen.findByText('Boom Speaker');

    expect(screen.getByRole('button', { name: 'Deactivate Boom Speaker' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete Boom Speaker' })).not.toBeInTheDocument();
  });

  it('offers Delete and Reactivate but no Deactivate for an inactive product', async () => {
    useProductStore.setState({ products: [{ ...PRODUCT, isActive: false }], status: 'success', error: null });
    renderPage();
    await screen.findByText('Boom Speaker');

    expect(screen.getByRole('button', { name: 'Delete Boom Speaker' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reactivate Boom Speaker' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Deactivate Boom Speaker' })).not.toBeInTheDocument();
  });

  it('deactivates through the backend and removes the row under the active scope', async () => {
    const user = userEvent.setup();
    deactivateProduct.mockResolvedValue({ ...PRODUCT, isActive: false });
    useProductStore.setState({ products: [{ ...PRODUCT, isActive: true }], status: 'success', error: null });
    renderPage();
    await screen.findByText('Boom Speaker');

    await user.click(screen.getByRole('button', { name: 'Deactivate Boom Speaker' }));
    expect(screen.getByRole('dialog', { name: 'Deactivate “Boom Speaker”?' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Yes, deactivate' }));
    expect(deactivateProduct).toHaveBeenCalledWith('p1');
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('deactivated'));
    await waitFor(() => expect(screen.queryByText('Boom Speaker')).not.toBeInTheDocument());
  });

  it('surfaces the backend blocked-deactivation message with the holding orders', async () => {
    const user = userEvent.setup();
    deactivateProduct.mockRejectedValue({
      code: 'PRODUCT_HAS_ACTIVE_ORDERS',
      message: 'Cannot deactivate "Boom Speaker" while it is in 1 active order (ORD-2026-000007 (PENDING)). Cancel or complete those orders first.',
    });
    useProductStore.setState({ products: [{ ...PRODUCT, isActive: true }], status: 'success', error: null });
    renderPage();
    await screen.findByText('Boom Speaker');

    await user.click(screen.getByRole('button', { name: 'Deactivate Boom Speaker' }));
    await user.click(screen.getByRole('button', { name: 'Yes, deactivate' }));

    expect(deactivateProduct).toHaveBeenCalledWith('p1');
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining('ORD-2026-000007'),
    );
    // Rejected deactivation changes nothing: the row stays active.
    expect(screen.getByText('Boom Speaker')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deactivate Boom Speaker' })).toBeInTheDocument();
  });

  it('deletes an inactive product behind the existing confirmation', async () => {
    const user = userEvent.setup();
    deleteProduct.mockResolvedValue({ ...PRODUCT, isActive: false });
    useProductStore.setState({ products: [{ ...PRODUCT, isActive: false }], status: 'success', error: null });
    renderPage();
    await screen.findByText('Boom Speaker');

    await user.click(screen.getByRole('button', { name: 'Delete Boom Speaker' }));
    expect(screen.getByRole('dialog', { name: 'Delete “Boom Speaker”?' })).toBeInTheDocument();
    expect(deleteProduct).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Yes, delete' }));
    expect(deleteProduct).toHaveBeenCalledWith('p1');
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('deleted'));
    await waitFor(() => expect(screen.queryByText('Boom Speaker')).not.toBeInTheDocument());
  });

  it('surfaces a backend delete rejection without removing the row', async () => {
    const user = userEvent.setup();
    deleteProduct.mockRejectedValue({
      code: 'PRODUCT_ACTIVE_CANNOT_DELETE',
      message: 'Cannot delete "Boom Speaker" while it is active. Deactivate it first, then delete.',
    });
    useProductStore.setState({ products: [{ ...PRODUCT, isActive: false }], status: 'success', error: null });
    renderPage();
    await screen.findByText('Boom Speaker');

    await user.click(screen.getByRole('button', { name: 'Delete Boom Speaker' }));
    await user.click(screen.getByRole('button', { name: 'Yes, delete' }));

    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('Deactivate it first'));
    expect(screen.getByText('Boom Speaker')).toBeInTheDocument();
  });
});

describe('ProductsPage header refresh', () => {
  function seedProducts(scope = 'active') {
    useProductStore.setState({ products: [{ ...PRODUCT }], status: 'success', error: null, scope });
    fetchProducts.mockResolvedValue([{ ...PRODUCT }]);
  }

  it('offers a single top-right Refresh button (no bottom duplicate)', async () => {
    seedProducts();
    renderPage();
    await screen.findByText('Boom Speaker');

    const refreshButtons = screen.getAllByRole('button', { name: 'Refresh' });
    expect(refreshButtons).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Refresh list' })).not.toBeInTheDocument();
  });

  it('repeated refreshes keep sending the valid selected scope', async () => {
    const user = userEvent.setup();
    seedProducts('active');
    renderPage();
    await screen.findByText('Boom Speaker');
    const refresh = screen.getByRole('button', { name: 'Refresh' });

    // Rapid sequential refreshes must never produce an invalid status —
    // the click event itself must not leak into the scope argument.
    await user.click(refresh);
    await user.click(refresh);
    await user.click(refresh);

    expect(fetchProducts).toHaveBeenCalled();
    for (const call of fetchProducts.mock.calls) {
      expect(['active', 'inactive', 'all']).toContain(call[0]);
    }
    expect(useProductStore.getState().scope).toBe('active');
    expect(screen.getByText('Boom Speaker')).toBeInTheDocument();
  });

  it.each([
    ['Active', 'active'],
    ['Inactive', 'inactive'],
    ['All', 'all'],
  ])('refresh preserves the %s scope (%s)', async (label, scope) => {
    const user = userEvent.setup();
    seedProducts('active');
    renderPage();
    await screen.findByText('Boom Speaker');

    await user.click(screen.getByRole('button', { name: label }));
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    await user.click(screen.getByRole('button', { name: 'Refresh' }));

    expect(fetchProducts).toHaveBeenLastCalledWith(scope);
    expect(useProductStore.getState().scope).toBe(scope);
  });

  it('disables Refresh while loading to prevent overlapping requests', async () => {
    useProductStore.setState({ products: [], status: 'loading', error: null, scope: 'active' });
    renderPage();

    expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled();
  });
});

describe('ProductsPage HEAD role gating', () => {
  it('hides hard delete and the status filter but keeps create/edit/deactivate', async () => {
    useAuthStore.setState({ user: { id: 'h1', email: 'head@example.test', roles: ['HEAD'] } });
    useProductStore.setState({ products: [{ ...PRODUCT, isActive: true }], status: 'success', error: null });
    renderPage();
    await screen.findByText('Boom Speaker');

    expect(screen.getByRole('link', { name: 'Add Product' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Edit Boom Speaker' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deactivate Boom Speaker' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Delete Boom Speaker/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Product status filter' })).not.toBeInTheDocument();
  });

  it('shows Reactivate (no Delete) for an inactive product', async () => {
    useAuthStore.setState({ user: { id: 'h1', email: 'head@example.test', roles: ['HEAD'] } });
    useProductStore.setState({ products: [{ ...PRODUCT, isActive: false }], status: 'success', error: null });
    renderPage();
    await screen.findByText('Boom Speaker');

    expect(screen.getByRole('button', { name: 'Reactivate Boom Speaker' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Delete Boom Speaker/ })).not.toBeInTheDocument();
  });
});
