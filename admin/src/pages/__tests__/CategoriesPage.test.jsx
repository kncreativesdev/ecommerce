import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { CategoriesPage } from '../CategoriesPage.jsx';
import { useCategoryStore } from '../../stores/useCategoryStore.js';
import { fetchCategories } from '../../services/category.service.js';

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

describe('CategoriesPage refresh', () => {
  it('offers a single top-right Refresh button in the page header', async () => {
    useCategoryStore.setState({
      categories: [
        {
          id: 'c1',
          parentId: null,
          name: 'Audio',
          slug: 'audio',
          description: null,
          image: null,
          isActive: true,
          sortOrder: 0,
          children: [],
        },
      ],
      status: 'success',
      error: null,
    });
    const { container } = renderPage();
    await screen.findByText('Audio');

    const header = container.querySelector('h2');
    expect(header).toHaveTextContent('Category Management');
    expect(screen.getAllByRole('button', { name: 'Refresh' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Refresh list' })).not.toBeInTheDocument();
  });

  it('re-fetches the list through the existing taxonomy refresh', async () => {
    const user = userEvent.setup();
    fetchCategories.mockResolvedValue([]);
    useCategoryStore.setState({
      categories: [
        {
          id: 'c1',
          parentId: null,
          name: 'Audio',
          slug: 'audio',
          description: null,
          image: null,
          isActive: true,
          sortOrder: 0,
          children: [],
        },
      ],
      status: 'success',
      error: null,
    });
    renderPage();
    await screen.findByText('Audio');

    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(fetchCategories).toHaveBeenCalled();
  });
});
