// [audit:fix 2026-10] T1: buildGazeTrackingLevel.onLangChange 修复验证
// ① 重建前释放旧 renderMenu disposer（旧滑块/监听器泄漏）
// ② c.innerHTML='' 清场后重建 conflict-banner（语言切换后 banner 不消失）
//
// Mock 策略（沿用 env-feature-levels.contract.test.ts 范式）：
// - render-menu 整体 mock（disposer 由 mock 返回值驱动，断言泄漏/重建）
// - scene/motion/perception、motion-modules/registry 轻 mock 切断重链
// - cardContainer / renderPerceptionConflictBanners / i18n 走真实叶（默认 happy-dom 环境）
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('../../menus/render-menu', () => ({
    renderMenu: vi.fn(() => vi.fn()),
}));

vi.mock('../../scene/motion/perception', () => ({
    getPerceptionState: vi.fn(() => ({})),
    setPerceptionState: vi.fn(),
    activatePerception: vi.fn(),
    pinPerception: vi.fn(),
    unpinPerception: vi.fn(),
    enableAllPerception: vi.fn(),
    disableAllPerception: vi.fn(),
    getPinnedModelIds: vi.fn(() => []),
    getPerceptionPerfTier: vi.fn(() => 'high'),
    getPerceptionPerfManualTier: vi.fn(() => null),
    setPerceptionPerfTier: vi.fn(),
    isAllPerceptionEnabled: vi.fn(() => false),
}));

vi.mock('../../scene/motion/motion-modules/registry', () => ({
    getModuleConflicts: vi.fn(() => []),
}));

import { buildGazeTrackingLevel } from '../../menus/motion-gaze-levels';
import { renderMenu } from '../../menus/render-menu';

const renderMenuMock = renderMenu as unknown as Mock<() => () => void>;

describe('buildGazeTrackingLevel.onLangChange [audit:fix 2026-10]', () => {
    let container: HTMLElement;

    beforeEach(() => {
        vi.clearAllMocks();
        container = document.createElement('div');
    });

    it('重建前释放旧 renderMenu disposer（旧订阅不泄漏）', () => {
        const level = buildGazeTrackingLevel();
        level.renderCustom!(container);
        const d1 = renderMenuMock.mock.results[0]?.value;
        expect(typeof d1).toBe('function');

        level.onLangChange?.();

        expect(d1).toHaveBeenCalledTimes(1);
        // renderCustom 1 次 + onLangChange 重建 1 次
        expect(renderMenuMock).toHaveBeenCalledTimes(2);
    });

    it('清场后重建 conflict-banner（语言切换后不消失）', () => {
        const level = buildGazeTrackingLevel();
        level.renderCustom!(container);
        const before = container.querySelector('.conflict-banner');
        expect(before).not.toBeNull();

        level.onLangChange?.();

        const after = container.querySelector('.conflict-banner');
        expect(after).not.toBeNull();
        expect(after).not.toBe(before); // 新节点：旧的已被 innerHTML='' 清掉
        // containerRef[0] 存的是外层 container（:511），重建 banner 与 renderMenu 同落外层容器（与 :528-531 重写一致）
        expect(after!.parentElement).toBe(container);
    });
});
