// @vitest-environment node
// menu-schema.motion-module.test.ts — motionModule. StatePath 前缀（ADR-093 §6.10，拆自 menu-schema.test.ts）
// 该 describe 依赖 vi.resetModules() + vi.doMock('@/core/state') 在隔离模块图内重绑 state，
// 故 getStateValue/setStateValue 经动态 import 取用重置后的实例（与 vi.mock 工厂不可共享的规律一致）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { StatePath } from '../menus/menu-schema';
import { mockScene, mockLighting, mockPerception, mockRegistry } from './menu-schema-mocks';

/**
 * 本文件测的是**解析器**对 `motionModule.<id>.<key>` 的动态路由（id 由 mock registry 提供，
 * 故意不在 `MotionModuleParamKeys` 里登记）。这样绕过 StatePath 检查是刻意的：
 * 登记的模块 id 已经由 tsc 保证，这里要证明的是「未登记 id 也走同一条解析路径」。
 */
const dynamicPath = (p: string): StatePath => p as StatePath;

vi.mock('@/scene/scene', () => mockScene());
vi.mock('@/scene/render/lighting', () => mockLighting());
vi.mock('@/scene/motion/perception', () => mockPerception());
vi.mock('@/scene/motion/motion-modules/registry', () => mockRegistry());

describe('ADR-093 Menu Schema — motionModule. StatePath 前缀', () => {
    const TEST_MID = 'test-model-1';

    beforeEach(() => {
        vi.resetModules();
        vi.doMock('@/core/state', async (importOriginal) => {
            const actual = await importOriginal<typeof import('../core/state')>();
            return {
                ...actual,
                focusedModelId: TEST_MID,
                modelRegistry: new Map<string, any>([
                    [
                        TEST_MID,
                        {
                            motionOverrideModules: [
                                { id: 'gaze', enabled: true, params: { headYawRange: 45 } },
                            ],
                        },
                    ],
                ]),
            };
        });
    });

    afterEach(() => {
        vi.doUnmock('@/core/state');
    });

    it('reads from registry getModuleState（单源，intent.motionModules + actionId）', async () => {
        const { getStateValue: gsv } = await import('../menus/menu-schema');
        const { getModuleState: gms } = await import('../scene/motion/motion-modules/registry');
        (gms as ReturnType<typeof vi.fn>).mockReturnValue({
            enabled: true,
            params: { headYawRange: 45 },
        });
        expect(gsv(dynamicPath('motionModule.gaze.headYawRange'))).toBe(45);
        expect(gms).toHaveBeenCalledWith(TEST_MID, 'gaze', undefined);
    });

    it('falls back to getModuleDefaultParam when undefined', async () => {
        const { getModuleDefaultParam: gmdp } =
            await import('../scene/motion/motion-modules/registry');
        (gmdp as ReturnType<typeof vi.fn>).mockReturnValue(30);
        const { getStateValue: gsv } = await import('../menus/menu-schema');
        expect(gsv(dynamicPath('motionModule.gaze.breathAmp'))).toBe(30);
        expect(gmdp).toHaveBeenCalledWith('gaze', 'breathAmp');
    });

    it('writes via setModuleParam（单源，不再写 inst.motionOverrideModules）', async () => {
        const { setStateValue: ssv } = await import('../menus/menu-schema');
        const { setModuleParam: smp } = await import('../scene/motion/motion-modules/registry');
        ssv(dynamicPath('motionModule.newMod.someParam'), 0.75);
        expect(smp).toHaveBeenCalledWith(TEST_MID, 'newMod', 'someParam', 0.75, undefined);
    });

    it('returns undefined when no focused model', async () => {
        vi.doMock('@/core/state', async (importOriginal) => {
            const actual = await importOriginal<typeof import('../core/state')>();
            return { ...actual, focusedModelId: null, modelRegistry: new Map() };
        });
        const { getStateValue: gsv } = await import('../menus/menu-schema');
        expect(gsv(dynamicPath('motionModule.gaze.headYawRange'))).toBeUndefined();
    });
});
