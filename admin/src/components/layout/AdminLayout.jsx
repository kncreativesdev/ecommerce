import { useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  BadgePercent,
  Boxes,
  FolderTree,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Package,
  ShoppingCart,
  Star,
  Sun,
  Users,
  X,
  Zap,
} from 'lucide-react';
import { useAuthStore } from '../../stores/useAuthStore.js';
import { useThemeStore } from '../../stores/useThemeStore.js';
import { cn } from '../../lib/cn.js';

/**
 * Admin shell: compact sidebar + top bar + content area. Desktop-first
 * with a slide-in sidebar below `lg`. Navigation lists ONLY implemented
 * sections (Dashboard, Categories, Products, Coupons, Orders, Inventory,
 * Customers, Reviews) — future sections (Media, Notifications, Settings)
 * join this config as their milestones land. No fake screens.
 */

const NAV_SECTIONS = [
  {
    label: 'Catalog',
    items: [
      { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, end: true },
      { to: '/catalog/categories', label: 'Categories', icon: FolderTree, end: false },
      { to: '/catalog/products', label: 'Products', icon: Package, end: false },
      { to: '/catalog/coupons', label: 'Coupons', icon: BadgePercent, end: false },
    ],
  },
  {
    label: 'Operations',
    items: [
      { to: '/orders', label: 'Orders', icon: ShoppingCart, end: false },
      { to: '/inventory', label: 'Inventory', icon: Boxes, end: false },
    ],
  },
  {
    label: 'People',
    items: [
      { to: '/customers', label: 'Customers', icon: Users, end: false },
      { to: '/reviews', label: 'Reviews', icon: Star, end: false },
    ],
  },
];

function BrandMark({ onNavigate }) {
  return (
    <Link
      to="/dashboard"
      onClick={onNavigate}
      aria-label="Tech Pulse Admin — dashboard"
      className="inline-flex items-center gap-2.5 rounded-lg px-1 py-1 hover:no-underline"
    >
      <span
        aria-hidden="true"
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-destructive text-destructive-foreground"
      >
        <Zap size={19} strokeWidth={2.5} fill="currentColor" />
      </span>
      <span className="flex flex-col leading-none">
        <span className="text-[15px] font-extrabold tracking-tight text-sidebar-foreground">
          TECH PULSE
        </span>
        <span className="mt-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-sidebar-muted">
          Admin
        </span>
      </span>
    </Link>
  );
}

function SidebarNav({ onNavigate }) {
  return (
    <nav aria-label="Admin" className="flex flex-col gap-5">
      {NAV_SECTIONS.map((section) => (
        <div key={section.label}>
          <p className="px-3 pb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-sidebar-muted">
            {section.label}
          </p>
          <ul className="flex flex-col gap-0.5">
            {section.items.map((item) => {
              const Icon = item.icon;
              return (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.end}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      cn(
                        'flex min-h-[44px] items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors duration-200 hover:no-underline',
                        isActive
                          ? 'bg-white/10 font-semibold text-sidebar-active'
                          : 'text-sidebar-muted hover:bg-white/5 hover:text-sidebar-foreground',
                      )
                    }
                  >
                    <Icon size={18} aria-hidden="true" className="shrink-0" />
                    {item.label}
                  </NavLink>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function ThemeToggleButton() {
  const resolved = useThemeStore((state) => state.resolved);
  const toggle = useThemeStore((state) => state.toggle);
  const isDark = resolved === 'dark';
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      aria-pressed={isDark}
      className="inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors duration-200 hover:bg-surface-muted hover:text-foreground"
    >
      {isDark ? <Sun size={19} aria-hidden="true" /> : <Moon size={19} aria-hidden="true" />}
    </button>
  );
}

export function AdminLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const closeSidebar = () => setSidebarOpen(false);

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  const sectionTitle =
    pathname.startsWith('/orders')
      ? 'Orders'
      : pathname.startsWith('/inventory')
        ? 'Inventory'
      : pathname.startsWith('/customers')
        ? 'Customers'
        : pathname.startsWith('/reviews')
          ? 'Reviews'
          : pathname.startsWith('/catalog/coupons')
        ? 'Coupons'
        : pathname.startsWith('/catalog/products')
          ? 'Products'
          : pathname.startsWith('/catalog/categories')
            ? 'Categories'
            : 'Dashboard';

  return (
    <div className="flex min-h-svh bg-background text-foreground">
      <a
        href="#admin-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-primary-foreground"
      >
        Skip to main content
      </a>

      {/* Mobile backdrop */}
      {sidebarOpen ? (
        <div aria-hidden="true" onClick={closeSidebar} className="fixed inset-0 z-30 bg-black/50 lg:hidden" />
      ) : null}

      {/* Sidebar */}
      <aside
        aria-label="Admin sidebar"
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col gap-6 bg-sidebar px-4 py-5 text-sidebar-foreground transition-transform duration-200 lg:sticky lg:top-0 lg:h-svh lg:translate-x-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex items-center justify-between">
          <BrandMark onNavigate={closeSidebar} />
          <button
            type="button"
            onClick={closeSidebar}
            aria-label="Close navigation"
            className="inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg text-sidebar-muted transition-colors hover:bg-white/10 hover:text-sidebar-foreground lg:hidden"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        <SidebarNav onNavigate={closeSidebar} />
        <div className="mt-auto rounded-lg bg-white/5 p-3 text-xs leading-5 text-sidebar-muted">
          Signed in as
          <p className="truncate font-semibold text-sidebar-foreground">{user?.email ?? '—'}</p>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-2 border-b border-border bg-surface px-4 sm:px-6">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open navigation"
            className="inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground lg:hidden"
          >
            <Menu size={20} aria-hidden="true" />
          </button>
          <h1 className="truncate text-base font-bold tracking-tight">{sectionTitle}</h1>
          <div className="ml-auto flex items-center gap-1">
            <ThemeToggleButton />
            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors duration-200 hover:bg-surface-muted hover:text-destructive"
            >
              <LogOut size={18} aria-hidden="true" />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        </header>

        <main id="admin-content" className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto w-full max-w-6xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
