import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { CheckoutPage } from '../CheckoutPage.jsx';
import { useAuthStore } from '../../stores/useAuthStore.js';
import { useCartStore } from '../../stores/useCartStore.js';
import { useCheckoutStore } from '../../stores/useCheckoutStore.js';
import { createOrder } from '../../services/orders.service.js';
import { fetchAddresses } from '../../services/addresses.service.js';
import { updateProfile } from '../../services/users.service.js';

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

vi.mock('../../services/users.service.js', () => ({
  fetchProfile: vi.fn(),
  updateProfile: vi.fn(),
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

function setSessionUser(user) {
  useAuthStore.setState({ user, accessToken: user ? 'token' : null, status: 'ready' });
}

function renderCheckout() {
  return render(
    <MemoryRouter initialEntries={['/checkout']}>
      <Routes>
        <Route path="/checkout" element={<CheckoutPage />} />
        <Route path="/order-confirmation/:id" element={<div>Order confirmed</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function goToReviewStep(user) {
  renderCheckout();
  await screen.findByRole('radiogroup', { name: /shipping address/i });
  await user.click(screen.getByRole('button', { name: /continue to billing/i }));
  await user.click(screen.getByRole('button', { name: /review order/i }));
  return screen.findByRole('region', { name: /review and place order/i });
}

beforeEach(() => {
  vi.clearAllMocks();
  useCheckoutStore.getState().reset();
  useCartStore.setState({ cart: CART, status: 'success', bootstrap: vi.fn().mockResolvedValue(null) });
  fetchAddresses.mockResolvedValue([HOME]);
  createOrder.mockResolvedValue({ id: 'order-1' });
  updateProfile.mockImplementation(async ({ phone }) => ({
    id: 'u1',
    email: 'buyer@example.test',
    firstName: 'Buyer',
    phone,
  }));
});

describe('CheckoutPage phone requirement', () => {
  it('places the order normally when the profile has a valid phone', async () => {
    const user = userEvent.setup();
    setSessionUser({ id: 'u1', email: 'buyer@example.test', firstName: 'Buyer', phone: '9876543210' });
    const section = await goToReviewStep(user);

    expect(within(section).queryByRole('alert', { name: /phone number required/i })).not.toBeInTheDocument();
    await user.click(within(section).getByRole('button', { name: /place order/i }));

    expect(createOrder).toHaveBeenCalledWith({
      shippingAddressId: 'a-home',
      billingAddressId: undefined,
      couponCode: undefined,
    });
    expect(await screen.findByText('Order confirmed')).toBeInTheDocument();
  });

  it('shows the requirement and blocks submission when the profile has no phone', async () => {
    const user = userEvent.setup();
    setSessionUser({ id: 'u1', email: 'buyer@example.test', firstName: 'Buyer', phone: null });
    const section = await goToReviewStep(user);

    const alert = within(section).getByRole('alert', { name: /phone number required/i });
    expect(alert).toBeInTheDocument();
    expect(within(alert).getByRole('form', { name: /add phone number/i })).toBeInTheDocument();

    const placeButton = within(section).getByRole('button', { name: /place order/i });
    expect(placeButton).toBeDisabled();
    expect(createOrder).not.toHaveBeenCalled();
  });

  it('rejects an empty phone inline without calling the profile API', async () => {
    const user = userEvent.setup();
    setSessionUser({ id: 'u1', email: 'buyer@example.test', firstName: 'Buyer', phone: '  ' });
    const section = await goToReviewStep(user);

    const alert = within(section).getByRole('alert', { name: /phone number required/i });
    await user.click(within(alert).getByRole('button', { name: /save phone number/i }));

    expect(await within(alert).findByText('Phone is required to place your order.')).toBeInTheDocument();
    expect(updateProfile).not.toHaveBeenCalled();
    expect(createOrder).not.toHaveBeenCalled();
  });

  it('saving the phone unblocks checkout without a reload', async () => {
    const user = userEvent.setup();
    setSessionUser({ id: 'u1', email: 'buyer@example.test', firstName: 'Buyer', phone: null });
    const section = await goToReviewStep(user);

    const alert = within(section).getByRole('alert', { name: /phone number required/i });
    await user.type(within(alert).getByPlaceholderText('Your contact number'), ' 9876543210 ');
    await user.click(within(alert).getByRole('button', { name: /save phone number/i }));

    expect(updateProfile).toHaveBeenCalledWith({ phone: '9876543210' });
    // Auth store now carries the phone — the gate clears and the order can go.
    await within(section).findByRole('button', { name: /place order/i }).then(async (placeButton) => {
      expect(placeButton).not.toBeDisabled();
      await user.click(placeButton);
    });
    expect(createOrder).toHaveBeenCalledTimes(1);
  });

  it('surfaces a backend phone rejection inline without clearing the cart or navigating', async () => {
    const user = userEvent.setup();
    // Stale mirror: store has a phone, but the backend disagrees.
    setSessionUser({ id: 'u1', email: 'buyer@example.test', firstName: 'Buyer', phone: '9876543210' });
    createOrder.mockRejectedValue({
      code: 'ORDER_PHONE_REQUIRED',
      status: 422,
      message: 'A phone number is required to place an order. Please add one to your profile.',
    });
    const section = await goToReviewStep(user);
    await user.click(within(section).getByRole('button', { name: /place order/i }));

    const alert = await within(section).findByRole('alert', { name: /phone number required/i });
    expect(within(alert).getByText('A phone number is required to place an order. Please add one to your profile.')).toBeInTheDocument();
    // No success navigation, no reset: still on review, cart intact.
    expect(screen.queryByText('Order confirmed')).not.toBeInTheDocument();
    expect(useCartStore.getState().cart.items).toHaveLength(1);
    expect(useCheckoutStore.getState().shippingAddressId).toBe('a-home');
  });

  it('keeps address selection and coupon behavior intact', async () => {
    const user = userEvent.setup();
    setSessionUser({ id: 'u1', email: 'buyer@example.test', firstName: 'Buyer', phone: '9876543210' });
    useCheckoutStore.setState({
      appliedCoupon: { coupon: { code: 'SAVE10' }, discountAmount: '20.00' },
    });
    const section = await goToReviewStep(user);

    expect(within(section).getAllByText(/SAVE10/).length).toBeGreaterThanOrEqual(1);
    await user.click(within(section).getByRole('button', { name: /place order/i }));
    expect(createOrder).toHaveBeenCalledWith({
      shippingAddressId: 'a-home',
      billingAddressId: undefined,
      couponCode: 'SAVE10',
    });
  });
});
