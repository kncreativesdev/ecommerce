import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Pencil, Power, RotateCcw, UserRoundX } from 'lucide-react';
import { toast } from 'sonner';
import { useAuthStore } from '../stores/useAuthStore.js';
import { useMemberStore } from '../stores/useMemberStore.js';
import { updateMemberProfile } from '../services/member.service.js';
import { isHeadRow, isMemberOnlyRow, isStaffRow, memberDisplayName } from '../utils/memberDisplay.js';
import { Badge } from '../components/ui/Badge.jsx';
import { Button } from '../components/ui/Button.jsx';
import { EmptyState } from '../components/ui/EmptyState.jsx';
import { ErrorState } from '../components/ui/ErrorState.jsx';
import { PageHeader } from '../components/ui/PageHeader.jsx';
import { Modal } from '../components/ui/Modal.jsx';
import { MemberEditForm } from '../components/members/MemberEditForm.jsx';
import { formatDateTime } from '../lib/format.js';
import { cn } from '../lib/cn.js';

/**
 * Team Member Detail (`/team/:id`): the server-resolved staff record via
 * `GET /users/:id`. HEAD callers resolve MEMBER targets only — anything
 * else answers the neutral `404 USER_NOT_FOUND` and renders the same
 * not-found state as a genuinely unknown id (no existence oracle, no
 * company inference from client state).
 *
 * Actions follow the list-page target rules: MEMBER rows get Edit +
 * lifecycle; HEAD rows get lifecycle for ADMIN viewers only; ADMIN rows
 * and the viewer's own row get none.
 */
