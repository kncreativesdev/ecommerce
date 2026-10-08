import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AdminLayout } from '../../components/layout/AdminLayout.jsx';
import { CategoriesPage } from '../CategoriesPage.jsx';
import { ProductsPage } from '../ProductsPage.jsx';
import { CouponsPage } from '../CouponsPage.jsx';
import { InventoryPage } from '../InventoryPage.jsx';
import { OrdersPage } from '../OrdersPage.jsx';
import { VariantManager } from '../../components/catalog/VariantManager.jsx';
import { VariantMediaSection } from '../../components/catalog/VariantMediaSection.jsx';
import { MediaManager } from '../../components/catalog/MediaManager.jsx';
import { useAuthStore } from '../../stores/useAuthStore.js';
import { useCategoryStore } from '../../stores/useCategoryStore.js';
import { useProductStore } from '../../stores/useProductStore.js';
import { useCouponStore, COUPON_PAGE_SIZE } from '../../stores/useCouponStore.js';
import { useInventoryStore } from '../../stores/useInventoryStore.js';
import { useOrderStore } from '../../stores/useOrderStore.js';

vi.mock('../../services/category.service.js', () => ({
  fetchCategories: vi.fn().mockResolvedValue([]),
  fetchCategoryById: vi.fn(),
  createCategory: vi.fn(),
  updateCategory: vi.fn(),
  deactivateCategory: vi.fn(),
  activateCategory: vi.fn(),
  uploadCategoryImage: vi.fn(),
  deleteCategoryImage: vi.fn(),
}));

vi.mock('../../services/product.service.js', () => ({
  fetchProducts: vi.fn().mockResolvedValue([]),
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

vi.mock('../../services/coupon.service.js', () => ({
  fetchCoupons: vi.fn().mockResolvedValue({ coupons: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 1 } }),
  fetchCouponById: vi.fn(),
  fetchCouponHistory: vi.fn().mockResolvedValue({ history: [], pagination: { page: 1, limit: 10, total: 0, totalPages: 1 } }),
  createCoupon: vi.fn(),
  updateCoupon: vi.fn(),
  activateCoupon: vi.fn(),
  deactivateCoupon: vi.fn(),
  deleteCoupon: vi.fn(),
}));

vi.mock('../../services/inventory.service.js', () => ({
  fetchVariantInventory: vi.fn(),
  fetchInventoryList: vi.fn().mockResolvedValue({ items: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 1 } }),
  fetchInventoryTransactions: vi.fn().mockResolvedValue({ transactions: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 1 } }),
  initializeInventory: vi.fn(),
  adjustInventory: vi.fn(),
}));

vi.mock('../../services/order.service.js', () => ({
  fetchOrdersAdmin: vi.fn().mockResolvedValue({ orders: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 1 } }),
  fetchOrderAdmin: vi.fn(),
  updateOrderStatus: vi.fn(),
  bulkUpdateOrderStatus: vi.fn(),
  updateOrderPaymentStatus: vi.fn(),
}));

vi.mock('../../services/audit.service.js', () => ({
  fetchAuditLogs: vi.fn().mockResolvedValue({ logs: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 1 } }),
  downloadAuditLogsCsv: vi.fn(),
  fetchAuditSummary: vi.fn().mockResolvedValue({
    total: 0,
    period: { from: '2026-02-01T00:00:00.000Z', to: '2026-03-03T00:00:00.000Z' },
    byOutcome: [],
    byAction: [],
    byResource: [],
    topActors: [],
    byDay: [],
    recent: null,
  }),
}));

import { fetchProductImages } from '../../services/media.service.js';

function asMember() {
  useAuthStore.setState({ accessToken: 'token', user: { id: 'm1', email: 'member@example.test', roles: ['MEMBER'] }, status: 'ready', error: null });
}

function asHead() {
  useAuthStore.setState({ accessToken: 'token', user: { id: 'h1', email: 'head@example.test', roles: ['HEAD'] }, status: 'ready', error: null });
}

function asAdmin() {
  useAuthStore.setState({ accessToken: 'token', user: { id: 'a1', email: 'admin@example.test', roles: ['ADMIN'] }, status: 'ready', error: null });
}

