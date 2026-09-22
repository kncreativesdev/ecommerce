import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PendingProductImages } from '../PendingProductImages.jsx';

function pngFile(name = 'photo.png', size = 1024) {
  return new File([new ArrayBuffer(size)], name, { type: 'image/png' });
}

beforeEach(() => {
  // jsdom has no object-URL support — stub it; every preview/revoke flows
  // through these spies so leaks are assertable.
  URL.createObjectURL = vi.fn(() => 'blob:mock-preview');
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete URL.createObjectURL;
  delete URL.revokeObjectURL;
});

describe('PendingProductImages', () => {
  it('renders the selector with format hints and no previews initially', () => {
    render(<PendingProductImages onSelectionChange={vi.fn()} />);
    expect(screen.getByLabelText('Select product images')).toBeInTheDocument();
    expect(screen.getByText(/JPEG, PNG, or WebP/)).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('previews a valid image and reports the File upward (never a URL)', async () => {
    const user = userEvent.setup();
    const onSelectionChange = vi.fn();
    render(<PendingProductImages onSelectionChange={onSelectionChange} />);
    const file = pngFile();

    await user.upload(screen.getByLabelText('Select product images'), file);

    expect(await screen.findByAltText('Preview of photo.png')).toBeInTheDocument();
    expect(screen.getByText('photo.png')).toBeInTheDocument();
    expect(screen.getByText(/Ready — uploads after product creation/)).toBeInTheDocument();
    expect(URL.createObjectURL).toHaveBeenCalledWith(file);
    const reported = onSelectionChange.mock.calls.at(-1)[0];
    expect(reported).toHaveLength(1);
    expect(reported[0]).toBeInstanceOf(File);
    expect(reported[0].name).toBe('photo.png');
  });

  it('rejects non-image files with a reason and excludes them from upload', async () => {
    const onSelectionChange = vi.fn();
    render(<PendingProductImages onSelectionChange={onSelectionChange} />);
    const input = screen.getByLabelText('Select product images');

    // fireEvent (not user.upload): user-event honors the accept attribute
    // like a real picker, but the component's own validation is what's
    // under test here (e.g. spoofed content reaching the handler).
    fireEvent.change(input, { target: { files: [new File(['x'], 'notes.txt', { type: 'text/plain' })] } });

    expect(await screen.findByText('Only JPEG, PNG, or WebP images are allowed.')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(onSelectionChange).toHaveBeenCalledWith([]);
  });

  it('rejects oversized images', async () => {
    const user = userEvent.setup();
    const onSelectionChange = vi.fn();
    render(<PendingProductImages onSelectionChange={onSelectionChange} />);

    await user.upload(screen.getByLabelText('Select product images'), pngFile('huge.png', 5 * 1024 * 1024 + 1));

    expect(await screen.findByText('Image must be 5 MB or smaller.')).toBeInTheDocument();
    expect(onSelectionChange.mock.calls.at(-1)[0]).toEqual([]);
  });

  it('removes a selected image and revokes its preview URL', async () => {
    const user = userEvent.setup();
    const onSelectionChange = vi.fn();
    render(<PendingProductImages onSelectionChange={onSelectionChange} />);

    await user.upload(screen.getByLabelText('Select product images'), pngFile());
    expect(await screen.findByAltText('Preview of photo.png')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Remove photo.png' }));

    expect(screen.queryByAltText('Preview of photo.png')).not.toBeInTheDocument();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-preview');
    expect(onSelectionChange.mock.calls.at(-1)[0]).toEqual([]);
  });

  it('revokes preview URLs on unmount without persisting anything', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<PendingProductImages onSelectionChange={vi.fn()} />);

    await user.upload(screen.getByLabelText('Select product images'), pngFile());
    expect(await screen.findByAltText('Preview of photo.png')).toBeInTheDocument();

    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-preview');
    expect(window.localStorage.length).toBe(0);
  });

  it('replaces selection on a new file dialog (no accumulation, no leaks)', async () => {
    const user = userEvent.setup();
    const onSelectionChange = vi.fn();
    render(<PendingProductImages onSelectionChange={onSelectionChange} />);
    const input = screen.getByLabelText('Select product images');

    await user.upload(input, pngFile('one.png'));
    expect(await screen.findByText('one.png')).toBeInTheDocument();
    fireEvent.change(input, { target: { files: [pngFile('two.png')] } });

    expect(await screen.findByText('two.png')).toBeInTheDocument();
    expect(screen.queryByText('one.png')).not.toBeInTheDocument();
    expect(onSelectionChange.mock.calls.at(-1)[0].map((file) => file.name)).toEqual(['two.png']);
  });
});
