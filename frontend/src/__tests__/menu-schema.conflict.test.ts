// menu-schema.conflict.test.ts — conflictHint 冲突标记（ADR-163 §6.12，拆自 menu-schema.test.ts）
// 同 motion-module：依赖 vi.resetModules() + vi.doMock('@/core/state') 隔离模块图，renderMenu/getModuleConflicts 经动态 import 取用。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockScene, mockLighting, mockPerception, mockRegistry } from './menu-schema-mocks';

vi.mock('@/scene/scene', () => mockScene());
vi.mock('@/scene/render/lighting', () => mockLighting());
vi.mock('@/scene/motion/perception', () => mockPerception());
vi.mock('@/scene/motion/motion-modules/registry', () => mockRegistry());

describe('ADR-093 Menu Schema — conflictHint 冲突标记', () => {
    let container: HTMLElement;
    const TEST_MID = 'conflict-model';

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(() => {
        container.remove();
        vi.doUnmock('@/core/state');
    });

    it('shows warning icon when module conflicts exist', async () => {
        vi.resetModules();
        vi.doMock('@/core/state', async (importOriginal) => {
            const actual = await importOriginal<typeof import('../core/state')>();
            return { ...actual, focusedModelId: TEST_MID };
        });
        const { getModuleConflicts: gmc } =
            await import('../scene/motion/motion-modules/registry');
        (gmc as ReturnType<typeof vi.fn>).mockReturnValue([
            { bone: 'Head', byModule: 'breath' },
        ]);
        const { renderMenu: rm } = await import('../menus/render-menu');
        const schema: Parameters<typeof rm>[0] = [
            {
                id: 't:conflict',
                kind: 'slider',
                label: 'env.groundPitch',
                control: { bind: 'env.groundPitch', min: 0, max: 90, step: 1 },
                conflictHint: 'perception.gaze.head',
            },
        ];
        rm(schema, container);
        const warnIcon = container.querySelector('iconify-icon');
        expect(warnIcon).toBeTruthy();
        expect(warnIcon!.getAttribute('icon')).toBeTruthy();
        // jsdom 不支持 CSS var() 内联样式，验证 title 包含冲突提示文案
        expect((warnIcon as HTMLElement).title).toBeTruthy();
    });

    it('no icon when no conflicts', async () => {
        vi.resetModules();
        vi.doMock('@/core/state', async (importOriginal) => {
            const actual = await importOriginal<typeof import('../core/state')>();
            return { ...actual, focusedModelId: TEST_MID };
        });
        const { getModuleConflicts: gmc } =
            await import('../scene/motion/motion-modules/registry');
        (gmc as ReturnType<typeof vi.fn>).mockReturnValue([]);
        const { renderMenu: rm } = await import('../menus/render-menu');
        const schema: Parameters<typeof rm>[0] = [
            {
                id: 't:noConflict',
                kind: 'slider',
                label: 'env.groundPitch',
                control: { bind: 'env.groundPitch', min: 0, max: 90, step: 1 },
                conflictHint: 'perception.gaze.head',
            },
        ];
        rm(schema, container);
        const warnIcon = container.querySelector('iconify-icon');
        expect(warnIcon).toBeNull();
    });
});
