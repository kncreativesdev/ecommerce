import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  BadgePercent,
  BellRing,
  Boxes,
  Building2,
  ChartColumn,
  FileText,
  FolderTree,
  History,
  LayoutDashboard,
  LogOut,
  Megaphone,
  Menu,
  Moon,
  Package,
  ShoppingCart,
  Star,
  Sun,
  Undo2,
  UserCog,
  Users,
  X,
  Zap,
} from 'lucide-react';
import { useAuthStore } from '../../stores/useAuthStore.js';
import { useThemeStore } from '../../stores/useThemeStore.js';
import { ADMIN_PANEL_ROLES } from '../../lib/roles.js';
import { cn } from '../../lib/cn.js';

/**
 * Admin shell: compact sidebar + top bar + content area. Desktop-first
 * with a slide-in sidebar below `lg`. Navigation lists ONLY implemented
 * sections (Dashboard, Categories, Products, Coupons, Orders, Inventory,
 * Customers, Reviews, Audit Logs, Platform Dashboard, Companies) — future
 * sections join this config as their milestones land. No fake screens.
 *
 * Per-item `roles` preserve backend authorization in the navigation:
 * operational pages stay ADMIN-only except the Phase 4-1 HEAD slice
 * (Categories, Products, Coupons, Orders, Inventory), which admits
 * ADMIN + HEAD to match the backend RBAC contract, and the Phase 4-5
 * MEMBER slice (same pages, read-only for coupons), which admits
 * ADMIN + HEAD + MEMBER;
 * Audit Logs / Audit Dashboard admit the four
 *   common admin-panel roles, matching `GET /audit-logs` (+ `/summary`
 *   — MEMBER sees self-only numbers, backend-enforced). ADMIN users
 *   see everything, exactly as before. SUPER_ADMIN-only platform pages
 *   (`Companies`, `Audit Retention`) live in the System section and are
 *   hidden from every other role. MEMBER never sees Dashboard, Returns,
 *   Customers, Reviews, Marketing, Companies, Audit Retention, or Team
 *   Members (staff management is ADMIN + HEAD only).
 */

const ADMIN_ONLY = Object.freeze(['ADMIN']);
const SUPER_ADMIN_ONLY = Object.freeze(['SUPER_ADMIN']);
// Phase 4-5 MEMBER slice (superset of the Phase 4-1 HEAD slice — same
// pages, coupons read-only for MEMBER via action gates + route split).
const OPERATIONAL_MEMBER = Object.freeze(['ADMIN', 'HEAD', 'MEMBER']);
// Phase 4-8 team member management (staff only — never customers):
// ADMIN manages HEAD/MEMBER, HEAD manages MEMBERs (backend
// `authorize("ADMIN", "HEAD")` + target guards stay authoritative).
const TEAM_MANAGERS = Object.freeze(['ADMIN', 'HEAD']);