function Section({ title, children, className }) {
  return (
    <section aria-label={title} className={cn('rounded-xl border border-border bg-card p-5 shadow-sm', className)}>
      <h3 className="text-sm font-bold text-foreground">{title}</h3>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function MemberDetailPage() {
  const { id } = useParams();
  const user = useAuthStore((state) => state.user);
  const isAdmin = useAuthStore((state) => state.isAdmin());
  const detail = useMemberStore((state) => state.detail);
  const detailStatus = useMemberStore((state) => state.detailStatus);
  const detailError = useMemberStore((state) => state.detailError);
  const fetchMemberDetail = useMemberStore((state) => state.fetchMemberDetail);
  const syncMember = useMemberStore((state) => state.syncMember);
  const setActive = useMemberStore((state) => state.setActive);
  const clearDetail = useMemberStore((state) => state.clearDetail);

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [activating, setActivating] = useState(false);

  useEffect(() => {
    document.title = 'Team Member — Tech Pulse Admin';
    fetchMemberDetail(id);
    return () => clearDetail();
  }, [id, fetchMemberDetail, clearDetail]);

  const isLoading = detailStatus === 'idle' || detailStatus === 'loading';
  // A non-staff row resolving here (ADMIN callers can resolve CUSTOMER
  // ids directly) is never presented as a team member — it reads as
  // not-found, exactly like an out-of-scope HEAD target.
  const loadedNonStaff = !isLoading && !detailError && detail && !isStaffRow(detail);
  const isNotFound =
    !isLoading &&
    (detailError?.status === 404 ||
      detailError?.code === 'USER_NOT_FOUND' ||
      (!detailError && !detail) ||
      Boolean(loadedNonStaff));
  const member = detail && isStaffRow(detail) ? detail : null;

  const isSelf = member && user?.id ? member.id === user.id : false;
  const canEdit = Boolean(member && !isSelf && isMemberOnlyRow(member));
  const canLifecycle = Boolean(
    member && !isSelf && (isMemberOnlyRow(member) || (isAdmin && isHeadRow(member))),
  );

  const refetch = () => fetchMemberDetail(id);

  const handleEdit = async (payload) => {
    if (!member?.id) return;
    setSaving(true);
    try {
      const record = await updateMemberProfile(member.id, payload);
      if (record?.id) syncMember(record);
      toast.success(`“${memberDisplayName(record ?? member)}” saved.`);
      setEditing(false);
      await refetch();
    } finally {
      setSaving(false);
    }
  };

  const handleActivate = async () => {
    if (!member?.id || activating) return;
    setActivating(true);
    try {
      await setActive(member.id, true);
      toast.success(`“${memberDisplayName(member)}” reactivated.`);
      await refetch();
    } catch (error) {
      toast.error(error?.message ?? 'Reactivation failed. Please try again.');
    } finally {
      setActivating(false);
    }
  };

  const handleDeactivate = async () => {
    if (!member?.id) return;
    setMutating(true);
    try {
      await setActive(member.id, false);
      toast.success(`“${memberDisplayName(member)}” deactivated — they cannot sign in until reactivated.`);
      setDeactivating(false);
      await refetch();
    } catch (error) {
      toast.error(error?.message ?? 'Deactivation failed. Please try again.');
    } finally {
      setMutating(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <Link
        to="/team"
        className="inline-flex min-h-[44px] w-fit items-center gap-2 rounded-lg px-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground hover:no-underline"
      >
        <ArrowLeft size={16} aria-hidden="true" />
        Back to team members
      </Link>

      {isLoading ? (
        <div role="status" aria-label="Loading team member" className="flex flex-col gap-3">
          <div aria-hidden="true" className="h-10 w-2/3 animate-pulse rounded-lg bg-surface-muted" />
          <div aria-hidden="true" className="h-32 animate-pulse rounded-xl bg-surface-muted" />
        </div>
      ) : isNotFound ? (
        <EmptyState
          icon={UserRoundX}
          title="Team member not found"
          message="This account does not exist, is outside your company, or is outside your management scope. Return to the team list."
          actionTo="/team"
          actionLabel="Back to team members"
        />
      ) : !member ? (
        <ErrorState title="Couldn’t load the team member" message={detailError?.message} onRetry={refetch} />
      ) : (
        <>
          <PageHeader
            title={memberDisplayName(member)}
            description={member.email}
            meta={
              <span className="mt-1 flex flex-wrap items-center gap-1.5">
                <Badge tone={isMemberOnlyRow(member) ? 'info' : isHeadRow(member) ? 'warning' : 'neutral'}>
                  {isMemberOnlyRow(member) ? 'Member' : isHeadRow(member) ? 'Head' : 'Admin'}
                </Badge>
                <Badge tone={member.isActive ? 'success' : 'neutral'}>
                  {member.isActive ? 'Active' : 'Deactivated'}
                </Badge>
              </span>
            }
            actions={
              <>
                {canEdit ? (
                  <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
                    <Pencil size={15} aria-hidden="true" />
                    Edit
                  </Button>
                ) : null}
                {canLifecycle ? (
                  member.isActive ? (
                    <Button variant="destructive" size="sm" onClick={() => setDeactivating(true)}>
                      <Power size={15} aria-hidden="true" />
                      Deactivate
                    </Button>
                  ) : (
                    <Button variant="secondary" size="sm" onClick={handleActivate} disabled={activating}>
                      <RotateCcw size={15} aria-hidden="true" />
                      {activating ? 'Reactivating…' : 'Reactivate'}
                    </Button>
                  )
                ) : null}
              </>
            }
          />

          <Section title="Profile">
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">First name</dt>
                <dd className="font-medium text-foreground">{member.firstName ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Last name</dt>
                <dd className="font-medium text-foreground">{member.lastName ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Email</dt>
                <dd className="font-medium text-foreground">{member.email}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Phone</dt>
                <dd className="font-medium text-foreground">{member.phone ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Joined</dt>
                <dd className="font-medium text-foreground">{formatDateTime(member.createdAt)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Last updated</dt>
                <dd className="font-medium text-foreground">{formatDateTime(member.updatedAt)}</dd>
              </div>
            </dl>
          </Section>
        </>
      )}

      {editing && member ? (
        <Modal title={`Edit “${memberDisplayName(member)}”`} onClose={() => !saving && setEditing(false)} persistent={saving}>
          <MemberEditForm key={member.id} initialValue={member} onSubmit={handleEdit} submitting={saving} />
        </Modal>
      ) : null}

      {deactivating && member ? (
        <Modal title={`Deactivate “${memberDisplayName(member)}”?`} onClose={() => !mutating && setDeactivating(false)} persistent={mutating}>
          <p className="text-sm leading-6 text-muted-foreground">
            They will be signed out and cannot sign back in until reactivated. Their record and history are kept.
          </p>
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={() => setDeactivating(false)} disabled={mutating}>
              Keep active
            </Button>
            <Button variant="destructive" loading={mutating} onClick={handleDeactivate}>
              Yes, deactivate
            </Button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
