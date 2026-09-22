import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { useCouponStore } from '../stores/useCouponStore.js';
import { fetchProducts } from '../services/product.service.js';
import { CouponForm } from '../components/catalog/CouponForm.jsx';

/**
 * Create Coupon (`/catalog/coupons/new`). Submits the documented
 * `POST /coupons` payload — only backend-supported fields (the form never
 * holds `usedCount`, per-customer limits, or category rules: none exist).
 * Success → toast + refresh (truthful totals) + back to the list.
 * Failures map to form fields inside `CouponForm`; no success is shown.
 */
export function CouponNewPage() {
  const navigate = useNavigate();
  const createCoupon = useCouponStore((state) => state.createCoupon);
  const refreshCoupons = useCouponStore((state) => state.refreshCoupons);
  const [products, setProducts] = useState([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    document.title = 'New Coupon — Tech Pulse Admin';
    let cancelled = false;
    fetchProducts('all')
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
  }, []);

  const handleSubmit = async (payload) => {
    setSubmitting(true);
    try {
      const record = await createCoupon(payload);
      toast.success(`Coupon “${record?.code ?? payload.code}” created.`);
      await refreshCoupons();
      navigate('/catalog/coupons', { replace: true });
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
        <span aria-current="page" className="font-medium text-foreground">New coupon</span>
      </nav>
      <h2 className="text-xl font-bold tracking-tight text-foreground">New Coupon</h2>
      <CouponForm products={products} productsLoading={productsLoading} onSubmit={handleSubmit} submitting={submitting} />
    </div>
  );
}
