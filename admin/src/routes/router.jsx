import { Navigate, createBrowserRouter } from 'react-router-dom';
import { AdminLayout } from '../components/layout/AdminLayout.jsx';
import { ProtectedRoute } from '../components/layout/ProtectedRoute.jsx';
import { LoginPage } from '../pages/LoginPage.jsx';
import { DashboardPage } from '../pages/DashboardPage.jsx';
import { CategoriesPage } from '../pages/CategoriesPage.jsx';
import { ProductsPage } from '../pages/ProductsPage.jsx';
import { ProductNewPage } from '../pages/ProductNewPage.jsx';
import { ProductEditPage } from '../pages/ProductEditPage.jsx';
import { OrdersPage } from '../pages/OrdersPage.jsx';
import { OrderDetailPage } from '../pages/OrderDetailPage.jsx';
import { ReturnsPage } from '../pages/ReturnsPage.jsx';
import { ReturnDetailPage } from '../pages/ReturnDetailPage.jsx';
import { CustomersPage } from '../pages/CustomersPage.jsx';
import { CustomerDetailPage } from '../pages/CustomerDetailPage.jsx';
import { ReviewsPage } from '../pages/ReviewsPage.jsx';
import { CompaniesPage } from '../pages/CompaniesPage.jsx';
import { CompanyDetailPage } from '../pages/CompanyDetailPage.jsx';
import { PlatformDashboardPage } from '../pages/PlatformDashboardPage.jsx';
import { AuditLogsPage } from '../pages/AuditLogsPage.jsx';
import { AuditDashboardPage } from '../pages/AuditDashboardPage.jsx';
import { AuditRetentionPage } from '../pages/AuditRetentionPage.jsx';
import { InventoryPage } from '../pages/InventoryPage.jsx';
import { CouponsPage } from '../pages/CouponsPage.jsx';
import { MarketingNotificationsPage } from '../pages/MarketingNotificationsPage.jsx';
import { AnnouncementsPage } from '../pages/AnnouncementsPage.jsx';
import { MembersPage } from '../pages/MembersPage.jsx';
import { MemberDetailPage } from '../pages/MemberDetailPage.jsx';
import { CouponNewPage } from '../pages/CouponNewPage.jsx';
import { CouponEditPage } from '../pages/CouponEditPage.jsx';
import { NotFoundPage } from '../pages/NotFoundPage.jsx';
import { ADMIN_PANEL_ROLES } from '../lib/roles.js';

/**
 * Admin route tree. Public: `/login`. Everything else sits behind
 * `ProtectedRoute` with explicit per-branch roles (backend
 * authorization stays authoritative):
 * - operational routes: ADMIN-only, except the Phase 4-1 HEAD slice
 *   (catalog categories/products, orders, inventory, coupons), which
 *   admits ADMIN + HEAD to match the backend RBAC contract, and the
 *   Phase 4-5 MEMBER slice (same pages, except coupon write routes),
 *   which admits ADMIN + HEAD + MEMBER;
 * - coupon write routes (`/catalog/coupons/new`, `/edit`): ADMIN + HEAD
 *   only (MEMBER holds coupon:READ — backend 403s writes);
 * - team member management (`/team`, `/team/:id`): ADMIN + HEAD only
 *   (Phase 4-8: HEAD manages MEMBERs, ADMIN manages HEAD/MEMBER —
 *   backend `authorize("ADMIN", "HEAD")` + in-service target guards);
 * - `/audit-logs` + `/audit-dashboard`: the four common admin-panel roles (the backend
 *   audit API serves SUPER_ADMIN/ADMIN/HEAD/MEMBER).
 * - `/audit-retention` + `/companies` + `/companies/:id` + `/platform`:
 *   SUPER_ADMIN only (platform metadata + aggregate counts, never
 *   operational rows).
 * Internal navigation only — no `window.location`.
 */
export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: <ProtectedRoute allowedRoles={['ADMIN']} />,
    children: [
      {
        element: <AdminLayout />,
        children: [
          { path: '/', element: <Navigate to="/dashboard" replace /> },
          { path: '/dashboard', element: <DashboardPage /> },
          { path: '/returns', element: <ReturnsPage /> },
          { path: '/returns/:id', element: <ReturnDetailPage /> },
          { path: '/customers', element: <CustomersPage /> },
          { path: '/customers/:id', element: <CustomerDetailPage /> },
          { path: '/reviews', element: <ReviewsPage /> },
          { path: '/marketing/notifications', element: <MarketingNotificationsPage /> },
          { path: '/marketing/announcements', element: <AnnouncementsPage /> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
  {
    element: <ProtectedRoute allowedRoles={['ADMIN', 'HEAD', 'MEMBER']} />,
    children: [
      {
        element: <AdminLayout />,
        children: [
          { path: '/catalog/categories', element: <CategoriesPage /> },
          { path: '/catalog/products', element: <ProductsPage /> },
          { path: '/catalog/products/new', element: <ProductNewPage /> },
          { path: '/catalog/products/:id/edit', element: <ProductEditPage /> },
          { path: '/orders', element: <OrdersPage /> },
          { path: '/orders/:id', element: <OrderDetailPage /> },
          { path: '/inventory', element: <InventoryPage /> },
          { path: '/catalog/coupons', element: <CouponsPage /> },
        ],
      },
    ],
  },
  {
    element: <ProtectedRoute allowedRoles={['ADMIN', 'HEAD']} />,
    children: [
      {
        element: <AdminLayout />,
        children: [
          { path: '/catalog/coupons/new', element: <CouponNewPage /> },
          { path: '/catalog/coupons/:id/edit', element: <CouponEditPage /> },
          { path: '/team', element: <MembersPage /> },
          { path: '/team/:id', element: <MemberDetailPage /> },
        ],
      },
    ],
  },
  {
    element: <ProtectedRoute allowedRoles={ADMIN_PANEL_ROLES} />,
    children: [
      {
        element: <AdminLayout />,
        children: [
          { path: '/audit-logs', element: <AuditLogsPage /> },
          { path: '/audit-dashboard', element: <AuditDashboardPage /> },
        ],
      },
    ],
  },
  {
    element: <ProtectedRoute allowedRoles={['SUPER_ADMIN']} />,
    children: [
      {
        element: <AdminLayout />,
        children: [
          { path: '/platform', element: <PlatformDashboardPage /> },
          { path: '/audit-retention', element: <AuditRetentionPage /> },
          { path: '/companies', element: <CompaniesPage /> },
          { path: '/companies/:id', element: <CompanyDetailPage /> },
        ],
      },
    ],
  },
  { path: '*', element: <Navigate to="/login" replace /> },
]);
