import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider } from 'react-router-dom';
import { router } from '../router.jsx';
import { useAuthStore } from '../../stores/useAuthStore.js';

vi.mock('../../services/return.service.js', () => ({
  fetchReturnsAdmin: vi.fn(),
  fetchReturnAdmin: vi.fn(),
}));

vi.mock('../../services/order.service.js', () => ({
  fetchOrdersAdmin: vi.fn(),
  fetchOrderAdmin: vi.fn(),
  updateOrderStatus: vi.fn(),
  bulkUpdateOrderStatus: vi.fn(),
  updateOrderPaymentStatus: vi.fn(),
}));

vi.mock('../../services/audit.service.js', () => ({
  fetchAuditLogs: vi.fn(),
  downloadAuditLogsCsv: vi.fn(),
  fetchAuditSummary: vi.fn(),
}));

vi.mock('../../services/retention.service.js', () => ({
  RETENTION_POLICIES: ['NEVER', '30_DAYS', '1_YEAR'],
  fetchRetentionPolicy: vi.fn(),
  updateRetentionPolicy: vi.fn(),
}));

vi.mock('../../services/company.service.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    isProtectedCompany: vi.fn(() => false),
    fetchCompanies: vi.fn(),
    fetchCompanyById: vi.fn(),
    fetchPlatformSummary: vi.fn(),
    createCompany: vi.fn(),
    renameCompany: vi.fn(),
    updateCompany: vi.fn(),
    uploadCompanyLogo: vi.fn(),
    deleteCompanyLogo: vi.fn(),
    suspendCompany: vi.fn(),
    restoreCompany: vi.fn(),
    provisionCompanyAdmin: vi.fn(),
    resetCompanyAdminPassword: vi.fn(),
    deleteCompany: vi.fn(),
    fetchCompanyDomains: vi.fn(),
    createCompanyDomain: vi.fn(),
    updateCompanyDomain: vi.fn(),
    deleteCompanyDomain: vi.fn(),
  };
});

vi.mock('../../services/member.service.js', () => ({
  fetchMembers: vi.fn(),
  fetchMemberById: vi.fn(),
  createMember: vi.fn(),
  updateMemberProfile: vi.fn(),
  setMemberActive: vi.fn(),
}));

// Network isolation: every page reachable through the real router must
// resolve its data from mocks — never from the live backend. An
// unmocked service fires real HTTP here; the dev backend answers 401
// for the fake test token, the apiClient refresh then fails without a
// cookie, and `handleUnauthorized` wipes the freshly-set auth state of
// the NEXT test (Sign-in landing). Mock the remaining service modules
// the same way so no render path can leak a real request.
vi.mock('../../services/dashboard.service.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, fetchDashboardSummary: vi.fn() };
});

vi.mock('../../services/category.service.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    fetchCategories: vi.fn(),
    fetchCategoryById: vi.fn(),
    createCategory: vi.fn(),
    updateCategory: vi.fn(),
    deactivateCategory: vi.fn(),
    activateCategory: vi.fn(),
    uploadCategoryImage: vi.fn(),
    deleteCategoryImage: vi.fn(),
  };
});

vi.mock('../../services/product.service.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    fetchProducts: vi.fn(),
    fetchProductById: vi.fn(),
    createProduct: vi.fn(),
    updateProduct: vi.fn(),
    deactivateProduct: vi.fn(),
    deleteProduct: vi.fn(),
    activateProduct: vi.fn(),
    createVariant: vi.fn(),
    updateVariant: vi.fn(),
    deactivateVariant: vi.fn(),
  };
});

vi.mock('../../services/customer.service.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    fetchCustomers: vi.fn(),
    fetchCustomerById: vi.fn(),
    setCustomerActive: vi.fn(),
  };
});

vi.mock('../../services/review.service.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, fetchReviewsAdmin: vi.fn() };
});

