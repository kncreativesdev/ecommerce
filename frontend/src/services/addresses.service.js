import { apiDelete, apiGet, apiPatch, apiPost } from '../lib/apiClient.js';

/**
 * Address book API access — owner-scoped (API_INTEGRATION §4).
 * Cross-owner access returns `404 ADDRESS_NOT_FOUND`. Strict bodies: only
 * documented fields are ever sent. Delete repeats → `404` (treated as
 * already-removed by callers).
 */
const ADDRESS_FIELDS = [
  'label',
  'fullName',
  'phone',
  'addressLine1',
  'addressLine2',
  'city',
  'state',
  'postalCode',
  'country',
  'isDefault',
];

function pickAddressFields(input) {
  const body = {};
  for (const field of ADDRESS_FIELDS) {
    if (input[field] === undefined) continue;
    const value = input[field];
    if (typeof value === 'string') {
      const trimmed = value.trim();
      // Optional string fields collapse to omission (backend treats them
      // as optional); required-field emptiness is caught by client Zod.
      if (trimmed === '' && (field === 'label' || field === 'addressLine2')) continue;
      body[field] = trimmed;
    } else {
      body[field] = value;
    }
  }
  return body;
}

export function fetchAddresses() {
  return apiGet('/addresses').then((data) => (Array.isArray(data) ? data : []));
}

export function fetchAddressById(id) {
  return apiGet(`/addresses/${id}`).then((data) => data?.address ?? null);
}

export function createAddress(input) {
  return apiPost('/addresses', pickAddressFields(input)).then((data) => data?.address ?? null);
}

export function updateAddress(id, input) {
  return apiPatch(`/addresses/${id}`, pickAddressFields(input)).then((data) => data?.address ?? null);
}

export function deleteAddress(id) {
  return apiDelete(`/addresses/${id}`);
}
