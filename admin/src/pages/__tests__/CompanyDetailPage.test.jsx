import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { CompanyDetailPage } from '../CompanyDetailPage.jsx';
import { useCompanyStore } from '../../stores/useCompanyStore.js';
import {
  deleteCompany,
  deleteCompanyLogo,
  fetchCompanies,
  fetchCompanyById,
  updateCompany,
  uploadCompanyLogo,
} from '../../services/company.service.js';

vi.mock('../../services/company.service.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    fetchCompanies: vi.fn(),
    fetchCompanyById: vi.fn(),
    updateCompany: vi.fn(),
    uploadCompanyLogo: vi.fn(),
    deleteCompanyLogo: vi.fn(),
    deleteCompany: vi.fn(),
  };
});

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function detailFixture(overrides = {}) {
  return {
    id: 'c1',
    name: 'Acme Store',
    status: 'ACTIVE',
    adminProvisioned: true,
    googleSignInEnabled: true,
    contactEmail: null,
    contactPhone: null,
    addressLine1: null,
    addressLine2: null,
    city: null,
    state: null,
    postalCode: null,
    country: null,
    website: null,
    logoPath: null,
    domains: [{ id: 'd1', domain: 'acme.test', isPrimary: true, isActive: true }],
    aggregates: {
      totalUsers: 4,
      totalCustomers: 2,
      totalHeads: 1,
      totalMembers: 0,
      totalProducts: 12,
      totalOrders: 7,
    },
    createdAt: '2026-03-01T10:00:00.000Z',
    updatedAt: '2026-03-02T10:00:00.000Z',
    ...overrides,
  };
}

function renderDetail(id = 'c1') {
  return render(
    <MemoryRouter initialEntries={[`/companies/${id}`]}>
      <Routes>
        <Route path="/companies" element={<div>Companies list</div>} />
        <Route path="/companies/:id" element={<CompanyDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchCompanies.mockResolvedValue({ companies: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 1 } });
  useCompanyStore.setState({ companies: [], status: 'idle', error: null, mutating: null });
});

