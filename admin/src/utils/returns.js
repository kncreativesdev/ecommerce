/**
 * Return-request display derivations (admin). Mirrors the backend
 * `ReturnRequestStatus` / `ReturnReason` enums — the backend owns the
 * lifecycle; this module only names values for display. Customer labels
 * match the storefront reason options so both sides describe reasons
 * identically.
 */

export const RETURN_STATUSES = ['REQUESTED', 'APPROVED', 'REJECTED', 'COMPLETED', 'CANCELLED'];

export const RETURN_STATUS_LABELS = {
  REQUESTED: 'Return requested',
  APPROVED: 'Return approved',
  REJECTED: 'Return rejected',
  COMPLETED: 'Return completed',
  CANCELLED: 'Return cancelled',
};

export function returnStatusLabel(status) {
  if (status == null || status === '') return '—';
  return RETURN_STATUS_LABELS[status] ?? String(status);
}

export const RETURN_STATUS_TONES = {
  REQUESTED: 'info',
  APPROVED: 'success',
  REJECTED: 'destructive',
  COMPLETED: 'success',
  CANCELLED: 'neutral',
};

export const RETURN_REASONS = [
  'WRONG_COLOR',
  'WRONG_SIZE',
  'DAMAGED',
  'DEFECTIVE',
  'WRONG_ITEM',
  'NOT_AS_DESCRIBED',
  'CHANGED_MIND',
  'OTHER',
];

export const RETURN_REASON_LABELS = {
  WRONG_COLOR: 'Wrong color',
  WRONG_SIZE: 'Wrong size',
  DAMAGED: 'Damaged',
  DEFECTIVE: 'Defective',
  WRONG_ITEM: 'Wrong item',
  NOT_AS_DESCRIBED: 'Not as described',
  CHANGED_MIND: 'Changed my mind',
  OTHER: 'Other',
};

export function returnReasonLabel(reason) {
  if (reason == null || reason === '') return '—';
  return RETURN_REASON_LABELS[reason] ?? String(reason);
}
