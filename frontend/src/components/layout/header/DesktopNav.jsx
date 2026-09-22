import { NavLink } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../../lib/cn.js';

/**
 * Center cluster of the desktop navbar: Categories trigger (mega menu) +
 * New Arrivals / About Us / Support links, in documented order.
 */
export function DesktopNav({ megaOpen, onCategoriesEnter, onCategoriesLeave, onCategoriesToggle, triggerRef }) {
  return (
    <nav aria-label="Primary" className="hidden items-center gap-1 lg:flex">
      <div onMouseEnter={onCategoriesEnter} onMouseLeave={onCategoriesLeave}>
        <button
          ref={triggerRef}
          type="button"
          onClick={onCategoriesToggle}
          onFocus={onCategoriesEnter}
          aria-haspopup="true"
          aria-expanded={megaOpen}
          className={cn(
            'inline-flex min-h-[44px] cursor-pointer items-center gap-1.5 rounded-lg px-3.5 text-[13px] font-semibold uppercase tracking-wide transition-colors duration-200 hover:no-underline',
            megaOpen ? 'text-accent' : 'text-header-foreground hover:text-accent',
          )}
        >
          Categories
          <ChevronDown
            size={15}
            strokeWidth={2.5}
            aria-hidden="true"
            className={cn('transition-transform duration-200', megaOpen && 'rotate-180')}
          />
        </button>
      </div>

      <NavLink
        to="/shop?sort=newest"
        className={({ isActive }) =>
          cn(
            'inline-flex min-h-[44px] items-center rounded-lg px-3.5 text-[13px] font-semibold uppercase tracking-wide transition-colors duration-200 hover:no-underline',
            isActive ? 'text-accent' : 'text-header-foreground hover:text-accent',
          )
        }
      >
        New Arrivals
      </NavLink>
      <NavLink
        to="/about"
        className={({ isActive }) =>
          cn(
            'inline-flex min-h-[44px] items-center rounded-lg px-3.5 text-[13px] font-semibold uppercase tracking-wide transition-colors duration-200 hover:no-underline',
            isActive ? 'text-accent' : 'text-header-foreground hover:text-accent',
          )
        }
      >
        About Us
      </NavLink>
      <NavLink
        to="/support"
        className={({ isActive }) =>
          cn(
            'inline-flex min-h-[44px] items-center rounded-lg px-3.5 text-[13px] font-semibold uppercase tracking-wide transition-colors duration-200 hover:no-underline',
            isActive ? 'text-accent' : 'text-header-foreground hover:text-accent',
          )
        }
      >
        Support
      </NavLink>
    </nav>
  );
}
