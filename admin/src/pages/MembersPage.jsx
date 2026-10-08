import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Eye, Pencil, Power, RotateCcw, Search, UserPlus, Users, X } from 'lucide-react';
import { toast } from 'sonner';
import { useAuthStore } from '../stores/useAuthStore.js';
import { useMemberStore } from '../stores/useMemberStore.js';
import { createMember, updateMemberProfile } from '../services/member.service.js';
import { isHeadRow, isMemberOnlyRow, isStaffRow, memberDisplayName } from '../utils/memberDisplay.js';
import { Badge } from '../components/ui/Badge.jsx';
import { Button } from '../components/ui/Button.jsx';
import { EmptyState } from '../components/ui/EmptyState.jsx';
import { ErrorState } from '../components/ui/ErrorState.jsx';
import { PageHeader } from '../components/ui/PageHeader.jsx';
import { Table } from '../components/ui/Table.jsx';
import { Modal } from '../components/ui/Modal.jsx';
import { Pagination } from '../components/ui/Pagination.jsx';
import { MemberCreateForm } from '../components/members/MemberCreateForm.jsx';
import { MemberEditForm } from '../components/members/MemberEditForm.jsx';
import { formatDate } from '../lib/format.js';

/**
 * Team Members (`/team`): company staff management for ADMIN + HEAD,
 * via `GET /users` (HEAD callers receive MEMBER rows only,
 * backend-forced; ADMIN receives the company list and this page renders
 * staff rows only — CUSTOMER records are never presented as team
 * members). Filtering/sorting/pagination are SERVER-driven — every
 * control maps to a documented query param
 * (`search/isActive/sortOrder`); the store refetches on each change.
 * No companyId is ever sent (the authenticated context owns tenancy).
 *
 * Target rules (backend `canManageRole` stays authoritative):
 * - MEMBER rows: Edit (managed profile) + Deactivate/Reactivate.
 * - HEAD rows: Deactivate/Reactivate for ADMIN viewers only, never Edit
 *   (the profile endpoint is MEMBER-targets-only).
 * - ADMIN rows and the viewer's own row: no actions (self-deactivation
 *   is a backend `409`; ADMIN profiles have no managed-edit endpoint).
 */
const MEMBER_COLUMNS = [
  { key: 'member', label: 'Member' },
  { key: 'contact', label: 'Contact' },
  { key: 'role', label: 'Role' },
  { key: 'status', label: 'Status' },
  { key: 'joined', label: 'Joined' },
  { key: 'actions', label: 'Actions', numeric: true },
];

const selectClass =
  'min-h-[44px] cursor-pointer rounded-lg border border-input bg-surface px-3 text-sm text-foreground transition-colors focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30';

function roleTone(member) {
  if (isMemberOnlyRow(member)) return 'info';
  if (isHeadRow(member)) return 'warning';
  return 'neutral';
}

function roleLabel(member) {
  if (isMemberOnlyRow(member)) return 'Member';
  if (isHeadRow(member)) return 'Head';
  if (Array.isArray(member?.roles) && member.roles.includes('ADMIN')) return 'Admin';
  return '—';
}

