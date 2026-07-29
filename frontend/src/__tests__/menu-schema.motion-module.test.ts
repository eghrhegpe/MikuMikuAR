// menu-schema.motion-module.test.ts — motionModule. StatePath 前缀（ADR-093 §6.10，拆自 menu-schema.test.ts）
// 该 describe 依赖 vi.resetModules() + vi.doMock('@/core/state') 在隔离模块图内重绑 state，
// 故 getStateValue/setStateValue 经动态 import 取用重置后的实例（与 vi.mock 工厂不可共享的规律一致）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockScene, mockLighting, mockPerception, mockRegistry } from './menu-schema-mocks';

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

    it('reads from modelRegistry motionOverrideModules', async () => {
        const { getStateValue: gsv } = await import('../menus/menu-schema');
        expect(gsv('motionModule.gaze.headYawRange')).toBe(45);
    });

    it('falls back to getModuleDefaultParam when undefined', async () => {
        const { getModuleDefaultParam: gmdp } =
            await import('../scene/motion/motion-modules/registry');
        (gmdp as ReturnType<typeof vi.fn>).mockReturnValue(30);
        const { getStateValue: gsv } = await import('../menus/menu-schema');
        expect(gsv('motionModule.gaze.breathAmp')).toBe(30);
        expect(gmdp).toHaveBeenCalledWith('gaze', 'breathAmp');
    });

    it('writes create module state if not exists', async () => {
        const { setStateValue: ssv } = await import('../menus/menu-schema');
        const { modelRegistry: mr } = await import('../core/state');
        ssv('motionModule.newMod.someParam', 0.75);
        const inst = mr.get(TEST_MID);
        const mod = inst?.motionOverrideModules?.find((m: any) => m.id === 'newMod');
        expect(mod).toBeTruthy();
        expect(mod!.params.someParam).toBe(0.75);
    });

    it('returns undefined when no focused model', async () => {
        vi.doMock('@/core/state', async (importOriginal) => {
            const actual = await importOriginal<typeof import('../core/state')>();
            return { ...actual, focusedModelId: null, modelRegistry: new Map() };
        });
        const { getStateValue: gsv } = await import('../menus/menu-schema');
        expect(gsv('motionModule.gaze.headYawRange')).toBeUndefined();
    });
});
