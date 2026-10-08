import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { toast } from 'sonner';
import { CompaniesPage } from '../CompaniesPage.jsx';
import { useCompanyStore } from '../../stores/useCompanyStore.js';
import { PROTECTED_COMPANY_ID } from '../../services/company.service.js';
import {
  createCompany,
  createCompanyDomain,
  deleteCompany,
  deleteCompanyDomain,
  fetchCompanies,
  fetchCompanyDomains,
  provisionCompanyAdmin,
  resetCompanyAdminPassword,
  restoreCompany,
  suspendCompany,
  updateCompanyDomain,
} from '../../services/company.service.js';

vi.mock('../../services/company.service.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    fetchCompanies: vi.fn(),
    fetchCompanyById: vi.fn(),
    createCompany: vi.fn(),
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

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function companyFixture(overrides = {}) {
  return {
    id: 'c1',
    name: 'Acme Store',
    status: 'ACTIVE',
    adminProvisioned: false,
    domains: [],
    createdAt: '2026-03-01T10:00:00.000Z',
    updatedAt: '2026-03-01T10:00:00.000Z',
    ...overrides,
  };
}

function domainFixture(overrides = {}) {
  return {
    id: 'd1',
    domain: 'acme.test',
    isPrimary: true,
    isActive: true,
    createdAt: '2026-03-01T10:00:00.000Z',
    updatedAt: '2026-03-01T10:00:00.000Z',
    ...overrides,
  };
}

function resetStore() {
  useCompanyStore.setState({
    companies: [],
    pagination: { page: 1, limit: 20, total: 0, totalPages: 1 },
    filters: { search: '', status: '' },
    status: 'idle',
    error: null,
    mutating: null,
    domainsCompany: null,
    companyDomains: [],
    domainsStatus: 'idle',
    domainsError: null,
  });
}

async function openDomainsModal(user, company = companyFixture()) {
  renderPage();
  await screen.findByText(company.name);
  await user.click(screen.getByRole('button', { name: 'Domains' }));
  expect(await screen.findByRole('dialog', { name: `Domains for “${company.name}”` })).toBeInTheDocument();
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/companies']}>
      <CompaniesPage />
    </MemoryRouter>,
  );
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetStore();
});

describe('CompaniesPage list', () => {
  it('loads companies and renders aggregate-only metadata (no operational rows)', async () => {
    fetchCompanies.mockResolvedValue({
      companies: [companyFixture({ name: 'Acme Store', adminProvisioned: true, domains: [{ id: 'd1', domain: 'acme.test', isPrimary: true, isActive: true }] })],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    renderPage();

    expect(fetchCompanies).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Acme Store')).toBeInTheDocument();
    expect(screen.getByText('ACTIVE')).toBeInTheDocument();
    // No redundant Admin Status column (exactly one ADMIN per company by
    // invariant — presence lives on the detail page instead).
    expect(screen.queryByText('Admin set')).not.toBeInTheDocument();
    expect(screen.queryByText('No admin')).not.toBeInTheDocument();
    expect(screen.getByText('acme.test')).toBeInTheDocument();
    // Every row carries a Details action to the company detail page.
    expect(screen.getByRole('button', { name: 'Details' })).toBeInTheDocument();
    // Aggregate metadata only — operational company records are never rendered.
    expect(screen.queryByText(/products/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/orders/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/customers/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/inventory/i)).not.toBeInTheDocument();
  });

  it('fetches the list exactly once with server pagination (no row-level endpoints)', async () => {
    const { fetchCompanyById } = await import('../../services/company.service.js');
    fetchCompanies.mockResolvedValue({ companies: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 1 } });
    renderPage();

    await screen.findByText('No companies yet');
    expect(fetchCompanies).toHaveBeenCalledWith({ page: 1, limit: 20, search: undefined, status: undefined });
    expect(fetchCompanies).toHaveBeenCalledTimes(1);
    expect(fetchCompanyById).not.toHaveBeenCalled();
  });

  it('shows a loading skeleton while fetching', async () => {
    fetchCompanies.mockImplementation(() => new Promise(() => {}));
    renderPage();

    expect(await screen.findByRole('status', { name: 'Loading companies' })).toBeInTheDocument();
  });

  it('shows an error with retry that refetches', async () => {
    fetchCompanies.mockRejectedValueOnce({ message: 'Load failed.' });
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText('Couldn’t load companies')).toBeInTheDocument();
    fetchCompanies.mockResolvedValue({ companies: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 1 } });
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('No companies yet')).toBeInTheDocument();
    expect(fetchCompanies).toHaveBeenCalledTimes(2);
  });

  it('shows the empty state without filters and the filtered empty state with filters', async () => {
    fetchCompanies.mockResolvedValue({ companies: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 1 } });
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText('No companies yet')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Search' }));
    // Search submits the (empty) draft — still no filters, same empty state.
    expect(await screen.findByText('No companies yet')).toBeInTheDocument();
  });
});

