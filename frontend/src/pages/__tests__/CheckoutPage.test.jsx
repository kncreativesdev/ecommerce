import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { CheckoutPage } from '../CheckoutPage.jsx';
import { useCartStore } from '../../stores/useCartStore.js';
import { useCheckoutStore } from '../../stores/useCheckoutStore.js';
import { createOrder } from '../../services/orders.service.js';
import { createAddress, fetchAddresses } from '../../services/addresses.service.js';

vi.mock('../../services/orders.service.js', () => ({
  createOrder: vi.fn(),
}));

vi.mock('../../services/addresses.service.js', () => ({
  fetchAddresses: vi.fn(),
  fetchAddressById: vi.fn(),
  createAddress: vi.fn(),
  updateAddress: vi.fn(),
  deleteAddress: vi.fn(),
}));

vi.mock('../../services/media.service.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, fetchProductImages: vi.fn().mockResolvedValue([]) };
});

const HOME = {
  id: 'a-home',
  fullName: 'Jaskaran Singh',
  phone: '9876543210',
  addressLine1: '123 Model Town',
  addressLine2: '',
  city: 'Ludhiana',
  state: 'Punjab',
  postalCode: '141002',
  country: 'India',
  isDefault: true,
};

const OFFICE = {
  id: 'a-office',
  fullName: 'Jaskaran Singh',
  phone: '9876543210',
  addressLine1: '456 Civil Lines',
  addressLine2: '',
  city: 'Ludhiana',
  state: 'Punjab',
  postalCode: '141002',
  country: 'India',
  isDefault: false,
};

const CART = {
  items: [
    {
      id: 'line-1',
      product: { id: 'p1', name: 'Test Widget' },
      variantId: 'v1',
      unitPrice: '100.00',
      quantity: 2,
      lineTotal: '200.00',
    },
  ],
  itemCount: 2,
  subtotal: '200.00',
};