const NAV_SECTIONS = [
  {
    label: 'Catalog',
    items: [
      { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, end: true, roles: ADMIN_ONLY },
      { to: '/catalog/categories', label: 'Categories', icon: FolderTree, end: false, roles: OPERATIONAL_MEMBER },
      { to: '/catalog/products', label: 'Products', icon: Package, end: false, roles: OPERATIONAL_MEMBER },
      { to: '/catalog/coupons', label: 'Coupons', icon: BadgePercent, end: false, roles: OPERATIONAL_MEMBER },
    ],
  },
  {
    label: 'Operations',
    items: [
      { to: '/orders', label: 'Orders', icon: ShoppingCart, end: false, roles: OPERATIONAL_MEMBER },
      { to: '/returns', label: 'Return Orders', icon: Undo2, end: false, roles: ADMIN_ONLY },
      { to: '/inventory', label: 'Inventory', icon: Boxes, end: false, roles: OPERATIONAL_MEMBER },
      { to: '/audit-logs', label: 'Audit Logs', icon: FileText, end: false, roles: ADMIN_PANEL_ROLES },
      { to: '/audit-dashboard', label: 'Audit Dashboard', icon: ChartColumn, end: false, roles: ADMIN_PANEL_ROLES },
    ],
  },
  {
    label: 'People',
    items: [
      { to: '/team', label: 'Team Members', icon: UserCog, end: false, roles: TEAM_MANAGERS },
      { to: '/customers', label: 'Customers', icon: Users, end: false, roles: ADMIN_ONLY },
      { to: '/reviews', label: 'Reviews', icon: Star, end: false, roles: ADMIN_ONLY },
    ],
  },
  {
    label: 'Marketing',
    items: [
      { to: '/marketing/notifications', label: 'Notifications', icon: Megaphone, end: false, roles: ADMIN_ONLY },
      { to: '/marketing/announcements', label: 'Announcements', icon: BellRing, end: false, roles: ADMIN_ONLY },
    ],
  },
  {
    label: 'System',
    items: [
      { to: '/platform', label: 'Platform Dashboard', icon: LayoutDashboard, end: true, roles: SUPER_ADMIN_ONLY },
      { to: '/companies', label: 'Companies', icon: Building2, end: false, roles: SUPER_ADMIN_ONLY },
      { to: '/audit-retention', label: 'Audit Retention', icon: History, end: false, roles: SUPER_ADMIN_ONLY },
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
  const roles = useAuthStore((state) => state.user?.roles);
  const visible = (item) => {
    const allowed = Array.isArray(item.roles) && item.roles.length > 0 ? item.roles : ADMIN_PANEL_ROLES;
    return Array.isArray(roles) && roles.some((role) => allowed.includes(role));
  };
  return (
    <nav aria-label="Admin" className="flex flex-col gap-4">
      {NAV_SECTIONS.map((section) => {
        const items = section.items.filter(visible);
        if (items.length === 0) return null;
        return (
          <div key={section.label}>
            <p className="px-3 pb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-sidebar-muted">
              {section.label}
            </p>
            <ul className="flex flex-col gap-0.5">
              {items.map((item) => {
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
        );
      })}
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
  const closeButtonRef = useRef(null);
  const [prevPathname, setPrevPathname] = useState(pathname);

  // Render-time reset when the route changes: the drawer must never cover
  // the page after navigation (back/forward and programmatic navigations
  // bypass the per-link close handler). Sanctioned derived-state pattern
  // used across the codebase; effects below only sync async subscriptions.
  if (prevPathname !== pathname) {
    setPrevPathname(pathname);
    setSidebarOpen(false);
  }

  // While open on tablet/mobile: Escape dismisses, the page behind stays
  // put (scroll lock), and focus moves into the drawer. All state updates
  // happen in event callbacks or cleanup — never synchronously in the body.
  useEffect(() => {
    if (!sidebarOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setSidebarOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [sidebarOpen]);

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  const sectionTitle =
    pathname.startsWith('/marketing/notifications')
      ? 'Notifications'
      : pathname.startsWith('/marketing/announcements')
        ? 'Announcements'
        : pathname.startsWith('/orders')
      ? 'Orders'
      : pathname.startsWith('/returns')
        ? 'Return Orders'
        : pathname.startsWith('/inventory')
          ? 'Inventory'
      : pathname.startsWith('/customers')
        ? 'Customers'
        : pathname.startsWith('/team')
          ? 'Team Members'
          : pathname.startsWith('/reviews')
            ? 'Reviews'
          : pathname.startsWith('/audit-logs')
            ? 'Audit Logs'
            : pathname.startsWith('/audit-dashboard')
              ? 'Audit Dashboard'
            : pathname.startsWith('/audit-retention')
              ? 'Audit Retention'
              : pathname.startsWith('/companies')
                ? 'Companies'
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

      {/* Sidebar: full panel on desktop, slide-in drawer below `lg`. The
          closed drawer is `invisible` (not merely off-canvas) so keyboard
          and assistive tech cannot reach it; `lg:visible` keeps desktop
          unaffected. Long navigation scrolls independently. */}
      <aside
        id="admin-sidebar"
        aria-label="Admin sidebar"
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col gap-5 bg-sidebar px-4 py-5 text-sidebar-foreground transition-transform duration-200 lg:sticky lg:top-0 lg:h-svh lg:translate-x-0 lg:visible',
          sidebarOpen ? 'visible translate-x-0' : 'invisible -translate-x-full',
        )}
      >
        <div className="flex items-center justify-between">
          <BrandMark onNavigate={closeSidebar} />
          <button
            type="button"
            ref={closeButtonRef}
            onClick={closeSidebar}
            aria-label="Close navigation"
            className="inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg text-sidebar-muted transition-colors hover:bg-white/10 hover:text-sidebar-foreground lg:hidden"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <SidebarNav onNavigate={closeSidebar} />
        </div>
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
            aria-expanded={sidebarOpen}
            aria-controls="admin-sidebar"
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

        <main id="admin-content" className="min-w-0 flex-1 px-3 py-4 sm:px-4 lg:px-6">
          <div className="mx-auto w-full max-w-7xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
