import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ProductDetailPage } from '../ProductDetailPage.jsx';
import { useProductStore } from '../../stores/useProductStore.js';
import { fetchProductById, fetchProducts } from '../../services/product.service.js';
import { fetchProductImages } from '../../services/media.service.js';
import { fetchMyReviews, fetchProductReviews } from '../../services/reviews.service.js';

vi.mock('../../services/product.service.js', () => ({
  fetchProducts: vi.fn(),
  fetchProductById: vi.fn(),
}));

vi.mock('../../services/media.service.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, fetchProductImages: vi.fn() };
});

vi.mock('../../services/reviews.service.js', () => ({
  fetchMyReviews: vi.fn(),
  fetchProductReviews: vi.fn(),
  createReview: vi.fn(),
  fetchReviewById: vi.fn(),
  updateReview: vi.fn(),
  deleteReview: vi.fn(),
}));

const PRODUCT = {
  id: 'p1',
  categoryId: 'c1',
  category: { id: 'c1', name: 'Audio', slug: 'audio' },
  name: 'Review Gadget',
  slug: 'review-gadget',
  description: null,
  shortDescription: null,
  brand: 'TP',
  isActive: true,
  isFeatured: false,
  variants: [
    { id: 'v-a', productId: 'p1', sku: 'SKU-A', name: 'Black', price: '100.00', compareAtPrice: null, isActive: true, inStock: true },
  ],
  createdAt: null,
  updatedAt: null,
};

function renderPdp() {
  return render(
    <MemoryRouter initialEntries={['/product/p1']}>
      <Routes>
        <Route path="/product/:id" element={<ProductDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useProductStore.setState({ products: [], status: 'idle', error: null });
  fetchProducts.mockResolvedValue([]);
  fetchProductById.mockResolvedValue(PRODUCT);
  fetchProductImages.mockResolvedValue([]);
  fetchMyReviews.mockResolvedValue([]);
});

describe('PDP customer reviews (backend truth)', () => {
  it('loads and displays approved reviews with rating, text, author, and date', async () => {
    fetchProductReviews.mockResolvedValue([
      { id: 'r1', productId: 'p1', rating: 5, title: 'Excellent', comment: 'Works great', author: 'Aarav S.', createdAt: '2026-09-10T10:00:00.000Z' },
    ]);
    renderPdp();
    expect(await screen.findByRole('heading', { name: 'Customer reviews' })).toBeInTheDocument();
    expect(await screen.findByText('Excellent')).toBeInTheDocument();
    expect(screen.getByText('Works great')).toBeInTheDocument();
    expect(screen.getByText('Aarav S.')).toBeInTheDocument();
    expect(screen.getByLabelText('Rated 5 out of 5')).toBeInTheDocument();
  });

  it('shows an honest empty state when there are no reviews', async () => {
    fetchProductReviews.mockResolvedValue([]);
    renderPdp();
    expect(await screen.findByRole('heading', { name: 'Customer reviews' })).toBeInTheDocument();
    expect(await screen.findByText(/No reviews yet/i)).toBeInTheDocument();
    expect(fetchProductReviews).toHaveBeenCalledWith('p1');
  });
});
