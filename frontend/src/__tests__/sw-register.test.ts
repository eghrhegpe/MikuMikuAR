import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type RegisterServiceWorker = typeof import('../core/sw-register').registerServiceWorker;

describe('registerServiceWorker', () => {
    let registerServiceWorker: RegisterServiceWorker;
    let registerMock: ReturnType<typeof vi.fn>;
    let loadListeners: Array<() => void> = [];

    const realServiceWorkerDescriptor = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');
    const realLocationDescriptor = Object.getOwnPropertyDescriptor(window, 'location');

    beforeEach(async () => {
        // 模块内有“只调度一次”的防重入状态，每个用例重置模块拿到全新状态。
        vi.resetModules();
        ({ registerServiceWorker } = await import('../core/sw-register'));
        registerMock = vi.fn().mockResolvedValue(undefined);
        loadListeners = [];
        Object.defineProperty(navigator, 'serviceWorker', {
            value: { register: registerMock },
            configurable: true,
        });
        vi.spyOn(window, 'addEventListener').mockImplementation((ev, cb) => {
            if (ev === 'load') {
                loadListeners.push(cb as () => void);
            }
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        Reflect.deleteProperty(globalThis as Record<string, unknown>, 'crossOriginIsolated');
        if (realServiceWorkerDescriptor) {
            Object.defineProperty(navigator, 'serviceWorker', realServiceWorkerDescriptor);
        } else {
            Reflect.deleteProperty(
                navigator as unknown as Record<string, unknown>,
                'serviceWorker'
            );
        }
        if (realLocationDescriptor) {
            Object.defineProperty(window, 'location', realLocationDescriptor);
        } else {
            Reflect.deleteProperty(window as unknown as Record<string, unknown>, 'location');
        }
    });

    it('在 enabled 时于 load 事件后以 BASE_URL 为 scope 注册 sw.js', () => {
        registerServiceWorker(true);
        expect(loadListeners).toHaveLength(1);
        expect(window.addEventListener).toHaveBeenCalledWith('load', expect.any(Function), {
            once: true,
        });
        loadListeners[0]!();
        expect(registerMock).toHaveBeenCalledTimes(1);
        const [url, opts] = registerMock.mock.calls[0];
        expect(url).toBe(`${import.meta.env.BASE_URL}sw.js`);
        expect(opts.scope).toBe(import.meta.env.BASE_URL);
    });

    it('disabled 时不注册', () => {
        registerServiceWorker(false);
        expect(loadListeners).toHaveLength(0);
        expect(registerMock).not.toHaveBeenCalled();
    });

    it('serviceWorker 不支持时安全 no-op', () => {
        Object.defineProperty(navigator, 'serviceWorker', {
            value: undefined,
            configurable: true,
        });
        registerServiceWorker(true);
        expect(loadListeners).toHaveLength(0);
        expect(registerMock).not.toHaveBeenCalled();
    });

    it('[adr-099] crossOriginIsolated=false 且未受控时，controllerchange 触发一次 reload', () => {
        const swListeners: Record<string, () => void> = {};
        Object.defineProperty(navigator, 'serviceWorker', {
            value: {
                register: registerMock,
                controller: null,
                addEventListener: (ev: string, cb: () => void) => {
                    swListeners[ev] = cb;
                },
            },
            configurable: true,
        });
        Object.defineProperty(globalThis, 'crossOriginIsolated', {
            value: false,
            configurable: true,
        });
        const reloadMock = vi.fn();
        Object.defineProperty(window, 'location', {
            value: { reload: reloadMock },
            configurable: true,
        });

        registerServiceWorker(true);
        expect(swListeners.controllerchange).toBeTypeOf('function');
        swListeners.controllerchange();
        swListeners.controllerchange(); // 二次触发应被 reloaded 守卫拦截
        expect(reloadMock).toHaveBeenCalledTimes(1);
    });

    it('serviceWorker.register 缺失时安全 no-op', () => {
        Object.defineProperty(navigator, 'serviceWorker', {
            value: {},
            configurable: true,
        });
        registerServiceWorker(true);
        expect(loadListeners).toHaveLength(0);
        expect(registerMock).not.toHaveBeenCalled();
    });

    it('crossOriginIsolated 未定义时不挂 controllerchange', () => {
        const swListeners: Record<string, () => void> = {};
        Object.defineProperty(navigator, 'serviceWorker', {
            value: {
                register: registerMock,
                controller: null,
                addEventListener: (ev: string, cb: () => void) => {
                    swListeners[ev] = cb;
                },
            },
            configurable: true,
        });

        registerServiceWorker(true);
        expect(swListeners.controllerchange).toBeUndefined();
    });

    it('register reject 时 catch 告警，不产生未处理拒绝', async () => {
        registerMock.mockRejectedValue(new Error('sw down'));
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        registerServiceWorker(true);
        loadListeners[0]!();
        await Promise.resolve();
        expect(registerMock).toHaveBeenCalledTimes(1);
        expect(warnSpy).toHaveBeenCalledWith('[sw] register failed:', expect.any(Error));
    });

    it('重复调用 registerServiceWorker 只调度一次注册', () => {
        registerServiceWorker(true);
        registerServiceWorker(true);
        expect(loadListeners).toHaveLength(1);
        loadListeners[0]!();
        expect(registerMock).toHaveBeenCalledTimes(1);
    });
});
