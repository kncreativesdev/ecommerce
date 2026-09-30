import { Badge } from '../ui/Badge.jsx';
import { RETURN_STATUS_TONES, returnStatusLabel } from '../../utils/returns.js';

/**
 * Return-request status badge. Tones mirror the order badge scale
 * (info = awaiting action, success = resolved forward, destructive =
 * rejected, neutral = terminal-cancelled) without touching the shared
 * order badge component.
 */
export function ReturnStatusBadge({ status }) {
  return <Badge tone={RETURN_STATUS_TONES[status] ?? 'neutral'}>{returnStatusLabel(status)}</Badge>;
}
