// ADR-147 R2 — 帧钩子显式 order 排序验证。
// 治理根因 R2：原实现用 Set 按插入序遍历，钩子间同骨获胜者依赖模块注册次序（隐式定序），
// 表现为「后注册的模块盖过先注册的」「后面的 AI 加钩子带动前面」。
// 本测试锁死：执行序只由 order 声明决定、与注册顺序无关；同 order 稳定；执行期注销安全。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { getMotionPipeline } from '@/scene/motion/motion-pipeline';
import {
    startBoneOverride,
    stopBoneOverride,
    registerBoneOverrideFrameHook,
} from '@/scene/motion/bone-override';

// 注入聚焦模型，使 bone-override 层回调越过 focusedId 守卫进入 _runFrameHooks
vi.mock('@/core/state', async (importActual) => ({
    ...(await importActual<typeof import('@/core/state')>()),
    focusedModelId: 'test-model',
}));

let engine: NullEngine;
let scene: Scene;

beforeEach(() => {
    engine = new NullEngine();
    scene = new Scene(engine);
});

afterEach(() => {
    stopBoneOverride();
    scene.dispose();
    engine.dispose();
});

describe('Bone Override 帧钩子顺序（ADR-147 R2）', () => {
    it('帧钩子按 order 升序执行，与注册顺序无关', () => {
        startBoneOverride(() => [], scene);
        const order: string[] = [];

        // 故意逆序注册：高 order 先注册、低 order 后注册
        const unregHigh = registerBoneOverrideFrameHook(() => {
            order.push('high');
        }, 30);
        const unregMid = registerBoneOverrideFrameHook(() => {
            order.push('mid');
        }, 20);
        const unregLow = registerBoneOverrideFrameHook(() => {
            order.push('low');
        }, 10);

        getMotionPipeline().runFrame({ scene });

        // 即便高 order 先注册，仍必须按 order 升序执行
        expect(order).toEqual(['low', 'mid', 'high']);
        unregLow();
        unregMid();
        unregHigh();
    });

    it('同 order 时按注册顺序（稳定排序）', () => {
        startBoneOverride(() => [], scene);
        const order: string[] = [];
        const a = registerBoneOverrideFrameHook(() => order.push('a'), 0);
        const b = registerBoneOverrideFrameHook(() => order.push('b'), 0);
        getMotionPipeline().runFrame({ scene });
        expect(order).toEqual(['a', 'b']);
        a();
        b();
    });

    it('执行期间 unregister 安全（快照迭代，不跳过后续钩子）', () => {
        startBoneOverride(() => [], scene);
        const order: string[] = [];
        const u2 = registerBoneOverrideFrameHook(() => {
            order.push('second');
        }, 20);
        const u1 = registerBoneOverrideFrameHook(() => {
            order.push('first');
            u2(); // 执行中注销另一钩子
        }, 10);
        getMotionPipeline().runFrame({ scene });
        // 快照已包含 second，即便执行中被注销仍会执行
        expect(order).toEqual(['first', 'second']);
        u1();
    });

    it('stopBoneOverride 清空所有帧钩子', () => {
        startBoneOverride(() => [], scene);
        let called = false;
        registerBoneOverrideFrameHook(() => {
            called = true;
        }, 0);
        stopBoneOverride();
        // 此时 bone-override 层已注销，runFrame 不再触发 _runFrameHooks
        getMotionPipeline().runFrame({ scene });
        expect(called).toBe(false);
    });
});
