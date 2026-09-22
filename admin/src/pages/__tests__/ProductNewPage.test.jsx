import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Toaster } from 'sonner';
import { ProductNewPage } from '../ProductNewPage.jsx';
import { ProductEditPage } from '../ProductEditPage.jsx';
import { useProductStore } from '../../stores/useProductStore.js';
import { useCategoryStore } from '../../stores/useCategoryStore.js';
import {
  createProduct,
  fetchProductById,
} from '../../services/product.service.js';
import {
  deleteProductImage,
  fetchProductImages,
  uploadProductImage,
} from '../../services/media.service.js';

vi.mock('../../services/product.service.js', () => ({
  fetchProducts: vi.fn(),
  fetchProductById: vi.fn(),
  createProduct: vi.fn(),
  updateProduct: vi.fn(),
  createVariant: vi.fn(),
  updateVariant: vi.fn(),
  deactivateVariant: vi.fn(),
}));

vi.mock('../../services/media.service.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    fetchProductImages: vi.fn(),
    uploadProductImage: vi.fn(),
    updateImageMetadata: vi.fn(),
    deleteProductImage: vi.fn(),
  };
});

vi.mock('../../services/category.service.js', () => ({
  fetchCategories: vi.fn(),
  fetchCategoryById: vi.fn(),
  createCategory: vi.fn(),
  updateCategory: vi.fn(),
  deactivateCategory: vi.fn(),
  activateCategory: vi.fn(),
  uploadCategoryImage: vi.fn(),
  deleteCategoryImage: vi.fn(),
}));

vi.mock('../../services/inventory.service.js', () => ({
  fetchVariantInventory: vi.fn(),
  initializeInventory: vi.fn(),
  adjustInventory: vi.fn(),
}));

import { fetchCategories } from '../../services/category.service.js';

const CATEGORY = { id: 'cat1', name: 'Audio', slug: 'audio', parentId: null, isActive: true, sortOrder: 0 };

function pngFile(name = 'front.png', size = 1024) {
  return new File([new ArrayBuffer(size)], name, { type: 'image/png' });
}

function resetStores() {
  useProductStore.setState({ products: [], status: 'idle', error: null, scope: 'active' });
  useCategoryStore.setState({ categories: [], status: 'idle', error: null, scope: 'active' });
}

