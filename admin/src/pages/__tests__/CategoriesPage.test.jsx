import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { CategoriesPage } from '../CategoriesPage.jsx';
import { useCategoryStore } from '../../stores/useCategoryStore.js';

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

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/catalog/categories']}>
      <Routes>
        <Route path="/catalog/categories" element={<CategoriesPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useCategoryStore.setState({
    categories: [],
    status: 'idle',
    error: null,
    scope: 'active',
  });
});

describe('CategoriesPage row category image', () => {
  it('shows the backend category image before the category name', async () => {
    useCategoryStore.setState({
      categories: [
        {
          id: 'c1',
          parentId: null,
          name: 'Audio',
          slug: 'audio',
          description: null,
          image: 'categories/audio.webp',
          isActive: true,
          sortOrder: 0,
          children: [],
        },
      ],
      status: 'success',
      error: null,
    });
    const { container } = renderPage();
    expect(await screen.findByText('Audio')).toBeInTheDocument();
    const img = container.querySelector('img[src*="categories/audio.webp"]');
    expect(img).not.toBeNull();
  });

  it('falls back gracefully when the category has no image', async () => {
    useCategoryStore.setState({
      categories: [
        {
          id: 'c2',
          parentId: null,
          name: 'Power',
          slug: 'power',
          description: null,
          image: null,
          isActive: true,
          sortOrder: 1,
          children: [],
        },
      ],
      status: 'success',
      error: null,
    });
    const { container } = renderPage();
    expect(await screen.findByText('Power')).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
  });
});
