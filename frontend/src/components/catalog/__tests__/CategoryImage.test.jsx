import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Package } from 'lucide-react';
import { CategoryImage } from '../CategoryImage.jsx';
import { SubcategoryThumb } from '../../layout/header/SubcategoryThumb.jsx';

describe('CategoryImage', () => {
  it('renders the uploaded image when a reference exists', () => {
    render(<CategoryImage image="categories/cat-1/abc.webp" name="Audio" icon={Package} className="h-12 w-12" />);
    const img = screen.getByAltText('Audio');
    expect(img).toHaveAttribute('src', expect.stringContaining('categories/cat-1/abc.webp'));
  });

  it('renders the Lucide fallback icon when no image exists', () => {
    const { container } = render(<CategoryImage image={null} name="Audio" icon={Package} className="h-12 w-12" />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('falls back to the icon when the image fails to load', () => {
    const { container } = render(<CategoryImage image="categories/cat-1/gone.webp" name="Audio" icon={Package} />);
    fireEvent.error(screen.getByAltText('Audio'));
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('falls back for blank references', () => {
    const { container } = render(<CategoryImage image="  " name="Audio" icon={Package} />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('lazy-loads by default', () => {
    render(<CategoryImage image="categories/cat-1/abc.webp" name="Audio" icon={Package} />);
    expect(screen.getByAltText('Audio')).toHaveAttribute('loading', 'lazy');
  });
});

describe('SubcategoryThumb image behavior', () => {
  it('resolves the backend reference through the media base', () => {
    render(
      <SubcategoryThumb subcategory={{ name: 'Earbuds', image: 'categories/sub-1/thumb.webp', icon: Package }} />,
    );
    expect(screen.getByAltText('Earbuds')).toHaveAttribute(
      'src',
      expect.stringContaining('categories/sub-1/thumb.webp'),
    );
  });

  it('renders the icon fallback without an image', () => {
    const { container } = render(
      <SubcategoryThumb subcategory={{ name: 'Earbuds', image: null, icon: Package }} />,
    );
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('falls back to the icon when the image fails to load', () => {
    const { container } = render(
      <SubcategoryThumb subcategory={{ name: 'Earbuds', image: 'categories/sub-1/gone.webp', icon: Package }} />,
    );
    fireEvent.error(screen.getByAltText('Earbuds'));
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(container.querySelector('svg')).not.toBeNull();
  });
});