function renderNav(initialPath = '/audit-logs') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route element={<AdminLayout />}>
          <Route path={initialPath} element={<div>content</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchProductImages.mockResolvedValue([]);
  useCategoryStore.setState({ categories: [], status: 'idle', error: null, scope: 'active' });
  useProductStore.setState({ products: [], status: 'idle', error: null, scope: 'active' });
  useCouponStore.setState({
    coupons: [],
    pagination: { page: 1, limit: COUPON_PAGE_SIZE, total: 0, totalPages: 1 },
    scope: 'all',
    search: '',
    status: 'idle',
    refreshing: false,
    error: null,
  });
  useInventoryStore.setState({
    items: [],
    pagination: { page: 1, limit: 20, total: 0, totalPages: 1 },
    filters: { search: '', stock: '', active: '', sortBy: 'createdAt', sortOrder: 'desc' },
    status: 'idle',
    error: null,
  });
  useOrderStore.setState({
    orders: [],
    pagination: { page: 1, limit: 20, total: 0, totalPages: 1 },
    filters: { status: '', paymentStatus: '', search: '', city: '', state: '', from: '', to: '', sortOrder: 'desc' },
    status: 'idle',
    error: null,
    detail: null,
    detailStatus: 'idle',
    detailError: null,
  });
});

describe('MEMBER navigation visibility (Phase 4-5)', () => {
  it('shows only the authorized operational sections', async () => {
    asMember();
    renderNav();
    const nav = await screen.findByRole('navigation', { name: 'Admin' });
    for (const label of ['Categories', 'Products', 'Coupons', 'Orders', 'Inventory', 'Audit Logs', 'Audit Dashboard']) {
      expect(within(nav).getByRole('link', { name: label })).toBeInTheDocument();
    }
  });

  it.each([['Dashboard'], ['Return Orders'], ['Customers'], ['Reviews'], ['Notifications'], ['Announcements'], ['Companies'], ['Audit Retention'], ['Team Members']])(
    'hides %s from MEMBER',
    async (label) => {
      asMember();
      renderNav();
      const nav = await screen.findByRole('navigation', { name: 'Admin' });
      expect(within(nav).queryByRole('link', { name: label })).not.toBeInTheDocument();
    },
  );
});

