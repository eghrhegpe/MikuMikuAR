import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerServiceWorker } from '../core/sw-register';

describe('registerServiceWorker', () => {
    let registerMock: ReturnType<typeof vi.fn>;
    let loadCb: (() => void) | null = null;

    beforeEach(() => {
        registerMock = vi.fn().mockResolvedValue(undefined);
        loadCb = null;
        Object.defineProperty(navigator, 'serviceWorker', {
            value: { register: registerMock },
            configurable: true,
        });
        vi.spyOn(window, 'addEventListener').mockImplementation((ev, cb) => {
            if (ev === 'load') loadCb = cb as () => void;
        });
    });

    it('在 enabled 时于 load 事件后以 BASE_URL 为 scope 注册 sw.js', () => {
        registerServiceWorker(true);
        expect(loadCb).not.toBeNull();
        loadCb!();
        expect(registerMock).toHaveBeenCalledTimes(1);
        const [url, opts] = registerMock.mock.calls[0];
        expect(url).toContain('sw.js');
        expect(opts.scope).toBe(import.meta.env.BASE_URL);
    });

    it('disabled 时不注册', () => {
        registerServiceWorker(false);
        expect(loadCb).toBeNull();
        expect(registerMock).not.toHaveBeenCalled();
    });

    it('serviceWorker 不支持时安全 no-op', () => {
        Object.defineProperty(navigator, 'serviceWorker', {
            value: undefined,
            configurable: true,
        });
        registerServiceWorker(true);
        expect(registerMock).not.toHaveBeenCalled();
    });
});
