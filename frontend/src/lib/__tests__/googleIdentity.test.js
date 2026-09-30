import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadGoogleIdentity, requestGoogleCredential, resetGoogleIdentityForTests } from '../googleIdentity.js';

describe('loadGoogleIdentity', () => {
  let appendedScripts;

  beforeEach(() => {
    resetGoogleIdentityForTests();
    appendedScripts = [];
    vi.spyOn(document.head, 'appendChild').mockImplementation((node) => {
      appendedScripts.push(node);
      return node;
    });
    delete window.google;
  });

  afterEach(() => {
    document.head.appendChild.mockRestore();
    delete window.google;
    resetGoogleIdentityForTests();
  });

  it('resolves immediately when GIS is already present', async () => {
    const api = { initialize: vi.fn(), renderButton: vi.fn() };
    window.google = { accounts: { id: api } };
    await expect(loadGoogleIdentity()).resolves.toBe(api);
    expect(appendedScripts).toHaveLength(0);
  });

  it('injects the GIS script once and resolves on load', async () => {
    const api = { initialize: vi.fn(), renderButton: vi.fn() };
    const first = loadGoogleIdentity();
    const second = loadGoogleIdentity();
    expect(appendedScripts).toHaveLength(1);
    expect(appendedScripts[0].src).toBe('https://accounts.google.com/gsi/client');

    window.google = { accounts: { id: api } };
    appendedScripts[0].onload();
    await expect(first).resolves.toBe(api);
    await expect(second).resolves.toBe(api);
  });

  it('rejects when the script fails and retries cleanly afterwards', async () => {
    const first = loadGoogleIdentity();
    appendedScripts[0].onerror(new Error('network down'));
    await expect(first).rejects.toThrow('Google sign-in failed to load.');

    // A failed load must not poison later attempts.
    const api = { initialize: vi.fn(), renderButton: vi.fn() };
    const second = loadGoogleIdentity();
    expect(appendedScripts).toHaveLength(2);
    window.google = { accounts: { id: api } };
    appendedScripts[1].onload();
    await expect(second).resolves.toBe(api);
  });
});

describe('requestGoogleCredential', () => {
  beforeEach(() => {
    resetGoogleIdentityForTests();
    delete window.google;
  });

  afterEach(() => {
    delete window.google;
    resetGoogleIdentityForTests();
    vi.unstubAllGlobals();
  });

  function gisApi() {
    return { initialize: vi.fn(), prompt: vi.fn() };
  }

  it('initializes GIS with the app client ID and prompts for the account', async () => {
    const api = gisApi();
    window.google = { accounts: { id: api } };
    const onCredential = vi.fn();

    const pending = requestGoogleCredential('test-client.apps.googleusercontent.com', { onCredential });
    // The loader resolves on a microtask; flush before asserting.
    await vi.waitFor(() => expect(api.initialize).toHaveBeenCalled());
    expect(api.initialize).toHaveBeenCalledWith(expect.objectContaining({
      client_id: 'test-client.apps.googleusercontent.com',
      auto_select: false,
    }));
    expect(api.prompt).toHaveBeenCalledTimes(1);

    // The GIS credential callback forwards the ID token and resolves.
    api.initialize.mock.calls[0][0].callback({ credential: 'id-token-123' });
    await expect(pending).resolves.toBe('id-token-123');
    expect(onCredential).toHaveBeenCalledWith('id-token-123');
  });

  it('rejects when the GIS callback carries no credential', async () => {
    const api = gisApi();
    window.google = { accounts: { id: api } };
    const onCredential = vi.fn();

    const pending = requestGoogleCredential('test-client.apps.googleusercontent.com', { onCredential });
    await vi.waitFor(() => expect(api.initialize).toHaveBeenCalled());
    api.initialize.mock.calls[0][0].callback({});
    await expect(pending).rejects.toMatchObject({ code: 'GOOGLE_NO_CREDENTIAL' });
    expect(onCredential).not.toHaveBeenCalled();
  });

  it('rejects as unavailable when One Tap cannot display', async () => {
    const api = gisApi();
    window.google = { accounts: { id: api } };

    const pending = requestGoogleCredential('test-client.apps.googleusercontent.com', {});
    await vi.waitFor(() => expect(api.prompt).toHaveBeenCalled());
    api.prompt.mock.calls[0][0]({ isDismissedMoment: () => false, isNotDisplayedMoment: () => true, isSkippedMoment: () => false });
    await expect(pending).rejects.toMatchObject({ code: 'GOOGLE_UNAVAILABLE' });
  });

  it('rejects quietly as dismissed when the user closes the chooser', async () => {
    const api = gisApi();
    window.google = { accounts: { id: api } };

    const pending = requestGoogleCredential('test-client.apps.googleusercontent.com', {});
    await vi.waitFor(() => expect(api.prompt).toHaveBeenCalled());
    api.prompt.mock.calls[0][0]({ isDismissedMoment: () => true, isNotDisplayedMoment: () => false, isSkippedMoment: () => false });
    await expect(pending).rejects.toMatchObject({ code: 'GOOGLE_DISMISSED' });
  });

  it('rejects without a client ID before touching GIS', async () => {
    await expect(requestGoogleCredential('', {})).rejects.toMatchObject({ code: 'GOOGLE_NOT_CONFIGURED' });
    await expect(requestGoogleCredential('   ', {})).rejects.toMatchObject({ code: 'GOOGLE_NOT_CONFIGURED' });
  });
});
