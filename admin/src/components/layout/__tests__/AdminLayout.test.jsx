import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AdminLayout } from '../AdminLayout.jsx';
import { useAuthStore } from '../../../stores/useAuthStore.js';

function renderShell(initialPath = '/dashboard') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route element={<AdminLayout />}>
          <Route path="/dashboard" element={<p>Dashboard page</p>} />
          <Route path="/orders" element={<p>Orders page</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

function sidebar() {
  return screen.getByRole('complementary', { name: 'Admin sidebar' });
}

beforeEach(() => {
  vi.clearAllMocks();
  document.body.style.overflow = '';
  useAuthStore.setState({ user: { id: 'a1', email: 'admin@example.test', roles: ['ADMIN'] } });
});

describe('AdminLayout mobile drawer', () => {
  it('opens the drawer with backdrop, expanded state, and focus inside', async () => {
    const user = userEvent.setup();
    renderShell();

    const toggle = screen.getByRole('button', { name: 'Open navigation' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(sidebar()).toHaveClass('invisible');

    await user.click(toggle);

    expect(sidebar()).not.toHaveClass('invisible');
    expect(screen.getByRole('button', { name: 'Open navigation' })).toHaveAttribute('aria-expanded', 'true');
    expect(document.body.style.overflow).toBe('hidden');
    expect(screen.getByRole('button', { name: 'Close navigation' })).toHaveFocus();
  });

  it('closes the drawer from its close button and restores scroll', async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByRole('button', { name: 'Open navigation' }));
    await user.click(screen.getByRole('button', { name: 'Close navigation' }));

    expect(sidebar()).toHaveClass('invisible');
    expect(screen.getByRole('button', { name: 'Open navigation' })).toHaveAttribute('aria-expanded', 'false');
    expect(document.body.style.overflow).toBe('');
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByRole('button', { name: 'Open navigation' }));
    expect(sidebar()).not.toHaveClass('invisible');

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(sidebar()).toHaveClass('invisible');
    expect(document.body.style.overflow).toBe('');
  });

  it('closes after selecting a navigation item and navigates', async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByRole('button', { name: 'Open navigation' }));
    const nav = screen.getByRole('navigation', { name: 'Admin' });
    await user.click(within(nav).getByRole('link', { name: 'Orders' }));

    expect(await screen.findByText('Orders page')).toBeInTheDocument();
    expect(sidebar()).toHaveClass('invisible');
  });

  it('closes on backdrop click', async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByRole('button', { name: 'Open navigation' }));
    expect(sidebar()).not.toHaveClass('invisible');

    // Backdrop is the fixed overlay behind the drawer.
    const backdrop = document.querySelector('div.fixed.inset-0.z-30');
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop);
    expect(sidebar()).toHaveClass('invisible');
  });
});

