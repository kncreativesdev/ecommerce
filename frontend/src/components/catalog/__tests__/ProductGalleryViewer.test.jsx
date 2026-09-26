import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ProductGallery } from '../ProductGallery.jsx';
import { fetchProductImages } from '../../../services/media.service.js';

vi.mock('../../../services/media.service.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, fetchProductImages: vi.fn() };
});

function image(id, variantId, sortOrder, alt) {
  return {
    id,
    productId: 'p',
    variantId,
    filename: `${id}.webp`,
    storagePath: `products/p/${id}.webp`,
    imageType: 'webp',
    altText: alt,
    sortOrder,
    isPrimary: sortOrder === 0,
  };
}

const SIX_A = [1, 2, 3, 4, 5, 6].map((n) => image(`a${n}`, 'v-a', n - 1, `Shade ${n}`));
const ONE_B = [image('b1', 'v-b', 0, 'Blue')];

beforeEach(() => {
  vi.clearAllMocks();
  fetchProductImages.mockImplementation(() => Promise.resolve([...SIX_A, ...ONE_B]));
  document.body.style.overflow = '';
});

function renderGallery(variantId = 'v-a') {
  return render(<ProductGallery productId="p" productName="Gadget" variantId={variantId} />);
}

async function openViewerOnMain() {
  renderGallery();
  await screen.findByAltText('Shade 1');
  fireEvent.click(screen.getByRole('button', { name: 'Open full-screen image viewer' }));
  return screen.findByRole('dialog');
}

describe('PDP gallery layout (4:5, responsive thumbs)', () => {
  it('uses a narrow 4:5 main well with uncropped images', async () => {
    const { container } = renderGallery();
    await screen.findByAltText('Shade 1');
    const well = container.querySelector('.aspect-\\[4\\/5\\]');
    expect(well).not.toBeNull();
    expect(container.querySelector('.aspect-\\[4\\/3\\]')).toBeNull();
    expect(screen.getByAltText('Shade 1').className).toMatch(/object-contain/);
  });

  it('places the thumbnail list left of the main image on desktop, below on mobile', async () => {
    const { container } = renderGallery();
    await screen.findByAltText('Shade 1');
    const stack = container.firstChild;
    expect(stack.className).toMatch(/flex-col-reverse/);
    expect(stack.className).toMatch(/sm:flex-row/);
    const thumbs = container.querySelector('ul[aria-label="Product images"]');
    const well = container.querySelector('.aspect-\\[4\\/5\\]');
    expect(thumbs.compareDocumentPosition(well) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('keeps selected-thumb state and changes the main image on click', async () => {
    renderGallery();
    await screen.findByAltText('Shade 1');
    expect(screen.getByRole('button', { name: 'View image 1 of 6' })).toHaveAttribute('aria-current', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'View image 2 of 6' }));
    expect(await screen.findByAltText('Shade 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View image 2 of 6' })).toHaveAttribute('aria-current', 'true');
  });
});

