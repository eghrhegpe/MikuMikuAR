import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../core/state', () => ({
    uiState: {},
}));

vi.mock('../scene/env/env-bridge', () => ({
    schedulePersistUI: vi.fn(),
}));

import { SettingsStore, SETTINGS_UPDATED } from '../lib/settings-store';

describe('SettingsStore', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('SettingsStore.get().set emits SETTINGS_UPDATED to globalThis', () => {
        const handler = vi.fn();
        globalThis.addEventListener(SETTINGS_UPDATED.description!, handler);
        SettingsStore.get().set('volume', 0.5);
        expect(handler).toHaveBeenCalledWith(
            expect.objectContaining({ type: SETTINGS_UPDATED.description! })
        );
        globalThis.removeEventListener(SETTINGS_UPDATED.description!, handler);
    });

    it('set writes to uiState and triggers schedulePersistUI', async () => {
        const { schedulePersistUI } = await import('../scene/env/env-bridge');
        const { uiState } = await import('../core/state');
        SettingsStore.get().set('volume', 0.6);
        expect((uiState as Record<string, unknown>)['volume']).toBe(0.6);
        expect(schedulePersistUI).toHaveBeenCalledTimes(1);
    });

    it('reset restores defaults and triggers schedulePersistUI', async () => {
        const { schedulePersistUI } = await import('../scene/env/env-bridge');
        SettingsStore.get().set('volume', 0.3);
        SettingsStore.get().reset();
        expect(SettingsStore.get().get('volume')).toBe(0.7);
        expect(schedulePersistUI).toHaveBeenCalledTimes(2);
    });
});
