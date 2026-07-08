import { describe, it, expect, vi } from 'vitest';
import { SettingsStore, SETTINGS_UPDATED } from '../lib/settings-store';

describe('SettingsStore', () => {
  it('SettingsStore.get().set emits SETTINGS_UPDATED to globalThis', () => {
    const handler = vi.fn();
    globalThis.addEventListener(SETTINGS_UPDATED.description!, handler);
    SettingsStore.get().set('volume', 0.5);
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ type: SETTINGS_UPDATED.description! }));
    globalThis.removeEventListener(SETTINGS_UPDATED.description!, handler);
  });
});