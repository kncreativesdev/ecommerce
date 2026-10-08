import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { MembersPage } from '../MembersPage.jsx';
import { MemberDetailPage } from '../MemberDetailPage.jsx';
import { useAuthStore } from '../../stores/useAuthStore.js';
import { useMemberStore } from '../../stores/useMemberStore.js';
import { createMember, fetchMemberById, fetchMembers, setMemberActive, updateMemberProfile } from '../../services/member.service.js';

vi.mock('../../services/member.service.js', () => ({
  fetchMembers: vi.fn(),
  fetchMemberById: vi.fn(),
  createMember: vi.fn(),
  updateMemberProfile: vi.fn(),
  setMemberActive: vi.fn(),
}));

function memberFixture(overrides = {}) {
  return {
    id: 'm1',
    email: 'member@example.test',
    firstName: 'Managed',
    lastName: 'Member',
    phone: '1112223333',
    isActive: true,
    roles: ['MEMBER'],
    createdAt: '2026-09-01T10:00:00.000Z',
    updatedAt: '2026-09-01T10:00:00.000Z',
    ...overrides,
  };
}

function resetStore() {
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
}

function renderList() {
  return render(
    <MemoryRouter initialEntries={['/team']}>
      <Routes>
        <Route path="/team" element={<MembersPage />} />
        <Route path="/team/:id" element={<MemberDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

function renderDetail(id = 'm1') {
  return render(
    <MemoryRouter initialEntries={[`/team/${id}`]}>
      <Routes>
        <Route path="/team" element={<MembersPage />} />
        <Route path="/team/:id" element={<MemberDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

function asHead() {
  useAuthStore.setState({ accessToken: 'token', user: { id: 'h1', email: 'head@example.test', roles: ['HEAD'] }, status: 'ready', error: null });
}

function asAdmin() {
  useAuthStore.setState({ accessToken: 'token', user: { id: 'a1', email: 'admin@example.test', roles: ['ADMIN'] }, status: 'ready', error: null });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetStore();
  fetchMembers.mockResolvedValue({ members: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 1 } });
});

describe('MembersPage staff rendering + customer separation', () => {
  it('renders MEMBER/HEAD staff rows but never CUSTOMER, roleless, or platform rows', async () => {
    asHead();
    useMemberStore.setState({
      members: [
        memberFixture({ id: 'm1', email: 'member@example.test' }),
        memberFixture({ id: 'h2', email: 'peer@example.test', roles: ['HEAD'], firstName: 'Peer', lastName: 'Head' }),
        memberFixture({ id: 'c9', email: 'customer@example.test', roles: ['CUSTOMER'], firstName: 'Shop', lastName: 'Per' }),
        memberFixture({ id: 'r0', email: 'noroles@example.test', roles: [], firstName: 'No', lastName: 'Roles' }),
        memberFixture({ id: 's0', email: 'super@example.test', roles: ['SUPER_ADMIN'], firstName: 'Super', lastName: 'Admin' }),
      ],
      status: 'success',
      error: null,
    });
    renderList();
    await screen.findByText('member@example.test');
    expect(screen.getByText('peer@example.test')).toBeInTheDocument();
    expect(screen.queryByText('customer@example.test')).not.toBeInTheDocument();
    expect(screen.queryByText('noroles@example.test')).not.toBeInTheDocument();
    expect(screen.queryByText('super@example.test')).not.toBeInTheDocument();
  });

  it('fetches through the documented company-scoped query with no companyId', async () => {
    asHead();
    fetchMembers.mockResolvedValue({ members: [memberFixture()], pagination: { page: 1, limit: 20, total: 1, totalPages: 1 } });
    renderList();
    await screen.findByText('member@example.test');
    expect(fetchMembers).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, limit: 20, sortBy: 'createdAt', sortOrder: 'desc' }),
    );
    const sent = JSON.stringify(fetchMembers.mock.calls[0][0]).toLowerCase();
    expect(sent).not.toContain('companyid');
  });
});

describe('MembersPage HEAD create (Phase 4-8)', () => {
  it('offers create with the role fixed to MEMBER and no privileged selection', async () => {
    const user = userEvent.setup();
    asHead();
    useMemberStore.setState({ members: [memberFixture()], status: 'success', error: null });
    renderList();
    await screen.findByText('member@example.test');

    await user.click(screen.getByRole('button', { name: 'Add Member' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add Team Member' });
    expect(within(dialog).queryByRole('combobox')).not.toBeInTheDocument();
    expect(within(dialog).getByText(/New account joins as/)).toBeInTheDocument();
  });

  it('submits the backend provisioning shape with role MEMBER and no companyId', async () => {
    const user = userEvent.setup();
    asHead();
    createMember.mockResolvedValue(memberFixture({ id: 'm9', email: 'new@example.test' }));
    useMemberStore.setState({ members: [memberFixture()], status: 'success', error: null });
    renderList();
    await screen.findByText('member@example.test');

    await user.click(screen.getByRole('button', { name: 'Add Member' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add Team Member' });
    await user.type(within(dialog).getByPlaceholderText('e.g. member@example.com'), 'new@example.test');
    const secrets = within(dialog).getAllByPlaceholderText('••••••••');
    await user.type(secrets[0], 'Secret123!');
    await user.type(secrets[1], 'Secret123!');
    await user.type(within(dialog).getByPlaceholderText('e.g. Ada'), 'New');
    await user.click(within(dialog).getByRole('button', { name: 'Create team member' }));

    await waitFor(() => expect(createMember).toHaveBeenCalled());
    const payload = createMember.mock.calls[0][0];
    expect(payload).toMatchObject({ email: 'new@example.test', password: 'Secret123!', firstName: 'New', role: 'MEMBER' });
    expect(payload).not.toHaveProperty('companyId');
    expect(payload).not.toHaveProperty('confirmPassword');
  });

  it('ADMIN sees a HEAD|MEMBER role choice and can provision a HEAD', async () => {
    const user = userEvent.setup();
    asAdmin();
    createMember.mockResolvedValue(memberFixture({ id: 'h9', email: 'head9@example.test', roles: ['HEAD'] }));
    useMemberStore.setState({ members: [memberFixture()], status: 'success', error: null });
    renderList();
    await screen.findByText('member@example.test');

    await user.click(screen.getByRole('button', { name: 'Add Member' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add Team Member' });
    const roleSelect = within(dialog).getByRole('combobox');
    await user.selectOptions(roleSelect, 'HEAD');
    await user.type(within(dialog).getByPlaceholderText('e.g. member@example.com'), 'head9@example.test');
    const secrets = within(dialog).getAllByPlaceholderText('••••••••');
    await user.type(secrets[0], 'Secret123!');
    await user.type(secrets[1], 'Secret123!');
    await user.type(within(dialog).getByPlaceholderText('e.g. Ada'), 'Head');
    await user.click(within(dialog).getByRole('button', { name: 'Create team member' }));

    await waitFor(() => expect(createMember).toHaveBeenCalled());
    expect(createMember.mock.calls[0][0]).toMatchObject({ role: 'HEAD' });
  });

  it('maps duplicate emails to the email field', async () => {
    const user = userEvent.setup();
    asHead();
    createMember.mockRejectedValue({ code: 'USER_EMAIL_EXISTS', message: 'Email is already registered' });
    useMemberStore.setState({ members: [memberFixture()], status: 'success', error: null });
    renderList();
    await screen.findByText('member@example.test');

    await user.click(screen.getByRole('button', { name: 'Add Member' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add Team Member' });
    await user.type(within(dialog).getByPlaceholderText('e.g. member@example.com'), 'taken@example.test');
    const secrets = within(dialog).getAllByPlaceholderText('••••••••');
    await user.type(secrets[0], 'Secret123!');
    await user.type(secrets[1], 'Secret123!');
    await user.type(within(dialog).getByPlaceholderText('e.g. Ada'), 'Taken');
    await user.click(within(dialog).getByRole('button', { name: 'Create team member' }));

    expect(await within(dialog).findByText('This email is already registered.')).toBeInTheDocument();
    expect(createMember).toHaveBeenCalledTimes(1);
  });
});

describe('MembersPage edit + lifecycle target rules', () => {
  it('HEAD edits MEMBER rows with profile fields only (no role control)', async () => {
    const user = userEvent.setup();
    asHead();
    updateMemberProfile.mockResolvedValue(memberFixture({ firstName: 'Renamed' }));
    useMemberStore.setState({ members: [memberFixture()], status: 'success', error: null });
    renderList();
    await screen.findByText('member@example.test');

    await user.click(screen.getByRole('button', { name: 'Edit Managed Member' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit “Managed Member”' });
    // No identity/escalation surface: no role, email, password, or
    // active-state control exists anywhere in the edit form.
    expect(within(dialog).queryByRole('combobox')).not.toBeInTheDocument();
    expect(within(dialog).queryByDisplayValue('member@example.test')).not.toBeInTheDocument();
    await user.clear(within(dialog).getByPlaceholderText('e.g. Ada'));
    await user.type(within(dialog).getByPlaceholderText('e.g. Ada'), 'Renamed');
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(updateMemberProfile).toHaveBeenCalled());
    const [id, payload] = updateMemberProfile.mock.calls[0];
    expect(id).toBe('m1');
    // Full documented profile subset (unchanged values resubmitted, like
    // the category/product forms) — never identity or escalation fields.
    expect(payload).toEqual({ firstName: 'Renamed', lastName: 'Member', phone: '1112223333' });
    expect(payload).not.toHaveProperty('role');
    expect(payload).not.toHaveProperty('email');
    expect(payload).not.toHaveProperty('password');
    expect(payload).not.toHaveProperty('isActive');
    expect(payload).not.toHaveProperty('companyId');
  });

  it('HEAD deactivates and reactivates MEMBER rows', async () => {
    const user = userEvent.setup();
    asHead();
    setMemberActive.mockResolvedValue(memberFixture({ isActive: false }));
    useMemberStore.setState({ members: [memberFixture()], status: 'success', error: null });
    renderList();
    await screen.findByText('member@example.test');

    await user.click(screen.getByRole('button', { name: 'Deactivate Managed Member' }));
    await screen.findByRole('dialog', { name: 'Deactivate “Managed Member”?' });
    await user.click(screen.getByRole('button', { name: 'Yes, deactivate' }));
    await waitFor(() => expect(setMemberActive).toHaveBeenCalledWith('m1', false));

    setMemberActive.mockResolvedValue(memberFixture({ isActive: true }));
    useMemberStore.setState({
      members: [memberFixture({ isActive: false })],
      status: 'success',
      error: null,
    });
    await user.click(screen.getByRole('button', { name: 'Reactivate Managed Member' }));
    await waitFor(() => expect(setMemberActive).toHaveBeenCalledWith('m1', true));
  });

  it('ADMIN sees lifecycle (no edit) for HEAD rows and nothing for ADMIN/self rows', async () => {
    asAdmin();
    useMemberStore.setState({
      members: [
        memberFixture({ id: 'h2', email: 'peer@example.test', roles: ['HEAD'], firstName: 'Peer', lastName: 'Head' }),
        memberFixture({ id: 'a1', email: 'admin@example.test', roles: ['ADMIN'], firstName: 'Root', lastName: 'Admin' }),
        memberFixture(),
      ],
      status: 'success',
      error: null,
    });
    renderList();
    await screen.findByText('member@example.test');

    expect(screen.queryByRole('button', { name: 'Edit Peer Head' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deactivate Peer Head' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Root Admin/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit Managed Member' })).toBeInTheDocument();
  });
});

describe('MemberDetailPage target safety', () => {
  it('renders a MEMBER profile with edit + lifecycle for HEAD', async () => {
    asHead();
    useMemberStore.setState({
      members: [],
      status: 'success',
      error: null,
      detail: memberFixture(),
      detailStatus: 'success',
      detailError: null,
    });
    fetchMemberById.mockResolvedValue(memberFixture());
    renderDetail();
    // Email renders twice (header description + profile row).
    expect(await screen.findAllByText('member@example.test')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deactivate' })).toBeInTheDocument();
  });

  it('renders neutral not-found for out-of-scope targets', async () => {
    asHead();
    fetchMemberById.mockRejectedValue({ status: 404, code: 'USER_NOT_FOUND', message: 'User not found' });
    useMemberStore.setState({
      members: [],
      status: 'success',
      error: null,
      detail: null,
      detailStatus: 'error',
      detailError: { status: 404, code: 'USER_NOT_FOUND', message: 'User not found' },
    });
    renderDetail('ghost-id');
    expect(await screen.findByText('Team member not found')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Deactivate' })).not.toBeInTheDocument();
  });

  it('never presents a CUSTOMER record as a team member (ADMIN direct id)', async () => {
    asAdmin();
    fetchMemberById.mockResolvedValue(memberFixture({ id: 'c9', email: 'customer@example.test', roles: ['CUSTOMER'] }));
    useMemberStore.setState({
      members: [],
      status: 'success',
      error: null,
      detail: memberFixture({ id: 'c9', email: 'customer@example.test', roles: ['CUSTOMER'] }),
      detailStatus: 'success',
      detailError: null,
    });
    renderDetail('c9');
    await screen.findByText('Back to team members');
    expect(screen.queryByText('customer@example.test')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
  });
});