export function MembersPage() {
  const user = useAuthStore((state) => state.user);
  const isAdmin = useAuthStore((state) => state.isAdmin());
  const members = useMemberStore((state) => state.members);
  const pagination = useMemberStore((state) => state.pagination);
  const filters = useMemberStore((state) => state.filters);
  const status = useMemberStore((state) => state.status);
  const error = useMemberStore((state) => state.error);
  const refreshMembers = useMemberStore((state) => state.refreshMembers);
  const setPage = useMemberStore((state) => state.setPage);
  const clearFilters = useMemberStore((state) => state.clearFilters);
  const ensureMembers = useMemberStore((state) => state.ensureMembers);
  const syncMember = useMemberStore((state) => state.syncMember);
  const setActive = useMemberStore((state) => state.setActive);

  const [searchDraft, setSearchDraft] = useState(filters.search ?? '');
  const [formState, setFormState] = useState(null); // null | { mode: 'create' } | { mode: 'edit', member }
  const [deactivating, setDeactivating] = useState(null); // member | null
  const [saving, setSaving] = useState(false);
  const [confirmingLifecycle, setConfirmingLifecycle] = useState(false);
  const [activatingId, setActivatingId] = useState(null);

  useEffect(() => {
    document.title = 'Team Members — Tech Pulse Admin';
    ensureMembers();
  }, [ensureMembers]);

  const isLoading = status === 'idle' || status === 'loading';
  const hasActiveFilters = Boolean(filters.search || filters.isActive);
  // Staff presentation scope: CUSTOMER/roleless/platform rows never
  // render as team members (HEAD responses cannot contain them —
  // backend-forced MEMBER scope; ADMIN responses may).
  const staff = members.filter(isStaffRow);

  const canEditRow = (member) => isMemberOnlyRow(member);
  const canLifecycleRow = (member) => {
    if (!member?.id || member.id === user?.id) return false;
    if (isMemberOnlyRow(member)) return true;
    return isAdmin && isHeadRow(member);
  };

  const applySearch = () => {
    refreshMembers({ filters: { ...filters, search: searchDraft.trim() } });
  };

  const handleClearAll = () => {
    setSearchDraft('');
    clearFilters();
  };

  const handleFilterChange = (patch) => {
    refreshMembers({ filters: { ...filters, ...patch } });
  };

  const closeForm = () => {
    if (!saving && !confirmingLifecycle) setFormState(null);
  };

  const handleCreate = async (payload) => {
    setSaving(true);
    try {
      const record = await createMember(payload);
      toast.success(`“${memberDisplayName(record)}” joined as ${payload.role === 'HEAD' ? 'Head' : 'Member'}.`);
      setFormState(null);
      await refreshMembers();
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = async (payload) => {
    if (!formState?.member?.id) return;
    setSaving(true);
    try {
      const record = await updateMemberProfile(formState.member.id, payload);
      if (record?.id) syncMember(record);
      toast.success(`“${memberDisplayName(record ?? formState.member)}” saved.`);
      setFormState(null);
      await refreshMembers();
    } finally {
      setSaving(false);
    }
  };

  const handleActivate = async (member) => {
    if (!member?.id || activatingId) return;
    setActivatingId(member.id);
    try {
      await setActive(member.id, true);
      toast.success(`“${memberDisplayName(member)}” reactivated.`);
    } catch (error) {
      toast.error(error?.message ?? 'Reactivation failed. Please try again.');
    } finally {
      setActivatingId(null);
    }
  };

  const handleDeactivate = async () => {
    if (!deactivating?.id) return;
    setConfirmingLifecycle(true);
    try {
      await setActive(deactivating.id, false);
      toast.success(`“${memberDisplayName(deactivating)}” deactivated — they cannot sign in until reactivated.`);
      setDeactivating(null);
    } catch (error) {
      toast.error(error?.message ?? 'Deactivation failed. Please try again.');
    } finally {
      setConfirmingLifecycle(false);
    }
  };

  const meta = isLoading
    ? 'Loading team members…'
    : `${staff.length} team ${staff.length === 1 ? 'member' : 'members'} on this page`;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Team Members"
        description="Company staff only — customers are managed under Customers."
        meta={meta}
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={() => refreshMembers()} disabled={isLoading}>
              Refresh
            </Button>
            <Button size="sm" onClick={() => setFormState({ mode: 'create' })} disabled={isLoading}>
              <UserPlus size={16} aria-hidden="true" />
              Add Member
            </Button>
          </>
        }
      />

      {!isLoading && !error && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="member-status-filter" className="sr-only">
              Filter by account status
            </label>
            <select
              id="member-status-filter"
              value={filters.isActive}
              onChange={(event) => handleFilterChange({ isActive: event.target.value })}
              className={selectClass}
            >
              <option value="">All statuses</option>
              <option value="true">Active</option>
              <option value="false">Deactivated</option>
            </select>
            <label htmlFor="member-sort" className="sr-only">
              Sort team members
            </label>
            <select
              id="member-sort"
              value={filters.sortOrder}
              onChange={(event) => handleFilterChange({ sortOrder: event.target.value })}
              className={selectClass}
            >
              <option value="desc">Newest first</option>
              <option value="asc">Oldest first</option>
            </select>
          </div>
          <div role="search" className="relative w-full sm:max-w-md">
            <label htmlFor="member-search" className="sr-only">
              Search team members by email or name
            </label>
            <Search size={17} aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              id="member-search"
              type="search"
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') applySearch();
              }}
              placeholder="Search email, first or last name… (Enter to apply)"
              autoComplete="off"
              className="min-h-[44px] w-full rounded-lg border border-input bg-surface pl-10 pr-10 text-sm text-foreground placeholder:text-muted-foreground transition-colors duration-200 focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30 hover:border-border-strong"
            />
            {searchDraft ? (
              <button
                type="button"
                onClick={() => {
                  setSearchDraft('');
                  refreshMembers({ filters: { ...filters, search: '' } });
                }}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 inline-flex h-9 w-9 -translate-y-1/2 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
              >
                <X size={16} aria-hidden="true" />
              </button>
            ) : null}
          </div>
          {hasActiveFilters ? (
            <button
              type="button"
              onClick={handleClearAll}
              className="inline-flex min-h-[44px] cursor-pointer items-center self-start rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
            >
              Clear filters
            </button>
          ) : null}
        </div>
      )}

      {isLoading ? (
        <div role="status" aria-label="Loading team members" className="flex flex-col gap-2">
          {[0, 1, 2, 3].map((index) => (
            <div key={index} aria-hidden="true" className="h-16 animate-pulse rounded-lg bg-surface-muted" />
          ))}
        </div>
      ) : error ? (
        <ErrorState title="Couldn’t load team members" message={error.message} onRetry={() => refreshMembers()} />
      ) : staff.length === 0 ? (
        <EmptyState
          icon={Users}
          title={hasActiveFilters ? 'No team members match' : 'No team members yet'}
          message={
            hasActiveFilters
              ? 'Nothing matches the current filters. Adjust or clear them to see more staff.'
              : 'Add the first team member. They sign in with their email and password.'
          }
        />
      ) : (
        <>
          <Table caption="Company team members" columns={MEMBER_COLUMNS} minWidth="min-w-[840px]">
            {staff.map((member) => (
              <tr key={member.id} className="transition-colors hover:bg-surface-muted/50">
                <td className="px-4 py-3">
                  <p className="font-semibold text-foreground">{memberDisplayName(member)}</p>
                  <p className="truncate text-xs text-muted-foreground">{member.email}</p>
                </td>
                <td className="px-4 py-3 text-muted-foreground">{member.phone ?? '—'}</td>
                <td className="px-4 py-3">
                  <Badge tone={roleTone(member)}>{roleLabel(member)}</Badge>
                </td>
                <td className="px-4 py-3">
                  <Badge tone={member.isActive ? 'success' : 'neutral'}>
                    {member.isActive ? 'Active' : 'Deactivated'}
                  </Badge>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{formatDate(member.createdAt)}</td>
                <td className="px-4 py-3 text-right">
                  <span className="inline-flex items-center justify-end gap-1">
                    <Link
                      to={`/team/${member.id}`}
                      aria-label={`View ${memberDisplayName(member)}`}
                      title={`View ${memberDisplayName(member)}`}
                      className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground hover:no-underline"
                    >
                      <Eye size={17} aria-hidden="true" />
                    </Link>
                    {canEditRow(member) ? (
                      <button
                        type="button"
                        onClick={() => setFormState({ mode: 'edit', member })}
                        aria-label={`Edit ${memberDisplayName(member)}`}
                        title={`Edit ${memberDisplayName(member)}`}
                        className="inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
                      >
                        <Pencil size={17} aria-hidden="true" />
                      </button>
                    ) : null}
                    {canLifecycleRow(member) ? (
                      member.isActive ? (
                        <button
                          type="button"
                          onClick={() => setDeactivating(member)}
                          aria-label={`Deactivate ${memberDisplayName(member)}`}
                          title={`Deactivate ${memberDisplayName(member)}`}
                          className="inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                        >
                          <Power size={17} aria-hidden="true" />
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleActivate(member)}
                          disabled={activatingId === member.id}
                          aria-label={`Reactivate ${memberDisplayName(member)}`}
                          title={`Reactivate ${memberDisplayName(member)}`}
                          className="inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-success/10 hover:text-success disabled:cursor-wait disabled:opacity-60"
                        >
                          <RotateCcw size={17} aria-hidden="true" />
                        </button>
                      )
                    ) : null}
                  </span>
                </td>
              </tr>
            ))}
          </Table>
          {/* Server totals drive page navigation (HEAD responses are
              MEMBER-exact; ADMIN totals may include non-staff company rows
              that never render above — the header meta counts only the
              staff rows shown). */}
          <Pagination
            page={pagination.page}
            totalPages={pagination.totalPages}
            totalItems={pagination.total}
            pageSize={pagination.limit}
            itemLabel={pagination.total === 1 ? 'member' : 'members'}
            onPageChange={setPage}
          />
        </>
      )}

      {formState?.mode === 'create' ? (
        <Modal title="Add Team Member" onClose={closeForm} persistent={saving}>
          <MemberCreateForm allowRoleChoice={isAdmin} onSubmit={handleCreate} submitting={saving} />
        </Modal>
      ) : null}

      {formState?.mode === 'edit' && formState.member ? (
        <Modal title={`Edit “${memberDisplayName(formState.member)}”`} onClose={closeForm} persistent={saving}>
          <MemberEditForm
            key={formState.member.id}
            initialValue={formState.member}
            onSubmit={handleEdit}
            submitting={saving}
          />
        </Modal>
      ) : null}

      {deactivating ? (
        <Modal title={`Deactivate “${memberDisplayName(deactivating)}”?`} onClose={() => !confirmingLifecycle && setDeactivating(null)} persistent={confirmingLifecycle}>
          <p className="text-sm leading-6 text-muted-foreground">
            They will be signed out and cannot sign back in until reactivated. Their record and history are kept.
          </p>
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={() => setDeactivating(null)} disabled={confirmingLifecycle}>
              Keep active
            </Button>
            <Button variant="destructive" loading={confirmingLifecycle} onClick={handleDeactivate}>
              <Power size={16} aria-hidden="true" />
              Yes, deactivate
            </Button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
