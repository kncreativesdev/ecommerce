import { Star } from 'lucide-react';
import { Badge } from '../ui/Badge.jsx';
import { cn } from '../../lib/cn.js';

/**
 * Review badges — display-only derivations of server state.
 *
 * Moderation terminology mirrors the actual `isApproved` boolean (there
 * is no status enum): approved vs pending. Tones follow the admin badge
 * language (success = live/approved, warning = needs attention).
 */

/** Moderation badge for a server review row (always icon + text). */
export function ReviewStatusBadge({ isApproved }) {
  return (
    <Badge tone={isApproved ? 'success' : 'warning'}>
      {isApproved ? 'Approved' : 'Pending'}
    </Badge>
  );
}

/** Read-only 1–5 star display (decorative; the numeric rating is text). */
export function RatingStars({ rating, className }) {
  const value = Number.isInteger(rating) ? rating : 0;
  return (
    <span
      role="img"
      aria-label={`Rated ${value} out of 5`}
      className={cn('inline-flex items-center gap-0.5', className)}
    >
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          size={14}
          aria-hidden="true"
          className={star <= value ? 'fill-warning text-warning' : 'text-muted-foreground'}
        />
      ))}
    </span>
  );
}
