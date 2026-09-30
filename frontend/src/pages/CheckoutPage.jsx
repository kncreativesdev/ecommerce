import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowLeft, ArrowRight, Banknote, Check, Phone, Plus } from 'lucide-react';
import { Container } from '../components/ui/Container.jsx';
import { Breadcrumbs } from '../components/layout/Breadcrumbs.jsx';
import { EmptyState } from '../components/ui/EmptyState.jsx';
import { ErrorState } from '../components/ui/ErrorState.jsx';
import { Skeleton } from '../components/ui/Skeleton.jsx';
import { FormField, TextInput } from '../components/ui/FormField.jsx';
import { ProductImage } from '../components/catalog/ProductImage.jsx';
import { AddressForm } from '../components/addresses/AddressForm.jsx';
import { CouponSection } from '../components/checkout/CouponSection.jsx';
import { useAuthStore } from '../stores/useAuthStore.js';
import { useCartStore } from '../stores/useCartStore.js';
import { useCheckoutStore } from '../stores/useCheckoutStore.js';
import { createOrder } from '../services/orders.service.js';
import { fetchAddresses } from '../services/addresses.service.js';
import { updateProfile } from '../services/users.service.js';
import { formatINR } from '../lib/format.js';
import { cn } from '../lib/cn.js';

/**
 * Inline phone capture for customers whose profile has no phone number.
 * Uses the existing profile update endpoint (`PATCH /users/me`) and writes
 * the authoritative result straight back into the auth store — checkout
 * continues immediately, no logout/login required. Phone is never kept in
 * localStorage and no second phone state is introduced: the auth store
 * `user` remains the single source of truth.
 */