describe('PDP main-image arrows', () => {
  it('cycle forward and wrap from last back to first', async () => {
    renderGallery();
    await screen.findByAltText('Shade 1');
    const next = screen.getByRole('button', { name: 'Next product image' });
    for (let step = 0; step < 5; step += 1) fireEvent.click(next);
    expect(await screen.findByAltText('Shade 6')).toBeInTheDocument();
    fireEvent.click(next);
    expect(await screen.findByAltText('Shade 1')).toBeInTheDocument();
  });

  it('cycle backward and wrap from first to last', async () => {
    renderGallery();
    await screen.findByAltText('Shade 1');
    fireEvent.click(screen.getByRole('button', { name: 'Previous product image' }));
    expect(await screen.findByAltText('Shade 6')).toBeInTheDocument();
  });

  it('hides arrows for a single-image gallery', async () => {
    fetchProductImages.mockResolvedValue([image('solo', 'v-solo', 0, 'Solo')]);
    render(<ProductGallery productId="p" productName="Gadget" variantId="v-solo" />);
    await screen.findByAltText('Solo');
    expect(screen.queryByRole('button', { name: 'Previous product image' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Next product image' })).not.toBeInTheDocument();
  });
});

describe('single-image thumbnail column (layout regression)', () => {
  async function renderSingle() {
    fetchProductImages.mockResolvedValue([image('solo', 'v-solo', 0, 'Solo')]);
    const utils = render(<ProductGallery productId="p" productName="Gadget" variantId="v-solo" />);
    await screen.findByAltText('Solo');
    return utils;
  }

  it('keeps the desktop thumbnail column with the same image as selected thumbnail', async () => {
    const { container } = await renderSingle();
    // Column structure present: list precedes the 4:5 main well in the DOM.
    const thumbs = container.querySelector('ul[aria-label="Product images"]');
    const well = container.querySelector('.aspect-\\[4\\/5\\]');
    expect(thumbs).not.toBeNull();
    expect(well).not.toBeNull();
    expect(thumbs.compareDocumentPosition(well) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Exactly one thumbnail button, selected, showing the same image URL.
    const thumbButtons = within(thumbs).getAllByRole('button');
    expect(thumbButtons).toHaveLength(1);
    expect(thumbButtons[0]).toHaveAttribute('aria-current', 'true');
    expect(thumbButtons[0].getAttribute('aria-label')).toBe('View image 1 of 1');
    const thumbImg = thumbButtons[0].querySelector('img');
    expect(thumbImg.getAttribute('src')).toBe(screen.getByAltText('Solo').getAttribute('src'));
    // Clicking it keeps the same main image.
    fireEvent.click(thumbButtons[0]);
    expect(await screen.findByAltText('Solo')).toBeInTheDocument();
  });

  it('shows no +N tile and no arrows for one image, but the lightbox still opens', async () => {
    await renderSingle();
    expect(screen.queryByText(/^\+\d+$/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Previous product image' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Next product image' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open full-screen image viewer' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Image')).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Previous product image' })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Next product image' })).not.toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('thumbnail +N overflow', () => {  it('shows +N only when images are hidden, with the exact hidden count', async () => {
    renderGallery();
    await screen.findByAltText('Shade 1');
    expect(screen.getByRole('button', { name: 'View 3 more images' })).toBeInTheDocument();
    expect(screen.getByText('+3')).toBeInTheDocument();
  });

  it('shows no +N tile when every image fits', async () => {
    fetchProductImages.mockResolvedValue([
      image('x1', 'v-x', 0, 'One'),
      image('x2', 'v-x', 1, 'Two'),
    ]);
    render(<ProductGallery productId="p" productName="Gadget" variantId="v-x" />);
    await screen.findByAltText('One');
    expect(screen.queryByText(/^\+\d+$/)).not.toBeInTheDocument();
  });

  it('+N opens the viewer at the first hidden image', async () => {
    renderGallery();
    await screen.findByAltText('Shade 1');
    fireEvent.click(screen.getByRole('button', { name: 'View 3 more images' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Image 4 of 6')).toBeInTheDocument();
  });
});

describe('full-screen photo viewer', () => {
  it('opens on the currently selected image with photos only', async () => {
    render(
      <div>
        <p>₹1,000.00</p>
        <button type="button">Add to Cart</button>
        <ProductGallery productId="p" productName="Gadget" variantId="v-a" />
      </div>,
    );
    await screen.findByAltText('Shade 1');
    fireEvent.click(screen.getByRole('button', { name: 'View image 3 of 6' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open full-screen image viewer' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Image 3 of 6')).toBeInTheDocument();
    // Photos only: PDP price and cart controls stay outside the viewer.
    expect(within(dialog).queryByText('₹1,000.00')).not.toBeInTheDocument();
    expect(within(dialog).queryByText('Add to Cart')).not.toBeInTheDocument();
    expect(dialog.querySelector('img').className).toMatch(/object-contain/);
  });

  it('navigates the complete gallery list forward and back with wrap', async () => {
    const dialog = await openViewerOnMain();
    expect(within(dialog).getByText('Image 1 of 6')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Next product image' }));
    expect(within(dialog).getByText('Image 2 of 6')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Previous product image' }));
    expect(within(dialog).getByText('Image 1 of 6')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Previous product image' }));
    // Wrap reaches images that were never visible as thumbnails.
    expect(within(dialog).getByText('Image 6 of 6')).toBeInTheDocument();
  });

  it('closes via the close button, backdrop click, and Escape, restoring scroll', async () => {
    renderGallery();
    await screen.findByAltText('Shade 1');
    const openViewer = () =>
      fireEvent.click(screen.getByRole('button', { name: 'Open full-screen image viewer' }));

    openViewer();
    let dialog = await screen.findByRole('dialog');
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close image viewer' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe('');

    openViewer();
    dialog = await screen.findByRole('dialog');
    fireEvent.click(dialog);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    openViewer();
    await screen.findByRole('dialog');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe('');
  });
});

describe('variant-aware viewer correctness', () => {
  it('never exposes another variant gallery and resets stale viewer state on switch', async () => {
    const { rerender } = renderGallery();
    await screen.findByAltText('Shade 1');
    const next = screen.getByRole('button', { name: 'Next product image' });
    for (let step = 0; step < 4; step += 1) fireEvent.click(next);
    expect(await screen.findByAltText('Shade 5')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open full-screen image viewer' }));
    expect(await screen.findByText('Image 5 of 6')).toBeInTheDocument();

    // Switching variant closes the viewer and reconciles to the new gallery.
    rerender(<ProductGallery productId="p" productName="Gadget" variantId="v-b" />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await screen.findByAltText('Blue')).toBeInTheDocument();
    expect(screen.queryByAltText('Shade 1')).not.toBeInTheDocument();
  });
});