describe('AdminLayout desktop shell intact', () => {
  it('keeps the desktop sidebar classes, header, and navigation items', () => {
    renderShell();

    // Desktop presentation classes preserved (sticky full panel at lg).
    expect(sidebar().className).toMatch(/lg:sticky/);
    expect(sidebar().className).toMatch(/lg:translate-x-0/);
    expect(sidebar().className).toMatch(/lg:visible/);

    // Header, skip link, and all fourteen navigation destinations intact.
    expect(screen.getByRole('link', { name: 'Skip to main content' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Admin' });
    expect(within(nav).getAllByRole('link')).toHaveLength(14);
    expect(within(nav).getByRole('link', { name: 'Team Members' })).toHaveAttribute('href', '/team');
    expect(within(nav).getByRole('link', { name: 'Return Orders' })).toHaveAttribute('href', '/returns');
    expect(within(nav).getByRole('link', { name: 'Audit Logs' })).toHaveAttribute('href', '/audit-logs');
    expect(within(nav).getByRole('link', { name: 'Audit Dashboard' })).toHaveAttribute('href', '/audit-dashboard');
    // Company management is SUPER_ADMIN-only: ADMIN never sees it.
    expect(within(nav).queryByRole('link', { name: 'Companies' })).not.toBeInTheDocument();
    expect(screen.getByText('Dashboard page')).toBeInTheDocument();
  });

  it('preserves the active-route indication', async () => {
    renderShell('/orders');
    await waitFor(() => expect(screen.getByText('Orders page')).toBeInTheDocument());

    const nav = screen.getByRole('navigation', { name: 'Admin' });
    const ordersLink = within(nav).getByRole('link', { name: 'Orders' });
    expect(ordersLink.getAttribute('aria-current')).toBe('page');
  });
});

describe('AdminLayout role-aware navigation', () => {
  it('shows the Phase 4-5 operational slice to MEMBER (read-only coupons, no dashboard)', () => {
    useAuthStore.setState({ user: { id: 'u1', email: 'staff@example.test', roles: ['MEMBER'] } });
    renderShell();

    const nav = screen.getByRole('navigation', { name: 'Admin' });
    const links = within(nav).getAllByRole('link');
    expect(links).toHaveLength(7);
    for (const name of ['Categories', 'Products', 'Coupons', 'Orders', 'Inventory', 'Audit Logs', 'Audit Dashboard']) {
      expect(within(nav).getByRole('link', { name })).toBeInTheDocument();
    }
    for (const name of ['Dashboard', 'Return Orders', 'Customers', 'Reviews', 'Notifications', 'Announcements', 'Companies', 'Audit Retention', 'Team Members']) {
      expect(within(nav).queryByRole('link', { name })).not.toBeInTheDocument();
    }
  });

  it('shows the Phase 4-1 operational slice to HEAD, hides the rest', () => {
    useAuthStore.setState({ user: { id: 'h1', email: 'head@example.test', roles: ['HEAD'] } });
    renderShell();

    const nav = screen.getByRole('navigation', { name: 'Admin' });
    const links = within(nav).getAllByRole('link');
    expect(links).toHaveLength(8);
    for (const name of ['Categories', 'Products', 'Coupons', 'Orders', 'Inventory', 'Audit Logs', 'Audit Dashboard', 'Team Members']) {
      expect(within(nav).getByRole('link', { name })).toBeInTheDocument();
    }
    expect(within(nav).getByRole('link', { name: 'Team Members' })).toHaveAttribute('href', '/team');
    for (const name of ['Dashboard', 'Return Orders', 'Customers', 'Reviews', 'Notifications', 'Announcements', 'Companies', 'Audit Retention']) {
      expect(within(nav).queryByRole('link', { name })).not.toBeInTheDocument();
    }
  });

  it('shows every destination to ADMIN, unchanged', () => {
    useAuthStore.setState({ user: { id: 'a1', email: 'admin@example.test', roles: ['ADMIN'] } });
    renderShell();

    const nav = screen.getByRole('navigation', { name: 'Admin' });
    expect(within(nav).getAllByRole('link')).toHaveLength(14);
    expect(within(nav).getByRole('link', { name: 'Audit Logs' })).toHaveAttribute('href', '/audit-logs');
    expect(within(nav).getByRole('link', { name: 'Audit Dashboard' })).toHaveAttribute('href', '/audit-dashboard');
  });

  it('shows no destinations to CUSTOMER', () => {
    useAuthStore.setState({ user: { id: 'c1', email: 'customer@example.test', roles: ['CUSTOMER'] } });
    renderShell();

    const nav = screen.getByRole('navigation', { name: 'Admin' });
    expect(within(nav).queryAllByRole('link')).toHaveLength(0);
  });

  it('shows audit pages and Audit Retention to SUPER_ADMIN only', () => {
    useAuthStore.setState({ user: { id: 's1', email: 'super@example.test', roles: ['SUPER_ADMIN'] } });
    renderShell();

    const nav = screen.getByRole('navigation', { name: 'Admin' });
    const links = within(nav).getAllByRole('link');
    expect(links).toHaveLength(5);
    expect(within(nav).getByRole('link', { name: 'Platform Dashboard' })).toHaveAttribute('href', '/platform');
    expect(within(nav).getByRole('link', { name: 'Audit Logs' })).toHaveAttribute('href', '/audit-logs');
    expect(within(nav).getByRole('link', { name: 'Audit Dashboard' })).toHaveAttribute('href', '/audit-dashboard');
    expect(within(nav).getByRole('link', { name: 'Companies' })).toHaveAttribute('href', '/companies');
    expect(within(nav).getByRole('link', { name: 'Audit Retention' })).toHaveAttribute('href', '/audit-retention');
    expect(within(nav).queryByRole('link', { name: 'Orders' })).not.toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: 'Team Members' })).not.toBeInTheDocument();
  });

  it.each([['ADMIN'], ['HEAD'], ['MEMBER']])(
    'hides the Companies item from %s',
    (role) => {
      useAuthStore.setState({ user: { id: 'u1', email: 'staff@example.test', roles: [role] } });
      renderShell();

      const nav = screen.getByRole('navigation', { name: 'Admin' });
      expect(within(nav).queryByRole('link', { name: 'Companies' })).not.toBeInTheDocument();
      expect(within(nav).queryByRole('link', { name: 'Platform Dashboard' })).not.toBeInTheDocument();
      // The audit branches they are entitled to remain unchanged.
      expect(within(nav).queryByRole('link', { name: 'Audit Retention' })).not.toBeInTheDocument();
    },
  );
});
