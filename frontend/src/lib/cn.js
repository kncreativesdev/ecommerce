import clsx from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge conditional class names with Tailwind conflict resolution.
 * The single class-composition helper for the whole storefront.
 */
export function cn(...inputs) {
  return twMerge(clsx(...inputs));
}