vi.mock('../../services/coupon.service.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    fetchCoupons: vi.fn(),
    fetchCouponById: vi.fn(),
    createCoupon: vi.fn(),
    updateCoupon: vi.fn(),
    deactivateCoupon: vi.fn(),
    activateCoupon: vi.fn(),
    deleteCoupon: vi.fn(),
    fetchCouponHistory: vi.fn(),
  };
});

vi.mock('../../services/inventory.service.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    fetchVariantInventory: vi.fn(),
    initializeInventory: vi.fn(),
    adjustInventory: vi.fn(),
    fetchInventoryList: vi.fn(),
    fetchInventoryTransactions: vi.fn(),
  };
});

vi.mock('../../services/marketing.service.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    fetchMarketingNotificationsAdmin: vi.fn(),
    fetchMarketingNotificationAdmin: vi.fn(),
    createMarketingNotification: vi.fn(),
    updateMarketingNotification: vi.fn(),
    setMarketingNotificationActive: vi.fn(),
    deleteMarketingNotification: vi.fn(),
  };
});

vi.mock('../../services/announcement.service.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    fetchAnnouncementsAdmin: vi.fn(),
    fetchAnnouncementAdmin: vi.fn(),
    createAnnouncement: vi.fn(),
    updateAnnouncement: vi.fn(),
    setAnnouncementActive: vi.fn(),
    deleteAnnouncement: vi.fn(),
  };
});

vi.mock('../../services/media.service.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    fetchProductImages: vi.fn(),
    uploadProductImage: vi.fn(),
    updateImageMetadata: vi.fn(),
    deleteProductImage: vi.fn(),
  };
});

vi.mock('../../services/auth.service.js', async (importOriginal) => {
  const actual = await importOriginal();
  // Deterministic auth surface: these tests drive the store directly,
  // so no code path here may reach the network. (Bootstrap
  // short-circuits on the settled states the tests install.)
  return {
    ...actual,
    loginRequest: vi.fn(),
    logoutRequest: vi.fn(),
    fetchCurrentUser: vi.fn(),
  };
});

import { fetchReturnsAdmin, fetchReturnAdmin } from '../../services/return.service.js';
import { fetchAuditLogs, fetchAuditSummary } from '../../services/audit.service.js';
import { fetchRetentionPolicy } from '../../services/retention.service.js';
import { fetchCompanies } from '../../services/company.service.js';
import { fetchMembers, fetchMemberById } from '../../services/member.service.js';
import { useAuditStore } from '../../stores/useAuditStore.js';
import { useAuditDashboardStore } from '../../stores/useAuditDashboardStore.js';
import { useRetentionStore } from '../../stores/useRetentionStore.js';
import { useCompanyStore } from '../../stores/useCompanyStore.js';
import { useMemberStore } from '../../stores/useMemberStore.js';

/**
 * Router-level regression coverage for admin route registration.
 *
 * Page tests below declare their own MemoryRouter routes, so a dropped or
 * mistyped entry in the real route table would surface as a NotFoundPage
 * 404 in production while the whole suite stays green. These tests render
 * the real `router` object so `/returns` and `/returns/:id` can never
 * silently detach from their pages again.
 */