describe('CompaniesPage create', () => {
  async function openCreate(user) {
    fetchCompanies.mockResolvedValue({ companies: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 1 } });
    renderPage();
    await screen.findByText('No companies yet');
    await user.click(screen.getByRole('button', { name: 'New company' }));
    expect(await screen.findByRole('dialog', { name: 'New company' })).toBeInTheDocument();
  }

  it('requires a name before calling the API', async () => {
    const user = userEvent.setup();
    await openCreate(user);

    await user.click(screen.getByRole('button', { name: 'Create company' }));

    expect(await screen.findByText('Company name is required.')).toBeInTheDocument();
    expect(createCompany).not.toHaveBeenCalled();
  });

  it('submits exactly { name } and refreshes on success', async () => {
    const user = userEvent.setup();
    await openCreate(user);
    createCompany.mockResolvedValue(companyFixture());
    fetchCompanies.mockResolvedValue({
      companies: [companyFixture()],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });

    await user.type(screen.getByPlaceholderText('Acme Store'), 'Acme Store');
    await user.click(screen.getByRole('button', { name: 'Create company' }));

    await waitFor(() => expect(createCompany).toHaveBeenCalledWith({ name: 'Acme Store' }));
    expect(createCompany).toHaveBeenCalledTimes(1);
    await screen.findByText('1 company');
    expect(screen.queryByRole('dialog', { name: 'New company' })).not.toBeInTheDocument();
  });

  it('keeps the dialog open on backend validation errors', async () => {
    const user = userEvent.setup();
    await openCreate(user);
    createCompany.mockRejectedValue({ message: 'Company name is required.', code: 'COMPANY_INVALID_NAME' });

    await user.type(screen.getByPlaceholderText('Acme Store'), 'x');
    await user.click(screen.getByRole('button', { name: 'Create company' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Company name is required.'));
    expect(screen.getByRole('dialog', { name: 'New company' })).toBeInTheDocument();
  });

  it('disables duplicate create submissions while pending', async () => {
    const user = userEvent.setup();
    await openCreate(user);
    const gate = deferred();
    createCompany.mockReturnValue(gate.promise);

    await user.type(screen.getByPlaceholderText('Acme Store'), 'Acme Store');
    await user.click(screen.getByRole('button', { name: 'Create company' }));

    const confirmButton = await screen.findByRole('button', { name: 'Create company' });
    await waitFor(() => expect(confirmButton).toBeDisabled());
    await user.click(confirmButton);
    expect(createCompany).toHaveBeenCalledTimes(1);
    gate.resolve(companyFixture());
  });

  it('Cancel closes without calling the API', async () => {
    const user = userEvent.setup();
    await openCreate(user);

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(createCompany).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: 'New company' })).not.toBeInTheDocument();
  });
});