function CheckoutPhoneForm({ onSaved }) {
  const [phone, setPhone] = useState('');
  const [fieldError, setFieldError] = useState(null);
  const [saving, setSaving] = useState(false);

  const handleSave = async (event) => {
    event.preventDefault();
    const trimmed = phone.trim();
    if (!trimmed) {
      setFieldError('Phone is required to place your order.');
      return;
    }
    setFieldError(null);
    setSaving(true);
    try {
      const updated = await updateProfile({ phone: trimmed });
      useAuthStore.setState({ user: updated ?? null });
      toast.success('Phone number saved — you can place your order now.');
      if (onSaved) onSaved();
    } catch (error) {
      const detail = Array.isArray(error?.details)
        ? error.details.find((entry) => entry?.path === 'phone')
        : null;
      setFieldError(detail?.message ?? error?.message ?? 'Could not save the phone number. Please try again.');
      toast.error(detail?.message ?? error?.message ?? 'Could not save the phone number. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSave} noValidate aria-label="Add phone number" className="flex flex-col gap-2.5">
      <FormField label="Phone" required error={fieldError}>
        {({ describedBy }) => (
          <TextInput
            type="tel"
            autoComplete="tel"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="Your contact number"
            aria-invalid={Boolean(fieldError)}
            aria-describedby={describedBy}
          />
        )}
      </FormField>
      <button
        type="submit"
        disabled={saving}
        aria-busy={saving}
        className="inline-flex min-h-[44px] cursor-pointer items-center justify-center gap-2 self-start rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground transition-opacity duration-200 hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
      >
        <Phone size={15} aria-hidden="true" />
        {saving ? 'Saving…' : 'Save phone number'}
      </button>
    </form>
  );
}

/**
 * Checkout (`/checkout`, protected): vertical stepper — 1) shipping address
 * picker (+ link to create), 2) billing (same-as-shipping default or second
 * picker), 3) review lines + COD summary (server totals only, fixed "Cash
 * on Delivery" method), 4) Place Order (single submit, double-submit guard).
 *
 * Prereqs: non-empty cart (else cart with messaging). A first-time customer
 * with no saved address gets the address form inline (no navigation away);
 * returning customers pick from saved cards (default preselected) and can
 * add another address inline without leaving checkout. `POST /orders` sends
 * address ids ONLY. `201` → reset checkout state →
 * `/order-confirmation/:id` (never from local state). Failures route per
 * PAGES.md §16.
 */
export function CheckoutPage() {
  const navigate = useNavigate();
  const cart = useCartStore((state) => state.cart);
  const cartStatus = useCartStore((state) => state.status);
  const bootstrapCart = useCartStore((state) => state.bootstrap);
  const step = useCheckoutStore((state) => state.step);
  const setStep = useCheckoutStore((state) => state.setStep);
  const shippingAddressId = useCheckoutStore((state) => state.shippingAddressId);
  const setShippingAddressId = useCheckoutStore((state) => state.setShippingAddressId);
  const billingAddressId = useCheckoutStore((state) => state.billingAddressId);
  const setBillingAddressId = useCheckoutStore((state) => state.setBillingAddressId);
  const billingSameAsShipping = useCheckoutStore((state) => state.billingSameAsShipping);
  const setBillingSameAsShipping = useCheckoutStore((state) => state.setBillingSameAsShipping);
  const placingOrder = useCheckoutStore((state) => state.placingOrder);
  const setPlacingOrder = useCheckoutStore((state) => state.setPlacingOrder);
  const appliedCoupon = useCheckoutStore((state) => state.appliedCoupon);
  const resetCheckout = useCheckoutStore((state) => state.reset);
  // Authoritative customer phone comes from the session profile
  // (`useAuthStore.user`), never localStorage and never the address book
  // (address phones are per-address contacts, snapshotted independently).
  const user = useAuthStore((state) => state.user);
  const userPhone = typeof user?.phone === 'string' ? user.phone.trim() : '';
  const hasValidPhone = userPhone !== '';

  const [addresses, setAddresses] = useState([]);
  const [addressStatus, setAddressStatus] = useState('loading');
  const [addressError, setAddressError] = useState(null);
  const [addressReloadToken, setAddressReloadToken] = useState(0);
  const [showAddressForm, setShowAddressForm] = useState(false);
  const [addressMutating, setAddressMutating] = useState(false);
  // Backend phone rejection message kept inline (in addition to the toast)
  // so a stale profile mirror is visible and recoverable without leaving
  // checkout. Cleared once an inline save succeeds.
  const [phoneServerError, setPhoneServerError] = useState(null);

  useEffect(() => {
    document.title = 'Checkout — Tech Pulse';
    bootstrapCart();
  }, [bootstrapCart]);

  // Address loading (state updates only in async continuations). One fetch
  // per mount/retry — the list feeds both pickers from local state.
  useEffect(() => {
    const controller = new AbortController();
    const signal = controller.signal;
    fetchAddresses()
      .then((data) => {
        if (signal.aborted) return;
        setAddresses(data);
        setAddressStatus('success');
        const store = useCheckoutStore.getState();
        const ids = new Set(data.map((address) => address.id));
        const preferred = data.find((address) => address.isDefault) ?? data[0] ?? null;
        if (!preferred) {
          // Address book emptied elsewhere: drop stale picks so the inline
          // form (not a dead selection) drives the next order.
          if (store.shippingAddressId) store.setShippingAddressId(null);
          if (store.billingAddressId) store.setBillingAddressId(null);
          return;
        }
        // Default (else first) is preselected; a stored pick survives only
        // if it still exists (e.g. not deleted from the account page).
        if (!store.shippingAddressId || !ids.has(store.shippingAddressId)) {
          store.setShippingAddressId(preferred.id);
        }
        if (!store.billingSameAsShipping && store.billingAddressId && !ids.has(store.billingAddressId)) {
          store.setBillingAddressId(preferred.id);
        }
      })
      .catch((error) => {
        if (signal.aborted) return;
        setAddressError(error);
        setAddressStatus('error');
      });
    return () => controller.abort();
  }, [addressReloadToken]);

  // A newly saved address joins the list and becomes the shipping pick —
  // no navigation, no reload; the customer continues checkout immediately.
  const handleAddressSaved = async (saved) => {
    setShowAddressForm(false);
    try {
      const data = await fetchAddresses();
      setAddresses(data);
      setAddressStatus('success');
      const pick = (saved?.id && data.some((address) => address.id === saved.id))
        ? saved.id
        : (data.find((address) => address.isDefault) ?? data[0] ?? null)?.id ?? null;
      if (pick) useCheckoutStore.getState().setShippingAddressId(pick);
    } catch (error) {
      setAddressError(error);
      setAddressStatus('error');
    }
  };

  const cartLoading = cartStatus === 'idle' || cartStatus === 'loading';
  const addressLoading = addressStatus === 'loading';

  const shippingAddress = addresses.find((address) => address.id === shippingAddressId) ?? null;
  const billingAddress = billingSameAsShipping
    ? shippingAddress
    : (addresses.find((address) => address.id === billingAddressId) ?? null);

  const canPlaceOrder =
    cart.items.length > 0 &&
    shippingAddress &&
    (billingSameAsShipping || billingAddress) &&
    hasValidPhone &&
    !placingOrder;

  const handlePlaceOrder = async () => {
    if (!hasValidPhone) {
      toast.error('A phone number is required to place your order. Please add one below.');
      return;
    }
    if (!canPlaceOrder) return;
    setPlacingOrder(true);
    try {
      const order = await createOrder({
        shippingAddressId: shippingAddress.id,
        billingAddressId: billingSameAsShipping ? undefined : billingAddress.id,
        // Applied coupon code only — the backend re-validates against the
        // cart, computes the discount, and consumes usage atomically.
        couponCode: appliedCoupon?.coupon?.code ?? undefined,
      });
      if (!order?.id) {
        throw new Error('Order was not created.');
      }
      resetCheckout();
      // The backend clears the cart atomically on order creation — refresh
      // the local mirror so the header badge and cart views sync immediately
      // instead of showing stale purchased items. Never blocks navigation.
      try {
        await bootstrapCart();
      } catch {
        /* Cart views reconcile on their next bootstrap. */
      }
      navigate(`/order-confirmation/${order.id}`, { replace: true });
    } catch (error) {
      // Coupon failures stay on the review step with the real backend
      // message (re-validate or remove the code). Checked FIRST: usage
      // exhaustion is a 409 that must not route to the stock/cart flow.
      if (typeof error?.code === 'string' && error.code.startsWith('COUPON_')) {
        toast.error(error?.message ?? 'Coupon could not be applied to this order.');
      } else if (error?.code === 'ORDER_PHONE_REQUIRED') {
        // Missing profile phone: stay on the review step with the precise
        // backend message — never clear the cart, never navigate away, never
        // report success. The phone gate below (with its inline save form)
        // unblocks the retry.
        const message = error?.message ?? 'A phone number is required to place your order.';
        setPhoneServerError(message);
        toast.error(message);
      } else if (error?.code === 'ORDER_INSUFFICIENT_STOCK' || error?.status === 409) {
        toast.error('Some items are out of stock — back to cart to review.');
        await bootstrapCart();
        navigate('/cart');
      } else if (error?.code === 'ORDER_EMPTY_CART' || error?.status === 422) {
        toast.error('Your cart is empty.');
        navigate('/cart');
      } else if (error?.code === 'ORDER_ADDRESS_NOT_FOUND' || error?.status === 404) {
        toast.error('Please re-pick your delivery address.');
        setStep(1);
      } else {
        toast.error(error?.message ?? 'Order failed. Please try again.');
      }
    } finally {
      setPlacingOrder(false);
    }
  };

  if (cartLoading || addressLoading) {
    return (
      <Container className="flex max-w-3xl flex-col gap-4 py-10 sm:py-14" role="status" aria-label="Loading checkout">
        <Skeleton className="h-10 w-48 rounded-xl" />
        <Skeleton className="h-40 rounded-2xl" />
        <Skeleton className="h-40 rounded-2xl" />
        <Skeleton className="h-16 rounded-2xl" />
      </Container>
    );
  }

  if (addressStatus === 'error') {
    return (
      <Container className="py-10 sm:py-14">
        <ErrorState
          title="Couldn’t load checkout"
          message={addressError?.message ?? 'Please try again.'}
          onRetry={() => setAddressReloadToken((token) => token + 1)}
        />
      </Container>
    );
  }

  if (cart.items.length === 0) {
    return (
      <Container className="py-10 sm:py-14">
        <EmptyState
          icon={null}
          title="Your cart is empty"
          message="Add something to your cart before checking out."
          actionTo="/cart"
          actionLabel="Go to cart"
        />
      </Container>
    );
  }

  if (addresses.length === 0) {
    // First order (or emptied book): the address form lives HERE — the
    // customer types once, saves to the server book, and continues. The
    // saved record is immediately selected; future orders reuse it.
    return (
      <Container className="flex max-w-3xl flex-col gap-6 py-10 sm:py-14">
        <Breadcrumbs items={[{ label: 'Home', to: '/' }, { label: 'Cart', to: '/cart' }, { label: 'Checkout' }]} />
        <h1 className="text-2xl font-bold tracking-tight">Checkout</h1>
        <p className="-mt-3 text-sm text-muted-foreground">
          Add a delivery address to continue — it will be saved for your next orders.
        </p>
        <AddressForm
          key="checkout-new"
          initialValue={null}
          mutating={addressMutating}
          setMutating={setAddressMutating}
          onSaved={handleAddressSaved}
          onCancel={() => setAddressReloadToken((token) => token + 1)}
        />
      </Container>
    );
  }

  return (
    <Container className="flex max-w-3xl flex-col gap-6 py-10 sm:py-14">
      <Breadcrumbs items={[{ label: 'Home', to: '/' }, { label: 'Cart', to: '/cart' }, { label: 'Checkout' }]} />
      <h1 className="text-2xl font-bold tracking-tight">Checkout</h1>

      <ol className="flex items-center gap-2 text-xs font-semibold" aria-label="Checkout steps">
        {['Shipping', 'Billing', 'Review'].map((label, index) => {
          const stepNumber = index + 1;
          const active = step === stepNumber;
          const done = step > stepNumber;
          return (
            <li key={label} className="flex flex-1 items-center gap-2 last:flex-none">
              <span
                aria-current={active ? 'step' : undefined}
                className={cn(
                  'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold',
                  done || active ? 'bg-primary text-primary-foreground' : 'bg-surface-muted text-muted-foreground',
                )}
              >
                {done ? <Check size={14} aria-hidden="true" /> : stepNumber}
              </span>
              <span className={active || done ? 'text-foreground' : 'text-muted-foreground'}>{label}</span>
              {index < 2 ? <span aria-hidden="true" className="h-px flex-1 bg-border" /> : null}
            </li>
          );
        })}
      </ol>

      {step === 1 ? (
        <section aria-label="Shipping address" className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 shadow-sm">
          <h2 className="text-base font-bold text-foreground">1. Shipping address</h2>
          <ul className="flex flex-col gap-2" role="radiogroup" aria-label="Shipping address">
            {addresses.map((address) => (
              <li key={address.id}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={shippingAddressId === address.id}
                  onClick={() => setShippingAddressId(address.id)}
                  className={cn(
                    'flex min-h-[44px] w-full cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm transition-colors duration-200',
                    shippingAddressId === address.id
                      ? 'border-primary bg-primary/5 font-semibold'
                      : 'border-border hover:bg-surface-muted',
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2',
                      shippingAddressId === address.id ? 'border-primary' : 'border-border-strong',
                    )}
                  >
                    {shippingAddressId === address.id ? <span className="h-2.5 w-2.5 rounded-full bg-primary" /> : null}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-foreground">{address.fullName}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {address.addressLine1}, {address.city} {address.postalCode}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {showAddressForm ? (
            <AddressForm
              key="checkout-additional"
              initialValue={null}
              mutating={addressMutating}
              setMutating={setAddressMutating}
              onSaved={handleAddressSaved}
              onCancel={() => setShowAddressForm(false)}
            />
          ) : (
            <button
              type="button"
              onClick={() => setShowAddressForm(true)}
              className="inline-flex min-h-[44px] items-center gap-1.5 self-start rounded-lg px-2 text-sm font-semibold text-accent-link hover:no-underline"
            >
              <Plus size={15} aria-hidden="true" />
              Add a new address
            </button>
          )}
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => shippingAddress && setStep(2)}
              disabled={!shippingAddress}
              className="inline-flex min-h-[48px] cursor-pointer items-center gap-2 rounded-xl bg-primary px-6 text-sm font-semibold text-primary-foreground transition-opacity duration-200 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Continue to billing
              <ArrowRight size={16} aria-hidden="true" />
            </button>
          </div>
        </section>
      ) : null}

      {step === 2 ? (
        <section aria-label="Billing address" className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 shadow-sm">
          <h2 className="text-base font-bold text-foreground">2. Billing address</h2>
          <label className="inline-flex min-h-[48px] cursor-pointer items-center gap-3 rounded-xl border border-border px-4 text-sm font-medium">
            <input
              type="checkbox"
              checked={billingSameAsShipping}
              onChange={(event) => setBillingSameAsShipping(event.target.checked)}
              className="h-5 w-5 accent-[var(--color-primary)]"
            />
            Same as shipping address
          </label>
          {!billingSameAsShipping ? (
            <ul className="flex flex-col gap-2" role="radiogroup" aria-label="Billing address">
              {addresses.map((address) => (
                <li key={address.id}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={billingAddressId === address.id}
                    onClick={() => setBillingAddressId(address.id)}
                    className={cn(
                      'flex min-h-[44px] w-full cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm transition-colors duration-200',
                      billingAddressId === address.id
                        ? 'border-primary bg-primary/5 font-semibold'
                        : 'border-border hover:bg-surface-muted',
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-foreground">{address.fullName}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {address.addressLine1}, {address.city} {address.postalCode}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="flex justify-between">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="inline-flex min-h-[48px] cursor-pointer items-center gap-2 rounded-xl border border-border px-5 text-sm font-semibold transition-colors duration-200 hover:bg-surface-muted"
            >
              <ArrowLeft size={16} aria-hidden="true" />
              Back
            </button>
            <button
              type="button"
              onClick={() => (billingSameAsShipping || billingAddress) && setStep(3)}
              disabled={!billingSameAsShipping && !billingAddress}
              className="inline-flex min-h-[48px] cursor-pointer items-center gap-2 rounded-xl bg-primary px-6 text-sm font-semibold text-primary-foreground transition-opacity duration-200 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Review order
              <ArrowRight size={16} aria-hidden="true" />
            </button>
          </div>
        </section>
      ) : null}

      {step === 3 ? (
        <section aria-label="Review and place order" className="flex flex-col gap-5 rounded-2xl border-2 border-primary/25 bg-card p-5 shadow-md sm:p-6">
          <div className="flex flex-col gap-1 border-b border-border pb-4">
            <h2 className="text-xl font-extrabold tracking-tight text-foreground">3. Review your order</h2>
            <p className="text-sm text-muted-foreground">
              Confirm your items, quantities, and totals before placing the order.
            </p>
          </div>
          <ul className="flex flex-col divide-y divide-border" aria-label="Order items">
            {cart.items.map((line) => (
              <li key={line.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-border">
                  {line.product?.id ? (
                    <ProductImage productId={line.product.id} variantId={line.variantId ?? line.variant?.id ?? null} alt={line.product.name} />
                  ) : (
                    <span aria-hidden="true" className="block h-full w-full bg-surface-muted" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-bold text-foreground">{line.product?.name ?? 'Product'}</p>
                  <p className="mt-0.5 text-[13px] tabular-nums text-muted-foreground">
                    Qty {line.quantity} · {formatINR(line.unitPrice)} each
                  </p>
                </div>
                <p className="shrink-0 text-[15px] font-extrabold tabular-nums text-foreground">{formatINR(line.lineTotal)}</p>
              </li>
            ))}
          </ul>
          <div className="flex flex-col gap-1.5 rounded-xl bg-surface-muted/60 px-4 py-3" role="group" aria-label="Order summary">
            <dl className="flex items-center justify-between text-sm">
              <dt className="text-muted-foreground">Subtotal ({cart.itemCount} {cart.itemCount === 1 ? 'item' : 'items'})</dt>
              <dd className="font-bold tabular-nums text-foreground">{formatINR(cart.subtotal)}</dd>
            </dl>
            {appliedCoupon?.coupon ? (
              <dl className="flex items-center justify-between text-sm">
                <dt className="text-muted-foreground">Coupon {appliedCoupon.coupon.code}</dt>
                <dd className="font-bold tabular-nums text-success">−{formatINR(appliedCoupon.discountAmount)}</dd>
              </dl>
            ) : null}
            <dl className="flex items-center justify-between text-sm">
              <dt className="text-muted-foreground">Shipping</dt>
              <dd className="font-bold tabular-nums text-foreground">Free</dd>
            </dl>
            <dl className="mt-1 flex items-center justify-between border-t border-border pt-2.5">
              <dt className="text-base font-extrabold text-foreground">Total payable</dt>
              <dd className="text-2xl font-extrabold tabular-nums text-foreground">
                {(() => {
                  // Display-only subtraction of two server values (same
                  // convention as CouponSection's estimate): the backend
                  // alone decides the final total at placement.
                  const subtotalNumber = Number(cart.subtotal);
                  const discountNumber = Number(appliedCoupon?.discountAmount ?? 0);
                  if (!Number.isFinite(subtotalNumber)) return formatINR(cart.subtotal);
                  if (!appliedCoupon?.coupon || !Number.isFinite(discountNumber)) {
                    return formatINR(cart.subtotal);
                  }
                  return formatINR((subtotalNumber - discountNumber).toFixed(2));
                })()}
              </dd>
            </dl>
          </div>
          <CouponSection disabled={placingOrder} />
          <p className="flex items-start gap-2 rounded-xl bg-surface-muted px-3.5 py-2.5 text-xs leading-5 text-muted-foreground">
            <Banknote size={15} aria-hidden="true" className="mt-0.5 shrink-0 text-accent" />
            Payment method: Cash on Delivery. Pay in cash when your order arrives — no online payment needed.
          </p>
          {!hasValidPhone || phoneServerError ? (
            <div
              role="alert"
              aria-label="Phone number required"
              className="flex flex-col gap-3 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3.5"
            >
              <p className="text-sm font-semibold text-foreground">
                A phone number is required to place your order.
              </p>
              {phoneServerError ? (
                <p className="text-xs leading-5 text-destructive">{phoneServerError}</p>
              ) : (
                <p className="-mt-1 text-xs leading-5 text-muted-foreground">
                  The courier needs it for delivery updates. Save it once — it stays on your profile for future orders.
                </p>
              )}
              <CheckoutPhoneForm onSaved={() => setPhoneServerError(null)} />
              <p className="text-xs text-muted-foreground">
                Prefer the account page?{' '}
                <Link to="/account/profile" className="font-semibold text-accent-link hover:no-underline">
                  Update it in your profile
                </Link>{' '}
                — checkout picks it up when you return.
              </p>
            </div>
          ) : null}
          <div className="flex justify-between">
            <button
              type="button"
              onClick={() => setStep(2)}
              disabled={placingOrder}
              className="inline-flex min-h-[48px] cursor-pointer items-center gap-2 rounded-xl border border-border px-5 text-sm font-semibold transition-colors duration-200 hover:bg-surface-muted disabled:opacity-60"
            >
              <ArrowLeft size={16} aria-hidden="true" />
              Back
            </button>
            <button
              type="button"
              onClick={handlePlaceOrder}
              disabled={!canPlaceOrder}
              aria-busy={placingOrder}
              className="inline-flex min-h-[48px] cursor-pointer items-center gap-2 rounded-xl bg-primary px-6 text-sm font-semibold text-primary-foreground transition-opacity duration-200 hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
            >
              {placingOrder ? 'Placing order…' : 'Place order · COD'}
            </button>
          </div>
        </section>
      ) : null}
    </Container>
  );
}
