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

import { showPlaza } from '../menus/plaza-browser';
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