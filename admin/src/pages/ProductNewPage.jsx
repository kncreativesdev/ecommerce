import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { useTaxonomy } from '../hooks/useTaxonomy.js';
import { useProductStore } from '../stores/useProductStore.js';
import { buildCreateProductPayload } from '../utils/productPayload.js';
import { mediaUploadErrorMessage } from '../utils/imageSelection.js';
import { uploadProductImage } from '../services/media.service.js';
import { ProductForm } from '../components/catalog/ProductForm.jsx';

/**
 * Create Product (`/catalog/products/new`). Submits the documented
 * `POST /products` payload via the payload adapter (parent category →
 * `categoryId`; subcategory kept as UI state, never sent; `variants[]`
 * inline — at least one variant is required and the backend creates them
 * with the product, returning real IDs).
 *
 * Images live INSIDE their variant (no product-level upload for new
 * products). Files are LOCAL File objects only (previews via object URLs,
 * never persisted). They upload SEQUENTIALLY through the existing
 * `POST /products/:id/images` endpoint AFTER the server returns real
 * IDs — each variant's files against its own created variant ID (matched
 * by SKU, unique per backend contract). The first file of each variant is
 * flagged primary with `sortOrder` 0, 1, 2, … so the storefront gallery
 * has a deterministic main image and order. Uploads against nonexistent
 * IDs are never attempted. Truthful outcomes:
 * - all uploaded → success toast naming the counts;
 * - partial → success toast for the product PLUS an explicit error toast
 *   naming each failed file (successes are kept, never rolled back — the
 *   admin continues from the edit galleries);
 * - product failure → error toast, no uploads attempted.
 * Navigation always lands on the edit page (canonical continuity — the
 * galleries there render the authoritative uploaded records, no refresh).
 */
export function ProductNewPage() {
  const navigate = useNavigate();
  const { categories } = useTaxonomy();
  const createProduct = useProductStore((state) => state.createProduct);
  const [submitting, setSubmitting] = useState(false);
  const [mediaProgress, setMediaProgress] = useState(null);

  useEffect(() => {
    document.title = 'New Product — Tech Pulse Admin';
  }, []);

  const uploadOne = async (productId, file, meta, label, failures) => {
    try {
      await uploadProductImage(productId, { file, ...meta });
      return true;
    } catch (uploadError) {
      failures.push(`${label}: ${mediaUploadErrorMessage(uploadError)}`);
      return false;
    }
  };

  const handleSubmit = async ({ parentCategoryId, subcategoryId, fields, variants }, mediaAction) => {
    setSubmitting(true);
    setMediaProgress('Creating product…');
    try {
      const payload = buildCreateProductPayload({ parentCategoryId, subcategoryId, fields, variants });
      const record = await createProduct(payload);
      if (!record?.id) {
        throw new Error('Product creation did not return a product. Please try again.');
      }
      const variantImages = mediaAction?.variantImages ?? [];
      const totalFiles = variantImages.reduce((sum, entry) => sum + entry.files.length, 0);
      const productName = record?.name ?? fields.name;

      if (totalFiles === 0) {
        // Unreachable through the form (every variant requires an image),
        // kept as a truthful guard for programmatic callers.
        toast.success(`“${productName}” created.`);
      } else {
        const failures = [];
        let uploaded = 0;
        let step = 0;
        // The backend accepts one file per request — upload sequentially
        // so a single failure never aborts or duplicates the rest.
        const createdVariants = Array.isArray(record.variants) ? record.variants : [];
        for (const entry of variantImages) {
          // Match the created variant by SKU (unique per backend contract);
          // a missing match fails truthfully instead of uploading blindly
          // (never against a fake ID, never against another variant).
          const match =
            createdVariants.find((variant) => variant.sku === entry.sku) ??
            createdVariants.find((variant) => variant.sku?.toLowerCase() === entry.sku?.toLowerCase());
          if (!match?.id) {
            for (const file of entry.files) {
              failures.push(`${entry.sku} / ${file?.name ?? 'image'}: created variant not found — files not uploaded.`);
            }
            continue;
          }
          for (let fileIndex = 0; fileIndex < entry.files.length; fileIndex += 1) {
            const file = entry.files[fileIndex];
            step += 1;
            setMediaProgress(`Uploading image ${step} of ${totalFiles}…`);
            // First file per variant is the primary storefront image;
            // explicit sortOrder keeps the gallery deterministic.
            const meta =
              fileIndex === 0
                ? { variantId: match.id, sortOrder: 0, isPrimary: true }
                : { variantId: match.id, sortOrder: fileIndex };
            if (await uploadOne(record.id, file, meta, `${entry.sku} / ${file?.name ?? 'image'}`, failures)) {
              uploaded += 1;
            }
          }
        }
        setMediaProgress('Finalizing…');
        if (failures.length === 0) {
          toast.success(`“${productName}” created with ${uploaded} ${uploaded === 1 ? 'image' : 'images'}.`);
        } else {
          toast.success(`“${productName}” created.`);
          toast.error(
            `Created, but ${failures.length} of ${totalFiles} ${totalFiles === 1 ? 'image' : 'images'} failed — successful uploads are kept. ${failures.join(' ')} Re-select the failed files in the media gallery.`,
            { duration: 10000 },
          );
        }
      }

      // Canonical continuity: the edit galleries render the authoritative
      // uploaded records with no refresh required.
      navigate(`/catalog/products/${record.id}/edit`, { replace: true });
    } catch (error) {
      toast.error(error?.message ?? 'Product creation failed.');
      throw error;
    } finally {
      setSubmitting(false);
      setMediaProgress(null);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-sm">
        <Link to="/catalog/products" className="text-muted-foreground transition-colors hover:text-foreground hover:no-underline">
          Products
        </Link>
        <ChevronRight size={14} aria-hidden="true" className="text-muted-foreground" />
        <span aria-current="page" className="font-medium text-foreground">New product</span>
      </nav>
      <h2 className="text-xl font-bold tracking-tight text-foreground">New Product</h2>
      <ProductForm categories={categories} onSubmit={handleSubmit} submitting={submitting} mediaProgress={mediaProgress} />
    </div>
  );
}
