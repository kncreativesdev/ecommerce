import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ChevronRight, History, ReceiptText } from 'lucide-react';
import { toast } from 'sonner';
import { useCouponStore } from '../stores/useCouponStore.js';
import { useAuthStore } from '../stores/useAuthStore.js';
import { fetchCouponById } from '../services/coupon.service.js';
import { fetchProducts } from '../services/product.service.js';
import { CouponForm } from '../components/catalog/CouponForm.jsx';
import { CouponHistory } from '../components/catalog/CouponHistory.jsx';
import { EmptyState } from '../components/ui/EmptyState.jsx';
import { ErrorState } from '../components/ui/ErrorState.jsx';
import { Modal } from '../components/ui/Modal.jsx';
import { couponUsageSummary } from '../utils/coupons.js';

/**
 * Edit Coupon (`/catalog/coupons/:id/edit`). Loads the documented
 * `GET /coupons/:id` directly (deep-link safe, independent of list state —
 * the list payload already carries every field, so nothing is lost).
 * Only backend-accepted fields are editable; `usedCount` renders
 * read-only (server-incremented, never submitted). Success reconciles the
 * list mirror from the server response and preserves filters/search (no
 * refetch). Unknown ids render the not-found state.
 */
export function CouponEditPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  // Product eligibility list follows the caller's read scope (see CouponNewPage).
  const isAdmin = useAuthStore((state) => state.isAdmin());
  const updateCoupon = useCouponStore((state) => state.updateCoupon);
  const [coupon, setCoupon] = useState(null);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState(null);
  const [products, setProducts] = useState([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [prevId, setPrevId] = useState(id);

  // Render-time reset when navigating between coupon ids (sanctioned
  // derived-state pattern); the effect below only syncs the async fetch.
  if (prevId !== id) {
    setPrevId(id);
    setCoupon(null);
    setError(null);
    setStatus('loading');
    setHistoryOpen(false);
  }

  // Stable modal close handler: Modal focuses itself whenever its onClose
  // identity changes, so an inline arrow would steal focus on every parent
  // render (same pattern as the inventory history modal).
  const closeHistory = useCallback(() => {
    setHistoryOpen(false);
  }, []);

  useEffect(() => {
    document.title = 'Edit Coupon — Tech Pulse Admin';
    let cancelled = false;
    fetchCouponById(id)
      .then((record) => {
        if (cancelled) return;
        if (!record) {
          setStatus('not-found');
          return;
        }
        setCoupon(record);
        setStatus('ready');
      })
      .catch((fetchError) => {
        if (cancelled) return;
        if (fetchError?.status === 404 || fetchError?.code === 'COUPON_NOT_FOUND') {
          setStatus('not-found');
        } else {
          setError({ message: fetchError?.message ?? 'Failed to load the coupon.' });
          setStatus('error');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [id, reloadToken]);

  useEffect(() => {
    let cancelled = false;
    fetchProducts(isAdmin ? 'all' : 'active')
      .then((rows) => {
        if (!cancelled) setProducts(Array.isArray(rows) ? rows : []);
      })
      .catch(() => {
        if (!cancelled) setProducts([]);
      })
      .finally(() => {
        if (!cancelled) setProductsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  const reload = () => {
    setError(null);
    setStatus('loading');
    setReloadToken((token) => token + 1);
  };

  const handleSubmit = async (payload) => {
    setSubmitting(true);
    try {
      const record = await updateCoupon(id, payload);
      toast.success(`Coupon “${record?.code ?? coupon?.code}” saved.`);
      navigate('/catalog/coupons');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-sm">
        <Link to="/catalog/coupons" className="text-muted-foreground transition-colors hover:text-foreground hover:no-underline">
          Coupons
        </Link>
        <ChevronRight size={14} aria-hidden="true" className="text-muted-foreground" />
        <span aria-current="page" className="font-medium text-foreground">
          Edit{coupon?.code ? ` ${coupon.code}` : ' coupon'}
        </span>
      </nav>

      {status === 'loading' ? (
        <div role="status" aria-label="Loading coupon" className="flex flex-col gap-3">
          <div aria-hidden="true" className="h-10 w-1/3 animate-pulse rounded-lg bg-surface-muted" />
          <div aria-hidden="true" className="h-64 animate-pulse rounded-xl bg-surface-muted" />
        </div>
      ) : status === 'not-found' ? (
        <EmptyState
          icon={ReceiptText}
          title="Coupon not found"
          message="This coupon does not exist or is no longer accessible. Return to the coupons list."
          actionTo="/catalog/coupons"
          actionLabel="Back to coupons"
        />
      ) : status === 'error' ? (
        <ErrorState title="Couldn’t load the coupon" message={error?.message} onRetry={reload} />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-mono text-xl font-bold tracking-tight text-foreground">{coupon.code}</h2>
            <span className="flex flex-wrap items-center gap-2">
              <p className="text-sm tabular-nums text-muted-foreground">{couponUsageSummary(coupon)} · usage is server-managed</p>
              <button
                type="button"
                onClick={() => setHistoryOpen(true)}
                aria-label={`View coupon history for ${coupon.code}`}
                title="Coupon history"
                className="inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
              >
                <History size={17} aria-hidden="true" />
              </button>
            </span>
          </div>
          <CouponForm
            key={coupon.id}
            initialValue={coupon}
            products={products}
            productsLoading={productsLoading}
            onSubmit={handleSubmit}
            submitting={submitting}
          />
        </>
      )}

      {historyOpen && coupon ? (
        <Modal title={`Coupon history — ${coupon.code}`} onClose={closeHistory}>
          <CouponHistory key={coupon.id} couponId={coupon.id} />
        </Modal>
      ) : null}
    </div>
  );
}
