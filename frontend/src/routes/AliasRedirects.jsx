import { Navigate, useParams } from 'react-router-dom';

/**
 * Compatibility alias redirects for the plural spellings listed in the
 * Milestone 1 brief. Canonical routes stay singular per the documented
 * architecture — these only forward.
 */
export function ProductAliasRedirect() {
  const { id } = useParams();
  return <Navigate to={id ? `/product/${id}` : '/shop'} replace />;
}

export function OrderAliasRedirect() {
  const { id } = useParams();
  return <Navigate to={id ? `/account/orders/${id}` : '/account/orders'} replace />;
}
