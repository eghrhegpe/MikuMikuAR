// plaza.contract.test.ts — 导出函数存在性 + 签名契约
//
// 验证 showPlaza / closePlaza 签名不变（不执行内部逻辑）。
// plaza-download → library → library-core → scene.ts 会触发 Babylon 引擎初始化，
// 因此需要 mock 掉重依赖链。

import { describe, it, expect, vi } from 'vitest';

// 阻断 Babylon 引擎初始化（scene.ts 模块级 new Scene(engine)）
vi.mock('../scene/scene', () => ({
    focusModel: vi.fn(),
    modelManager: { get: vi.fn() },
    scene: {},
    triggerAutoSave: vi.fn(),
}));
vi.mock('../core/wails-bindings', () => ({
    FetchPlazaConfig: vi.fn(),
    GetCachedPlazaConfig: vi.fn(),
    ReadTextFile: vi.fn(),
    StartProxy: vi.fn(),
    StopProxy: vi.fn(),
    ClosePlazaWindow: vi.fn(),
    PlazaGoBack: vi.fn(),
    PlazaGoForward: vi.fn(),
    PlazaReload: vi.fn(),
    PlazaZoomIn: vi.fn(),
    PlazaZoomOut: vi.fn(),
    PlazaZoomReset: vi.fn(),
    DownloadFromPlaza: vi.fn(),
}));
vi.mock('@bindings/mikumikuar/internal/app/app', () => ({}));
vi.mock('@wailsio/runtime', () => ({ Events: { On: vi.fn(), Off: vi.fn() } }));

import { showPlaza, preserveBuiltinRouting, normalizeSite } from '../menus/plaza-browser';
import { closePlaza } from '../menus/plaza-state';

describe('plaza 导出契约', () => {
    it('showPlaza 是异步函数', () => {
        expect(typeof showPlaza).toBe('function');
        const result = showPlaza();
        expect(result).toBeInstanceOf(Promise);
    });

    it('closePlaza 是函数', () => {
        expect(typeof closePlaza).toBe('function');
    });
});

// [doc:plaza-spa] 锁定回归：缓存/远程配置丢失 directNavigate 时，内置站点必须仍以源码路由标记为准，
// 否则会静默退回代理 origin → API CORS 白屏。
describe('preserveBuiltinRouting（缓存不得丢弃内置站点路由标记）', () => {
    it('缓存缺失 directNavigate 时，内置站点仍以源码 PLAZA_SITES 为准', () => {
        const cached = [{ id: 'mzhouse', name: '模之屋', url: 'https://www.aplaybox.com/', mode: 'external' as const }];
        const out = preserveBuiltinRouting(cached);
        expect(out[0].directNavigate).toBe(true);
    });

    it('缓存显式 false 不覆盖内置 true（路由标记为代码级决策）', () => {
        const cached = [{ id: 'mzhouse', name: '模之屋', url: 'https://www.aplaybox.com/', mode: 'external' as const, directNavigate: false }];
        const out = preserveBuiltinRouting(cached);
        expect(out[0].directNavigate).toBe(true);
    });

    it('自定义站点（无内置项）保留自身 directNavigate', () => {
        const custom = [{ id: 'mysite', name: 'X', url: 'https://x.test/', mode: 'external' as const, directNavigate: true }];
        const out = preserveBuiltinRouting(custom);
        expect(out[0].directNavigate).toBe(true);
    });

    it('normalizeSite 圆整 directNavigate 字段', () => {
        const s = normalizeSite({ id: 'a', name: 'A', url: 'https://a.test/', mode: 'external', directNavigate: true });
        expect(s?.directNavigate).toBe(true);
    });
});