function authenticateAdmin() {
  useAuthStore.setState({
    accessToken: 'token',
    user: { id: 'a1', email: 'admin@example.test', roles: ['ADMIN'] },
    status: 'ready',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  authenticateAdmin();
  // The audit store persists across tests in this file (shared module
  // state); reset it so each navigation mounts a fresh idle page that
  // actually fetches instead of reusing the previous test's success.
  useAuditStore.setState({
    logs: [],
    pagination: { page: 1, limit: 20, total: 0, totalPages: 1 },
    filters: { action: '', resource: '', outcome: '', role: '', actorId: '', resourceId: '', companyId: '', from: '', to: '' },
    status: 'idle',
    error: null,
    exporting: false,
  });
  useRetentionStore.setState({ retention: null, status: 'idle', error: null, saving: false });
  useAuditDashboardStore.setState({
    summary: null,
    filters: { action: '', resource: '', outcome: '', companyId: '', from: '', to: '' },
    status: 'idle',
    error: null,
  });
  useCompanyStore.setState({
    companies: [],
    pagination: { page: 1, limit: 20, total: 0, totalPages: 1 },
    filters: { search: '', status: '' },
    status: 'idle',
    error: null,
    mutating: null,
  });
  useMemberStore.setState({
    members: [],
    pagination: { page: 1, limit: 20, total: 0, totalPages: 1 },
    filters: { search: '', isActive: '', sortOrder: 'desc' },
    status: 'idle',
    error: null,
    detail: null,
    detailStatus: 'idle',
    detailError: null,
  });
});

describe('admin router return orders registration', () => {
  it('/returns resolves to ReturnsPage, not the not-found page', async () => {
    fetchReturnsAdmin.mockResolvedValue({
      returns: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 1 },
    });
    await router.navigate('/returns');
    render(<RouterProvider router={router} />);

    // Header h1 + page h2 both carry the section title.
    const headings = await screen.findAllByRole('heading', { name: 'Return Orders' });
    expect(headings).toHaveLength(2);
    expect(await screen.findByText('No return requests')).toBeInTheDocument();
    expect(screen.queryByText(/page not found/i)).not.toBeInTheDocument();
    expect(fetchReturnsAdmin).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, limit: 20 }),
    );
  });

  it('/returns/:id resolves to ReturnDetailPage with the route id', async () => {
    fetchReturnAdmin.mockResolvedValue({
      id: 'return-9',
      orderId: 'order-9',
      status: 'REQUESTED',
      reason: 'DAMAGED',
      details: null,
      createdAt: '2026-09-04T10:00:00.000Z',
      updatedAt: '2026-09-04T10:00:00.000Z',
      customer: { id: 'u9', email: 'buyer@example.test', firstName: 'Buy', lastName: 'Er', phone: '9999999999' },
      order: { id: 'order-9', orderNumber: 'ORD-2026-000009', status: 'DELIVERED', grandTotal: '100.00', createdAt: '2026-09-01T10:00:00.000Z' },
      history: [],
    });
    await router.navigate('/returns/return-9');
    render(<RouterProvider router={router} />);

    expect(await screen.findByRole('heading', { name: 'Return — ORD-2026-000009' })).toBeInTheDocument();
    expect(fetchReturnAdmin).toHaveBeenCalledWith('return-9');
    expect(screen.queryByText(/page not found/i)).not.toBeInTheDocument();
  });

  it('operations navigation reaches the registered return routes', async () => {
    const user = userEvent.setup();
    fetchReturnsAdmin.mockResolvedValue({
      returns: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 1 },
    });
    await router.navigate('/orders');
    render(<RouterProvider router={router} />);
    expect(await screen.findByRole('heading', { name: 'Orders', level: 1 })).toBeInTheDocument();

    const nav = screen.getByRole('navigation', { name: 'Admin' });
    await user.click(within(nav).getByRole('link', { name: 'Return Orders' }));
    const headings = await screen.findAllByRole('heading', { name: 'Return Orders' });
    expect(headings).toHaveLength(2);
    expect(await screen.findByText('No return requests')).toBeInTheDocument();
  });

  it('unknown paths still render the not-found page', async () => {
    await router.navigate('/no-such-admin-page');
    render(<RouterProvider router={router} />);

    expect(await screen.findByText(/page not found/i)).toBeInTheDocument();
  });
});