function renderNew() {
  return render(
    <MemoryRouter initialEntries={['/catalog/products/new']}>
      <Toaster />
      <Routes>
        <Route path="/catalog/products/new" element={<ProductNewPage />} />
        <Route path="/catalog/products/:id/edit" element={<ProductEditPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function fillValidProduct(user, container) {
  await user.type(screen.getByPlaceholderText('e.g. DriveCharge 38W'), 'Test Speaker');
  const parentSelect = container.querySelectorAll('select')[0];
  await user.selectOptions(parentSelect, 'cat1');
}

async function fillVariant(user, group, sku, name, price) {
  await user.type(within(group).getByPlaceholderText('e.g. TP-DC38-BLK'), sku);
  await user.type(within(group).getByPlaceholderText('e.g. Onyx Black'), name);
  await user.type(within(group).getByPlaceholderText('e.g. 1299.00'), price);
}

beforeEach(() => {
  vi.clearAllMocks();
  resetStores();
  URL.createObjectURL = vi.fn(() => 'blob:mock-preview');
  URL.revokeObjectURL = vi.fn();
  fetchCategories.mockResolvedValue([CATEGORY]);
  fetchProductImages.mockResolvedValue([]);
});

describe('ProductNewPage create-then-upload flow', () => {
  it('shows Variant 1 immediately — no Add Variant click needed', async () => {
    renderNew();
    expect(await screen.findByRole('heading', { name: 'New Product' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Variant 1' })).toBeInTheDocument();
    // No standalone product-level image section for new products.
    expect(screen.queryByText('Product images (required)')).not.toBeInTheDocument();
  });

  it('blocks completion when Variant 1 has no images — product creation is never attempted', async () => {
    const user = userEvent.setup();
    const { container } = renderNew();
    expect(await screen.findByRole('heading', { name: 'New Product' })).toBeInTheDocument();

    await fillValidProduct(user, container);
    await fillVariant(user, screen.getByRole('group', { name: 'Variant 1' }), 'SPK-BLK', 'Black', '1299.00');
    await user.click(screen.getByRole('button', { name: 'Create product' }));

    expect(await screen.findByText('Variant 1 requires at least one image.')).toBeInTheDocument();
    expect(createProduct).not.toHaveBeenCalled();
    expect(uploadProductImage).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'New Product' })).toBeInTheDocument();
  });

  it('uploads the variant file through the real media service AFTER creation with primary + sort order, then shows it in the edit gallery', async () => {
    const user = userEvent.setup();
    createProduct.mockResolvedValue({
      id: 'p1',
      name: 'Test Speaker',
      categoryId: 'cat1',
      isActive: true,
      variants: [{ id: 'v-black', sku: 'SPK-BLK', name: 'Black' }],
    });
    const file = pngFile();
    const uploaded = { id: 'img1', productId: 'p1', variantId: 'v-black', filename: 'uuid.webp', storagePath: 'products/p1/uuid.webp', imageType: 'webp', altText: null, sortOrder: 0, isPrimary: true };
    uploadProductImage.mockResolvedValue(uploaded);
    fetchProductById.mockResolvedValue({ id: 'p1', name: 'Test Speaker', categoryId: 'cat1', isActive: true, variants: [] });
    fetchProductImages.mockResolvedValue([uploaded]);
    const { container } = renderNew();
    expect(await screen.findByRole('heading', { name: 'New Product' })).toBeInTheDocument();

    await fillValidProduct(user, container);
    const group = screen.getByRole('group', { name: 'Variant 1' });
    await fillVariant(user, group, 'SPK-BLK', 'Black', '1299.00');
    await user.upload(within(group).getByLabelText('Select product images'), file);
    expect(await screen.findByAltText('Preview of front.png')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Create product' }));

    // Creation first, upload second with the REAL ids — never before, never fake.
    expect(createProduct).toHaveBeenCalledTimes(1);
    expect(createProduct).toHaveBeenCalledWith(
      expect.objectContaining({
        variants: [expect.objectContaining({ sku: 'SPK-BLK', name: 'Black', price: '1299.00' })],
      }),
    );
    expect(uploadProductImage).toHaveBeenCalledTimes(1);
    expect(createProduct.mock.invocationCallOrder[0]).toBeLessThan(uploadProductImage.mock.invocationCallOrder[0]);
    const [productId, body] = uploadProductImage.mock.calls[0];
    expect(productId).toBe('p1');
    expect(body.file).toBe(file);
    expect(body.variantId).toBe('v-black');
    expect(body.sortOrder).toBe(0);
    expect(body.isPrimary).toBe(true);
    expect(await screen.findByText(/created with 1 image/)).toBeInTheDocument();
    // Edit gallery is populated from authoritative backend media records.
    expect(await screen.findByRole('heading', { name: 'Edit “Test Speaker”' })).toBeInTheDocument();
    expect(await screen.findByText('uuid.webp')).toBeInTheDocument();
  });

  it('reports partial upload failure truthfully without rolling back successes', async () => {
    const user = userEvent.setup();
    createProduct.mockResolvedValue({
      id: 'p1',
      name: 'Test Speaker',
      categoryId: 'cat1',
      isActive: true,
      variants: [{ id: 'v-black', sku: 'SPK-BLK', name: 'Black' }],
    });
    uploadProductImage
      .mockResolvedValueOnce({ id: 'img1' })
      .mockRejectedValueOnce({ code: 'MEDIA_FILE_TOO_LARGE', message: 'Image exceeds the maximum allowed size of 5MB' });
    fetchProductById.mockResolvedValue({ id: 'p1', name: 'Test Speaker', categoryId: 'cat1', isActive: true, variants: [] });
    const { container } = renderNew();
    expect(await screen.findByRole('heading', { name: 'New Product' })).toBeInTheDocument();

    await fillValidProduct(user, container);
    const group = screen.getByRole('group', { name: 'Variant 1' });
    await fillVariant(user, group, 'SPK-BLK', 'Black', '1299.00');
    await user.upload(within(group).getByLabelText('Select product images'), [pngFile('ok.png'), pngFile('huge.png')]);
    await user.click(screen.getByRole('button', { name: 'Create product' }));

    expect(uploadProductImage).toHaveBeenCalledTimes(2);
    // Successful uploads are kept — never deleted or retried.
    expect(deleteProductImage).not.toHaveBeenCalled();
    // Both uploads target the created variant with deterministic order.
    expect(uploadProductImage.mock.calls.every(([, body]) => body?.variantId === 'v-black')).toBe(true);
    expect(await screen.findByText(/1 of 2 images failed/)).toBeInTheDocument();
    expect(await screen.findByText(/huge\.png/)).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Edit “Test Speaker”' })).toBeInTheDocument();
  });

  it('attempts no upload when product creation fails and stays on the form', async () => {
    const user = userEvent.setup();
    createProduct.mockRejectedValue({ code: 'PRODUCT_SLUG_EXISTS', message: 'Slug taken.', details: [] });
    const { container } = renderNew();
    expect(await screen.findByRole('heading', { name: 'New Product' })).toBeInTheDocument();

    await fillValidProduct(user, container);
    const group = screen.getByRole('group', { name: 'Variant 1' });
    await fillVariant(user, group, 'SPK-BLK', 'Black', '1299.00');
    await user.upload(within(group).getByLabelText('Select product images'), pngFile());
    await user.click(screen.getByRole('button', { name: 'Create product' }));

    expect(uploadProductImage).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'New Product' })).toBeInTheDocument();
  });

  it('blocks completion when only invalid files are selected', async () => {
    const user = userEvent.setup();
    const { container } = renderNew();
    expect(await screen.findByRole('heading', { name: 'New Product' })).toBeInTheDocument();

    await fillValidProduct(user, container);
    const group = screen.getByRole('group', { name: 'Variant 1' });
    await fillVariant(user, group, 'SPK-BLK', 'Black', '1299.00');
    fireEvent.change(within(group).getByLabelText('Select product images'), {
      target: { files: [new File(['x'], 'notes.txt', { type: 'text/plain' })] },
    });
    expect(await screen.findByText('Only JPEG, PNG, or WebP images are allowed.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Create product' }));

    expect(await screen.findByText('Variant 1 requires at least one image.')).toBeInTheDocument();
    expect(createProduct).not.toHaveBeenCalled();
  });

  it('creates multiple variants and uploads each variant’s own images against its real ID', async () => {
    const user = userEvent.setup();
    createProduct.mockResolvedValue({
      id: 'p1',
      name: 'Test Speaker',
      categoryId: 'cat1',
      isActive: true,
      variants: [
        { id: 'v-black', sku: 'SPK-BLK', name: 'Black' },
        { id: 'v-blue', sku: 'SPK-BLU', name: 'Blue' },
      ],
    });
    uploadProductImage.mockResolvedValue({ id: 'img' });
    fetchProductById.mockResolvedValue({ id: 'p1', name: 'Test Speaker', categoryId: 'cat1', isActive: true, variants: [] });
    const { container } = renderNew();
    expect(await screen.findByRole('heading', { name: 'New Product' })).toBeInTheDocument();

    await fillValidProduct(user, container);
    // Variant 1 is already visible — Add Variant adds only Variant 2.
    await user.click(screen.getByRole('button', { name: 'Add Variant' }));

    const groups = screen.getAllByRole('group', { name: /Variant \d/ });
    expect(groups).toHaveLength(2);
    await fillVariant(user, groups[0], 'SPK-BLK', 'Black', '1299.00');
    await fillVariant(user, groups[1], 'SPK-BLU', 'Blue', '1399.00');

    // Per-variant image selections stay isolated: 2 for Black, 1 for Blue.
    await user.upload(within(groups[0]).getByLabelText('Select product images'), [pngFile('blk1.png'), pngFile('blk2.png')]);
    await user.upload(within(groups[1]).getByLabelText('Select product images'), pngFile('blu1.png'));
    // No standalone product-level image picker exists for new products.
    expect(screen.getAllByLabelText('Select product images')).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: 'Create product' }));

    // Backend receives both variants inline.
    expect(createProduct).toHaveBeenCalledWith(
      expect.objectContaining({
        variants: [
          expect.objectContaining({ sku: 'SPK-BLK', name: 'Black', price: '1299.00' }),
          expect.objectContaining({ sku: 'SPK-BLU', name: 'Blue', price: '1399.00' }),
        ],
      }),
    );
    // 2 Black + 1 Blue, each against the correct real ID — none product-level.
    expect(uploadProductImage).toHaveBeenCalledTimes(3);
    const calls = uploadProductImage.mock.calls;
    expect(calls.every(([productId]) => productId === 'p1')).toBe(true);
    expect(calls.every(([, body]) => body && 'variantId' in body)).toBe(true);
    const blackCalls = calls.filter(([, body]) => body?.variantId === 'v-black');
    const blueCalls = calls.filter(([, body]) => body?.variantId === 'v-blue');
    expect(blackCalls).toHaveLength(2);
    expect(blueCalls).toHaveLength(1);
    // Deterministic primary + order: first file primary at 0, rest ordered.
    expect(blackCalls[0][1]).toMatchObject({ sortOrder: 0, isPrimary: true });
    expect(blackCalls[1][1]).toMatchObject({ sortOrder: 1 });
    expect(blackCalls[1][1].isPrimary).not.toBe(true);
    expect(blueCalls[0][1]).toMatchObject({ variantId: 'v-blue', sortOrder: 0, isPrimary: true });
    expect(await screen.findByText(/created with 3 images/)).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Edit “Test Speaker”' })).toBeInTheDocument();
  });

  it('blocks submit when a listed variant is incomplete and uploads nothing', async () => {
    const user = userEvent.setup();
    const { container } = renderNew();
    expect(await screen.findByRole('heading', { name: 'New Product' })).toBeInTheDocument();

    await fillValidProduct(user, container);
    const group = screen.getByRole('group', { name: 'Variant 1' });
    await user.type(within(group).getByPlaceholderText('e.g. Onyx Black'), 'Nameless SKU');
    await user.upload(within(group).getByLabelText('Select product images'), pngFile());
    await user.click(screen.getByRole('button', { name: 'Create product' }));

    expect(await screen.findByText('SKU is required.')).toBeInTheDocument();
    expect(createProduct).not.toHaveBeenCalled();
    expect(uploadProductImage).not.toHaveBeenCalled();
  });
});
