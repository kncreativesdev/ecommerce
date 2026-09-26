import { useCallback, useEffect, useMemo, useState } from 'react';
import { BellRing, Pencil, Plus, Power, RotateCcw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  createAnnouncement,
  deleteAnnouncement,
  fetchAnnouncementsAdmin,
  setAnnouncementActive,
  updateAnnouncement,
} from '../services/announcement.service.js';
import { Badge } from '../components/ui/Badge.jsx';
import { Button } from '../components/ui/Button.jsx';
import { EmptyState } from '../components/ui/EmptyState.jsx';
import { ErrorState } from '../components/ui/ErrorState.jsx';
import { PageHeader } from '../components/ui/PageHeader.jsx';
import { Table } from '../components/ui/Table.jsx';
import { Modal } from '../components/ui/Modal.jsx';
import { formatDate } from '../lib/format.js';
import { cn } from '../lib/cn.js';

/**
 * Announcements (`/marketing/announcements`): real backend data only, via
 * ADMIN-only `GET/POST /announcements/admin` and
 * `GET/PATCH/DELETE /announcements/admin/:id`. The list envelope is
 * `{ announcements[] }` (no pagination — `apiGet`).
 *
 * Lifecycle is `PATCH { isActive }` (deactivate confirm-gated, reactivate
 * direct); delete is a server-confirmed hard delete. Priority (0–1000),
 * schedules, and internal link targets render as stored; the preview bar
 * shows exactly what customers would read. The live candidate (active,
 * in-window, highest priority) carries the Current highlight.
 */

const ANNOUNCEMENT_COLUMNS = [
  { key: 'message', label: 'Message' },
  { key: 'priority', label: 'Priority' },
  { key: 'link', label: 'Link' },
  { key: 'schedule', label: 'Schedule' },
  { key: 'status', label: 'Status' },
  { key: 'actions', label: 'Actions', numeric: true },
];

const inputClass =
  'min-h-[44px] w-full rounded-lg border border-input bg-surface px-3 text-sm text-foreground placeholder:text-muted-foreground transition-colors focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30';

function derivedStatus(announcement) {
  if (!announcement?.isActive) return 'inactive';
  const now = Date.now();
  const start = announcement.startsAt ? Date.parse(announcement.startsAt) : NaN;
  const end = announcement.expiresAt ? Date.parse(announcement.expiresAt) : NaN;
  if (Number.isFinite(start) && start > now) return 'scheduled';
  if (Number.isFinite(end) && end < now) return 'expired';
  return 'active';
}

const STATUS_TONES = { active: 'success', inactive: 'neutral', scheduled: 'info', expired: 'warning' };
const STATUS_LABELS = { active: 'Active', inactive: 'Inactive', scheduled: 'Scheduled', expired: 'Expired' };

function scheduleSummary(announcement) {
  const from = announcement?.startsAt ? formatDate(announcement.startsAt) : null;
  const to = announcement?.expiresAt ? formatDate(announcement.expiresAt) : null;
  if (from && to) return `${from} – ${to}`;
  if (from) return `From ${from}`;
  if (to) return `Until ${to}`;
  return 'Anytime';
}