describe('admin router audit logs registration', () => {
  it('/audit-logs resolves to AuditLogsPage, not the not-found page', async () => {
    fetchAuditLogs.mockResolvedValue({
      logs: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 1 },
    });
    await router.navigate('/audit-logs');
    render(<RouterProvider router={router} />);

    const headings = await screen.findAllByRole('heading', { name: 'Audit Logs' });
    expect(headings).toHaveLength(2);
    expect(await screen.findByText('No audit logs yet')).toBeInTheDocument();
    expect(screen.queryByText(/page not found/i)).not.toBeInTheDocument();
    expect(fetchAuditLogs).toHaveBeenCalledWith(expect.objectContaining({ page: 1, limit: 20 }));
  });

  it('operations navigation reaches the registered audit route', async () => {
    const user = userEvent.setup();
    fetchAuditLogs.mockResolvedValue({
      logs: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 1 },
    });
    await router.navigate('/orders');
    render(<RouterProvider router={router} />);
    expect(await screen.findByRole('heading', { name: 'Orders', level: 1 })).toBeInTheDocument();

    const nav = screen.getByRole('navigation', { name: 'Admin' });
    await user.click(within(nav).getByRole('link', { name: 'Audit Logs' }));
    const headings = await screen.findAllByRole('heading', { name: 'Audit Logs' });
    expect(headings).toHaveLength(2);
    expect(await screen.findByText('No audit logs yet')).toBeInTheDocument();
  });

  it('non-admin users are redirected to login instead of the audit page', async () => {
    useAuthStore.setState({
      accessToken: 'token',
      user: { id: 'c1', email: 'customer@example.test', roles: ['CUSTOMER'] },
      status: 'ready',
    });
    await router.navigate('/audit-logs');
    render(<RouterProvider router={router} />);

    expect(await screen.findByRole('button', { name: /sign in/i })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Audit Logs' })).not.toBeInTheDocument();
    expect(fetchAuditLogs).not.toHaveBeenCalled();
  });

  it.each([['SUPER_ADMIN'], ['ADMIN'], ['HEAD'], ['MEMBER']])(
    '%s reaches /audit-logs through the common panel guard',
    async (role) => {
      useAuthStore.setState({
        accessToken: 'token',
        user: { id: 'u1', email: 'staff@example.test', roles: [role] },
        status: 'ready',
      });
      fetchAuditLogs.mockResolvedValue({
        logs: [],
        pagination: { page: 1, limit: 20, total: 0, totalPages: 1 },
      });
      await router.navigate('/audit-logs');
      render(<RouterProvider router={router} />);

      expect(await screen.findByText('No audit logs yet')).toBeInTheDocument();
      expect(screen.queryByText(/page not found/i)).not.toBeInTheDocument();
      expect(fetchAuditLogs).toHaveBeenCalled();
    },
  );

  it('HEAD reaches the Phase 4-1 operational slice', async () => {
    useAuthStore.setState({
      accessToken: 'token',
      user: { id: 'h1', email: 'head@example.test', roles: ['HEAD'] },
      status: 'ready',
    });
    await router.navigate('/orders');
    render(<RouterProvider router={router} />);

    expect(await screen.findByRole('heading', { name: 'Orders', level: 1 })).toBeInTheDocument();
    expect(screen.queryByText(/page not found/i)).not.toBeInTheDocument();
  });

  it('MEMBER reaches the Phase 4-5 operational slice (orders)', async () => {
    useAuthStore.setState({
      accessToken: 'token',
      user: { id: 'm1', email: 'member@example.test', roles: ['MEMBER'] },
      status: 'ready',
    });
    await router.navigate('/orders');
    render(<RouterProvider router={router} />);

    expect(await screen.findByRole('heading', { name: 'Orders', level: 1 })).toBeInTheDocument();
    expect(screen.queryByText(/page not found/i)).not.toBeInTheDocument();
  });

  it.each([['/dashboard'], ['/returns'], ['/customers'], ['/marketing/notifications'], ['/catalog/coupons/new']])(
    'MEMBER stays out of %s (lands on audit-logs, no loop)',
    async (path) => {
      useAuthStore.setState({
        accessToken: 'token',
        user: { id: 'm1', email: 'member@example.test', roles: ['MEMBER'] },
        status: 'ready',
      });
      fetchAuditLogs.mockResolvedValue({
        logs: [],
        pagination: { page: 1, limit: 20, total: 0, totalPages: 1 },
      });
      await router.navigate(path);
      render(<RouterProvider router={router} />);

      expect(await screen.findByText('No audit logs yet')).toBeInTheDocument();
      expect(router.state.location.pathname).toBe('/audit-logs');
    },
  );

  it.each([['/dashboard'], ['/returns'], ['/customers'], ['/marketing/notifications']])(
    'HEAD stays out of ADMIN-only %s (lands on audit-logs, no loop)',
    async (path) => {
      useAuthStore.setState({
        accessToken: 'token',
        user: { id: 'h1', email: 'head@example.test', roles: ['HEAD'] },
        status: 'ready',
      });
      fetchAuditLogs.mockResolvedValue({
        logs: [],
        pagination: { page: 1, limit: 20, total: 0, totalPages: 1 },
      });
      await router.navigate(path);
      render(<RouterProvider router={router} />);

      expect(await screen.findByText('No audit logs yet')).toBeInTheDocument();
      expect(router.state.location.pathname).toBe('/audit-logs');
    },
  );
});

