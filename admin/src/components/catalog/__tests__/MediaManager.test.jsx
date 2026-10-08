import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MediaManager } from '../MediaManager.jsx';
import { useAuthStore } from '../../../stores/useAuthStore.js';
import { fetchProductImages } from '../../../services/media.service.js';

vi.mock('../../../services/media.service.js', () => ({
  deleteProductImage: vi.fn(),
  fetchProductImages: vi.fn(),
  resolveImageUrl: vi.fn((image) => `https://cdn.test/${image.filename}`),
  updateImageMetadata: vi.fn(),
  uploadProductImage: vi.fn(),
}));

const IMAGE = {
  id: 'img-1',
  productId: 'p1',
  variantId: null,
  filename: 'main.webp',
  storagePath: 'products/p1/main.webp',
  imageType: 'webp',
  altText: 'Front',
  sortOrder: 0,
  isPrimary: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  fetchProductImages.mockResolvedValue([IMAGE]);
});

function renderManager() {
  return render(<MediaManager productId="p1" productName="Boom Speaker" variants={[]} />);
}

describe('MediaManager delete role gating', () => {
  it('shows the image Delete control to ADMIN', async () => {
    useAuthStore.setState({ user: { id: 'a1', email: 'admin@example.test', roles: ['ADMIN'] } });
    renderManager();
    expect(await screen.findByRole('button', { name: 'Delete main.webp' })).toBeInTheDocument();
  });

  it('hides Delete for HEAD but keeps upload and metadata edit', async () => {
    useAuthStore.setState({ user: { id: 'h1', email: 'head@example.test', roles: ['HEAD'] } });
    renderManager();
    await screen.findByText('main.webp');

    expect(screen.queryByRole('button', { name: 'Delete main.webp' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit metadata for main.webp' })).toBeInTheDocument();
  });
});
