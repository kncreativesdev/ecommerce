import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiDelete, apiGet, apiPatch, apiPost } from '../../lib/apiClient.js';
import {
  createAddress,
  deleteAddress,
  fetchAddressById,
  fetchAddresses,
  updateAddress,
} from '../addresses.service.js';

vi.mock('../../lib/apiClient.js', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPatch: vi.fn(),
  apiDelete: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

const SAVED = {
  id: 'a1',
  fullName: 'Jaskaran Singh',
  phone: '9876543210',
  addressLine1: '123 Model Town',
  city: 'Ludhiana',
  state: 'Punjab',
  postalCode: '141002',
  country: 'India',
  isDefault: true,
};

describe('addresses.service', () => {
  it('fetches the book as a plain array (empty when absent)', async () => {
    apiGet.mockResolvedValue([SAVED]);
    await expect(fetchAddresses()).resolves.toEqual([SAVED]);
    expect(apiGet).toHaveBeenCalledWith('/addresses');

    apiGet.mockResolvedValue(null);
    await expect(fetchAddresses()).resolves.toEqual([]);
  });

  it('fetches one address by id', async () => {
    apiGet.mockResolvedValue({ address: SAVED });
    await expect(fetchAddressById('a1')).resolves.toEqual(SAVED);
    expect(apiGet).toHaveBeenCalledWith('/addresses/a1');
  });

  it('creates with trimmed strict fields (line2 + default included)', async () => {
    apiPost.mockResolvedValue({ address: SAVED });
    await createAddress({
      label: '  Home  ',
      fullName: 'Jaskaran Singh',
      phone: '9876543210',
      addressLine1: '123 Model Town',
      addressLine2: 'Near Clock Tower',
      city: 'Ludhiana',
      state: 'Punjab',
      postalCode: '141002',
      country: 'India',
      isDefault: true,
      hacked: 'drop me',
    });
    expect(apiPost).toHaveBeenCalledWith('/addresses', {
      label: 'Home',
      fullName: 'Jaskaran Singh',
      phone: '9876543210',
      addressLine1: '123 Model Town',
      addressLine2: 'Near Clock Tower',
      city: 'Ludhiana',
      state: 'Punjab',
      postalCode: '141002',
      country: 'India',
      isDefault: true,
    });
  });

  it('omits blank optional strings instead of sending empties', async () => {
    apiPost.mockResolvedValue({ address: SAVED });
    await createAddress({ ...SAVED, label: '   ', addressLine2: '' });
    const [, body] = apiPost.mock.calls[0];
    expect(body).not.toHaveProperty('label');
    expect(body).not.toHaveProperty('addressLine2');
    expect(body.fullName).toBe('Jaskaran Singh');
  });

  it('updates by id with picked fields only', async () => {
    apiPatch.mockResolvedValue({ address: SAVED });
    await updateAddress('a1', { city: 'Amritsar', addressLine2: 'Second Floor' });
    expect(apiPatch).toHaveBeenCalledWith('/addresses/a1', {
      city: 'Amritsar',
      addressLine2: 'Second Floor',
    });
  });

  it('deletes by id', async () => {
    apiDelete.mockResolvedValue({ id: 'a1' });
    await deleteAddress('a1');
    expect(apiDelete).toHaveBeenCalledWith('/addresses/a1');
  });
});
