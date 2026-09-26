import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Check, MapPin, Pencil, Plus, Star, Trash2 } from 'lucide-react';
import { Container } from '../components/ui/Container.jsx';
import { Breadcrumbs } from '../components/layout/Breadcrumbs.jsx';
import { EmptyState } from '../components/ui/EmptyState.jsx';
import { ErrorState } from '../components/ui/ErrorState.jsx';
import { Skeleton } from '../components/ui/Skeleton.jsx';
import { AddressForm } from '../components/addresses/AddressForm.jsx';
import {
  deleteAddress,
  fetchAddresses,
  updateAddress,
} from '../services/addresses.service.js';

/**
 * Address book (`/account/addresses`, protected): list (default badge,
 * edit/delete/set-default), add/edit form, delete two-tap confirm.
 * Checkout requires ≥1 address — the empty state links back appropriately.
 * Server is the source of truth: every mutation refetches the list.
 */
export function AddressesPage() {
  const [addresses, setAddresses] = useState([]);
  const [status, setStatus] = useState('loading');
  const [loadError, setLoadError] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [mutating, setMutating] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  // Mount + retry fetching (state updates only in async continuations).
  useEffect(() => {
    document.title = 'Addresses — Tech Pulse';
    const controller = new AbortController();
    const signal = controller.signal;
    fetchAddresses()
      .then((data) => {
        if (signal.aborted) return;
        setAddresses(data);
        setStatus('success');
      })
      .catch((error) => {
        if (signal.aborted) return;
        setLoadError(error);
        setStatus('error');
      });
    return () => controller.abort();
  }, [reloadToken]);

  const refresh = async () => {
    try {
      const data = await fetchAddresses();
      setAddresses(data);
      setStatus('success');
    } catch (error) {
      setLoadError(error);
      setStatus('error');
    }
  };

  const retry = () => {
    setStatus('loading');
    setLoadError(null);
    setReloadToken((token) => token + 1);
  };

  const startAdd = () => {
    setEditingId(null);
    setConfirmDeleteId(null);
    setShowForm(true);
  };

  const startEdit = (address) => {
    setEditingId(address.id);
    setConfirmDeleteId(null);
    setShowForm(true);
  };

  const handleSaved = async () => {
    setShowForm(false);
    setEditingId(null);
    await refresh();
  };

  const handleDelete = async (id) => {
    setMutating(true);
    try {
      await deleteAddress(id);
      toast.success('Address removed.');
      setConfirmDeleteId(null);
      await refresh();
    } catch (error) {
      if (error?.status === 404 || error?.code === 'ADDRESS_NOT_FOUND') {
        toast.success('Address already removed.');
        setConfirmDeleteId(null);
        await refresh();
      } else {
        toast.error(error?.message ?? 'Remove failed. Please try again.');
      }
    } finally {
      setMutating(false);
    }
  };

  const handleSetDefault = async (id) => {
    setMutating(true);
    try {
      await updateAddress(id, { isDefault: true });
      toast.success('Default address updated.');
      await refresh();
    } catch (error) {
      toast.error(error?.message ?? 'Update failed. Please try again.');
    } finally {
      setMutating(false);
    }
  };

  const editingAddress = editingId ? addresses.find((address) => address.id === editingId) ?? null : null;

  return (
    <Container className="flex max-w-3xl flex-col gap-6 py-10 sm:py-14">
      <Breadcrumbs items={[{ label: 'Home', to: '/' }, { label: 'My Account', to: '/account' }, { label: 'Addresses' }]} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Addresses</h1>
        {!showForm && status === 'success' && addresses.length > 0 ? (
          <button
            type="button"
            onClick={startAdd}
            className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground transition-opacity duration-200 hover:opacity-90"
          >
            <Plus size={16} aria-hidden="true" />
            Add address
          </button>
        ) : null}
      </div>

      {status === 'loading' ? (
        <div role="status" aria-label="Loading addresses" className="flex flex-col gap-3">
          <Skeleton className="h-28 rounded-2xl" />
          <Skeleton className="h-28 rounded-2xl" />
        </div>
      ) : status === 'error' ? (
        <ErrorState
          title="Couldn’t load your addresses"
          message={loadError?.message ?? 'Please try again.'}
          onRetry={retry}
        />
      ) : (
        <>
          {showForm ? (
            <AddressForm
              key={editingId ?? 'new'}
              initialValue={editingAddress}
              mutating={mutating}
              setMutating={setMutating}
              onSaved={handleSaved}
              onCancel={() => {
                setShowForm(false);
                setEditingId(null);
              }}
            />
          ) : null}

          {addresses.length === 0 && !showForm ? (
            <EmptyState
              icon={MapPin}
              title="No addresses yet"
              message="Add a delivery address — checkout needs at least one."
              actionTo="/account"
              actionLabel="Back to account"
            />
          ) : (
            <ul className="flex flex-col gap-3">
              {addresses.map((address) => (
                <li
                  key={address.id}
                  className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-bold text-foreground">
                        {address.fullName || address.label || 'Address'}
                        {address.isDefault ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-accent px-2.5 py-0.5 text-[11px] font-bold text-accent-foreground">
                            <Star size={11} aria-hidden="true" fill="currentColor" />
                            Default
                          </span>
                        ) : null}
                      </p>
                      <address className="mt-1 text-sm not-italic leading-6 text-muted-foreground">
                        {address.addressLine1}
                        {address.addressLine2 ? `, ${address.addressLine2}` : ''}, {address.city},{' '}
                        {address.state} {address.postalCode}, {address.country}
                        <br />
                        {address.phone}
                      </address>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
                    {!address.isDefault ? (
                      <button
                        type="button"
                        onClick={() => handleSetDefault(address.id)}
                        disabled={mutating}
                        className="inline-flex min-h-[44px] cursor-pointer items-center gap-1.5 rounded-lg px-2 text-[13px] font-semibold text-accent-link disabled:cursor-wait disabled:opacity-60"
                      >
                        <Check size={15} aria-hidden="true" />
                        Set as default
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => startEdit(address)}
                      className="inline-flex min-h-[44px] cursor-pointer items-center gap-1.5 rounded-lg px-2 text-[13px] font-semibold text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <Pencil size={15} aria-hidden="true" />
                      Edit
                    </button>
                    {confirmDeleteId === address.id ? (
                      <span className="inline-flex items-center gap-2" role="group" aria-label="Confirm delete">
                        <span className="text-[13px] text-muted-foreground">Delete this address?</span>
                        <button
                          type="button"
                          onClick={() => handleDelete(address.id)}
                          disabled={mutating}
                          className="inline-flex min-h-[44px] cursor-pointer items-center rounded-lg bg-destructive px-3 text-[13px] font-semibold text-destructive-foreground disabled:cursor-wait disabled:opacity-60"
                        >
                          Yes, delete
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(null)}
                          disabled={mutating}
                          className="inline-flex min-h-[44px] cursor-pointer items-center rounded-lg border border-border px-3 text-[13px] font-semibold disabled:opacity-60"
                        >
                          Keep
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(address.id)}
                        className="inline-flex min-h-[44px] cursor-pointer items-center gap-1.5 rounded-lg px-2 text-[13px] font-semibold text-muted-foreground transition-colors hover:text-destructive"
                      >
                        <Trash2 size={15} aria-hidden="true" />
                        Delete
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {status === 'success' && addresses.length === 0 && !showForm ? (
            <button
              type="button"
              onClick={startAdd}
              className="inline-flex min-h-[48px] cursor-pointer items-center justify-center gap-2 self-start rounded-xl bg-primary px-6 text-sm font-semibold text-primary-foreground transition-opacity duration-200 hover:opacity-90"
            >
              <Plus size={16} aria-hidden="true" />
              Add your first address
            </button>
          ) : null}
        </>
      )}
    </Container>
  );
}
