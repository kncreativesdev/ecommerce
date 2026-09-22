/**
 * Shared enter/exit motion for dropdowns, menus, and overlays.
 *
 * Design-system alignment: durations follow the `--tp-duration-*` motion
 * tokens in `src/index.css` (fast 150ms / base 200ms / slow 300ms) and the
 * easing matches `--tp-ease-out` (`cubic-bezier(0, 0, 0.2, 1)`).
 *
 * Rules:
 * - Animate ONLY opacity + transform (GPU-friendly, theme-invariant).
 * - Never animate colors, shadows, or backgrounds here.
 * - Small dropdowns use a subtle fade + rise + scale from their trigger.
 * - Full-width/large panels use fade + rise without scale.
 * - `hidden` sets `pointerEvents: 'none'` so an exiting menu cannot
 *   intercept clicks while it fades out.
 * - Reduced motion is handled by `<MotionConfig reducedMotion="user">`
 *   at the header root (framer-motion disables transform/opacity movement
 *   for users who request it) plus the global `prefers-reduced-motion`
 *   CSS rule for the CSS-based accordions.
 */

export const TP_EASE_OUT = [0, 0, 0.2, 1];

/** Small anchored dropdowns: account menu, notification panel. */
export const dropdownVariants = {
  hidden: {
    opacity: 0,
    y: -6,
    scale: 0.98,
    pointerEvents: 'none',
    transition: { duration: 0.12, ease: 'easeIn' },
  },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    pointerEvents: 'auto',
    transition: { duration: 0.16, ease: TP_EASE_OUT },
  },
};

/** Full-width panels dropping from the navbar: mega menu, search panel. */
export const panelDownVariants = {
  hidden: {
    opacity: 0,
    y: -8,
    pointerEvents: 'none',
    transition: { duration: 0.15, ease: 'easeIn' },
  },
  visible: {
    opacity: 1,
    y: 0,
    pointerEvents: 'auto',
    transition: { duration: 0.2, ease: TP_EASE_OUT },
  },
};

/** Mobile slide-down drawer panel (backdrop handled separately). */
export const drawerVariants = {
  hidden: {
    opacity: 0,
    y: -12,
    pointerEvents: 'none',
    transition: { duration: 0.18, ease: 'easeIn' },
  },
  visible: {
    opacity: 1,
    y: 0,
    pointerEvents: 'auto',
    transition: { duration: 0.25, ease: TP_EASE_OUT },
  },
};

/** Dimming backdrop behind the mobile drawer. Opacity only. */
export const backdropVariants = {
  hidden: {
    opacity: 0,
    pointerEvents: 'none',
    transition: { duration: 0.18, ease: 'easeIn' },
  },
  visible: {
    opacity: 1,
    pointerEvents: 'auto',
    transition: { duration: 0.2, ease: TP_EASE_OUT },
  },
};
