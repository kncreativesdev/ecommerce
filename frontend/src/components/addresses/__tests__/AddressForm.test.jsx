import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AddressForm } from '../AddressForm.jsx';
import { createAddress, updateAddress } from '../../../services/addresses.service.js';

vi.mock('../../../services/addresses.service.js', () => ({
  createAddress: vi.fn(),
  updateAddress: vi.fn(),
  fetchAddresses: vi.fn(),
}));

const VALID = {
  fullName: 'Jaskaran Singh',
  phone: '9876543210',
  addressLine1: '123 Model Town',
  city: 'Ludhiana',
  state: 'Punjab',
  postalCode: '141002',
  country: 'India',
};

async function fillValid(user, container) {
  // FormField labels are not programmatically associated (no htmlFor/id),
  // so inputs are located by their RHF field names. Typed strictly
  // sequentially — userEvent instances do not support parallel typing.
  const field = (name) => container.querySelector(`input[name="${name}"]`);
  await user.type(field('fullName'), VALID.fullName);
  await user.type(field('phone'), VALID.phone);
  await user.type(field('addressLine1'), VALID.addressLine1);
  await user.type(field('city'), VALID.city);
  await user.type(field('state'), VALID.state);
  await user.type(field('postalCode'), VALID.postalCode);
  await user.clear(field('country'));
  await user.type(field('country'), VALID.country);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AddressForm (shared book + checkout form)', () => {
  it('creates an address and hands the saved record to onSaved', async () => {
    const user = userEvent.setup();
    const saved = { id: 'a9', ...VALID, isDefault: false };
    createAddress.mockResolvedValue(saved);
    const onSaved = vi.fn();

    const { container } = render(<AddressForm initialValue={null} mutating={false} setMutating={() => {}} onSaved={onSaved} onCancel={() => {}} />);
    await fillValid(user, container);
    await user.click(screen.getByRole('button', { name: /add address/i }));

    expect(createAddress).toHaveBeenCalledTimes(1);
    expect(createAddress).toHaveBeenCalledWith(expect.objectContaining({ fullName: 'Jaskaran Singh', city: 'Ludhiana' }));
    expect(onSaved).toHaveBeenCalledWith(saved);
  });

  it('blocks submit with client validation errors (nothing sent)', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();

    render(<AddressForm initialValue={null} mutating={false} setMutating={() => {}} onSaved={onSaved} onCancel={() => {}} />);
    await user.click(screen.getByRole('button', { name: /add address/i }));

    expect(await screen.findByText(/full name is required/i)).toBeInTheDocument();
    expect(createAddress).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('prefills when editing and updates by id', async () => {
    const user = userEvent.setup();
    updateAddress.mockResolvedValue({ id: 'a1', ...VALID, city: 'Amritsar' });
    const onSaved = vi.fn();

    const { container } = render(
      <AddressForm
        initialValue={{ id: 'a1', ...VALID }}
        mutating={false}
        setMutating={() => {}}
        onSaved={onSaved}
        onCancel={() => {}}
      />,
    );

    expect(container.querySelector('input[name="fullName"]')).toHaveValue('Jaskaran Singh');
    await user.clear(container.querySelector('input[name="city"]'));
    await user.type(container.querySelector('input[name="city"]'), 'Amritsar');
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    expect(updateAddress).toHaveBeenCalledWith('a1', expect.objectContaining({ city: 'Amritsar' }));
    expect(onSaved).toHaveBeenCalled();
  });

  it('surfaces server errors without claiming success', async () => {
    const user = userEvent.setup();
    createAddress.mockRejectedValue({ code: 'VALIDATION_ERROR', message: 'Invalid request data', details: [] });
    const onSaved = vi.fn();

    const { container } = render(<AddressForm initialValue={null} mutating={false} setMutating={() => {}} onSaved={onSaved} onCancel={() => {}} />);
    await fillValid(user, container);
    await user.click(screen.getByRole('button', { name: /add address/i }));

    expect(await screen.findByText(/invalid request data/i)).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });
});
