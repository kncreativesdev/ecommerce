import { useCallback, useEffect, useMemo, useState } from 'react';
import { Megaphone, Pencil, Plus, Power, RotateCcw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  createMarketingNotification,
  deleteMarketingNotification,
  fetchMarketingNotificationsAdmin,
  setMarketingNotificationActive,
  updateMarketingNotification,
} from '../services/marketing.service.js';
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
 * Marketing Notifications (`/marketing/notifications`): real backend data
 * only, via ADMIN-only `GET/POST /marketing/notifications/admin` and
 * `GET/PATCH/DELETE /marketing/notifications/admin/:id`. The list
 * envelope is `{ notifications[] }` (no pagination — `apiGet`).
 *
 * Lifecycle is `PATCH { isActive }` (deactivate confirm-gated, reactivate
 * direct); delete is a server-confirmed hard delete. Schedules
 * (`startsAt`/`expiresAt`), types (`DEAL|OFFER|ANNOUNCEMENT`), and
 * destinations (`linkType` + required `linkValue`) render as stored;
 * the preview card shows exactly what customers would read.
 */

const NOTIFICATION_COLUMNS = [
  { key: 'notification', label: 'Notification' },
  { key: 'type', label: 'Type' },
  { key: 'destination', label: 'Destination' },
  { key: 'schedule', label: 'Schedule' },
  { key: 'status', label: 'Status' },
  { key: 'actions', label: 'Actions', numeric: true },
];

const NOTIFICATION_TYPES = ['DEAL', 'OFFER', 'ANNOUNCEMENT'];
const LINK_TYPES = ['SHOP', 'CATEGORY', 'PRODUCT', 'COUPON'];

const inputClass =
  'min-h-[44px] w-full rounded-lg border border-input bg-surface px-3 text-sm text-foreground placeholder:text-muted-foreground transition-colors focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30';

function derivedStatus(notification) {
  if (!notification?.isActive) return 'inactive';
  const now = Date.now();
  const start = notification.startsAt ? Date.parse(notification.startsAt) : NaN;
  const end = notification.expiresAt ? Date.parse(notification.expiresAt) : NaN;
  if (Number.isFinite(start) && start > now) return 'scheduled';
  if (Number.isFinite(end) && end < now) return 'expired';
  return 'active';
}

const STATUS_TONES = { active: 'success', inactive: 'neutral', scheduled: 'info', expired: 'warning' };
const STATUS_LABELS = { active: 'Active', inactive: 'Inactive', scheduled: 'Scheduled', expired: 'Expired' };

