import { Star } from 'lucide-react';
import { cn } from '../../lib/cn.js';
import { formatDate } from '../../lib/format.js';

/** Read-only star display (decorative icons + text alternative). */
export function RatingStars({ rating, className }) {
  return (
    <span
      role="img"
      aria-label={`Rated ${rating} out of 5`}
      className={cn('inline-flex items-center gap-0.5', className)}
    >
      {[1, 2, 3, 4, 5].map((value) => (
        <Star
          key={value}
          size={15}
          aria-hidden="true"
          className={cn(rating >= value ? 'fill-warning text-warning' : 'text-border-strong')}
        />
      ))}
    </span>
  );
}

/**
 * Own-review card: product context, stars, title/comment, timestamp, and
 * caller-supplied actions (edit/delete). Only the signed-in user's reviews
 * ever render here — no public aggregation exists.
 */
export function ReviewCard({ review, productName, actions }) {
  return (
    <li className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <RatingStars rating={review?.rating ?? 0} />
        <span className="text-xs text-muted-foreground">{formatDate(review?.createdAt)}</span>
      </div>
      {productName ? (
        <p className="text-[13px] font-semibold text-muted-foreground">{productName}</p>
      ) : null}
      {review?.title ? (
        <p className="text-sm font-bold text-foreground">{review.title}</p>
      ) : null}
      {review?.comment ? (
        <p className="whitespace-pre-line text-sm leading-6 text-muted-foreground">{review.comment}</p>
      ) : null}
      {actions ? <div className="mt-1 flex flex-wrap gap-2 border-t border-border pt-3">{actions}</div> : null}
    </li>
  );
}