function renderCheckout() {
  return render(
    <MemoryRouter initialEntries={['/checkout']}>
      <Routes>
        <Route path="/checkout" element={<CheckoutPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

// AddressForm labels are not programmatically associated (no htmlFor/id),
// so inline-form inputs are located by their RHF field names.
function field(container, name) {
  return container.querySelector(`input[name="${name}"]`);
}

async function fillAddress(user, container, values) {
  await user.type(field(container, 'fullName'), values.fullName);
  await user.type(field(container, 'phone'), values.phone);
  await user.type(field(container, 'addressLine1'), values.addressLine1);
  await user.type(field(container, 'city'), values.city);
  await user.type(field(container, 'state'), values.state);
  await user.type(field(container, 'postalCode'), values.postalCode);
}

beforeEach(() => {
  vi.clearAllMocks();
  useCheckoutStore.getState().reset();
  useCartStore.setState({ cart: CART, status: 'success', bootstrap: vi.fn().mockResolvedValue(null) });
  fetchAddresses.mockResolvedValue([HOME, OFFICE]);
  createOrder.mockResolvedValue({ id: 'order-1' });
  createAddress.mockImplementation(async (input) => ({ id: 'a-new', ...input, isDefault: false }));
});

describe('CheckoutPage saved addresses', () => {
  it('loads the book once and preselects the default address', async () => {
    renderCheckout();

    const group = await screen.findByRole('radiogroup', { name: /shipping address/i });
    expect(fetchAddresses).toHaveBeenCalledTimes(1);
    const radios = within(group).getAllByRole('radio');
    expect(radios).toHaveLength(2);
    expect(radios[0]).toHaveAttribute('aria-checked', 'true');
    expect(useCheckoutStore.getState().shippingAddressId).toBe('a-home');
  });

  it('switches the shipping pick without retyping', async () => {
    const user = userEvent.setup();
    renderCheckout();
    const group = await screen.findByRole('radiogroup', { name: /shipping address/i });
    const radios = within(group).getAllByRole('radio');

    await user.click(radios[1]);

    expect(radios[1]).toHaveAttribute('aria-checked', 'true');
    expect(useCheckoutStore.getState().shippingAddressId).toBe('a-office');
    expect(fetchAddresses).toHaveBeenCalledTimes(1);
  });

  it('adds an address inline and selects it without leaving checkout', async () => {
    const user = userEvent.setup();
    const { container } = renderCheckout();
    await screen.findByRole('radiogroup', { name: /shipping address/i });

    await user.click(screen.getByRole('button', { name: /add a new address/i }));
    expect(screen.getByRole('form', { name: /add address/i })).toBeInTheDocument();

    await fillAddress(user, container, {
      fullName: 'Jaskaran Singh',
      phone: '9876543210',
      addressLine1: '789 New Road',
      city: 'Amritsar',
      state: 'Punjab',
      postalCode: '143001',
    });
    // The post-save refetch must already resolve the grown book: the form
    // saves, then handleAddressSaved refetches exactly once more.
    fetchAddresses.mockResolvedValue([
      HOME,
      OFFICE,
      { id: 'a-new', fullName: 'Jaskaran Singh', addressLine1: '789 New Road', city: 'Amritsar', postalCode: '143001', isDefault: false },
    ]);
    await user.click(screen.getByRole('button', { name: /^add address$/i }));

    expect(createAddress).toHaveBeenCalledTimes(1);
    // Saved record joins the book and becomes the pick — still on step 1.
    await screen.findByText('789 New Road, Amritsar 143001');
    expect(useCheckoutStore.getState().shippingAddressId).toBe('a-new');
    expect(screen.getByRole('button', { name: /continue to billing/i })).toBeInTheDocument();
  });

  it('places the order with selected ids only (server snapshots the rest)', async () => {
    const user = userEvent.setup();
    renderCheckout();
    await screen.findByRole('radiogroup', { name: /shipping address/i });

    await user.click(screen.getByRole('button', { name: /continue to billing/i }));
    await user.click(screen.getByRole('button', { name: /review order/i }));
    await user.click(screen.getByRole('button', { name: /place order/i }));

    expect(createOrder).toHaveBeenCalledWith({
      shippingAddressId: 'a-home',
      billingAddressId: undefined,
      couponCode: undefined,
    });
    // Success resets the ephemeral picks (book itself is server-side).
    expect(useCheckoutStore.getState().shippingAddressId).toBeNull();
  });

  it('reselects deterministically when the stored pick no longer exists', async () => {
    useCheckoutStore.setState({ shippingAddressId: 'a-deleted' });
    renderCheckout();

    await screen.findByRole('radiogroup', { name: /shipping address/i });
    expect(useCheckoutStore.getState().shippingAddressId).toBe('a-home');
  });
});

describe('CheckoutPage without saved addresses', () => {
  it('shows the address form inline (no bounce-out) and continues after save', async () => {
    const user = userEvent.setup();
    fetchAddresses.mockResolvedValue([]);
    const { container } = renderCheckout();

    // Inline form, not a "go somewhere else" empty state.
    expect(await screen.findByRole('form', { name: /add address/i })).toBeInTheDocument();
    expect(screen.queryByText(/add a delivery address first/i)).not.toBeInTheDocument();

    await fillAddress(user, container, {
      fullName: 'Jaskaran Singh',
      phone: '9876543210',
      addressLine1: '123 Model Town',
      city: 'Ludhiana',
      state: 'Punjab',
      postalCode: '141002',
    });
    fetchAddresses.mockResolvedValue([
      { id: 'a-new', fullName: 'Jaskaran Singh', addressLine1: '123 Model Town', city: 'Ludhiana', postalCode: '141002', isDefault: false },
    ]);
    await user.click(screen.getByRole('button', { name: /^add address$/i }));

    expect(createAddress).toHaveBeenCalledTimes(1);
    await screen.findByRole('radiogroup', { name: /shipping address/i });
    expect(useCheckoutStore.getState().shippingAddressId).toBe('a-new');
  });
});