function scheduleSummary(notification) {
  const from = notification?.startsAt ? formatDate(notification.startsAt) : null;
  const to = notification?.expiresAt ? formatDate(notification.expiresAt) : null;
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

function validateForm(values) {
  const errors = {};
  const title = (values.title ?? '').trim();
  const message = (values.message ?? '').trim();
  if (title.length < 1) errors.title = 'Title is required.';
  else if (title.length > 150) errors.title = 'Title must be 150 characters or fewer.';
  if (message.length < 1) errors.message = 'Message is required.';
  else if (message.length > 1000) errors.message = 'Message must be 1000 characters or fewer.';
  if (values.type && !NOTIFICATION_TYPES.includes(values.type)) errors.type = 'Unknown type.';
  if (values.linkType && !LINK_TYPES.includes(values.linkType)) errors.linkType = 'Unknown destination.';
  const linkValue = (values.linkValue ?? '').trim();
  if (values.linkType && linkValue.length < 1) {
    errors.linkValue = 'Destination value is required when a destination is set.';
  } else if (linkValue.length > 100) {
    errors.linkValue = 'Destination value must be 100 characters or fewer.';
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

function buildPayload(values) {
  const payload = {
    title: values.title.trim(),
    message: values.message.trim(),
  };
  if (values.type) payload.type = values.type;
  if (typeof values.isActive === 'boolean') payload.isActive = values.isActive;
  if (values.startsAt) payload.startsAt = new Date(values.startsAt).toISOString();
  if (values.expiresAt) payload.expiresAt = new Date(values.expiresAt).toISOString();
  if (values.linkType) {
    payload.linkType = values.linkType;
    payload.linkValue = values.linkValue.trim();
  } else {
    payload.linkType = null;
    payload.linkValue = null;
  }
  return payload;
}

const EMPTY_FORM = {
  title: '',
  message: '',
  type: 'OFFER',
  isActive: true,
  startsAt: '',
  expiresAt: '',
  linkType: '',
  linkValue: '',
};

export function MarketingNotificationsPage() {
  const [notifications, setNotifications] = useState([]);
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

  const load = useCallback(async () => {
    setStatus((current) => (current === 'success' ? 'refreshing' : 'loading'));
    setError(null);
    try {
      const rows = await fetchMarketingNotificationsAdmin();
      setNotifications(rows);
      setStatus('success');
    } catch (loadError) {
      setError(loadError?.message ?? 'Failed to load notifications.');
      setStatus((current) => (current === 'refreshing' ? 'success' : 'error'));
    }
  }, []);

  useEffect(() => {
    document.title = 'Marketing Notifications — Tech Pulse Admin';
    // Intentional mount fetch: initial status is already 'loading', and
    // `load` only flips to 'refreshing' on later calls — no cascading
    // render on mount (same pattern as DashboardPage).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const isInitialLoading = status === 'loading';
  const refreshing = status === 'refreshing';
  const hasRows = notifications.length > 0;

  const openCreate = () => {
    setEditing(null);
    setFormValues({ ...EMPTY_FORM });
    setFormErrors({});
    setFormOpen(true);
  };

  const openEdit = (notification) => {
    setEditing(notification);
    setFormValues({
      title: notification?.title ?? '',
      message: notification?.message ?? '',
      type: notification?.type ?? 'OFFER',
      isActive: notification?.isActive ?? true,
      startsAt: toDateTimeLocal(notification?.startsAt),
      expiresAt: toDateTimeLocal(notification?.expiresAt),
      linkType: notification?.linkType ?? '',
      linkValue: notification?.linkValue ?? '',
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
        await updateMarketingNotification(editing.id, buildPayload(formValues));
        toast.success('Notification updated.');
      } else {
        await createMarketingNotification(buildPayload(formValues));
        toast.success('Notification created.');
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

  const handleActivate = async (notification) => {
    if (!notification?.id || activatingId) return;
    setActivatingId(notification.id);
    try {
      await setMarketingNotificationActive(notification.id, true);
      toast.success(`“${notification.title}” activated.`);
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
      await setMarketingNotificationActive(deactivating.id, false);
      toast.success(`“${deactivating.title}” deactivated.`);
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
      await deleteMarketingNotification(deleting.id);
      toast.success('Notification deleted.');
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
    ? 'Loading notifications…'
    : refreshing
      ? `Refreshing… · ${notifications.length} ${notifications.length === 1 ? 'notification' : 'notifications'}`
      : `${notifications.length} ${notifications.length === 1 ? 'notification' : 'notifications'}`;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Marketing Notifications"
        meta={meta}
        actions={
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            <Plus size={17} aria-hidden="true" />
            Add Notification
          </button>
        }
      />

      {isInitialLoading ? (
        <div role="status" aria-label="Loading notifications" className="flex flex-col gap-2">
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
            <Table caption="Marketing notifications" columns={NOTIFICATION_COLUMNS} minWidth="min-w-[960px]">
              {notifications.map((notification) => {
                const derived = derivedStatus(notification);
                return (
                  <tr key={notification.id} className="transition-colors hover:bg-surface-muted/50">
                    <td className="px-4 py-3">
                      <p className="font-semibold text-foreground">{notification.title}</p>
                      <p className="max-w-md truncate text-xs text-muted-foreground">{notification.message}</p>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone="info">{notification.type ?? '—'}</Badge>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {notification.linkType ? (
                        <span className="font-mono text-xs">
                          {notification.linkType}
                          {notification.linkValue ? `:${notification.linkValue}` : ''}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{scheduleSummary(notification)}</td>
                    <td className="px-4 py-3">
                      <Badge tone={STATUS_TONES[derived]}>{STATUS_LABELS[derived]}</Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="inline-flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => openEdit(notification)}
                          aria-label={`Edit notification ${notification.title}`}
                          title={`Edit notification ${notification.title}`}
                          className="inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
                        >
                          <Pencil size={17} aria-hidden="true" />
                        </button>
                        {notification.isActive ? (
                          <button
                            type="button"
                            onClick={() => setDeactivating(notification)}
                            aria-label={`Deactivate notification ${notification.title}`}
                            title={`Deactivate notification ${notification.title}`}
                            className="inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                          >
                            <Power size={17} aria-hidden="true" />
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleActivate(notification)}
                            disabled={activatingId === notification.id}
                            aria-label={`Reactivate notification ${notification.title}`}
                            title={`Reactivate notification ${notification.title}`}
                            className="inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-success/10 hover:text-success disabled:cursor-wait disabled:opacity-60"
                          >
                            <RotateCcw size={17} aria-hidden="true" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setDeleting(notification)}
                          aria-label={`Delete notification ${notification.title}`}
                          title={`Delete notification ${notification.title}`}
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
        <ErrorState title="Couldn’t load notifications" message={error} onRetry={load} />
      ) : (
        <EmptyState
          icon={Megaphone}
          title="No notifications yet"
          message="Create the first marketing notification. It becomes visible to customers according to its active flag and schedule."
        />
      )}

      <div className="flex justify-start">
        <Button variant="secondary" onClick={load} disabled={isInitialLoading || refreshing}>
          Refresh list
        </Button>
      </div>

      {formOpen ? (
        <Modal
          title={editing ? `Edit “${editing.title}”?` : 'Add notification'}
          onClose={() => !saving && setFormOpen(false)}
          persistent={saving}
        >
          <div className="flex flex-col gap-4">
            <div>
              <label htmlFor="marketing-title" className="text-xs font-semibold text-muted-foreground">
                Title (1–150, required)
              </label>
              <input
                id="marketing-title"
                value={formValues.title}
                maxLength={150}
                onChange={(event) => setFormValues((current) => ({ ...current, title: event.target.value }))}
                placeholder="Festive sale is live"
                className={cn(inputClass, 'mt-1')}
              />
              {formErrors.title ? <p className="mt-1 text-xs text-destructive">{formErrors.title}</p> : null}
            </div>
            <div>
              <label htmlFor="marketing-message" className="text-xs font-semibold text-muted-foreground">
                Message (1–1000, required)
              </label>
              <textarea
                id="marketing-message"
                value={formValues.message}
                maxLength={1000}
                rows={3}
                onChange={(event) => setFormValues((current) => ({ ...current, message: event.target.value }))}
                placeholder="Up to 30% off on audio…"
                className={cn(inputClass, 'mt-1 min-h-[88px] py-2')}
              />
              <p className="mt-1 text-xs tabular-nums text-muted-foreground">{formValues.message.length}/1000</p>
              {formErrors.message ? <p className="mt-1 text-xs text-destructive">{formErrors.message}</p> : null}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="marketing-type" className="text-xs font-semibold text-muted-foreground">
                  Type
                </label>
                <select
                  id="marketing-type"
                  value={formValues.type}
                  onChange={(event) => setFormValues((current) => ({ ...current, type: event.target.value }))}
                  className={cn(inputClass, 'mt-1 cursor-pointer')}
                >
                  {NOTIFICATION_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
                {formErrors.type ? <p className="mt-1 text-xs text-destructive">{formErrors.type}</p> : null}
              </div>
              <div className="flex items-end gap-2 pb-1">
                <input
                  id="marketing-active"
                  type="checkbox"
                  checked={formValues.isActive}
                  onChange={(event) => setFormValues((current) => ({ ...current, isActive: event.target.checked }))}
                  className="h-5 w-5 cursor-pointer accent-primary"
                />
                <label htmlFor="marketing-active" className="cursor-pointer text-sm font-medium text-foreground">
                  Active
                </label>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="marketing-starts" className="text-xs font-semibold text-muted-foreground">
                  Starts at (optional)
                </label>
                <input
                  id="marketing-starts"
                  type="datetime-local"
                  value={formValues.startsAt}
                  onChange={(event) => setFormValues((current) => ({ ...current, startsAt: event.target.value }))}
                  className={cn(inputClass, 'mt-1')}
                />
                {formErrors.startsAt ? <p className="mt-1 text-xs text-destructive">{formErrors.startsAt}</p> : null}
              </div>
              <div>
                <label htmlFor="marketing-expires" className="text-xs font-semibold text-muted-foreground">
                  Expires at (optional)
                </label>
                <input
                  id="marketing-expires"
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
                <label htmlFor="marketing-link-type" className="text-xs font-semibold text-muted-foreground">
                  Destination (optional)
                </label>
                <select
                  id="marketing-link-type"
                  value={formValues.linkType}
                  onChange={(event) => setFormValues((current) => ({ ...current, linkType: event.target.value }))}
                  className={cn(inputClass, 'mt-1 cursor-pointer')}
                >
                  <option value="">No destination</option>
                  {LINK_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
                {formErrors.linkType ? <p className="mt-1 text-xs text-destructive">{formErrors.linkType}</p> : null}
              </div>
              <div>
                <label htmlFor="marketing-link-value" className="text-xs font-semibold text-muted-foreground">
                  Destination value{formValues.linkType ? ' (required)' : ''}
                </label>
                <input
                  id="marketing-link-value"
                  value={formValues.linkValue}
                  maxLength={100}
                  onChange={(event) => setFormValues((current) => ({ ...current, linkValue: event.target.value }))}
                  placeholder={formValues.linkType ? 'Category id, product id, coupon code…' : 'Set a destination first'}
                  disabled={!formValues.linkType}
                  className={cn(inputClass, 'mt-1 disabled:cursor-not-allowed disabled:opacity-60')}
                />
                {formErrors.linkValue ? <p className="mt-1 text-xs text-destructive">{formErrors.linkValue}</p> : null}
              </div>
            </div>
            {preview ? (
              <div aria-label="Notification preview" className="rounded-xl border border-border bg-card p-4 shadow-sm">
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Preview</p>
                <p className="mt-2 text-sm font-bold text-foreground">{preview.title}</p>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">{preview.message}</p>
                {preview.linkType ? (
                  <p className="mt-1 font-mono text-xs text-muted-foreground">
                    {preview.linkType}:{preview.linkValue.trim()}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={() => setFormOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button variant="primary" loading={saving} onClick={handleSave}>
              {editing ? 'Save changes' : 'Create notification'}
            </Button>
          </div>
        </Modal>
      ) : null}

      {deactivating ? (
        <Modal title={`Deactivate “${deactivating.title}”?`} onClose={() => !mutating && setDeactivating(null)} persistent={mutating}>
          <p className="text-sm leading-6 text-muted-foreground">
            Deactivated notifications are hidden from customers and stay visible here for review and reactivation.
          </p>
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={() => setDeactivating(null)} disabled={mutating}>
              Keep notification
            </Button>
            <Button variant="destructive" loading={mutating} onClick={handleDeactivate}>
              Yes, deactivate
            </Button>
          </div>
        </Modal>
      ) : null}

      {deleting ? (
        <Modal title={`Delete “${deleting.title}”?`} onClose={() => !mutating && setDeleting(null)} persistent={mutating}>
          <p className="text-sm leading-6 text-muted-foreground">
            This permanently removes the notification. Customers will no longer see it.
          </p>
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={() => setDeleting(null)} disabled={mutating}>
              Keep notification
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
