// [audit:fix 2026-10] T3: buildPresetScenesLevel —— GetPresetScenes reject 路径
// 修复前：swallowError 静默吞掉 reject → loadingPlaceholder 永不摘除（占位卡死）+ 拒绝无声。
// 修复后：链尾 .catch 显式 remove 占位 + logWarn('scene-render-levels','load preset scenes failed',err)。
//
// Mock 策略（沿用 menu/nav-click-dom.test.ts 范式）：
// - scene/scene 走共享工厂 sceneMockSuperset（+ 补 scene-render-levels 用到的 triggerAutoSave 叶 re-export）
// - scene-bundle / wails-bindings / render-menu 轻 mock 切断重链
// - cardContainer / slideRow / i18n / logger 走真实叶（默认 happy-dom 环境；断言走真实 getLogBuffer 环形缓冲）
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import { sceneMockSuperset } from '../mocks/scene-superset';

vi.mock('../../scene/scene', () => ({
    ...sceneMockSuperset(),
    triggerAutoSave: vi.fn(), // scene-render-levels 经 scene.ts:898 re-export 使用；共享工厂尚未收录
}));

vi.mock('../../scene/scene-bundle', () => ({
    exportSceneBundle: vi.fn(),
    importSceneBundle: vi.fn(),
}));

vi.mock('../../core/wails-bindings', () => ({
    GetPresetScenes: vi.fn(),
    GetPresetScenesDir: vi.fn().mockResolvedValue(''),
    DeletePresetScene: vi.fn(),
    LoadSceneFile: vi.fn(),
    SaveScenePreset: vi.fn(),
    SaveRenderPreset: vi.fn(), // scene-render-presets.ts 顶层使用
}));

vi.mock('../../menus/render-menu', () => ({
    renderMenu: vi.fn(() => vi.fn()),
}));

import { buildPresetScenesLevel } from '../../menus/scene-render-levels';
import { GetPresetScenes } from '../../core/wails-bindings';
import { getLogBuffer } from '../../core/logger';

const getPresetScenesMock = GetPresetScenes as unknown as Mock;

describe('buildPresetScenesLevel 预设加载失败 [audit:fix 2026-10]', () => {
    let container: HTMLElement;

    beforeEach(() => {
        vi.clearAllMocks();
        getLogBuffer().clear();
        container = document.createElement('div');
    });

    it('GetPresetScenes reject → 占位摘除（不卡死）+ logWarn 留痕', async () => {
        getPresetScenesMock.mockRejectedValue(new Error('binding down'));

        const level = buildPresetScenesLevel();
        level.renderCustom!(container);

        // 三张卡片都正常构建（异步 reject 不阻断同步渲染；卡片 3 = 场景包导入/导出 :171）
        expect(container.querySelectorAll('.lcard')).toHaveLength(3);

        // reject 微任务落地后：占位卡死解除 + 环形日志留痕（旧实现两条都不发生）
        await vi.waitFor(() => {
            // LogEntry.message 存的是带前缀串 `[tag] message`（logger.ts:136），tag 另存原值
            const hit = getLogBuffer()
                .getAll()
                .find(
                    (e) =>
                        e.tag === 'scene-render-levels' &&
                        e.level === 'warn' &&
                        e.message === '[scene-render-levels] load preset scenes failed'
                );
            expect(hit).toBeDefined();
        });
        expect(container.querySelectorAll('.lcard')[0].childElementCount).toBe(0);
    });
});
