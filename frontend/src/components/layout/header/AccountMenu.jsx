import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Heart, LogIn, LogOut, Package, UserPlus, UserRound } from 'lucide-react';
import { useSession } from '../../../hooks/useSession.js';
import { dropdownVariants } from '../../../lib/menuMotion.js';

/**
 * Account dropdown. Renders the unauthenticated state (sign in / register)
 * through the `useSession` seam — no fake user, no tokens, no backend calls.
 * The authenticated branch is implemented against the future session shape so
 * the auth milestone only swaps the seam. Escape or outside interaction is
 * handled by the parent via `onClose`.
 */
export function AccountMenu({ onClose, onNavigate }) {
  const { user, isAuthenticated, signOut } = useSession();
  const navigate = useNavigate();

  const go = (to) => {
    onNavigate();
    navigate(to);
  };

  return (
    <motion.div
      role="menu"
      aria-label="Account"
      variants={dropdownVariants}
      initial="hidden"
      animate="visible"
      exit="hidden"
      style={{ transformOrigin: 'top right' }}
      className="absolute right-0 top-[calc(100%+10px)] z-50 w-72 overflow-hidden rounded-2xl border border-border bg-surface-elevated shadow-2xl"
    >
      {isAuthenticated ? (
        <div className="p-2">
          <p className="px-3 pb-1 pt-2 text-xs text-muted-foreground">
            Signed in{user?.email ? ` as ${user.email}` : ''}
          </p>
          <Link
            to="/account"
            role="menuitem"
            onClick={onNavigate}
            className="flex min-h-[44px] items-center gap-3 rounded-xl px-3 text-sm font-medium text-foreground transition-colors duration-200 hover:bg-surface-muted hover:no-underline"
          >
            <UserRound size={17} aria-hidden="true" className="text-muted-foreground" />
            My Account
          </Link>
          <Link
            to="/account/orders"
            role="menuitem"
            onClick={onNavigate}
            className="flex min-h-[44px] items-center gap-3 rounded-xl px-3 text-sm font-medium text-foreground transition-colors duration-200 hover:bg-surface-muted hover:no-underline"
          >
            <Package size={17} aria-hidden="true" className="text-muted-foreground" />
            Orders
          </Link>
          <Link
            to="/wishlist"
            role="menuitem"
            onClick={onNavigate}
            className="flex min-h-[44px] items-center gap-3 rounded-xl px-3 text-sm font-medium text-foreground transition-colors duration-200 hover:bg-surface-muted hover:no-underline"
          >
            <Heart size={17} aria-hidden="true" className="text-muted-foreground" />
            Wishlist
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              signOut();
              onClose();
            }}
            className="flex min-h-[44px] w-full cursor-pointer items-center gap-3 rounded-xl px-3 text-sm font-medium text-foreground transition-colors duration-200 hover:bg-surface-muted"
          >
            <LogOut size={17} aria-hidden="true" className="text-muted-foreground" />
            Sign Out
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-1 p-4">
          <p className="text-sm font-semibold text-foreground">Welcome to Tech Pulse</p>
          <p className="text-xs leading-5 text-muted-foreground">
            Sign in to track orders, manage your cart and save your wishlist.
          </p>
          <button
            type="button"
            onClick={() => go('/login')}
            className="mt-2 inline-flex min-h-[44px] cursor-pointer items-center justify-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-accent-foreground transition-colors duration-200 hover:bg-accent-hover"
          >
            <LogIn size={16} aria-hidden="true" />
            Sign In
          </button>
          <button
            type="button"
            onClick={() => go('/register')}
            className="inline-flex min-h-[44px] cursor-pointer items-center justify-center gap-2 rounded-xl border border-border px-5 py-2.5 text-sm font-semibold text-secondary-foreground transition-colors duration-200 hover:bg-surface-muted"
          >
            <UserPlus size={16} aria-hidden="true" />
            Create Account
          </button>
        </div>
      )}
    </motion.div>
  );
}
