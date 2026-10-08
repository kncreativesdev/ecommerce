import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VariantMediaSection } from '../VariantMediaSection.jsx';
import { useAuthStore } from '../../../stores/useAuthStore.js';
import {
  deleteProductImage,
  fetchProductImages,
  updateImageMetadata,
  uploadProductImage,
} from '../../../services/media.service.js';

vi.mock('../../../services/media.service.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    fetchProductImages: vi.fn(),
    uploadProductImage: vi.fn(),
    updateImageMetadata: vi.fn(),
    deleteProductImage: vi.fn(),
  };
});

const VARIANTS = [
  { id: 'v-a', sku: 'SKU-A', name: 'Black', isActive: true },
  { id: 'v-b', sku: 'SKU-B', name: 'Blue', isActive: false },
];

function imageFixture(overrides = {}) {
  return {
    id: 'img-1',
    productId: 'p1',
    variantId: 'v-a',
    filename: 'a1.webp',
    storagePath: 'products/p1/a1.webp',
    imageType: 'webp',
    altText: null,
    sortOrder: 0,
    isPrimary: false,
    ...overrides,
  };
}

function pngFile(name = 'new.png') {
  return new File([new ArrayBuffer(1024)], name, { type: 'image/png' });
}

beforeEach(() => {
  vi.clearAllMocks();
  URL.createObjectURL = vi.fn(() => 'blob:mock');
  URL.revokeObjectURL = vi.fn();
  // Default to ADMIN so the pre-existing gallery/upload/primary/delete
  // tests keep exercising the authorized path.
  useAuthStore.setState({ user: { id: 'a1', email: 'admin@example.test', roles: ['ADMIN'] } });
});

describe('VariantMediaSection', () => {
  it('isolates galleries per variant with counts', async () => {
    fetchProductImages.mockResolvedValue([
      imageFixture({ id: 'a1', variantId: 'v-a', filename: 'a1.webp', sortOrder: 0 }),
      imageFixture({ id: 'a2', variantId: 'v-a', filename: 'a2.webp', sortOrder: 1, isPrimary: true }),
      imageFixture({ id: 'b1', variantId: 'v-b', filename: 'b1.webp', sortOrder: 0 }),
      imageFixture({ id: 'p1', variantId: null, filename: 'hero.webp', sortOrder: 0 }),
    ]);
    render(<VariantMediaSection productId="p1" variants={VARIANTS} />);

    const cardA = await screen.findByRole('listitem', { name: 'Images for variant SKU-A' });
    expect(within(cardA).getByText('a1.webp')).toBeInTheDocument();
    expect(within(cardA).getByText('a2.webp')).toBeInTheDocument();
    expect(within(cardA).queryByText('b1.webp')).not.toBeInTheDocument();
    expect(within(cardA).queryByText('hero.webp')).not.toBeInTheDocument();
    expect(within(cardA).getByText('2 images')).toBeInTheDocument();
    // a2 is primary (badge, no mark-button); a1 offers the mark action.
    expect(within(cardA).getAllByText('Primary')).toHaveLength(2);
    expect(within(cardA).getByRole('button', { name: 'Mark image as primary for variant SKU-A' })).toBeInTheDocument();

    const cardB = screen.getByRole('listitem', { name: 'Images for variant SKU-B' });
    expect(within(cardB).getByText('b1.webp')).toBeInTheDocument();
    expect(within(cardB).queryByText('a1.webp')).not.toBeInTheDocument();
    expect(within(cardB).getByText('1 image')).toBeInTheDocument();
  });

  it('uploads selected files preset to the owning variant', async () => {
    const user = userEvent.setup();
    fetchProductImages.mockResolvedValue([]);
    uploadProductImage.mockResolvedValue({ id: 'img-new' });
    render(<VariantMediaSection productId="p1" variants={VARIANTS} />);

    const cardA = await screen.findByRole('listitem', { name: 'Images for variant SKU-A' });
    await user.upload(within(cardA).getByLabelText('Add images to variant SKU-A'), pngFile());

    expect(uploadProductImage).toHaveBeenCalledWith('p1', expect.objectContaining({ variantId: 'v-a' }));
    expect(uploadProductImage.mock.calls[0][1].file).toBeInstanceOf(File);
  });

  it('deletes an image only after confirmation', async () => {
    const user = userEvent.setup();
    fetchProductImages.mockResolvedValue([imageFixture()]);
    deleteProductImage.mockResolvedValue({ id: 'img-1' });
    render(<VariantMediaSection productId="p1" variants={VARIANTS} />);

    await screen.findByText('a1.webp');
    await user.click(screen.getByRole('button', { name: 'Delete image a1.webp' }));
    expect(deleteProductImage).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Yes, delete' }));

    expect(deleteProductImage).toHaveBeenCalledWith('p1', 'img-1');
  });

  it('toggles the primary flag through the metadata endpoint', async () => {
    const user = userEvent.setup();
    fetchProductImages.mockResolvedValue([imageFixture({ isPrimary: false })]);
    updateImageMetadata.mockResolvedValue({});
    render(<VariantMediaSection productId="p1" variants={VARIANTS} />);

    await screen.findByText('a1.webp');
    await user.click(screen.getByRole('button', { name: 'Mark image as primary for variant SKU-A' }));

    expect(updateImageMetadata).toHaveBeenCalledWith('p1', 'img-1', { isPrimary: true });
  });

  it('renders nothing without variants', () => {
    const { container } = render(<VariantMediaSection productId="p1" variants={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('VariantMediaSection delete role gating (Phase 4-6)', () => {
  it('shows the image Delete control to ADMIN', async () => {
    useAuthStore.setState({ user: { id: 'a1', email: 'admin@example.test', roles: ['ADMIN'] } });
    fetchProductImages.mockResolvedValue([imageFixture()]);
    render(<VariantMediaSection productId="p1" variants={VARIANTS} />);

    await screen.findByText('a1.webp');
    expect(screen.getByRole('button', { name: 'Delete image a1.webp' })).toBeInTheDocument();
  });

  it('hides Delete for HEAD but keeps upload, primary, and sort controls', async () => {
    useAuthStore.setState({ user: { id: 'h1', email: 'head@example.test', roles: ['HEAD'] } });
    fetchProductImages.mockResolvedValue([imageFixture({ isPrimary: false })]);
    render(<VariantMediaSection productId="p1" variants={VARIANTS} />);

    await screen.findByText('a1.webp');
    expect(screen.queryByRole('button', { name: 'Delete image a1.webp' })).not.toBeInTheDocument();
    // All other authorized HEAD media operations stay available (upload is
    // a file input inside its label, not a button).
    expect(screen.getByLabelText('Add images to variant SKU-A')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark image as primary for variant SKU-A' })).toBeInTheDocument();
    expect(screen.getByLabelText('Sort order for image a1.webp')).toBeInTheDocument();
  });

  it('hides Delete for MEMBER but keeps upload and metadata controls', async () => {
    useAuthStore.setState({ user: { id: 'm1', email: 'member@example.test', roles: ['MEMBER'] } });
    fetchProductImages.mockResolvedValue([imageFixture({ isPrimary: false })]);
    render(<VariantMediaSection productId="p1" variants={VARIANTS} />);

    await screen.findByText('a1.webp');
    expect(screen.queryByRole('button', { name: 'Delete image a1.webp' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Add images to variant SKU-A')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark image as primary for variant SKU-A' })).toBeInTheDocument();
  });
});
