import { describe, it, expect, vi, afterEach } from 'vitest';
import type { EnvState } from '../config';
import {
    registerEnvCallback,
    clearAllEnvCallbacks,
    dispatchEnvChange,
    registerSceneTickCallback,
    clearSceneTickCallbacks,
    runSceneTickCallbacks,
} from '../../scene/env/env-dispatcher';

const dummyState = {} as EnvState;

describe('env-dispatcher: registerEnvCallback / dispatchEnvChange', () => {
    afterEach(() => {
        clearAllEnvCallbacks();
    });

    it('callback is invoked on dispatch', () => {
        const cb = vi.fn();
        const cleanup = registerEnvCallback(cb);

        dispatchEnvChange(new Set(['skyMode']), dummyState);
        expect(cb).toHaveBeenCalledTimes(1);

        cleanup();
    });

    it('cleanup function removes callback', () => {
        const cb = vi.fn();
        const cleanup = registerEnvCallback(cb);
        cleanup();

        dispatchEnvChange(new Set(['skyMode']), dummyState);
        expect(cb).not.toHaveBeenCalled();
    });

    it('null changed (full dispatch) triggers all callbacks', () => {
        const cb = vi.fn();
        registerEnvCallback(cb);

        dispatchEnvChange(null, dummyState);
        expect(cb).toHaveBeenCalledWith(null, dummyState);
    });

    it('callback error does not block other callbacks', () => {
        const cb1 = vi.fn(() => {
            throw new Error('boom');
        });
        const cb2 = vi.fn();
        registerEnvCallback(cb1);
        registerEnvCallback(cb2);

        // 不应抛错
        expect(() => dispatchEnvChange(new Set(['skyMode']), dummyState)).not.toThrow();
        expect(cb2).toHaveBeenCalledTimes(1);
    });

    it('clearAllEnvCallbacks removes all', () => {
        const cb = vi.fn();
        registerEnvCallback(cb);
        clearAllEnvCallbacks();

        dispatchEnvChange(new Set(['skyMode']), dummyState);
        expect(cb).not.toHaveBeenCalled();
    });
});

describe('env-dispatcher: registerSceneTickCallback / runSceneTickCallbacks', () => {
    afterEach(() => {
        clearSceneTickCallbacks();
    });

    it('registers and runs tick callback', () => {
        const cb = vi.fn();
        const cleanup = registerSceneTickCallback(cb);

        runSceneTickCallbacks();
        expect(cb).toHaveBeenCalledTimes(1);

        cleanup();
    });

    it('cleanup function removes tick callback', () => {
        const cb = vi.fn();
        const cleanup = registerSceneTickCallback(cb);
        cleanup();

        runSceneTickCallbacks();
        expect(cb).not.toHaveBeenCalled();
    });

    it('clearSceneTickCallbacks removes all', () => {
        const cb = vi.fn();
        registerSceneTickCallback(cb);
        clearSceneTickCallbacks();

        runSceneTickCallbacks();
        expect(cb).not.toHaveBeenCalled();
    });
});
