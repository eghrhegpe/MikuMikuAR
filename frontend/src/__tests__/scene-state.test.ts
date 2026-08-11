// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    createDefaultFeetState,
    setMmdRuntime,
    mmdRuntime,
    getMmdRuntimeType,
    setMmdRuntimeType,
    setModelRegistry,
    modelRegistry,
    setFocusedModelId,
    focusedModelId,
} from '../core/scene-state';

// ---- localStorage mock (node env has no localStorage) ----
const store = new Map<string, string>();
const localStorageMock = {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { store.set(key, value); }),
    removeItem: vi.fn((key: string) => { store.delete(key); }),
    clear: vi.fn(() => { store.clear(); }),
    get length() { return store.size; },
    key: vi.fn((i: number) => [...store.keys()][i] ?? null),
};
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, configurable: true });

// ---- re-import after defining localStorage so module top-level can access it ----
// (scene-state.ts only reads localStorage inside functions, so order is fine)

beforeEach(() => {
    store.clear();
    vi.clearAllMocks();
    // Reset module-level mutable state to defaults
    setMmdRuntime(null);
    setModelRegistry(new Map());
    setFocusedModelId(null);
});

// ======== createDefaultFeetState ========

describe('createDefaultFeetState', () => {
    it('returns a FeetState with all expected default values', () => {
        const feet = createDefaultFeetState();
        expect(feet).toEqual({
            enabled: false,
            intensity: 1,
            soleHeight: 0,
            jumpThreshold: 9999,
            bodySmooth: 0.5,
            footSmooth: 0.5,
            maxAngle: 30,
            reachAngle: 15,
        });
    });

    it('returns a fresh object on each call (no shared reference)', () => {
        const a = createDefaultFeetState();
        const b = createDefaultFeetState();
        expect(a).not.toBe(b);
    });

    it('returned object is mutable without affecting subsequent calls', () => {
        const a = createDefaultFeetState();
        a.enabled = true;
        a.intensity = 0;
        const b = createDefaultFeetState();
        expect(b.enabled).toBe(false);
        expect(b.intensity).toBe(1);
    });
});

// ======== setMmdRuntime / mmdRuntime ========

describe('setMmdRuntime / mmdRuntime', () => {
    it('initial value is null', async () => {
        // Already reset in beforeEach; re-check via fresh import
        const mod = await import('../core/scene-state');
        expect(mod.mmdRuntime).toBeNull();
    });

    it('setter updates the exported binding', async () => {
        const fakeRuntime = { name: 'fake' } as unknown as import('babylon-mmd/esm/Runtime/IMmdRuntime').IMmdRuntime;
        setMmdRuntime(fakeRuntime);
        const mod = await import('../core/scene-state');
        expect(mod.mmdRuntime).toBe(fakeRuntime);
    });

    it('setter accepts null to clear', async () => {
        const fakeRuntime = {} as unknown as import('babylon-mmd/esm/Runtime/IMmdRuntime').IMmdRuntime;
        setMmdRuntime(fakeRuntime);
        setMmdRuntime(null);
        const mod = await import('../core/scene-state');
        expect(mod.mmdRuntime).toBeNull();
    });
});

// ======== getMmdRuntimeType / setMmdRuntimeType ========

describe('getMmdRuntimeType / setMmdRuntimeType', () => {
    it('returns "wasm" when localStorage has no value and env is not "js"', () => {
        expect(getMmdRuntimeType()).toBe('wasm');
    });

    it('returns stored value "wasm" from localStorage', () => {
        store.set('mmdRuntimeType', 'wasm');
        expect(getMmdRuntimeType()).toBe('wasm');
    });

    it('returns stored value "js" from localStorage', () => {
        store.set('mmdRuntimeType', 'js');
        expect(getMmdRuntimeType()).toBe('js');
    });

    it('ignores invalid localStorage values and falls back to env', () => {
        store.set('mmdRuntimeType', 'invalid');
        expect(getMmdRuntimeType()).toBe('wasm');
    });

    it('setMmdRuntimeType persists to localStorage', () => {
        setMmdRuntimeType('js');
        expect(store.get('mmdRuntimeType')).toBe('js');
        expect(getMmdRuntimeType()).toBe('js');
    });

    it('round-trips wasm value', () => {
        setMmdRuntimeType('wasm');
        expect(getMmdRuntimeType()).toBe('wasm');
    });
});

// ======== setModelRegistry / modelRegistry ========

describe('setModelRegistry / modelRegistry', () => {
    it('initial value is an empty Map', async () => {
        const mod = await import('../core/scene-state');
        expect(mod.modelRegistry).toBeInstanceOf(Map);
        expect(mod.modelRegistry.size).toBe(0);
    });

    it('setter replaces the registry', async () => {
        const fakeInstance = { id: 'm1' } as unknown as import('../core/types').ModelInstance;
        const newMap = new Map<string, import('../core/types').ModelInstance>([['m1', fakeInstance]]);
        setModelRegistry(newMap);
        const mod = await import('../core/scene-state');
        expect(mod.modelRegistry).toBe(newMap);
        expect(mod.modelRegistry.get('m1')).toBe(fakeInstance);
    });

    it('setter accepts empty Map to clear', async () => {
        const populated = new Map<string, import('../core/types').ModelInstance>([['x', {} as any]]);
        setModelRegistry(populated);
        setModelRegistry(new Map());
        const mod = await import('../core/scene-state');
        expect(mod.modelRegistry.size).toBe(0);
    });
});

// ======== setFocusedModelId / focusedModelId ========

describe('setFocusedModelId / focusedModelId', () => {
    it('initial value is null', async () => {
        const mod = await import('../core/scene-state');
        expect(mod.focusedModelId).toBeNull();
    });

    it('setter updates the exported binding', async () => {
        setFocusedModelId('model-42');
        const mod = await import('../core/scene-state');
        expect(mod.focusedModelId).toBe('model-42');
    });

    it('setter accepts null to clear', async () => {
        setFocusedModelId('model-42');
        setFocusedModelId(null);
        const mod = await import('../core/scene-state');
        expect(mod.focusedModelId).toBeNull();
    });

    it('setter overwrites previous value', async () => {
        setFocusedModelId('a');
        setFocusedModelId('b');
        const mod = await import('../core/scene-state');
        expect(mod.focusedModelId).toBe('b');
    });
});