describe('admin router team members registration (Phase 4-8)', () => {
  it.each([['ADMIN'], ['HEAD']])('%s reaches /team through the staff guard', async (role) => {
    useAuthStore.setState({
      accessToken: 'token',
      user: { id: 'u1', email: 'staff@example.test', roles: [role] },
      status: 'ready',
    });
    fetchMembers.mockResolvedValue({
      members: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 1 },
    });
    await router.navigate('/team');
    render(<RouterProvider router={router} />);

    // Header h1 + page h2 both carry the section title.
    const headings = await screen.findAllByRole('heading', { name: 'Team Members' });
    expect(headings).toHaveLength(2);
    expect(screen.queryByText(/page not found/i)).not.toBeInTheDocument();
    expect(fetchMembers).toHaveBeenCalled();
  });

  it('HEAD reaches /team/:id detail', async () => {
    useAuthStore.setState({
      accessToken: 'token',
      user: { id: 'h1', email: 'head@example.test', roles: ['HEAD'] },
      status: 'ready',
    });
    fetchMemberById.mockResolvedValue({
      id: 'm1',
      email: 'member@example.test',
      firstName: 'Managed',
      lastName: 'Member',
      phone: null,
      isActive: true,
      roles: ['MEMBER'],
      createdAt: '2026-09-01T10:00:00.000Z',
      updatedAt: '2026-09-01T10:00:00.000Z',
    });
    await router.navigate('/team/m1');
    render(<RouterProvider router={router} />);

    expect(await screen.findByRole('link', { name: 'Back to team members' })).toBeInTheDocument();
    expect(fetchMemberById).toHaveBeenCalledWith('m1');
    expect(screen.queryByText(/page not found/i)).not.toBeInTheDocument();
  });

  it.each([['MEMBER'], ['CUSTOMER']])('%s cannot enter /team (no loop)', async (role) => {
    useAuthStore.setState({
      accessToken: 'token',
      user: { id: 'u1', email: 'staff@example.test', roles: [role] },
      status: 'ready',
    });
    fetchAuditLogs.mockResolvedValue({
      logs: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 1 },
    });
    await router.navigate('/team');
    render(<RouterProvider router={router} />);

    expect(screen.queryByRole('heading', { name: 'Team Members' })).not.toBeInTheDocument();
    expect(fetchMembers).not.toHaveBeenCalled();
  });

  it('MEMBER deep-linking /team lands on audit-logs instead of looping', async () => {
    useAuthStore.setState({
      accessToken: 'token',
      user: { id: 'm1', email: 'member@example.test', roles: ['MEMBER'] },
      status: 'ready',
    });
    fetchAuditLogs.mockResolvedValue({
      logs: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 1 },
    });
    await router.navigate('/team');
    render(<RouterProvider router={router} />);

    expect(await screen.findByText('No audit logs yet')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/audit-logs');
  });

  it('SUPER_ADMIN cannot enter /team', async () => {
    useAuthStore.setState({
      accessToken: 'token',
      user: { id: 's1', email: 'super@example.test', roles: ['SUPER_ADMIN'] },
      status: 'ready',
    });
    await router.navigate('/team');
    render(<RouterProvider router={router} />);

    expect(screen.queryByRole('heading', { name: 'Team Members' })).not.toBeInTheDocument();
    expect(fetchMembers).not.toHaveBeenCalled();
  });

  it('team navigation is reachable from the People group for HEAD', async () => {
    const user = userEvent.setup();
    useAuthStore.setState({
      accessToken: 'token',
      user: { id: 'h1', email: 'head@example.test', roles: ['HEAD'] },
      status: 'ready',
    });
    fetchMembers.mockResolvedValue({
      members: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 1 },
    });
    fetchAuditLogs.mockResolvedValue({
      logs: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 1 },
    });
    await router.navigate('/audit-logs');
    render(<RouterProvider router={router} />);
    expect(await screen.findByRole('heading', { name: 'Audit Logs', level: 1 })).toBeInTheDocument();

    const nav = screen.getByRole('navigation', { name: 'Admin' });
    await user.click(within(nav).getByRole('link', { name: 'Team Members' }));
    const headings = await screen.findAllByRole('heading', { name: 'Team Members' });
    expect(headings).toHaveLength(2);
  });
});