describe('CompanyDetailPage', () => {
  it('renders permitted metadata and aggregate counts, never operational rows or secrets', async () => {
    fetchCompanyById.mockResolvedValue(detailFixture());
    renderDetail();

    expect(await screen.findByRole('heading', { name: 'Acme Store' })).toBeInTheDocument();
    expect(screen.getByText('ACTIVE')).toBeInTheDocument();
    expect(screen.getByText('Admin set')).toBeInTheDocument();
    expect(screen.getByText('acme.test')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(fetchCompanyById).toHaveBeenCalledWith('c1');
    const serialized = document.body.innerHTML;
    expect(serialized).not.toMatch(/password/i);
    expect(serialized).not.toMatch(/secret/i);
  });

  it('renders NULL profile fields as Not provided with the logo placeholder', async () => {
    fetchCompanyById.mockResolvedValue(detailFixture());
    renderDetail();

    expect(await screen.findByText('Business profile')).toBeInTheDocument();
    expect(screen.getAllByText('Not provided').length).toBeGreaterThanOrEqual(6);
    expect(screen.getByLabelText('No logo')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload logo' })).toBeInTheDocument();
  });

  it('renders populated profile fields, website link, and logo preview', async () => {
    fetchCompanyById.mockResolvedValue(
      detailFixture({
        contactEmail: 'hq@acme.test',
        contactPhone: '+1-555-0100',
        addressLine1: '1 Market Street',
        city: 'Springfield',
        state: 'IL',
        postalCode: '62701',
        country: 'USA',
        website: 'https://acme.test',
        logoPath: 'companies/c1/branding/logo.webp',
      }),
    );
    renderDetail();

    expect(await screen.findByText('hq@acme.test')).toBeInTheDocument();
    expect(screen.getByText('+1-555-0100')).toBeInTheDocument();
    expect(screen.getByText('1 Market Street')).toBeInTheDocument();
    const website = screen.getByRole('link', { name: 'https://acme.test' });
    expect(website).toHaveAttribute('href', 'https://acme.test');
    expect(screen.getByRole('img', { name: 'Acme Store logo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Replace logo' })).toBeInTheDocument();
  });

  it('shows a not-found state for unknown companies with retry', async () => {
    const user = userEvent.setup();
    fetchCompanyById.mockResolvedValueOnce(null);
    fetchCompanyById.mockResolvedValueOnce(detailFixture());
    renderDetail('missing');

    expect(await screen.findByText('Company not found')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'Acme Store' })).toBeInTheDocument();
  });

  it('surfaces forbidden responses without leaking anything', async () => {
    fetchCompanyById.mockRejectedValueOnce({ message: 'Forbidden.', code: 'AUTH_FORBIDDEN' });
    renderDetail();

    expect(await screen.findByText('Couldn’t load company')).toBeInTheDocument();
  });

  it('saves name plus profile fields through the exact PATCH contract and refreshes', async () => {
    const user = userEvent.setup();
    fetchCompanyById.mockResolvedValue(detailFixture());
    updateCompany.mockResolvedValue(detailFixture({ name: 'Acme Renamed', city: 'Shelbyville' }));
    renderDetail();

    expect(await screen.findByRole('heading', { name: 'Acme Store' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    expect(await screen.findByRole('dialog', { name: 'Edit “Acme Store”' })).toBeInTheDocument();

    await user.clear(screen.getByPlaceholderText('Acme Store'));
    await user.type(screen.getByPlaceholderText('Acme Store'), 'Acme Renamed');
    await user.type(screen.getByPlaceholderText('Springfield'), 'Shelbyville');
    await user.type(screen.getByPlaceholderText('support@acme.test'), 'hq@acme.test');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(updateCompany).toHaveBeenCalledWith('c1', {
        name: 'Acme Renamed',
        contactEmail: 'hq@acme.test',
        contactPhone: '',
        addressLine1: '',
        addressLine2: '',
        city: 'Shelbyville',
        state: '',
        postalCode: '',
        country: '',
        website: '',
      }),
    );
    expect(await screen.findByRole('heading', { name: 'Acme Renamed' })).toBeInTheDocument();
    // List mirror refreshed after the save.
    await waitFor(() => expect(fetchCompanies).toHaveBeenCalled());
  });

  it('blocks invalid email/website per field and surfaces backend errors in-dialog', async () => {
    const user = userEvent.setup();
    fetchCompanyById.mockResolvedValue(detailFixture());
    renderDetail();

    expect(await screen.findByRole('heading', { name: 'Acme Store' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Edit' }));

    await user.type(screen.getByPlaceholderText('support@acme.test'), 'not-an-email');
    await user.type(screen.getByPlaceholderText('https://acme.test'), 'http://acme.test');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Enter a valid email address.')).toBeInTheDocument();
    expect(await screen.findByText('Enter a valid HTTPS URL (https://…).')).toBeInTheDocument();
    expect(updateCompany).not.toHaveBeenCalled();

    updateCompany.mockRejectedValueOnce({ message: 'Company name is required.' });
    await user.clear(screen.getByPlaceholderText('support@acme.test'));
    await user.clear(screen.getByPlaceholderText('https://acme.test'));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Company name is required.')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Edit “Acme Store”' })).toBeInTheDocument();
  });

  it('uploads a logo file and shows the preview, rejecting bad extensions client-side', async () => {
    fetchCompanyById.mockResolvedValue(detailFixture());
    renderDetail();

    expect(await screen.findByRole('button', { name: 'Upload logo' })).toBeInTheDocument();
    uploadCompanyLogo.mockResolvedValue(detailFixture({ logoPath: 'companies/c1/branding/logo.webp' }));

    const good = new File(['pixels'], 'logo.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('Choose logo file'), { target: { files: [good] } });
    await waitFor(() => expect(uploadCompanyLogo).toHaveBeenCalledTimes(1));
    expect(uploadCompanyLogo.mock.calls[0][0]).toBe('c1');
    expect(uploadCompanyLogo.mock.calls[0][1].file).toBe(good);
    expect(await screen.findByRole('img', { name: 'Acme Store logo' })).toBeInTheDocument();

    const bad = new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' });
    fireEvent.change(screen.getByLabelText('Choose logo file'), { target: { files: [bad] } });
    expect(await screen.findByText('Only JPEG, PNG, and WebP images are allowed.')).toBeInTheDocument();
    expect(uploadCompanyLogo).toHaveBeenCalledTimes(1);
  });

  it('surfaces upload failures without breaking the page and removes with confirmation', async () => {
    const user = userEvent.setup();
    fetchCompanyById.mockResolvedValue(detailFixture({ logoPath: 'companies/c1/branding/logo.webp' }));
    renderDetail();

    expect(await screen.findByRole('img', { name: 'Acme Store logo' })).toBeInTheDocument();
    uploadCompanyLogo.mockRejectedValueOnce({ message: 'Image exceeds the maximum allowed size of 5MB.' });
    fireEvent.change(screen.getByLabelText('Choose logo file'), {
      target: { files: [new File(['x'], 'big.png', { type: 'image/png' })] },
    });
    expect(await screen.findByText('Image exceeds the maximum allowed size of 5MB.')).toBeInTheDocument();
    // Page intact after the failure.
    expect(screen.getByRole('img', { name: 'Acme Store logo' })).toBeInTheDocument();

    deleteCompanyLogo.mockResolvedValue(detailFixture({ logoPath: null }));
    await user.click(screen.getByRole('button', { name: 'Remove logo' }));
    await user.click(screen.getByRole('button', { name: 'Remove logo' }));
    await waitFor(() => expect(deleteCompanyLogo).toHaveBeenCalledWith('c1'));
    expect(await screen.findByLabelText('No logo')).toBeInTheDocument();
  });
});

describe('CompanyDetailPage permanent deletion', () => {
  it('renders a destructive Delete Company action at the bottom for SUSPENDED companies', async () => {
    fetchCompanyById.mockResolvedValue(detailFixture({ status: 'SUSPENDED' }));
    renderDetail();

    expect(await screen.findByText('Danger zone')).toBeInTheDocument();
    const action = screen.getByRole('button', { name: 'Delete Company' });
    expect(action).toBeInTheDocument();
    // Destructive styling: the danger-zone heading and action carry the
    // destructive treatment (asserted via classes, not color alone — the
    // surrounding copy states the consequences in text).
    expect(action.className).toMatch(/bg-destructive/);
    expect(screen.getByText(/cannot be undone/i)).toBeInTheDocument();
  });

  it('opens the exact-name confirmation flow and deletes through the existing service', async () => {
    const user = userEvent.setup();
    fetchCompanyById.mockResolvedValue(detailFixture({ id: 'c9', status: 'SUSPENDED' }));
    renderDetail('c9');
    expect(await screen.findByRole('button', { name: 'Delete Company' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Delete Company' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete “Acme Store” permanently?' });
    expect(within(dialog).getByText(/permanently destroys the company/i)).toBeInTheDocument();
    const confirmButton = within(dialog).getByRole('button', { name: 'Delete permanently' });
    const input = within(dialog).getByPlaceholderText('Acme Store');

    // Empty and near-miss entries keep the destructive control disabled.
    expect(confirmButton).toBeDisabled();
    await user.type(input, 'acme store');
    expect(confirmButton).toBeDisabled();
    expect(deleteCompany).not.toHaveBeenCalled();

    deleteCompany.mockResolvedValue({ id: 'c9', name: 'Acme Store' });
    await user.clear(input);
    await user.type(input, 'Acme Store');
    await user.click(confirmButton);

    await waitFor(() => expect(deleteCompany).toHaveBeenCalledWith('c9', { confirmName: 'Acme Store' }));
    expect(deleteCompany).toHaveBeenCalledTimes(1);
    // Successful deletion navigates back to the Companies list.
    expect(await screen.findByText('Companies list')).toBeInTheDocument();
  });

  it('Cancel closes the confirmation without any API traffic', async () => {
    const user = userEvent.setup();
    fetchCompanyById.mockResolvedValue(detailFixture({ status: 'SUSPENDED' }));
    renderDetail();

    await user.click(await screen.findByRole('button', { name: 'Delete Company' }));
    await screen.findByRole('dialog', { name: 'Delete “Acme Store” permanently?' });
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(deleteCompany).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('surfaces backend 4xx failures inside the dialog, which stays open', async () => {
    const user = userEvent.setup();
    fetchCompanyById.mockResolvedValue(detailFixture({ status: 'SUSPENDED' }));
    renderDetail();

    await user.click(await screen.findByRole('button', { name: 'Delete Company' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete “Acme Store” permanently?' });
    deleteCompany.mockRejectedValueOnce({ message: 'Company must be suspended before permanent deletion.' });
    await user.type(within(dialog).getByPlaceholderText('Acme Store'), 'Acme Store');
    await user.click(within(dialog).getByRole('button', { name: 'Delete permanently' }));

    expect(await within(dialog).findByText('Company must be suspended before permanent deletion.')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Delete “Acme Store” permanently?' })).toBeInTheDocument();
  });

  it('ACTIVE companies get suspend-first guidance instead of a delete action', async () => {
    fetchCompanyById.mockResolvedValue(detailFixture({ status: 'ACTIVE' }));
    renderDetail();

    expect(await screen.findByText('Danger zone')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete Company' })).not.toBeInTheDocument();
    expect(screen.getByText(/only suspended companies can be deleted/i)).toBeInTheDocument();
    expect(deleteCompany).not.toHaveBeenCalled();
  });

  it('protected Company #1 is never deletable even when SUSPENDED', async () => {
    const { PROTECTED_COMPANY_ID } = await import('../../services/company.service.js');
    fetchCompanyById.mockResolvedValue(
      detailFixture({ id: PROTECTED_COMPANY_ID, name: 'Tech Pulse', status: 'SUSPENDED' }),
    );
    renderDetail(PROTECTED_COMPANY_ID);

    expect(await screen.findByText('Danger zone')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete Company' })).not.toBeInTheDocument();
    expect(screen.getByText(/protected and cannot be deleted/i)).toBeInTheDocument();
    expect(deleteCompany).not.toHaveBeenCalled();
  });
});
