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
import { CustomersPage } from '../pages/CustomersPage.jsx';
import { CustomerDetailPage } from '../pages/CustomerDetailPage.jsx';
import { ReviewsPage } from '../pages/ReviewsPage.jsx';
import { InventoryPage } from '../pages/InventoryPage.jsx';
import { CouponsPage } from '../pages/CouponsPage.jsx';
import { MarketingNotificationsPage } from '../pages/MarketingNotificationsPage.jsx';
import { AnnouncementsPage } from '../pages/AnnouncementsPage.jsx';
import { CouponNewPage } from '../pages/CouponNewPage.jsx';
import { CouponEditPage } from '../pages/CouponEditPage.jsx';
import { NotFoundPage } from '../pages/NotFoundPage.jsx';

/**
 * Admin route tree. Public: `/login`. Everything else is ADMIN-gated via
 * `ProtectedRoute` (session bootstrap + role check; backend authorization
 * stays authoritative). Internal navigation only — no `window.location`.
 */
export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <AdminLayout />,
        children: [
          { path: '/', element: <Navigate to="/dashboard" replace /> },
          { path: '/dashboard', element: <DashboardPage /> },
          { path: '/catalog/categories', element: <CategoriesPage /> },
          { path: '/catalog/products', element: <ProductsPage /> },
          { path: '/catalog/products/new', element: <ProductNewPage /> },
          { path: '/catalog/products/:id/edit', element: <ProductEditPage /> },
          { path: '/orders', element: <OrdersPage /> },
          { path: '/orders/:id', element: <OrderDetailPage /> },
          { path: '/inventory', element: <InventoryPage /> },
          { path: '/customers', element: <CustomersPage /> },
          { path: '/customers/:id', element: <CustomerDetailPage /> },
          { path: '/reviews', element: <ReviewsPage /> },
          { path: '/catalog/coupons', element: <CouponsPage /> },
          { path: '/catalog/coupons/new', element: <CouponNewPage /> },
          { path: '/catalog/coupons/:id/edit', element: <CouponEditPage /> },
          { path: '/marketing/notifications', element: <MarketingNotificationsPage /> },
          { path: '/marketing/announcements', element: <AnnouncementsPage /> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
  { path: '*', element: <Navigate to="/login" replace /> },
]);
