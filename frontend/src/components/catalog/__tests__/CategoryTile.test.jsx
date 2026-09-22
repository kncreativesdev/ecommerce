import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Package } from 'lucide-react';
import { CategoryTile } from '../CategoryTile.jsx';

function renderTile(category) {
  return render(
    <MemoryRouter>
      <CategoryTile category={category} to="/category/cat-1" />
    </MemoryRouter>,
  );
}

describe('CategoryTile', () => {
  it('renders the uploaded category image when present', () => {
    renderTile({ name: 'Audio', image: 'categories/cat-1/hero.webp', icon: Package });
    const img = screen.getByAltText('Audio');
    expect(img).toHaveAttribute('src', expect.stringContaining('categories/cat-1/hero.webp'));
    expect(img).toHaveAttribute('loading', 'lazy');
  });

  it('renders the Lucide fallback icon when no image exists', () => {
    const { container } = renderTile({ name: 'Audio', image: null, icon: Package });
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(container.querySelector('svg')).not.toBeNull();
    expect(screen.getByText('Audio')).toBeInTheDocument();
  });

  it('falls back to the icon when the image fails to load', () => {
    const { container } = renderTile({ name: 'Audio', image: 'categories/cat-1/gone.webp', icon: Package });
    fireEvent.error(screen.getByAltText('Audio'));
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(container.querySelector('svg')).not.toBeNull();
  });
});