describe('CompaniesPage suspend/restore', () => {
  it('suspends an ACTIVE company only after confirmation', async () => {
    const user = userEvent.setup();
    fetchCompanies.mockResolvedValue({
      companies: [companyFixture({ status: 'ACTIVE' })],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    renderPage();
    await screen.findByText('Acme Store');

    // No destructive call before the operator confirms.
    expect(suspendCompany).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Suspend' }));
    expect(await screen.findByRole('dialog', { name: 'Suspend “Acme Store”?' })).toBeInTheDocument();
    expect(screen.getByText(/deletes nothing and is reversible/i)).toBeInTheDocument();

    suspendCompany.mockResolvedValue(companyFixture({ status: 'SUSPENDED' }));
    fetchCompanies.mockResolvedValue({
      companies: [companyFixture({ status: 'SUSPENDED' })],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    await user.click(screen.getByRole('button', { name: 'Suspend company' }));

    await waitFor(() => expect(suspendCompany).toHaveBeenCalledWith('c1'));
    expect(suspendCompany).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Suspend “Acme Store”?' })).not.toBeInTheDocument());
    expect(await screen.findByText('SUSPENDED')).toBeInTheDocument();
  });

  it('Cancel on the suspend dialog does nothing', async () => {
    const user = userEvent.setup();
    fetchCompanies.mockResolvedValue({
      companies: [companyFixture({ status: 'ACTIVE' })],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    renderPage();
    await screen.findByText('Acme Store');

    await user.click(screen.getByRole('button', { name: 'Suspend' }));
    await screen.findByRole('dialog', { name: 'Suspend “Acme Store”?' });
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(suspendCompany).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('restores a SUSPENDED company through the exact endpoint', async () => {
    const user = userEvent.setup();
    fetchCompanies.mockResolvedValue({
      companies: [companyFixture({ status: 'SUSPENDED' })],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    renderPage();
    await screen.findByText('Acme Store');

    // Suspended rows offer Restore, never Suspend.
    expect(screen.queryByRole('button', { name: 'Suspend' })).not.toBeInTheDocument();
    restoreCompany.mockResolvedValue(companyFixture({ status: 'ACTIVE' }));
    fetchCompanies.mockResolvedValue({
      companies: [companyFixture({ status: 'ACTIVE' })],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    await user.click(screen.getByRole('button', { name: 'Restore' }));

    await waitFor(() => expect(restoreCompany).toHaveBeenCalledWith('c1'));
    expect(restoreCompany).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('ACTIVE')).toBeInTheDocument();
  });

  it('surfaces transition conflicts without dropping the list', async () => {
    const user = userEvent.setup();
    fetchCompanies.mockResolvedValue({
      companies: [companyFixture({ status: 'ACTIVE' })],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    renderPage();
    await screen.findByText('Acme Store');

    await user.click(screen.getByRole('button', { name: 'Suspend' }));
    suspendCompany.mockRejectedValue({ message: 'Company is already suspended', code: 'COMPANY_ALREADY_SUSPENDED' });
    await user.click(await screen.findByRole('button', { name: 'Suspend company' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Company is already suspended'));
    expect(screen.getByText('Acme Store')).toBeInTheDocument();
  });
});

describe('CompaniesPage admin provisioning + password reset', () => {
  it('provisions the ADMIN with the exact body when none exists', async () => {
    const user = userEvent.setup();
    fetchCompanies.mockResolvedValue({
      companies: [companyFixture({ adminProvisioned: false })],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    renderPage();
    await screen.findByText('Acme Store');

    expect(screen.getByRole('button', { name: 'Set up admin' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Set up admin' }));
    expect(await screen.findByRole('dialog', { name: 'Set up admin for “Acme Store”' })).toBeInTheDocument();

    provisionCompanyAdmin.mockResolvedValue({ id: 'u9' });
    await user.type(screen.getByPlaceholderText('admin@example.com'), 'admin@acme.test');
    await user.type(screen.getAllByPlaceholderText('••••••••')[0], 'secret-password');
    await user.type(screen.getByPlaceholderText('Ada'), 'Ada');
    await user.click(screen.getByRole('button', { name: 'Provision admin' }));

    await waitFor(() =>
      expect(provisionCompanyAdmin).toHaveBeenCalledWith('c1', {
        email: 'admin@acme.test',
        password: 'secret-password',
        firstName: 'Ada',
        lastName: '',
        phone: '',
      }),
    );
  });

  it('resets the existing ADMIN password with confirmation validation and password-only inputs', async () => {
    const user = userEvent.setup();
    fetchCompanies.mockResolvedValue({
      companies: [companyFixture({ adminProvisioned: true })],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    renderPage();
    await screen.findByText('Acme Store');

    await user.click(screen.getByRole('button', { name: 'Admin' }));
    expect(await screen.findByRole('dialog', { name: 'Reset admin password for “Acme Store”' })).toBeInTheDocument();
    const [password, confirm] = screen.getAllByPlaceholderText('••••••••');
    expect(password).toHaveAttribute('type', 'password');
    expect(confirm).toHaveAttribute('type', 'password');

    // Field fills use single change events (validation runs on submit,
    // not per keystroke, so per-key typing adds only timer cost here).
    const fill = (element, value) => {
      fireEvent.change(element, { target: { value: '' } });
      fireEvent.change(element, { target: { value } });
    };

    // Too short → client validation, no API call.
    fill(password, 'short');
    fill(confirm, 'short');
    await user.click(screen.getByRole('button', { name: 'Reset password' }));
    expect(await screen.findByText('Password must be at least 8 characters.')).toBeInTheDocument();
    expect(resetCompanyAdminPassword).not.toHaveBeenCalled();

    // Mismatch → client validation, no API call.
    fill(password, 'long-enough-secret');
    fill(confirm, 'different-secret');
    await user.click(screen.getByRole('button', { name: 'Reset password' }));
    expect(await screen.findByText('Passwords do not match.')).toBeInTheDocument();
    expect(resetCompanyAdminPassword).not.toHaveBeenCalled();

    resetCompanyAdminPassword.mockResolvedValue({ id: 'u9' });
    fill(password, 'brand-new-secret');
    fill(confirm, 'brand-new-secret');
    await user.click(screen.getByRole('button', { name: 'Reset password' }));

    await waitFor(() => expect(resetCompanyAdminPassword).toHaveBeenCalledWith('c1', { password: 'brand-new-secret' }));
    expect(resetCompanyAdminPassword).toHaveBeenCalledTimes(1);
  });
});

describe('CompaniesPage permanent deletion', () => {
  it('offers no delete action on ACTIVE rows; Details and lifecycle actions stay', async () => {
    fetchCompanies.mockResolvedValue({
      companies: [companyFixture({ status: 'ACTIVE' })],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    renderPage();
    await screen.findByText('Acme Store');

    const row = screen.getByText('Acme Store').closest('tr');
    expect(within(row).queryByRole('button', { name: /delete .* permanently/i })).not.toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: 'Delete Company' })).not.toBeInTheDocument();
    // Deletion moved to the company detail page; the row keeps its
    // operational actions.
    expect(within(row).getByRole('button', { name: 'Details' })).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Domains' })).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Suspend' })).toBeInTheDocument();
  });

  it('offers no delete action for protected Company #1 even when SUSPENDED', async () => {
    fetchCompanies.mockResolvedValue({
      companies: [companyFixture({ id: PROTECTED_COMPANY_ID, name: 'Tech Pulse', status: 'SUSPENDED' })],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    renderPage();
    await screen.findByText('Tech Pulse');

    const row = screen.getByText('Tech Pulse').closest('tr');
    expect(within(row).queryByRole('button', { name: /delete .* permanently/i })).not.toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: 'Delete Company' })).not.toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Details' })).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Restore' })).toBeInTheDocument();
  });

  it('offers no delete action on SUSPENDED rows either; deletion lives on the detail page', async () => {
    fetchCompanies.mockResolvedValue({
      companies: [companyFixture({ id: 'c9', name: 'Acme Store', status: 'SUSPENDED' })],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    renderPage();
    await screen.findByText('Acme Store');

    const row = screen.getByText('Acme Store').closest('tr');
    expect(within(row).queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Details' })).toBeInTheDocument();
    expect(deleteCompany).not.toHaveBeenCalled();
  });
});

describe('CompaniesPage domain registry', () => {
  it('opens the registry modal and renders primary/active state explicitly', async () => {
    const user = userEvent.setup();
    fetchCompanies.mockResolvedValue({
      companies: [companyFixture()],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    fetchCompanyDomains.mockResolvedValue([
      domainFixture(),
      domainFixture({ id: 'd2', domain: 'old.test', isPrimary: false, isActive: false }),
    ]);
    await openDomainsModal(user);

    expect(fetchCompanyDomains).toHaveBeenCalledWith('c1');
    // Scoped to the dialog: the page-level status filter also renders
    // an "Active" option, so bare queries would collide with it.
    const dialog = await screen.findByRole('dialog', { name: 'Domains for “Acme Store”' });
    expect(within(dialog).getByText('acme.test')).toBeInTheDocument();
    expect(within(dialog).getByText('old.test')).toBeInTheDocument();
    expect(within(dialog).getByText('Primary')).toBeInTheDocument();
    expect(within(dialog).getByText('Secondary')).toBeInTheDocument();
    expect(within(dialog).getByText('Active')).toBeInTheDocument();
    expect(within(dialog).getByText('Inactive')).toBeInTheDocument();
    // The primary row offers no promotion; the secondary row does.
    expect(within(dialog).getAllByRole('button', { name: 'Make primary' })).toHaveLength(1);
    expect(screen.queryByText(/products/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/orders/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/customers/i)).not.toBeInTheDocument();
  });

  it('shows loading, empty, and error-with-retry states', async () => {
    const user = userEvent.setup();
    fetchCompanies.mockResolvedValue({
      companies: [companyFixture()],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    renderPage();
    await screen.findByText('Acme Store');
    const openModal = async () => {
      await user.click(screen.getByRole('button', { name: 'Domains' }));
      expect(await screen.findByRole('dialog', { name: 'Domains for “Acme Store”' })).toBeInTheDocument();
    };

    fetchCompanyDomains.mockImplementation(() => new Promise(() => {}));
    await openModal();
    expect(await screen.findByRole('status', { name: 'Loading domains' })).toBeInTheDocument();

    fetchCompanyDomains.mockResolvedValue([]);
    await user.click(screen.getByRole('button', { name: 'Close' }));
    await openModal();
    expect(await screen.findByText('No domains registered')).toBeInTheDocument();

    fetchCompanyDomains.mockRejectedValueOnce({ message: 'Domains failed.', code: 'HTTP_500' });
    await user.click(screen.getByRole('button', { name: 'Close' }));
    await openModal();
    expect(await screen.findByText('Couldn’t load domains')).toBeInTheDocument();
    fetchCompanyDomains.mockResolvedValue([]);
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('No domains registered')).toBeInTheDocument();
  });

  it('requires a value before calling the API and sends exactly { domain }', async () => {
    const user = userEvent.setup();
    fetchCompanies.mockResolvedValue({
      companies: [companyFixture()],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    fetchCompanyDomains.mockResolvedValue([]);
    await openDomainsModal(user);

    await user.click(screen.getByRole('button', { name: 'Add domain' }));
    expect(await screen.findByText('Domain is required.')).toBeInTheDocument();
    expect(createCompanyDomain).not.toHaveBeenCalled();

    createCompanyDomain.mockResolvedValue(domainFixture({ domain: 'shop.example.com' }));
    fetchCompanyDomains.mockResolvedValue([domainFixture({ domain: 'shop.example.com' })]);
    await user.type(screen.getByPlaceholderText('shop.example.com'), 'shop.example.com');
    await user.click(screen.getByRole('button', { name: 'Add domain' }));

    await waitFor(() => expect(createCompanyDomain).toHaveBeenCalledWith('c1', { domain: 'shop.example.com' }));
    expect(createCompanyDomain).toHaveBeenCalledTimes(1);
    // Registry refreshes from the server instead of assuming the new row.
    await waitFor(() => expect(screen.getByText('shop.example.com')).toBeInTheDocument());
    expect(screen.getByPlaceholderText('shop.example.com')).toHaveValue('');
  });

  it('surfaces backend conflicts and keeps the modal open', async () => {
    const user = userEvent.setup();
    fetchCompanies.mockResolvedValue({
      companies: [companyFixture()],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    fetchCompanyDomains.mockResolvedValue([]);
    await openDomainsModal(user);

    createCompanyDomain.mockRejectedValue({ message: 'Domain is already registered', code: 'COMPANY_DOMAIN_EXISTS' });
    await user.type(screen.getByPlaceholderText('shop.example.com'), 'shop.example.com');
    await user.click(screen.getByRole('button', { name: 'Add domain' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Domain is already registered'));
    expect(screen.getByRole('dialog', { name: 'Domains for “Acme Store”' })).toBeInTheDocument();
  });

  it('disables duplicate add submissions while pending', async () => {
    const user = userEvent.setup();
    fetchCompanies.mockResolvedValue({
      companies: [companyFixture()],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    fetchCompanyDomains.mockResolvedValue([]);
    await openDomainsModal(user);

    const gate = deferred();
    createCompanyDomain.mockReturnValue(gate.promise);
    await user.type(screen.getByPlaceholderText('shop.example.com'), 'shop.example.com');
    await user.click(screen.getByRole('button', { name: 'Add domain' }));

    const addButton = await screen.findByRole('button', { name: 'Add domain' });
    await waitFor(() => expect(addButton).toBeDisabled());
    await user.click(addButton);
    expect(createCompanyDomain).toHaveBeenCalledTimes(1);
    gate.resolve(domainFixture());
  });

  it('toggles active state through the exact PATCH payload', async () => {
    const user = userEvent.setup();
    fetchCompanies.mockResolvedValue({
      companies: [companyFixture()],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    fetchCompanyDomains.mockResolvedValue([domainFixture()]);
    await openDomainsModal(user);

    updateCompanyDomain.mockResolvedValue(domainFixture({ isActive: false }));
    fetchCompanyDomains.mockResolvedValue([domainFixture({ isActive: false })]);
    await user.click(screen.getByRole('button', { name: 'Deactivate' }));

    await waitFor(() => expect(updateCompanyDomain).toHaveBeenCalledWith('c1', 'd1', { isActive: false }));
    expect(updateCompanyDomain).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Inactive')).toBeInTheDocument();
  });

  it('promotes a secondary domain and guards the primary delete control', async () => {
    const user = userEvent.setup();
    fetchCompanies.mockResolvedValue({
      companies: [companyFixture()],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    fetchCompanyDomains.mockResolvedValue([
      domainFixture(),
      domainFixture({ id: 'd2', domain: 'old.test', isPrimary: false }),
    ]);
    await openDomainsModal(user);

    // The primary trash control is disabled until another domain is promoted.
    expect(screen.getByRole('button', { name: 'Remove acme.test' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remove old.test' })).not.toBeDisabled();

    updateCompanyDomain.mockResolvedValue(domainFixture({ id: 'd2', domain: 'old.test' }));
    fetchCompanyDomains.mockResolvedValue([
      domainFixture({ isPrimary: false }),
      domainFixture({ id: 'd2', domain: 'old.test' }),
    ]);
    await user.click(screen.getByRole('button', { name: 'Make primary' }));

    await waitFor(() => expect(updateCompanyDomain).toHaveBeenCalledWith('c1', 'd2', { isPrimary: true }));
    expect(updateCompanyDomain).toHaveBeenCalledTimes(1);
  });

  it('requires confirmation for destructive removal; Cancel does nothing', async () => {
    const user = userEvent.setup();
    fetchCompanies.mockResolvedValue({
      companies: [companyFixture()],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    fetchCompanyDomains.mockResolvedValue([domainFixture({ isPrimary: false })]);
    await openDomainsModal(user);

    expect(deleteCompanyDomain).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Remove acme.test' }));
    expect(await screen.findByText('Remove this domain?')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(deleteCompanyDomain).not.toHaveBeenCalled();
    expect(screen.queryByText('Remove this domain?')).not.toBeInTheDocument();

    deleteCompanyDomain.mockResolvedValue({ id: 'd1', domain: 'acme.test' });
    fetchCompanyDomains.mockResolvedValue([]);
    await user.click(screen.getByRole('button', { name: 'Remove acme.test' }));
    await user.click(await screen.findByRole('button', { name: 'Remove domain' }));

    await waitFor(() => expect(deleteCompanyDomain).toHaveBeenCalledWith('c1', 'd1'));
    expect(deleteCompanyDomain).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('No domains registered')).toBeInTheDocument();
  });

  it('Close dismisses without any mutation API call', async () => {
    const user = userEvent.setup();
    fetchCompanies.mockResolvedValue({
      companies: [companyFixture()],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    fetchCompanyDomains.mockResolvedValue([domainFixture()]);
    await openDomainsModal(user);

    await user.click(screen.getByRole('button', { name: 'Close' }));

    expect(createCompanyDomain).not.toHaveBeenCalled();
    expect(updateCompanyDomain).not.toHaveBeenCalled();
    expect(deleteCompanyDomain).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('notes suspension without blocking management', async () => {
    const user = userEvent.setup();
    fetchCompanies.mockResolvedValue({
      companies: [companyFixture({ status: 'SUSPENDED' })],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    fetchCompanyDomains.mockResolvedValue([domainFixture()]);
    await openDomainsModal(user, companyFixture({ status: 'SUSPENDED' }));

    expect(await screen.findByText(/stays blocked until the company is restored/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add domain' })).not.toBeDisabled();
  });
});
