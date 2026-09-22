import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProductForm } from '../ProductForm.jsx';

const CATEGORIES = [
  { id: 'cat1', name: 'Audio', slug: 'audio', parentId: null, isActive: true, sortOrder: 0 },
];

function pngFile(name = 'front.png', size = 1024) {
  return new File([new ArrayBuffer(size)], name, { type: 'image/png' });
}

function renderCreate(props = {}) {
  return render(
    <ProductForm
      categories={CATEGORIES}
      onSubmit={props.onSubmit ?? vi.fn()}
      submitting={false}
      {...props}
    />,
  );
}

async function fillValidProduct(user, container) {
  await user.type(screen.getByPlaceholderText('e.g. DriveCharge 38W'), 'Test Speaker');
  const parentSelect = container.querySelectorAll('select')[0];
  await user.selectOptions(parentSelect, 'cat1');
}

async function fillVariant(user, group, sku, name, price) {
  await user.type(within(group).getByPlaceholderText('e.g. TP-DC38-BLK'), sku);
  await user.type(within(group).getByPlaceholderText('e.g. Onyx Black'), name);
  await user.type(within(group).getByPlaceholderText('e.g. 1299.00'), price);
}

async function uploadToVariant(user, group, files) {
  await user.upload(within(group).getByLabelText('Select product images'), files);
}

beforeEach(() => {
  vi.clearAllMocks();
  URL.createObjectURL = vi.fn(() => 'blob:mock-preview');
  URL.revokeObjectURL = vi.fn();
});

describe('ProductForm variant-first create UX', () => {
  it('shows Variant 1 immediately without clicking Add Variant', () => {
    renderCreate();
    expect(screen.getByRole('group', { name: 'Variant 1' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Variant 1' })).toBeInTheDocument();
  });

  it('offers no standalone product-level image upload for new products', () => {
    renderCreate();
    expect(screen.queryByTitle(/product images/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Product images (required)')).not.toBeInTheDocument();
    // The only image pickers live inside variant sections.
    expect(screen.getAllByLabelText('Select product images')).toHaveLength(1);
  });

  it('Add Variant appends Variant 2, then Variant 3', async () => {
    const user = userEvent.setup();
    renderCreate();
    expect(screen.getAllByRole('group', { name: /Variant \d/ })).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Add Variant' }));
    expect(screen.getAllByRole('group', { name: /Variant \d/ })).toHaveLength(2);
    expect(screen.getByRole('group', { name: 'Variant 2' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Add Variant' }));
    expect(screen.getAllByRole('group', { name: /Variant \d/ })).toHaveLength(3);
  });

  it('keeps variant image selections independent', async () => {
    const user = userEvent.setup();
    renderCreate();
    await user.click(screen.getByRole('button', { name: 'Add Variant' }));
    const groups = screen.getAllByRole('group', { name: /Variant \d/ });

    await uploadToVariant(user, groups[0], [pngFile('blk1.png'), pngFile('blk2.png')]);
    await uploadToVariant(user, groups[1], pngFile('blu1.png'));

    expect(await within(groups[0]).findByAltText('Preview of blk1.png')).toBeInTheDocument();
    expect(await within(groups[0]).findByAltText('Preview of blk2.png')).toBeInTheDocument();
    expect(await within(groups[1]).findByAltText('Preview of blu1.png')).toBeInTheDocument();
    expect(within(groups[0]).queryByAltText('Preview of blu1.png')).not.toBeInTheDocument();
    expect(within(groups[1]).queryByAltText('Preview of blk1.png')).not.toBeInTheDocument();
  });

  it('does not allow removing the last variant', async () => {
    const user = userEvent.setup();
    renderCreate();
    expect(screen.getByRole('button', { name: 'Remove variant 1' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Add Variant' }));
    expect(screen.getByRole('button', { name: 'Remove variant 1' })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remove variant 2' })).not.toBeDisabled();
  });

  it('blocks submit when Variant 1 has valid fields but zero images', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const { container } = renderCreate({ onSubmit });

    await fillValidProduct(user, container);
    await fillVariant(user, screen.getByRole('group', { name: 'Variant 1' }), 'SPK-BLK', 'Black', '1299.00');
    await user.click(screen.getByRole('button', { name: 'Create product' }));

    expect(await screen.findByText('Variant 1 requires at least one image.')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('blocks submit when Variant 2 has zero images and names that variant', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const { container } = renderCreate({ onSubmit });

    await fillValidProduct(user, container);
    await user.click(screen.getByRole('button', { name: 'Add Variant' }));
    const groups = screen.getAllByRole('group', { name: /Variant \d/ });
    await fillVariant(user, groups[0], 'SPK-BLK', 'Black', '1299.00');
    await fillVariant(user, groups[1], 'SPK-BLU', 'Blue', '1399.00');
    await uploadToVariant(user, groups[0], pngFile('blk1.png'));
    await user.click(screen.getByRole('button', { name: 'Create product' }));

    expect(await screen.findByText('Variant 2 requires at least one image.')).toBeInTheDocument();
    expect(screen.queryByText('Variant 1 requires at least one image.')).not.toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('blocks submit when variant fields are invalid and uploads nothing', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const { container } = renderCreate({ onSubmit });

    await fillValidProduct(user, container);
    const group = screen.getByRole('group', { name: 'Variant 1' });
    await user.type(within(group).getByPlaceholderText('e.g. Onyx Black'), 'Nameless SKU');
    await user.click(screen.getByRole('button', { name: 'Create product' }));

    expect(await screen.findByText('SKU is required.')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits variants with per-variant files and no product-level image collection', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const { container } = renderCreate({ onSubmit });

    await fillValidProduct(user, container);
    await user.click(screen.getByRole('button', { name: 'Add Variant' }));
    const groups = screen.getAllByRole('group', { name: /Variant \d/ });
    await fillVariant(user, groups[0], 'SPK-BLK', 'Black', '1299.00');
    await fillVariant(user, groups[1], 'SPK-BLU', 'Blue', '1399.00');
    const blk1 = pngFile('blk1.png');
    const blk2 = pngFile('blk2.png');
    const blu1 = pngFile('blu1.png');
    await uploadToVariant(user, groups[0], [blk1, blk2]);
    await uploadToVariant(user, groups[1], blu1);
    await user.click(screen.getByRole('button', { name: 'Create product' }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const [formValue, mediaAction] = onSubmit.mock.calls[0];
    expect(formValue.variants).toEqual([
      expect.objectContaining({ sku: 'SPK-BLK', name: 'Black', price: '1299.00' }),
      expect.objectContaining({ sku: 'SPK-BLU', name: 'Blue', price: '1399.00' }),
    ]);
    // Images travel per variant (SKU-keyed); no product-level collection.
    expect(mediaAction).not.toHaveProperty('productImages');
    expect(mediaAction.variantImages).toHaveLength(2);
    expect(mediaAction.variantImages[0].sku).toBe('SPK-BLK');
    expect(mediaAction.variantImages[0].files).toEqual([blk1, blk2]);
    expect(mediaAction.variantImages[1].sku).toBe('SPK-BLU');
    expect(mediaAction.variantImages[1].files).toEqual([blu1]);
  });
});