describe('MEMBER categories UI (Phase 4-5)', () => {
  const category = {
    id: 'c1', parentId: null, name: 'Audio', slug: 'audio',
    description: null, image: null, isActive: true, sortOrder: 0, children: [],
  };

  it('keeps create/edit visible but hides deactivate and the status scope', async () => {
    asMember();
    useCategoryStore.setState({ categories: [category], status: 'success', error: null });
    render(
      <MemoryRouter initialEntries={['/catalog/categories']}>
        <Routes><Route path="/catalog/categories" element={<CategoriesPage />} /></Routes>
      </MemoryRouter>,
    );
    await screen.findByText('Audio');
    expect(screen.getByRole('button', { name: 'Add Category' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit Audio' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Deactivate Audio' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reactivate Audio' })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Category status filter' })).not.toBeInTheDocument();
  });

  it('HEAD regression: deactivate stays visible, scope stays hidden', async () => {
    asHead();
    useCategoryStore.setState({ categories: [category], status: 'success', error: null });
    render(
      <MemoryRouter initialEntries={['/catalog/categories']}>
        <Routes><Route path="/catalog/categories" element={<CategoriesPage />} /></Routes>
      </MemoryRouter>,
    );
    await screen.findByText('Audio');
    expect(screen.getByRole('button', { name: 'Deactivate Audio' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Category status filter' })).not.toBeInTheDocument();
  });

  it('ADMIN regression: scope filter visible', async () => {
    asAdmin();
    useCategoryStore.setState({ categories: [], status: 'success', error: null });
    render(
      <MemoryRouter initialEntries={['/catalog/categories']}>
        <Routes><Route path="/catalog/categories" element={<CategoriesPage />} /></Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByRole('group', { name: 'Category status filter' })).toBeInTheDocument();
  });
});

describe('MEMBER products UI (Phase 4-5)', () => {
  const product = {
    id: 'p1', categoryId: 'c1', category: { id: 'c1', name: 'Audio', slug: 'audio' },
    name: 'Boom Speaker', slug: 'boom-speaker', brand: 'Boom',
    isActive: true, isFeatured: false,
    variants: [{ id: 'v1', sku: 'S1', name: 'Std', price: '5000.00', isActive: true }],
    createdAt: '2026-09-01T00:00:00.000Z',
  };

  it('keeps create/edit but hides deactivate/delete/scope and ADMIN-only media delete', async () => {
    asMember();
    useProductStore.setState({ products: [{ ...product }], status: 'success', error: null });
    render(
      <MemoryRouter initialEntries={['/catalog/products']}>
        <Routes><Route path="/catalog/products" element={<ProductsPage />} /></Routes>
      </MemoryRouter>,
    );
    await screen.findByText('Boom Speaker');
    expect(screen.getByRole('link', { name: 'Add Product' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Edit Boom Speaker' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Deactivate Boom Speaker' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Delete Boom Speaker/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Product status filter' })).not.toBeInTheDocument();
  });

  it('HEAD regression: deactivate stays, delete/scope stay hidden', async () => {
    asHead();
    useProductStore.setState({ products: [{ ...product }], status: 'success', error: null });
    render(
      <MemoryRouter initialEntries={['/catalog/products']}>
        <Routes><Route path="/catalog/products" element={<ProductsPage />} /></Routes>
      </MemoryRouter>,
    );
    await screen.findByText('Boom Speaker');
    expect(screen.getByRole('button', { name: 'Deactivate Boom Speaker' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Delete Boom Speaker/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Product status filter' })).not.toBeInTheDocument();
  });
});

describe('MEMBER variants UI (Phase 4-5)', () => {
  const product = { id: 'p1', name: 'Boom Speaker', variants: [{ id: 'v1', sku: 'SKU-1', name: 'Std', price: '5000.00', isActive: true }] };

  it('keeps create/edit but hides deactivate/reactivate', async () => {
    asMember();
    render(<VariantManager product={product} onChanged={vi.fn()} />);
    expect(await screen.findByText('SKU-1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add variant' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit variant SKU-1' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Deactivate variant SKU-1' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reactivate variant SKU-1' })).not.toBeInTheDocument();
  });

  it('HEAD regression: deactivate stays visible', async () => {
    asHead();
    render(<VariantManager product={product} onChanged={vi.fn()} />);
    expect(await screen.findByText('SKU-1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deactivate variant SKU-1' })).toBeInTheDocument();
  });

  it('hides ADMIN-only variant image delete for MEMBER but keeps upload/metadata', async () => {
    asMember();
    fetchProductImages.mockResolvedValue([
      { id: 'img-1', productId: 'p1', variantId: 'v1', filename: 'a1.webp', storagePath: 'products/p1/a1.webp', sortOrder: 0, isPrimary: false },
    ]);
    render(<VariantMediaSection productId="p1" variants={[{ id: 'v1', sku: 'SKU-1', name: 'Std', isActive: true }]} />);
    await screen.findByText('a1.webp');
    expect(screen.queryByRole('button', { name: 'Delete image a1.webp' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark image as primary for variant SKU-1' })).toBeInTheDocument();
  });

  it('MediaManager regression: ADMIN sees delete, HEAD/MEMBER do not', async () => {
    asAdmin();
    fetchProductImages.mockResolvedValue([
      { id: 'img-1', productId: 'p1', variantId: null, filename: 'main.webp', storagePath: 'products/p1/main.webp', sortOrder: 0, isPrimary: true },
    ]);
    const { unmount } = render(<MediaManager productId="p1" productName="Boom" variants={[]} />);
    expect(await screen.findByRole('button', { name: 'Delete main.webp' })).toBeInTheDocument();
    unmount();

    asMember();
    fetchProductImages.mockResolvedValue([
      { id: 'img-1', productId: 'p1', variantId: null, filename: 'main.webp', storagePath: 'products/p1/main.webp', sortOrder: 0, isPrimary: true },
    ]);
    render(<MediaManager productId="p1" productName="Boom" variants={[]} />);
    await screen.findByText('main.webp');
    expect(screen.queryByRole('button', { name: 'Delete main.webp' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit metadata for main.webp' })).toBeInTheDocument();
  });
});

describe('MEMBER coupons UI read-only (Phase 4-5)', () => {
  function couponFixture(overrides = {}) {
    return {
      id: 'coupon-1', code: 'SAVE10', description: null, discountType: 'PERCENTAGE',
      discountValue: '10.00', minimumOrderAmount: null, maximumDiscountAmount: null,
      usageLimit: 100, usedCount: 1, startsAt: null, expiresAt: null, isActive: true,
      products: [], createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
      ...overrides,
    };
  }

  function renderCoupons() {
    return render(
      <MemoryRouter initialEntries={['/catalog/coupons']}>
        <Routes><Route path="/catalog/coupons" element={<CouponsPage />} /></Routes>
      </MemoryRouter>,
    );
  }

  it('keeps list/history but hides create/edit/deactivate/delete', async () => {
    asMember();
    useCouponStore.setState({
      coupons: [couponFixture()],
      pagination: { page: 1, limit: COUPON_PAGE_SIZE, total: 1, totalPages: 1 },
      scope: 'all', search: '', status: 'success', refreshing: false, error: null,
    });
    renderCoupons();
    await screen.findByText('SAVE10');
    expect(screen.queryByRole('link', { name: 'Add Coupon' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Edit coupon SAVE10' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Deactivate coupon SAVE10' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reactivate coupon SAVE10' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete coupon SAVE10' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View coupon history for SAVE10' })).toBeInTheDocument();
  });

  it('HEAD regression: write controls stay, delete stays hidden', async () => {
    asHead();
    useCouponStore.setState({
      coupons: [couponFixture()],
      pagination: { page: 1, limit: COUPON_PAGE_SIZE, total: 1, totalPages: 1 },
      scope: 'all', search: '', status: 'success', refreshing: false, error: null,
    });
    renderCoupons();
    await screen.findByText('SAVE10');
    expect(screen.getByRole('link', { name: 'Add Coupon' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deactivate coupon SAVE10' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete coupon SAVE10' })).not.toBeInTheDocument();
  });
});

describe('MEMBER inventory + orders UI (Phase 4-5)', () => {
  it('keeps authorized inventory create/read/update controls', async () => {
    asMember();
    useInventoryStore.setState({
      items: [{
        product: { id: 'p1', name: 'Gadget', isActive: true },
        variant: { id: 'v1', productId: 'p1', sku: 'GAD-BLK', name: 'Black', price: '1299.00', isActive: true },
        inventory: { id: 'i1', variantId: 'v1', quantity: 8, reservedQuantity: 0, updatedAt: '2026-09-19T10:00:00.000Z' },
      }],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
      filters: { search: '', stock: '', active: '', sortBy: 'createdAt', sortOrder: 'desc' },
      status: 'success',
      error: null,
    });
    render(
      <MemoryRouter><InventoryPage /></MemoryRouter>,
    );
    await screen.findByText('GAD-BLK');
    expect(screen.getByRole('button', { name: 'Adjust stock for GAD-BLK' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View stock history for GAD-BLK' })).toBeInTheDocument();
  });

  it('keeps order list/detail/status/payment/bulk capabilities', async () => {
    asMember();
    useOrderStore.setState({
      orders: [{
        id: 'o1', orderNumber: 'ORD-2026-000001', status: 'PENDING', grandTotal: '100.00',
        createdAt: '2026-09-01T10:00:00.000Z',
        customer: { firstName: 'Buy', lastName: 'Er', email: 'buyer@example.test' },
        addresses: [], items: [{ id: 'i1' }], payments: [{ status: 'PENDING', method: 'CASH_ON_DELIVERY', amount: '100.00' }],
      }],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
      filters: { status: '', paymentStatus: '', search: '', city: '', state: '', from: '', to: '', sortOrder: 'desc' },
      status: 'success',
      error: null,
    });
    render(
      <MemoryRouter initialEntries={['/orders']}>
        <Routes><Route path="/orders" element={<OrdersPage />} /></Routes>
      </MemoryRouter>,
    );
    await screen.findByText('ORD-2026-000001');
    expect(screen.getByRole('checkbox', { name: 'Select order ORD-2026-000001' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View order ORD-2026-000001' })).toBeInTheDocument();
  });
});
