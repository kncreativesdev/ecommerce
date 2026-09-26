import { Navigate, useSearchParams } from 'react-router-dom';

/**
 * Search (`/search?q=...`, public): canonical catalog lives in `/shop?q=...`
 * (single filterable product-listing system). This route preserves old
 * bookmarks/links by redirecting to the shop with the same query — no
 * second listing implementation, no stale search state. Removing `q` on the
 * shop returns to normal browsing; back/forward stays coherent via URL
 * params.
 */
export function SearchPage() {
  const [searchParams] = useSearchParams();
  const query = (searchParams.get('q') ?? '').trim();
  const target = query ? `/shop?q=${encodeURIComponent(query)}` : '/shop';
  return <Navigate to={target} replace />;
}
