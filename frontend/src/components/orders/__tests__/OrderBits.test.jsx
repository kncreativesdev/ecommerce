import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { OrderItemThumb } from '../OrderBits.jsx';

function renderThumb(item) {
  return render(
    <MemoryRouter>
      <OrderItemThumb item={item} />
    </MemoryRouter>,
  );
}

describe('OrderItemThumb', () => {
  it('resolves the immutable snapshot path', () => {
    renderThumb({ imageStoragePath: 'products/p/black-primary.webp' });
    const img = document.querySelector('img');
    expect(img).not.toBeNull();
    expect(img.getAttribute('src')).toContain('products/p/black-primary.webp');
  });

  it('renders a neutral placeholder for pre-snapshot (null) items', () => {
    renderThumb({ imageStoragePath: null });
    expect(document.querySelector('img')).toBeNull();
    expect(screen.getByLabelText('No image recorded for this item')).toBeInTheDocument();
  });
});