describe('admin router audit retention registration', () => {
  it('SUPER_ADMIN reaches /audit-retention', async () => {
    useAuthStore.setState({
      accessToken: 'token',
      user: { id: 's1', email: 'super@example.test', roles: ['SUPER_ADMIN'] },
      status: 'ready',
    });
    fetchRetentionPolicy.mockResolvedValue({
      policy: 'NEVER',
      description: 'Audit logs are retained indefinitely.',
      updatedAt: null,
      updatedBy: null,
    });
    await router.navigate('/audit-retention');
    render(<RouterProvider router={router} />);

    // Header h1 + page h2 both carry the section title.
    const headings = await screen.findAllByRole('heading', { name: 'Audit Retention' });
    expect(headings).toHaveLength(2);
    expect(screen.queryByText(/page not found/i)).not.toBeInTheDocument();
    expect(fetchRetentionPolicy).toHaveBeenCalledTimes(1);
  });

  it.each([['ADMIN'], ['HEAD'], ['MEMBER'], ['CUSTOMER']])(
    '%s cannot enter /audit-retention',
    async (role) => {
      useAuthStore.setState({
        accessToken: 'token',
        user: { id: 'u1', email: 'staff@example.test', roles: [role] },
        status: 'ready',
      });
      await router.navigate('/audit-retention');
      render(<RouterProvider router={router} />);

      expect(screen.queryByRole('heading', { name: 'Audit Retention' })).not.toBeInTheDocument();
      expect(fetchRetentionPolicy).not.toHaveBeenCalled();
    },
  );

  it('audit-log route restrictions are unchanged by the retention branch', async () => {
    useAuthStore.setState({
      accessToken: 'token',
      user: { id: 'h1', email: 'head@example.test', roles: ['HEAD'] },
      status: 'ready',
    });
    fetchAuditLogs.mockResolvedValue({
      logs: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 1 },
    });
    await router.navigate('/audit-logs');
    render(<RouterProvider router={router} />);

    expect(await screen.findByText('No audit logs yet')).toBeInTheDocument();
  });

  it('ADMIN deep-linking the SUPER_ADMIN route lands on dashboard instead of looping', async () => {
    useAuthStore.setState({
      accessToken: 'token',
      user: { id: 'a1', email: 'admin@example.test', roles: ['ADMIN'] },
      status: 'ready',
    });
    await router.navigate('/audit-retention');
    render(<RouterProvider router={router} />);

    // Rejected at the retention guard, bounced through plain login,
    // landed on the ADMIN home: the forbidden page is never shown and
    // no login↔route ping-pong can start.
    await waitFor(() => expect(router.state.location.pathname).toBe('/dashboard'));
    expect(screen.queryByRole('heading', { name: 'Audit Retention' })).not.toBeInTheDocument();
    expect(fetchRetentionPolicy).not.toHaveBeenCalled();
  });
});

