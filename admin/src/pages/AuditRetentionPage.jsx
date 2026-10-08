import { useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import { useRetentionStore } from '../stores/useRetentionStore.js';
import { RETENTION_POLICIES } from '../services/retention.service.js';
import { Button } from '../components/ui/Button.jsx';
import { Badge } from '../components/ui/Badge.jsx';
import { ErrorState } from '../components/ui/ErrorState.jsx';
import { PageHeader } from '../components/ui/PageHeader.jsx';
import { Modal } from '../components/ui/Modal.jsx';
import { formatDateTime } from '../lib/format.js';

/**
 * Audit Retention (`/audit-retention`): SUPER_ADMIN-only view of the
 * global audit retention policy, via `GET/PATCH /audit-retention`.
 * The backend is authoritative (strict enum, platform scope, audited
 * changes); this page forwards `{ policy }` exactly and renders
 * whatever the server returns — timestamps and actor come from the
 * response, never invented client-side.
 *
 * Reducing retention (toward shorter keeping) asks for confirmation
 * through the shared Modal pattern (destructive settings changes are
 * confirm-gated across the admin app); same-value saves and
 * increases apply directly. No per-company settings, no company
 * selector, no manual deletion or cleanup controls exist anywhere
 * on this page — retention governs automatic cleanup only and never
 * permanent company deletion.
 */
const POLICY_META = {
  NEVER: {
    label: 'Never',
    description: 'Audit logs are not automatically removed by retention cleanup.',
  },
  '30_DAYS': {
    label: '30 days',
    description: 'Audit logs older than 30 days are eligible for automatic cleanup.',
  },
  '1_YEAR': {
    label: '1 year',
    description: 'Audit logs older than 365 days are eligible for automatic cleanup.',
  },
};

// Keeping duration in days (NEVER is unbounded): a draft that keeps
// less than the current policy is a reduction and needs
// confirmation. Same value never confirms.
const POLICY_DAYS = { NEVER: Number.POSITIVE_INFINITY, '30_DAYS': 30, '1_YEAR': 365 };

function shortId(value) {
  if (typeof value !== 'string' || value === '') return '—';
  return value.length > 13 ? `${value.slice(0, 8)}…` : value;
}

export function AuditRetentionPage() {
  const retention = useRetentionStore((state) => state.retention);
  const status = useRetentionStore((state) => state.status);
  const error = useRetentionStore((state) => state.error);
  const saving = useRetentionStore((state) => state.saving);
  const loadRetention = useRetentionStore((state) => state.loadRetention);
  const saveRetention = useRetentionStore((state) => state.saveRetention);

  const [draft, setDraft] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [draftSource, setDraftSource] = useState(null);

  useEffect(() => {
    document.title = 'Audit Retention — Tech Pulse Admin';
    loadRetention();
  }, [loadRetention]);

  // Render-time draft sync when the SERVER policy changes (initial
  // load, post-save refresh): same sanctioned derived-state pattern
  // as AdminLayout's route reset — effects below only sync async
  // subscriptions. User edits never trigger it (draft is local until
  // saved), so in-progress selections are never clobbered.
  if ((retention?.policy ?? null) !== draftSource) {
    setDraftSource(retention?.policy ?? null);
    if (retention?.policy) setDraft(retention.policy);
  }

  const isLoading = status === 'idle' || status === 'loading';
  const current = retention?.policy ?? '';
  const isReduction = current !== '' && draft !== '' && (POLICY_DAYS[draft] ?? 0) < (POLICY_DAYS[current] ?? 0);

  const persist = async () => {
    setConfirming(false);
    await saveRetention(draft);
  };

  const handleSave = () => {
    if (saving || draft === '') return;
    if (isReduction) {
      setConfirming(true);
      return;
    }
    persist();
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Audit Retention"
        description="Controls how long audit logs are retained globally."
        actions={
          <Button variant="secondary" size="sm" onClick={() => loadRetention()} disabled={isLoading}>
            Refresh
          </Button>
        }
      />

      {isLoading ? (
        <div role="status" aria-label="Loading retention policy" className="flex flex-col gap-2">
          {[0, 1, 2].map((index) => (
            <div key={index} aria-hidden="true" className="h-16 animate-pulse rounded-lg bg-surface-muted" />
          ))}
        </div>
      ) : error ? (
        <ErrorState title="Couldn’t load retention policy" message={error.message} onRetry={() => loadRetention()} />
      ) : (
        <>
          <section aria-label="Current retention policy" className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <div className="flex flex-wrap items-center gap-3">
              <h3 className="text-base font-bold text-foreground">{POLICY_META[current]?.label ?? current}</h3>
              <Badge tone="neutral">Current</Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{retention.description ?? POLICY_META[current]?.description}</p>
            <dl className="mt-4 grid gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Last updated</dt>
                <dd className="mt-0.5 text-sm text-foreground">{retention?.updatedAt ? formatDateTime(retention.updatedAt) : '—'}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Updated by</dt>
                <dd className="mt-0.5 font-mono text-[13px] text-foreground" title={retention?.updatedBy ?? undefined}>
                  {shortId(retention?.updatedBy)}
                </dd>
              </div>
            </dl>
          </section>

          <section aria-label="Change retention policy" className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <fieldset>
              <legend className="text-base font-bold text-foreground">Retention policy</legend>
              <div className="mt-3 flex flex-col gap-2">
                {RETENTION_POLICIES.map((policy) => (
                  <label
                    key={policy}
                    className="flex cursor-pointer items-start gap-3 rounded-lg border border-border px-4 py-3 transition-colors hover:border-border-strong has-checked:border-primary"
                  >
                    <input
                      type="radio"
                      name="retention-policy"
                      value={policy}
                      checked={draft === policy}
                      onChange={() => setDraft(policy)}
                      className="mt-1 h-4 w-4 shrink-0 cursor-pointer accent-primary"
                    />
                    <span>
                      <span className="block text-sm font-semibold text-foreground">{POLICY_META[policy].label}</span>
                      <span className="mt-0.5 block text-sm text-muted-foreground">{POLICY_META[policy].description}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <p className="mt-4 text-sm leading-6 text-muted-foreground">
              Retention controls automatic audit-log cleanup. It does not control permanent company deletion.
            </p>
            <div className="mt-4">
              <Button variant="primary" onClick={handleSave} loading={saving} disabled={draft === ''}>
                <Save size={16} aria-hidden="true" />
                Save changes
              </Button>
            </div>
          </section>
        </>
      )}

      {confirming ? (
        <Modal
          title={`Shorten retention to ${POLICY_META[draft]?.label ?? draft}?`}
          onClose={() => !saving && setConfirming(false)}
          persistent={saving}
        >
          <div className="flex flex-col gap-4">
            <p className="text-sm leading-6 text-muted-foreground">
              Audit logs older than {POLICY_META[draft]?.label ?? draft} will become eligible for automatic cleanup
              on the next scheduled run. This cannot be undone once cleanup removes them.
            </p>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="secondary" onClick={() => setConfirming(false)} disabled={saving}>
                Cancel
              </Button>
              <Button variant="destructive" loading={saving} onClick={persist}>
                Yes, shorten retention
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
