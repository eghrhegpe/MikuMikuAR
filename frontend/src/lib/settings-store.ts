import { signal } from '@preact/signals-core';

// AO ✂️ SettingsStore singleton for centralized audio settings
const SETTINGS_UPDATED = Symbol('SETTINGS_UPDATED');

type SettingsKey = 'volume' | 'audioOffset' | 'muted' | 'bpmQuantizeEnabled' | 'autoLoadCompanionAudio';

type Settings = Record<SettingsKey, number | boolean>;

const defaults: Settings = {
  volume: 0.7,
  audioOffset: 0,
  muted: false,
  bpmQuantizeEnabled: false,
  autoLoadCompanionAudio: true,
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
    globalThis.dispatchEvent(new CustomEvent(SETTINGS_UPDATED.description!, { detail: { key, value } }));
  }

  reset(): void {
    state.value = { ...defaults };
  }
}

export { SettingsStore, SETTINGS_UPDATED };

export default SettingsStore.get();