function toDateTimeLocal(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function isValidLinkTarget(value) {
  if (value === '' || value == null) return true;
  const trimmed = String(value).trim();
  if (trimmed === '') return true;
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return false;
  if (/[\s\\]/.test(trimmed)) return false;
  if (/[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) return false;
  if (trimmed.length > 200) return false;
  return true;
}

function validateForm(values) {
  const errors = {};
  const message = (values.message ?? '').trim();
  if (message.length < 1) errors.message = 'Message is required.';
  else if (message.length > 200) errors.message = 'Message must be 200 characters or fewer.';
  const priority = Number(values.priority);
  if (values.priority === '' || values.priority == null) {
    errors.priority = 'Priority is required.';
  } else if (!Number.isInteger(priority) || priority < 0 || priority > 1000) {
    errors.priority = 'Priority must be an integer 0–1000.';
  }
  const linkLabel = (values.linkLabel ?? '').trim();
  if (linkLabel.length > 50) errors.linkLabel = 'Link label must be 50 characters or fewer.';
  const linkTarget = (values.linkTarget ?? '').trim();
  if (linkTarget !== '' && !isValidLinkTarget(linkTarget)) {
    errors.linkTarget = 'Link must be an internal route starting with a single / (no schemes).';
  }
  const start = values.startsAt ? Date.parse(values.startsAt) : NaN;
  const end = values.expiresAt ? Date.parse(values.expiresAt) : NaN;
  if (values.startsAt && Number.isNaN(start)) errors.startsAt = 'Invalid start date.';
  if (values.expiresAt && Number.isNaN(end)) errors.expiresAt = 'Invalid end date.';
  if (Number.isFinite(start) && Number.isFinite(end) && start > end) {
    errors.expiresAt = 'End must be on or after start.';
  }
  return errors;
}

function buildPayload(values, isCreate) {
  const payload = { message: values.message.trim() };
  const priority = Number(values.priority);
  if (Number.isInteger(priority)) payload.priority = priority;
  if (typeof values.isActive === 'boolean') payload.isActive = values.isActive;
  if (values.startsAt) payload.startsAt = new Date(values.startsAt).toISOString();
  else if (!isCreate && values.startsAt === '') payload.startsAt = null;
  if (values.expiresAt) payload.expiresAt = new Date(values.expiresAt).toISOString();
  else if (!isCreate && values.expiresAt === '') payload.expiresAt = null;
  const linkLabel = (values.linkLabel ?? '').trim();
  const linkTarget = (values.linkTarget ?? '').trim();
  payload.linkLabel = linkLabel === '' ? null : linkLabel;
  payload.linkTarget = linkTarget === '' ? null : linkTarget;
  return payload;
}

const EMPTY_FORM = {
  message: '',
  priority: 0,
  isActive: true,
  startsAt: '',
  expiresAt: '',
  linkLabel: '',
  linkTarget: '',
};

export function AnnouncementsPage() {
  const [announcements, setAnnouncements] = useState([]);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [formValues, setFormValues] = useState(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [deactivating, setDeactivating] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [mutating, setMutating] = useState(false);
  const [activatingId, setActivatingId] = useState(null);
  // Snapshot once per mount for the Current highlight — a live clock is
  // not needed and impure reads are forbidden during render.
  const [now] = useState(() => Date.now());

  const load = useCallback(async () => {
    setStatus((current) => (current === 'success' ? 'refreshing' : 'loading'));
    setError(null);
    try {
      const rows = await fetchAnnouncementsAdmin();
      setAnnouncements(rows);
      setStatus('success');
    } catch (loadError) {
      setError(loadError?.message ?? 'Failed to load announcements.');
      setStatus((current) => (current === 'refreshing' ? 'success' : 'error'));
    }
  }, []);

  useEffect(() => {
    document.title = 'Announcements — Tech Pulse Admin';
    // Intentional mount fetch: initial status is already 'loading', and
    // `load` only flips to 'refreshing' on later calls — no cascading
    // render on mount (same pattern as DashboardPage).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const isInitialLoading = status === 'loading';
  const refreshing = status === 'refreshing';
  const hasRows = announcements.length > 0;

  const currentId = useMemo(() => {
    const live = announcements.filter((announcement) => {
      if (!announcement?.isActive) return false;
      const start = announcement.startsAt ? Date.parse(announcement.startsAt) : NaN;
      const end = announcement.expiresAt ? Date.parse(announcement.expiresAt) : NaN;
      if (Number.isFinite(start) && start > now) return false;
      if (Number.isFinite(end) && end < now) return false;
      return true;
    });
    if (live.length === 0) return null;
    live.sort((a, b) => (b?.priority ?? 0) - (a?.priority ?? 0));
    return live[0]?.id ?? null;
  }, [announcements, now]);

  const openCreate = () => {
    setEditing(null);
    setFormValues({ ...EMPTY_FORM });
    setFormErrors({});
    setFormOpen(true);
  };

  const openEdit = (announcement) => {
    setEditing(announcement);
    setFormValues({
      message: announcement?.message ?? '',
      priority: announcement?.priority ?? 0,
      isActive: announcement?.isActive ?? true,
      startsAt: toDateTimeLocal(announcement?.startsAt),
      expiresAt: toDateTimeLocal(announcement?.expiresAt),
      linkLabel: announcement?.linkLabel ?? '',
      linkTarget: announcement?.linkTarget ?? '',
    });
    setFormErrors({});
    setFormOpen(true);
  };

  const handleSave = async () => {
    const errors = validateForm(formValues);
    setFormErrors(errors);
    if (Object.keys(errors).length > 0) return;
    setSaving(true);
    try {
      if (editing?.id) {
        await updateAnnouncement(editing.id, buildPayload(formValues, false));
        toast.success('Announcement updated.');
      } else {
        await createAnnouncement(buildPayload(formValues, true));
        toast.success('Announcement created.');
      }
      setFormOpen(false);
      setEditing(null);
      await load();
    } catch (saveError) {
      toast.error(saveError?.message ?? 'Save failed. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleActivate = async (announcement) => {
    if (!announcement?.id || activatingId) return;
    setActivatingId(announcement.id);
    try {
      await setAnnouncementActive(announcement.id, true);
      toast.success('Announcement activated.');
      await load();
    } catch (activateError) {
      toast.error(activateError?.message ?? 'Activation failed. Please try again.');
    } finally {
      setActivatingId(null);
    }
  };

  const handleDeactivate = async () => {
    if (!deactivating?.id) return;
    setMutating(true);
    try {
      await setAnnouncementActive(deactivating.id, false);
      toast.success('Announcement deactivated.');
      setDeactivating(null);
      await load();
    } catch (deactivateError) {
      toast.error(deactivateError?.message ?? 'Deactivation failed. Please try again.');
    } finally {
      setMutating(false);
    }
  };

  const handleDelete = async () => {
    if (!deleting?.id) return;
    setMutating(true);
    try {
      await deleteAnnouncement(deleting.id);
      toast.success('Announcement deleted.');
      setDeleting(null);
      await load();
    } catch (deleteError) {
      toast.error(deleteError?.message ?? 'Delete failed. Please try again.');
      if (deleteError?.status === 404) {
        setDeleting(null);
        await load();
      }
    } finally {
      setMutating(false);
    }
  };

  const preview = useMemo(() => {
    if (Object.keys(validateForm(formValues)).length > 0) return null;
    return formValues;
  }, [formValues]);

  const meta = isInitialLoading
    ? 'Loading announcements…'
    : refreshing
      ? `Refreshing… · ${announcements.length} ${announcements.length === 1 ? 'announcement' : 'announcements'}`
      : `${announcements.length} ${announcements.length === 1 ? 'announcement' : 'announcements'}`;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Announcements"
        meta={meta}
        actions={
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            <Plus size={17} aria-hidden="true" />
            Add Announcement
          </button>
        }
      />

      {isInitialLoading ? (
        <div role="status" aria-label="Loading announcements" className="flex flex-col gap-2">
          {[0, 1, 2, 3].map((index) => (
            <div key={index} aria-hidden="true" className="h-16 animate-pulse rounded-lg bg-surface-muted" />
          ))}
        </div>
      ) : hasRows ? (
        <>
          {error ? (
            <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3">
              <p className="text-sm text-foreground">{error} Showing previous results.</p>
              <Button variant="secondary" size="sm" onClick={load}>
                Retry
              </Button>
            </div>
          ) : null}
          <div aria-busy={refreshing || undefined}>
            <Table caption="Announcements" columns={ANNOUNCEMENT_COLUMNS} minWidth="min-w-[960px]">
              {announcements.map((announcement) => {
                const derived = derivedStatus(announcement);
                const isCurrent = currentId === announcement.id;
                return (
                  <tr key={announcement.id} className="transition-colors hover:bg-surface-muted/50">
                    <td className="px-4 py-3">
                      <p className="max-w-md font-medium text-foreground">
                        {announcement.message}
                        {isCurrent ? (
                          <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                            Current
                          </span>
                        ) : null}
                      </p>
                    </td>
                    <td className="px-4 py-3 tabular-nums text-muted-foreground">{announcement.priority ?? 0}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {announcement.linkTarget ? (
                        <span className="font-mono text-xs">
                          {announcement.linkLabel ? `${announcement.linkLabel} → ` : ''}
                          {announcement.linkTarget}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                      {scheduleSummary(announcement)}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={STATUS_TONES[derived]}>{STATUS_LABELS[derived]}</Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="inline-flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => openEdit(announcement)}
                          aria-label="Edit announcement"
                          title="Edit announcement"
                          className="inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
                        >
                          <Pencil size={17} aria-hidden="true" />
                        </button>
                        {announcement.isActive ? (
                          <button
                            type="button"
                            onClick={() => setDeactivating(announcement)}
                            aria-label="Deactivate announcement"
                            title="Deactivate announcement"
                            className="inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                          >
                            <Power size={17} aria-hidden="true" />
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleActivate(announcement)}
                            disabled={activatingId === announcement.id}
                            aria-label="Reactivate announcement"
                            title="Reactivate announcement"
                            className="inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-success/10 hover:text-success disabled:cursor-wait disabled:opacity-60"
                          >
                            <RotateCcw size={17} aria-hidden="true" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setDeleting(announcement)}
                          aria-label="Delete announcement"
                          title="Delete announcement"
                          className="inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                        >
                          <Trash2 size={17} aria-hidden="true" />
                        </button>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </Table>
          </div>
        </>
      ) : error ? (
        <ErrorState title="Couldn’t load announcements" message={error} onRetry={load} />
      ) : (
        <EmptyState
          icon={BellRing}
          title="No announcements yet"
          message="Create the first site announcement. It becomes the banner for customers according to its active flag, schedule, and priority."
        />
      )}

      <div className="flex justify-start">
        <Button variant="secondary" onClick={load} disabled={isInitialLoading || refreshing}>
          Refresh list
        </Button>
      </div>

      {formOpen ? (
        <Modal
          title={editing ? 'Edit announcement' : 'Add announcement'}
          onClose={() => !saving && setFormOpen(false)}
          persistent={saving}
        >
          <div className="flex flex-col gap-4">
            <div>
              <label htmlFor="announcement-message" className="text-xs font-semibold text-muted-foreground">
                Message (1–200, required)
              </label>
              <textarea
                id="announcement-message"
                value={formValues.message}
                maxLength={200}
                rows={2}
                onChange={(event) => setFormValues((current) => ({ ...current, message: event.target.value }))}
                placeholder="Free shipping this weekend…"
                className={cn(inputClass, 'mt-1 min-h-[64px] py-2')}
              />
              <p className="mt-1 text-xs tabular-nums text-muted-foreground">{formValues.message.length}/200</p>
              {formErrors.message ? <p className="mt-1 text-xs text-destructive">{formErrors.message}</p> : null}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="announcement-priority" className="text-xs font-semibold text-muted-foreground">
                  Priority (0–1000)
                </label>
                <input
                  id="announcement-priority"
                  type="number"
                  min={0}
                  max={1000}
                  step={1}
                  value={formValues.priority}
                  onChange={(event) =>
                    setFormValues((current) => ({ ...current, priority: event.target.value }))
                  }
                  className={cn(inputClass, 'mt-1')}
                />
                {formErrors.priority ? <p className="mt-1 text-xs text-destructive">{formErrors.priority}</p> : null}
              </div>
              <div className="flex items-end gap-2 pb-1">
                <input
                  id="announcement-active"
                  type="checkbox"
                  checked={formValues.isActive}
                  onChange={(event) => setFormValues((current) => ({ ...current, isActive: event.target.checked }))}
                  className="h-5 w-5 cursor-pointer accent-primary"
                />
                <label htmlFor="announcement-active" className="cursor-pointer text-sm font-medium text-foreground">
                  Active
                </label>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="announcement-starts" className="text-xs font-semibold text-muted-foreground">
                  Starts at (optional)
                </label>
                <input
                  id="announcement-starts"
                  type="datetime-local"
                  value={formValues.startsAt}
                  onChange={(event) => setFormValues((current) => ({ ...current, startsAt: event.target.value }))}
                  className={cn(inputClass, 'mt-1')}
                />
                {formErrors.startsAt ? <p className="mt-1 text-xs text-destructive">{formErrors.startsAt}</p> : null}
              </div>
              <div>
                <label htmlFor="announcement-expires" className="text-xs font-semibold text-muted-foreground">
                  Expires at (optional)
                </label>
                <input
                  id="announcement-expires"
                  type="datetime-local"
                  value={formValues.expiresAt}
                  onChange={(event) => setFormValues((current) => ({ ...current, expiresAt: event.target.value }))}
                  className={cn(inputClass, 'mt-1')}
                />
                {formErrors.expiresAt ? <p className="mt-1 text-xs text-destructive">{formErrors.expiresAt}</p> : null}
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="announcement-link-label" className="text-xs font-semibold text-muted-foreground">
                  Link label (≤50, optional)
                </label>
                <input
                  id="announcement-link-label"
                  value={formValues.linkLabel}
                  maxLength={50}
                  onChange={(event) => setFormValues((current) => ({ ...current, linkLabel: event.target.value }))}
                  placeholder="Shop now"
                  className={cn(inputClass, 'mt-1')}
                />
                {formErrors.linkLabel ? <p className="mt-1 text-xs text-destructive">{formErrors.linkLabel}</p> : null}
              </div>
              <div>
                <label htmlFor="announcement-link-target" className="text-xs font-semibold text-muted-foreground">
                  Link target (internal route, optional)
                </label>
                <input
                  id="announcement-link-target"
                  value={formValues.linkTarget}
                  maxLength={200}
                  onChange={(event) => setFormValues((current) => ({ ...current, linkTarget: event.target.value }))}
                  placeholder="/catalog/products"
                  className={cn(inputClass, 'mt-1 font-mono')}
                />
                {formErrors.linkTarget ? (
                  <p className="mt-1 text-xs text-destructive">{formErrors.linkTarget}</p>
                ) : null}
              </div>
            </div>
            {preview ? (
              <div aria-label="Announcement preview" className="rounded-xl border border-primary/30 bg-primary/5 px-4 py-3">
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                  Preview bar
                </p>
                <p className="mt-1 text-sm font-medium text-foreground">
                  {preview.message}
                  {preview.linkTarget.trim() !== '' ? (
                    <span className="ml-2 font-semibold text-primary">
                      {preview.linkLabel.trim() !== '' ? preview.linkLabel.trim() : 'Learn more'}
                    </span>
                  ) : null}
                </p>
              </div>
            ) : null}
          </div>
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={() => setFormOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button variant="primary" loading={saving} onClick={handleSave}>
              {editing ? 'Save changes' : 'Create announcement'}
            </Button>
          </div>
        </Modal>
      ) : null}

      {deactivating ? (
        <Modal title="Deactivate announcement?" onClose={() => !mutating && setDeactivating(null)} persistent={mutating}>
          <p className="text-sm leading-6 text-muted-foreground">
            Deactivated announcements are hidden from customers and stay visible here for review and reactivation.
          </p>
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={() => setDeactivating(null)} disabled={mutating}>
              Keep announcement
            </Button>
            <Button variant="destructive" loading={mutating} onClick={handleDeactivate}>
              Yes, deactivate
            </Button>
          </div>
        </Modal>
      ) : null}

      {deleting ? (
        <Modal title="Delete announcement?" onClose={() => !mutating && setDeleting(null)} persistent={mutating}>
          <p className="text-sm leading-6 text-muted-foreground">
            This permanently removes the announcement. Customers will no longer see it.
          </p>
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={() => setDeleting(null)} disabled={mutating}>
              Keep announcement
            </Button>
            <Button variant="destructive" loading={mutating} onClick={handleDelete}>
              Yes, delete
            </Button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
