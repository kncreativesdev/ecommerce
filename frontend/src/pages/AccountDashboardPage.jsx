import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Heart, LogOut, MapPin, Package, Star, UserRound } from 'lucide-react';
import { Container } from '../components/ui/Container.jsx';
import { Breadcrumbs } from '../components/layout/Breadcrumbs.jsx';
import { useSession } from '../hooks/useSession.js';
import { useWishlistStore } from '../stores/useWishlistStore.js';
import { fetchAddresses } from '../services/addresses.service.js';
import { fetchOrders } from '../services/orders.service.js';

/**
 * Account dashboard (`/account`, protected): greeting + hub cards linking
 * to profile/addresses/orders/reviews, with live summaries (orders count,
 * wishlist count, default address). Per-card failures degrade to dashes —
 * the hub never breaks.
 */
export function AccountDashboardPage() {
  const { user, signOut } = useSession();
  const wishlistCount = useWishlistStore((state) => state.wishlist.itemCount);
  const [ordersCount, setOrdersCount] = useState(null);
  const [defaultAddressLabel, setDefaultAddressLabel] = useState(null);

  useEffect(() => {
    document.title = 'My Account — Tech Pulse';
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchOrders()
      .then((orders) => {
        if (!cancelled) setOrdersCount(orders.length);
      })
      .catch(() => {
        if (!cancelled) setOrdersCount(null);
      });
    fetchAddresses()
      .then((addresses) => {
        if (cancelled) return;
        const preferred = addresses.find((address) => address.isDefault) ?? addresses[0] ?? null;
        setDefaultAddressLabel(
          preferred
            ? `${preferred.city ?? ''}${preferred.city && preferred.state ? ', ' : ''}${preferred.state ?? ''}`.trim() ||
                preferred.fullName
            : null,
        );
      })
      .catch(() => {
        if (!cancelled) setDefaultAddressLabel(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const firstName = user?.firstName?.trim();
  const greeting = firstName ? `Hi, ${firstName}` : 'Hi there';

  const cards = [
    {
      to: '/account/profile',
      icon: UserRound,
      title: 'Profile',
      summary: user?.email ?? '—',
    },
    {
      to: '/account/addresses',
      icon: MapPin,
      title: 'Addresses',
      summary: defaultAddressLabel ?? 'No addresses yet',
    },
    {
      to: '/account/orders',
      icon: Package,
      title: 'Orders',
      summary: ordersCount === null ? '—' : `${ordersCount} ${ordersCount === 1 ? 'order' : 'orders'}`,
    },
    {
      to: '/wishlist',
      icon: Heart,
      title: 'Wishlist',
      summary: `${wishlistCount} saved`,
    },
    {
      to: '/account/reviews',
      icon: Star,
      title: 'My reviews',
      summary: 'Purchased items',
    },
    {
      to: '/cart',
      icon: Package,
      title: 'Cart',
      summary: 'Review and checkout',
    },
  ];

  return (
    <Container className="flex flex-col gap-6 py-10 sm:py-14">
      <Breadcrumbs items={[{ label: 'Home', to: '/' }, { label: 'My Account' }]} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{greeting}</h1>
          <p className="mt-1 text-sm text-muted-foreground">Manage your profile, addresses, orders, and reviews.</p>
        </div>
        <button
          type="button"
          onClick={signOut}
          className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-xl border border-border bg-surface px-4 text-sm font-semibold text-secondary-foreground transition-colors duration-200 hover:bg-surface-muted"
        >
          <LogOut size={16} aria-hidden="true" />
          Sign out
        </button>
      </div>

      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((card) => (
          <li key={card.to + card.title}>
            <Link
              to={card.to}
              className="group flex items-center gap-4 rounded-2xl border border-border bg-card p-5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:no-underline"
            >
              <span aria-hidden="true" className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-surface-muted text-accent">
                <card.icon size={22} />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-bold text-foreground">{card.title}</span>
                <span className="block truncate text-[13px] text-muted-foreground">{card.summary}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Container>
  );
}
