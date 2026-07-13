import { signal } from '@preact/signals-core';
import { uiState } from '../core/state';
import { schedulePersistUI } from '../scene/env/env-bridge';

// AO ✂️ SettingsStore singleton for centralized audio settings
const SETTINGS_UPDATED = Symbol('SETTINGS_UPDATED');

type SettingsKey =
    | 'volume'
    | 'audioOffset'
    | 'muted'
    | 'bpmQuantizeEnabled'
    | 'autoLoadCompanionAudio'
    | 'sfxEnabled'
    | 'sfxVolume'
    | 'footstepEnabled'
    | 'footstepVolume';

type Settings = Record<SettingsKey, number | boolean>;

const defaults: Settings = {
    volume: 0.7,
    audioOffset: 0,
    muted: false,
    bpmQuantizeEnabled: false,
    autoLoadCompanionAudio: true,
    sfxEnabled: true,
    sfxVolume: 0.7,
    footstepEnabled: false,
    footstepVolume: 0.8,
};

const state = signal<Settings>({ ...defaults });

class SettingsStore {
    private static instance: SettingsStore;

    private constructor() {}

    static get(): SettingsStore {
        if (!SettingsStore.instance) {
            SettingsStore.instance = new SettingsStore();
        }
        return SettingsStore.instance;
    }

    get<K extends SettingsKey>(key: K): Settings[K] {
        return state.value[key];
    }

    set<K extends SettingsKey>(key: K, value: Settings[K]): void {
        state.value = { ...state.value, [key]: value };
        globalThis.dispatchEvent(
            new CustomEvent(SETTINGS_UPDATED.description!, { detail: { key, value } })
        );
        (uiState as Record<string, unknown>)[key] = value;
        schedulePersistUI();
    }

    reset(): void {
        state.value = { ...defaults };
        Object.assign(uiState, defaults);
        schedulePersistUI();
    }
}

export { SettingsStore, SETTINGS_UPDATED };

export default SettingsStore.get();
