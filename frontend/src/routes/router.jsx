import { Navigate, createBrowserRouter } from 'react-router-dom';
import { Layout } from '../components/layout/Layout.jsx';
import { ProtectedRoute } from './ProtectedRoute.jsx';
import { OrderAliasRedirect, ProductAliasRedirect } from './AliasRedirects.jsx';
import { HomePage } from '../pages/HomePage.jsx';
import { ShopPage } from '../pages/ShopPage.jsx';
import { CategoryPage } from '../pages/CategoryPage.jsx';
import { SearchPage } from '../pages/SearchPage.jsx';
import { ProductDetailPage } from '../pages/ProductDetailPage.jsx';
import { AboutPage } from '../pages/AboutPage.jsx';
import { SupportPage } from '../pages/SupportPage.jsx';
import { CartPage } from '../pages/CartPage.jsx';
import { WishlistPage } from '../pages/WishlistPage.jsx';
import { LoginPage } from '../pages/LoginPage.jsx';
import { RegisterPage } from '../pages/RegisterPage.jsx';
import { AccountDashboardPage } from '../pages/AccountDashboardPage.jsx';
import { ProfilePage } from '../pages/ProfilePage.jsx';
import { AddressesPage } from '../pages/AddressesPage.jsx';
import { OrdersPage } from '../pages/OrdersPage.jsx';
import { OrderDetailPage } from '../pages/OrderDetailPage.jsx';
import { ReviewsPage } from '../pages/ReviewsPage.jsx';
import { CheckoutPage } from '../pages/CheckoutPage.jsx';
import { OrderConfirmationPage } from '../pages/OrderConfirmationPage.jsx';
import { NotFoundPage } from '../pages/NotFoundPage.jsx';

/**
 * Route tree (Milestone 1 — routing foundation).
 *
 * Canonical paths follow the documented architecture (PAGES.md /
 * FRONTEND_ARCHITECTURE.md §3): product reads use singular `/product/:id`
 * with backend UUIDs, account areas nest under `/account`.
 *
 * Compatibility aliases: the Milestone 1 brief listed plural variants
 * (`/products`, `/products/:id`, `/new-arrivals`, `/orders`, `/orders/:id`).
 * Those redirect to the canonical documented routes so both spellings
 * resolve without forking the page structure.
 */
export const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      // Public storefront routes
      { path: '/', element: <HomePage /> },
      { path: '/shop', element: <ShopPage /> },
      { path: '/category/:id', element: <CategoryPage /> },
      { path: '/search', element: <SearchPage /> },
      { path: '/product/:id', element: <ProductDetailPage /> },
      { path: '/about', element: <AboutPage /> },
      { path: '/support', element: <SupportPage /> },
      { path: '/login', element: <LoginPage /> },
      { path: '/register', element: <RegisterPage /> },
      { path: '/order-confirmation/:id', element: <OrderConfirmationPage /> },

      // Guest-browsable: cart/wishlist work locally when logged out and
      // merge into the account on login. Checkout and account areas stay
      // protected (genuinely account-specific operations).
      { path: '/cart', element: <CartPage /> },
      { path: '/wishlist', element: <WishlistPage /> },

      // Protected routes (auth gate lands in the authentication milestone)
      {
        element: <ProtectedRoute />,
        children: [
          { path: '/account', element: <AccountDashboardPage /> },
          { path: '/account/profile', element: <ProfilePage /> },
          { path: '/account/addresses', element: <AddressesPage /> },
          { path: '/account/orders', element: <OrdersPage /> },
          { path: '/account/orders/:id', element: <OrderDetailPage /> },
          { path: '/account/reviews', element: <ReviewsPage /> },
          { path: '/checkout', element: <CheckoutPage /> },
        ],
      },

      // Compatibility aliases for the plural spellings in the milestone brief
      { path: '/products', element: <Navigate to="/shop" replace /> },
      { path: '/products/:id', element: <ProductAliasRedirect /> },
      { path: '/new-arrivals', element: <Navigate to="/shop?sort=newest" replace /> },
      { path: '/orders', element: <Navigate to="/account/orders" replace /> },
      { path: '/orders/:id', element: <OrderAliasRedirect /> },

      // Fallback
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
