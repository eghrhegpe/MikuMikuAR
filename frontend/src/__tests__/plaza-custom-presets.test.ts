// [audit:fix 2026-10] MikuMikuAR P3：getCustomPresets 对 localStorage 非数组值的兜底。
// 历史缺陷：JSON.parse(getItem(...) || '[]') 在值被写入 'string'/object 时返回非数组，
// 调用方（plaza-browser.ts:394/:432/:476）对其 .map 即崩。修复后：
// 无值 / 合法数组 / 非法 JSON（既有 catch）/ 非数组 JSON（string、object）均安全。
// mock 策略同 plaza-xss.audit.test.ts（plaza-download + wails-bindings + @bindings），
// localStorage 用 happy-dom 环境真实实例（与 plaza-xss 同范式），按 key 清理。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../menus/plaza-download', () => ({
    installDownloadListener: vi.fn(),
    installEventListeners: vi.fn(),
    installShortcuts: vi.fn(),
    ensureObserver: vi.fn(),
}));
vi.mock('../core/wails-bindings', () => ({
    FetchPlazaConfig: vi.fn(),
    GetCachedPlazaConfig: vi.fn().mockResolvedValue(['', '']),
    SavePlazaConfig: vi.fn(),
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

import { getCustomPresets } from '../menus/plaza-browser';

const KEY = 'miku.plaza.presets.presets-test-site';

describe('plaza-browser getCustomPresets 非数组兜底 [audit:fix 2026-10]', () => {
    beforeEach(() => {
        localStorage.removeItem(KEY);
    });

    afterEach(() => {
        localStorage.removeItem(KEY);
    });

    it('localStorage 无值 → []', () => {
        expect(getCustomPresets('presets-test-site')).toEqual([]);
    });

    it('合法数组 → 原样返回（返回类型不变，调用方 .map 可用）', () => {
        const presets = [
            { label: 'MMD 模型', q: 'miku' },
            { label: '服装', q: 'skirt' },
        ];
        localStorage.setItem(KEY, JSON.stringify(presets));
        expect(getCustomPresets('presets-test-site')).toEqual(presets);
    });

    it("存 'not-json'（既有 catch 行为）→ []", () => {
        localStorage.setItem(KEY, 'not-json');
        expect(getCustomPresets('presets-test-site')).toEqual([]);
    });

    it('存非数组 JSON（"a string" / 对象）→ []（T1 新行为）', () => {
        localStorage.setItem(KEY, JSON.stringify('a string'));
        expect(getCustomPresets('presets-test-site')).toEqual([]);
        localStorage.setItem(KEY, JSON.stringify({ x: 1 }));
        expect(getCustomPresets('presets-test-site')).toEqual([]);
        // 嵌套数组外的合法 JSON 标量同理
        localStorage.setItem(KEY, 'null');
        expect(getCustomPresets('presets-test-site')).toEqual([]);
    });
});
