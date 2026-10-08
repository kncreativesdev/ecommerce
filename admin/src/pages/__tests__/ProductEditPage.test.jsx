import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ProductEditPage } from '../ProductEditPage.jsx';
import { useAuthStore } from '../../stores/useAuthStore.js';
import { useProductStore } from '../../stores/useProductStore.js';
import { fetchProductById } from '../../services/product.service.js';

vi.mock('../../services/product.service.js', () => ({
  fetchProducts: vi.fn(),
  fetchProductById: vi.fn(),
  createProduct: vi.fn(),
  updateProduct: vi.fn(),
  deactivateProduct: vi.fn(),
  deleteProduct: vi.fn(),
  activateProduct: vi.fn(),
  createVariant: vi.fn(),
  updateVariant: vi.fn(),
  deactivateVariant: vi.fn(),
}));

vi.mock('../../services/category.service.js', () => ({
  fetchCategories: vi.fn().mockResolvedValue([]),
  fetchCategoryById: vi.fn(),
}));

vi.mock('../../services/media.service.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    fetchProductImages: vi.fn().mockResolvedValue([]),
    uploadProductImage: vi.fn(),
    updateImageMetadata: vi.fn(),
    deleteProductImage: vi.fn(),
  };
});

vi.mock('../../services/inventory.service.js', () => ({
  fetchVariantInventory: vi.fn().mockResolvedValue(null),
  fetchInventoryList: vi.fn(),
  fetchInventoryTransactions: vi.fn().mockResolvedValue({ transactions: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 1 } }),
  initializeInventory: vi.fn(),
  adjustInventory: vi.fn(),
}));

const PRODUCT = {
  id: 'p1',
  categoryId: 'c1',
  name: 'Boom Speaker',
  slug: 'boom-speaker',
  description: null,
  shortDescription: null,
  brand: 'Boom',
  isActive: true,
  isFeatured: false,
  variants: [{ id: 'v1', sku: 'S1', name: 'Std', price: '5000.00', isActive: true }],
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/catalog/products/p1/edit']}>
      <Routes>
        <Route path="/catalog/products/:id/edit" element={<ProductEditPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useProductStore.setState({ products: [], status: 'idle', error: null, scope: 'active' });
  fetchProductById.mockResolvedValue(PRODUCT);
});

describe('ProductEditPage detail scope role gating', () => {
  it("fetches with the admin 'all' scope for ADMIN", async () => {
    useAuthStore.setState({ user: { id: 'a1', email: 'admin@example.test', roles: ['ADMIN'] } });
    renderPage();

    await screen.findByText('Edit “Boom Speaker”');
    expect(fetchProductById).toHaveBeenCalledWith('p1', 'all');
  });

  it("fetches with the active scope for HEAD (inactive rows stay out of reach)", async () => {
    useAuthStore.setState({ user: { id: 'h1', email: 'head@example.test', roles: ['HEAD'] } });
    renderPage();

    await screen.findByText('Edit “Boom Speaker”');
    expect(fetchProductById).toHaveBeenCalledWith('p1', 'active');
  });
});
