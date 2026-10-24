// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { EnvState } from '../config';
import {
    registerEnvCallback,
    clearAllEnvCallbacks,
    dispatchEnvChange,
    registerSceneTickCallback,
    clearSceneTickCallbacks,
    runSceneTickCallbacks,
    registerEnvObserverHandler,
    requestEnvObserver,
    registerEnvDtTickCallback,
    clearEnvDtTickCallbacks,
    runEnvDtTickCallbacks,
} from '../../scene/env/_bridge/env-dispatcher';

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

    it('tick callback error does not block other callbacks (per-frame resilience)', () => {
        const cb1 = vi.fn(() => {
            throw new Error('tick boom');
        });
        const cb2 = vi.fn();
        registerSceneTickCallback(cb1);
        registerSceneTickCallback(cb2);

        const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(() => runSceneTickCallbacks()).not.toThrow();
        expect(cb2).toHaveBeenCalledTimes(1);
        expect(spy).toHaveBeenCalledWith(
            '[env-dispatcher] tick callback error:',
            expect.any(Error)
        );
        spy.mockRestore();
    });
});
// [audit P3] 零覆盖区补齐：observer handler 注册表（ADR-269 IoC）+ dt tick 注册表
describe('env-dispatcher: registerEnvObserverHandler / requestEnvObserver', () => {
    // 该注册表无 clear 函数（ADR-269 设计：handler 由 env-impl 模块顶层注册，随其生命周期）
    // → 测试内 _cleanups 数组兜底
    const _cleanups: Array<() => void> = [];
    afterEach(() => {
        while (_cleanups.length > 0) {
            _cleanups.pop()!();
        }
    });

    it('requestEnvObserver 按注册顺序触发全部 handler', () => {
        const order: string[] = [];
        _cleanups.push(registerEnvObserverHandler(() => { order.push('a'); }));
        _cleanups.push(registerEnvObserverHandler(() => { order.push('b'); }));
        requestEnvObserver();
        expect(order).toEqual(['a', 'b']);
    });

    it('未注册 handler 时 requestEnvObserver 静默 no-op', () => {
        expect(() => requestEnvObserver()).not.toThrow();
    });

    it('单 handler 抛错不影响其他 handler + 记录 warn', () => {
        const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const ok = vi.fn();
        _cleanups.push(registerEnvObserverHandler(() => {
            throw new Error('obs boom');
        }));
        _cleanups.push(registerEnvObserverHandler(ok));
        expect(() => requestEnvObserver()).not.toThrow();
        expect(ok).toHaveBeenCalledTimes(1);
        expect(spy).toHaveBeenCalledWith('[env-dispatcher] observer request error:', expect.any(Error));
        spy.mockRestore();
    });

    it('cleanup 函数移除单个 handler', () => {
        const h = vi.fn();
        const cleanup = registerEnvObserverHandler(h);
        cleanup();
        requestEnvObserver();
        expect(h).not.toHaveBeenCalled();
    });
});

describe('env-dispatcher: registerEnvDtTickCallback / runEnvDtTickCallbacks', () => {
    afterEach(() => {
        clearEnvDtTickCallbacks();
    });

    it('dt 透传给回调（焦散/水波等时间累积）', () => {
        const cb = vi.fn();
        const cleanup = registerEnvDtTickCallback(cb);
        runEnvDtTickCallbacks(0.016);
        expect(cb).toHaveBeenCalledWith(0.016);
        cleanup();
    });

    it('cleanup 单个移除 + clearEnvDtTickCallbacks 清空全部', () => {
        const cb1 = vi.fn();
        const cb2 = vi.fn();
        const cleanup1 = registerEnvDtTickCallback(cb1);
        registerEnvDtTickCallback(cb2);
        cleanup1();
        runEnvDtTickCallbacks(0.01);
        expect(cb1).not.toHaveBeenCalled();
        expect(cb2).toHaveBeenCalledTimes(1);
        clearEnvDtTickCallbacks();
        runEnvDtTickCallbacks(0.01);
        expect(cb2).toHaveBeenCalledTimes(1);
    });

    it('单回调抛错不阻塞同帧其他回调 + 记录 warn', () => {
        const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const ok = vi.fn();
        registerEnvDtTickCallback(() => {
            throw new Error('dt boom');
        });
        registerEnvDtTickCallback(ok);
        expect(() => runEnvDtTickCallbacks(0.016)).not.toThrow();
        expect(ok).toHaveBeenCalledWith(0.016);
        expect(spy).toHaveBeenCalledWith('[env-dispatcher] dt tick callback error:', expect.any(Error));
        spy.mockRestore();
    });
});
