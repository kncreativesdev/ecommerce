import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ChevronRight, PackageSearch } from 'lucide-react';
import { toast } from 'sonner';
import { useTaxonomy } from '../hooks/useTaxonomy.js';
import { useProductStore } from '../stores/useProductStore.js';
import { fetchProductById } from '../services/product.service.js';
import { buildUpdateProductPayload } from '../utils/productPayload.js';
import { ProductForm } from '../components/catalog/ProductForm.jsx';
import { VariantManager } from '../components/catalog/VariantManager.jsx';
import { InventoryManager } from '../components/catalog/InventoryManager.jsx';
import { MediaManager } from '../components/catalog/MediaManager.jsx';
import { EmptyState } from '../components/ui/EmptyState.jsx';
import { ErrorState } from '../components/ui/ErrorState.jsx';

/**
 * Edit Product (`/catalog/products/:id/edit`). Loads the documented
 * `GET /products/:id` directly (deep-link safe, independent of list
 * state), then submits `PATCH /products/:id` via the payload adapter.
 * Detail is read with the admin `?status=all` scope so deactivated
 * products stay editable and reactivatable (via the form's Active
 * checkbox). Product fields via `ProductForm`; variants via
 * `VariantManager` (dedicated variant endpoints) below.
 */
export function ProductEditPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { categories } = useTaxonomy();
  const updateProduct = useProductStore((state) => state.updateProduct);
  const syncProduct = useProductStore((state) => state.syncProduct);
  const [product, setProduct] = useState(null);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [prevId, setPrevId] = useState(id);

  // Render-time reset when navigating between product ids (sanctioned
  // derived-state pattern); the effect below only syncs the async fetch.
  if (prevId !== id) {
    setPrevId(id);
    setProduct(null);
    setError(null);
    setStatus('loading');
  }

  useEffect(() => {
    document.title = 'Edit Product — Tech Pulse Admin';
    let cancelled = false;
    fetchProductById(id, 'all')
      .then((record) => {
        if (cancelled) return;
        if (!record) {
          setStatus('not-found');
          return;
        }
        setProduct(record);
        document.title = `Edit ${record.name} — Tech Pulse Admin`;
        setStatus('ready');
      })
      .catch((fetchError) => {
        if (cancelled) return;
        if (fetchError?.status === 404 || fetchError?.code === 'PRODUCT_NOT_FOUND') {
          setStatus('not-found');
        } else {
          setError({ message: fetchError?.message ?? 'Failed to load the product.' });
          setStatus('error');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [id, reloadToken]);

  const reload = () => {
    setError(null);
    setStatus('loading');
    setReloadToken((token) => token + 1);
  };

  // Silent refresh after variant mutations (no skeleton flash): refetch the
  // product detail and sync the list mirror (admin scope — inactive-safe).
  const refreshProduct = async () => {
    const record = await fetchProductById(id, 'all');
    if (record) {
      setProduct(record);
      syncProduct(record);
    }
  };

  const handleSubmit = async ({ parentCategoryId, subcategoryId, fields }) => {
    setSubmitting(true);
    try {
      const payload = buildUpdateProductPayload({ parentCategoryId, subcategoryId, fields });
      const record = await updateProduct(id, payload);
      toast.success(`“${record?.name ?? fields.name}” saved.`);
      navigate('/catalog/products', { replace: true });
    } catch (submitError) {
      toast.error(submitError?.message ?? 'Save failed.');
      throw submitError;
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-sm">
        <Link to="/catalog/products" className="text-muted-foreground transition-colors hover:text-foreground hover:no-underline">
          Products
        </Link>
        <ChevronRight size={14} aria-hidden="true" className="text-muted-foreground" />
        <span aria-current="page" className="font-medium text-foreground">Edit product</span>
      </nav>
      <h2 className="text-xl font-bold tracking-tight text-foreground">
        {product ? `Edit “${product.name}”` : 'Edit Product'}
      </h2>

      {status === 'loading' ? (
        <div role="status" aria-label="Loading product" className="flex flex-col gap-3">
          {[0, 1, 2].map((index) => (
            <div key={index} aria-hidden="true" className="h-32 animate-pulse rounded-xl bg-surface-muted" />
          ))}
        </div>
      ) : status === 'not-found' ? (
        <EmptyState
          icon={PackageSearch}
          title="Product not found"
          message="This product doesn’t exist or is no longer available."
          actionTo="/catalog/products"
          actionLabel="Back to products"
        />
      ) : status === 'error' ? (
        <ErrorState title="Couldn’t load this product" message={error?.message} onRetry={reload} />
      ) : (
        <>
          <ProductForm
            key={product.id}
            initialValue={product}
            categories={categories}
            onSubmit={handleSubmit}
            submitting={submitting}
          />
          <div className="mt-5">
            <VariantManager product={product} onChanged={refreshProduct} />
          </div>
          <div className="mt-5">
            <InventoryManager
              productId={product.id}
              variants={Array.isArray(product.variants) ? product.variants : []}
            />
          </div>
          <div className="mt-5">
            <MediaManager
              productId={product.id}
              productName={product.name}
              variants={Array.isArray(product.variants) ? product.variants : []}
            />
          </div>
        </>
      )}
    </div>
  );
}