describe('admin router audit dashboard registration', () => {
  it('/audit-dashboard resolves to AuditDashboardPage, not the not-found page', async () => {
    fetchAuditSummary.mockResolvedValue({
      total: 0,
      period: { from: '2026-02-01T00:00:00.000Z', to: '2026-03-03T00:00:00.000Z' },
      byOutcome: [],
      byAction: [],
      byResource: [],
      topActors: [],
      byDay: [],
      recent: null,
    });
    await router.navigate('/audit-dashboard');
    render(<RouterProvider router={router} />);

    const headings = await screen.findAllByRole('heading', { name: 'Audit Dashboard' });
    expect(headings).toHaveLength(2);
    expect(await screen.findByText('No audit activity')).toBeInTheDocument();
    expect(screen.queryByText(/page not found/i)).not.toBeInTheDocument();
    expect(fetchAuditSummary).toHaveBeenCalledWith({});
  });

  it.each([['SUPER_ADMIN'], ['ADMIN'], ['HEAD'], ['MEMBER']])(
    '%s reaches /audit-dashboard through the common panel guard',
    async (role) => {
      useAuthStore.setState({
        accessToken: 'token',
        user: { id: 'u1', email: 'staff@example.test', roles: [role] },
        status: 'ready',
      });
      fetchAuditSummary.mockResolvedValue({
        total: 0,
        period: { from: '2026-02-01T00:00:00.000Z', to: '2026-03-03T00:00:00.000Z' },
        byOutcome: [],
        byAction: [],
        byResource: [],
        topActors: [],
        byDay: [],
        recent: null,
      });
      await router.navigate('/audit-dashboard');
      render(<RouterProvider router={router} />);

      expect(await screen.findByText('No audit activity')).toBeInTheDocument();
      expect(screen.queryByText(/page not found/i)).not.toBeInTheDocument();
      expect(fetchAuditSummary).toHaveBeenCalled();
    },
  );

  it('CUSTOMER cannot enter /audit-dashboard', async () => {
    useAuthStore.setState({
      accessToken: 'token',
      user: { id: 'c1', email: 'customer@example.test', roles: ['CUSTOMER'] },
      status: 'ready',
    });
    await router.navigate('/audit-dashboard');
    render(<RouterProvider router={router} />);

    expect(await screen.findByRole('button', { name: /sign in/i })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Audit Dashboard' })).not.toBeInTheDocument();
    expect(fetchAuditSummary).not.toHaveBeenCalled();
  });

  it('operations navigation reaches the registered dashboard route', async () => {
    const user = userEvent.setup();
    fetchAuditSummary.mockResolvedValue({
      total: 0,
      period: { from: '2026-02-01T00:00:00.000Z', to: '2026-03-03T00:00:00.000Z' },
      byOutcome: [],
      byAction: [],
      byResource: [],
      topActors: [],
      byDay: [],
      recent: null,
    });
    await router.navigate('/audit-logs');
    render(<RouterProvider router={router} />);
    expect(await screen.findByRole('heading', { name: 'Audit Logs', level: 1 })).toBeInTheDocument();

    const nav = screen.getByRole('navigation', { name: 'Admin' });
    await user.click(within(nav).getByRole('link', { name: 'Audit Dashboard' }));
    const headings = await screen.findAllByRole('heading', { name: 'Audit Dashboard' });
    expect(headings).toHaveLength(2);
    expect(await screen.findByText('No audit activity')).toBeInTheDocument();
  });
});

describe('admin router company management registration', () => {
  it('SUPER_ADMIN reaches /companies through the dedicated guard', async () => {
    useAuthStore.setState({
      accessToken: 'token',
      user: { id: 's1', email: 'super@example.test', roles: ['SUPER_ADMIN'] },
      status: 'ready',
    });
    fetchCompanies.mockResolvedValue({
      companies: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 1 },
    });
    await router.navigate('/companies');
    render(<RouterProvider router={router} />);

    // Header h1 + page h2 both carry the section title.
    const headings = await screen.findAllByRole('heading', { name: 'Companies' });
    expect(headings).toHaveLength(2);
    expect(await screen.findByText('No companies yet')).toBeInTheDocument();
    expect(screen.queryByText(/page not found/i)).not.toBeInTheDocument();
    expect(fetchCompanies).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, limit: 20 }),
    );
  });

  it.each([['ADMIN'], ['HEAD'], ['MEMBER'], ['CUSTOMER']])(
    '%s cannot enter /companies',
    async (role) => {
      useAuthStore.setState({
        accessToken: 'token',
        user: { id: 'u1', email: 'staff@example.test', roles: [role] },
        status: 'ready',
      });
      await router.navigate('/companies');
      render(<RouterProvider router={router} />);

      expect(screen.queryByRole('heading', { name: 'Companies' })).not.toBeInTheDocument();
      expect(fetchCompanies).not.toHaveBeenCalled();
    },
  );

  it('system navigation reaches the registered companies route', async () => {
    const user = userEvent.setup();
    useAuthStore.setState({
      accessToken: 'token',
      user: { id: 's1', email: 'super@example.test', roles: ['SUPER_ADMIN'] },
      status: 'ready',
    });
    fetchRetentionPolicy.mockResolvedValue({
      policy: 'NEVER',
      description: 'Audit logs are retained indefinitely.',
      updatedAt: null,
      updatedBy: null,
    });
    fetchCompanies.mockResolvedValue({
      companies: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 1 },
    });
    await router.navigate('/audit-retention');
    render(<RouterProvider router={router} />);
    expect(await screen.findByRole('heading', { name: 'Audit Retention', level: 1 })).toBeInTheDocument();

    const nav = screen.getByRole('navigation', { name: 'Admin' });
    await user.click(within(nav).getByRole('link', { name: 'Companies' }));
    const headings = await screen.findAllByRole('heading', { name: 'Companies' });
    expect(headings).toHaveLength(2);
    expect(await screen.findByText('No companies yet')).toBeInTheDocument();
  });

  it('ADMIN deep-linking the companies route lands on dashboard instead of looping', async () => {
    useAuthStore.setState({
      accessToken: 'token',
      user: { id: 'a1', email: 'admin@example.test', roles: ['ADMIN'] },
      status: 'ready',
    });
    await router.navigate('/companies');
    render(<RouterProvider router={router} />);

    // Rejected at the companies guard, bounced through plain login,
    // landed on the ADMIN home: the forbidden page is never shown and
    // no login↔route ping-pong can start.
    await waitFor(() => expect(router.state.location.pathname).toBe('/dashboard'));
    expect(screen.queryByRole('heading', { name: 'Companies' })).not.toBeInTheDocument();
    expect(fetchCompanies).not.toHaveBeenCalled();
  });

  it('company route restrictions leave the audit branches unchanged', async () => {
    useAuthStore.setState({
      accessToken: 'token',
      user: { id: 'h1', email: 'head@example.test', roles: ['HEAD'] },
      status: 'ready',
    });
    fetchAuditLogs.mockResolvedValue({
      logs: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 1 },
    });
    await router.navigate('/audit-logs');
    render(<RouterProvider router={router} />);

    expect(await screen.findByText('No audit logs yet')).toBeInTheDocument();
    expect(fetchCompanies).not.toHaveBeenCalled();
  });
});
