import { cn } from '../../lib/cn.js';

/**
 * Responsive page container: `max-w-7xl` with `px-4 sm:px-6 lg:px-8` gutters.
 * Single source for the content width so later milestones stay consistent.
 */
export function Container({ className, as: Tag = 'div', ...props }) {
  return <Tag className={cn('tp-container', className)} {...props} />;
}
