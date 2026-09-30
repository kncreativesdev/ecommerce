import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { VariantMediaSection } from '../VariantMediaSection.jsx';
import {
  fetchProductImages,
  updateImageMetadata,
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

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
  Toaster: () => null,
}));

const VARIANTS = [{ id: 'v-a', sku: 'SKU-A', name: 'Black', isActive: true }];

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

beforeEach(() => {
  vi.clearAllMocks();
});

describe('VariantMediaSection Set primary reconciliation', () => {
  it('calls the metadata mutation with isPrimary:true', async () => {
    const user = userEvent.setup();
    fetchProductImages.mockResolvedValue([imageFixture({ isPrimary: false })]);
    updateImageMetadata.mockResolvedValue({ id: 'img-1', isPrimary: true });
    render(<VariantMediaSection productId="p1" variants={VARIANTS} />);

    await screen.findByText('a1.webp');
    await user.click(screen.getByRole('button', { name: 'Mark image as primary for variant SKU-A' }));

    expect(updateImageMetadata).toHaveBeenCalledWith('p1', 'img-1', { isPrimary: true });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Marked as primary image.'));
  });

  it('shows exactly the selected image as primary and clears the previous badge', async () => {
    const user = userEvent.setup();
    fetchProductImages
      .mockResolvedValueOnce([
        imageFixture({ id: 'a1', filename: 'a1.webp', sortOrder: 0, isPrimary: false }),
        imageFixture({ id: 'a2', filename: 'a2.webp', sortOrder: 1, isPrimary: true }),
      ])
      .mockResolvedValueOnce([
        imageFixture({ id: 'a1', filename: 'a1.webp', sortOrder: 0, isPrimary: true }),
        imageFixture({ id: 'a2', filename: 'a2.webp', sortOrder: 1, isPrimary: false }),
      ]);
    updateImageMetadata.mockResolvedValue({ id: 'a1', isPrimary: true });
    render(<VariantMediaSection productId="p1" variants={VARIANTS} />);

    const card = await screen.findByRole('listitem', { name: 'Images for variant SKU-A' });
    // Initially a2 is the only Primary badge.
    expect(within(card).getAllByText('Primary')).toHaveLength(2); // badge + button label
    await user.click(within(card).getByRole('button', { name: 'Mark image as primary for variant SKU-A' }));
    expect(updateImageMetadata).toHaveBeenCalledWith('p1', 'a1', { isPrimary: true });

    // After the refetch, a1 carries the badge and a2 offers the action.
    await waitFor(() => expect(fetchProductImages).toHaveBeenCalledTimes(2));
    const refreshed = await screen.findByRole('listitem', { name: 'Images for variant SKU-A' });
    await waitFor(() => {
      const badges = within(refreshed).getAllByText('Primary');
      // One badge (a1) + one button label (a2's "Primary" action).
      expect(badges).toHaveLength(2);
    });
    expect(toast.success).toHaveBeenCalledWith('Marked as primary image.');
  });

  it('does not falsely mark primary on failure and shows error feedback', async () => {
    const user = userEvent.setup();
    fetchProductImages.mockResolvedValue([
      imageFixture({ id: 'a1', filename: 'a1.webp', sortOrder: 0, isPrimary: false }),
      imageFixture({ id: 'a2', filename: 'a2.webp', sortOrder: 1, isPrimary: true }),
    ]);
    updateImageMetadata.mockRejectedValue(new Error('Update failed. Please try again.'));
    render(<VariantMediaSection productId="p1" variants={VARIANTS} />);

    const card = await screen.findByRole('listitem', { name: 'Images for variant SKU-A' });
    await user.click(within(card).getByRole('button', { name: 'Mark image as primary for variant SKU-A' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Update failed. Please try again.'));
    // No refetch on failure — the list still shows a2 as the only badge.
    expect(fetchProductImages).toHaveBeenCalledTimes(1);
    expect(updateImageMetadata).toHaveBeenCalledWith('p1', 'a1', { isPrimary: true });
    // a1 still offers the action (never optimistically badged).
    expect(
      within(await screen.findByRole('listitem', { name: 'Images for variant SKU-A' })).getByRole('button', {
        name: 'Mark image as primary for variant SKU-A',
      }),
    ).toBeInTheDocument();
  });

  it('prevents duplicate submissions while the mutation is pending', async () => {
    const user = userEvent.setup();
    fetchProductImages.mockResolvedValue([
      imageFixture({ id: 'a1', filename: 'a1.webp', sortOrder: 0, isPrimary: false }),
      imageFixture({ id: 'a3', filename: 'a3.webp', sortOrder: 2, isPrimary: false }),
    ]);
    let resolveUpdate;
    updateImageMetadata.mockImplementation(
      () => new Promise((resolve) => { resolveUpdate = resolve; }),
    );
    render(<VariantMediaSection productId="p1" variants={VARIANTS} />);

    const card = await screen.findByRole('listitem', { name: 'Images for variant SKU-A' });
    const buttons = within(card).getAllByRole('button', { name: 'Mark image as primary for variant SKU-A' });
    expect(buttons).toHaveLength(2);
    await user.click(buttons[0]);
    // While pending, every Set-primary button is disabled.
    await waitFor(() => {
      const pending = within(screen.getByRole('listitem', { name: 'Images for variant SKU-A' })).getAllByRole(
        'button',
        { name: 'Mark image as primary for variant SKU-A' },
      );
      for (const button of pending) expect(button).toBeDisabled();
    });
    expect(updateImageMetadata).toHaveBeenCalledTimes(1);
    resolveUpdate({ id: 'a1', isPrimary: true });
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
  });
});
