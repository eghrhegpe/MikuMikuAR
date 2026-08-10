// @vitest-environment node
// env-bridge/cel-ground-persist.test.ts — cel-shading 地面哑光临时切换的持久化行为
// 修复验证（env-bridge.ts registerCelGroundCoupling + cancelEnvPersistTimer）：
//   cel 激活临时关 groundPbr 用 skipAutoSave=true，但因契约 skipAutoSave 只跳过
//   triggerAutoSave、不跳过 env 防抖持久化，若不 cancelEnvPersistTimer，中间态会在
//   500ms 后写回后端。本测试验证激活时取消持久化、关闭时恢复最终态重新调度。
//
// 注意：本文件不得 import './env-mocks'（静态或动态都会破坏 renderer mock 命中），
// 初始状态一律经 setEnvState 真实入口设置。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => {
    const s = { called: 0 };
    return {
        registerCelGroundCoupling: vi.fn((cb: (active: boolean) => void) => {
            s.called++;
            return cb;
        }),
        s,
    };
});

vi.mock(
    'babylon-mmd/esm/Runtime/Optimized/mmdWasmRuntime',
    async () => (await import('./env-mocks')).mmdWasmRuntimeModule
);
vi.mock('../../core/backend', async () => (await import('./env-mocks')).backendModule);
vi.mock(
    '@babylonjs/core/Maths/math.vector',
    async () => (await import('./env-mocks')).babylonVectorModule
);
vi.mock(
    '@babylonjs/core/Maths/math.color',
    async () => (await import('./env-mocks')).babylonColorModule
);
vi.mock('../../core/config', async () => (await import('./env-mocks')).configModule);
vi.mock(
    '../../scene/env/env-lighting',
    async () => (await import('./env-mocks')).envLightingModule
);
vi.mock('../../scene/env/env-impl', async () => (await import('./env-mocks')).envImplModule);
vi.mock(
    '../../scene/env/_bridge/env-dispatcher',
    async () => (await import('./env-mocks')).envDispatcherModule
);
vi.mock('../../scene/render/lighting', async () => (await import('./env-mocks')).lightingModule);
vi.mock('../../scene/scene', async () => (await import('./env-mocks')).sceneModule);
vi.mock('../../scene/render/renderer', () => ({
    registerCelGroundCoupling: h.registerCelGroundCoupling,
}));

import { setEnvState } from '../../scene/env/_bridge/env-bridge';

// env-bridge 模块加载时向 renderer 注册 cel 耦合回调，此处捕获供测试触发
const celCoupling: (active: boolean) => void = h.registerCelGroundCoupling.mock.calls[0]?.[0];

describe('cel-shading 地面哑光临时切换', () => {
    beforeEach(() => {
        vi.spyOn(globalThis, 'setTimeout');
        vi.spyOn(globalThis, 'clearTimeout');
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('cel 激活：临时关 groundPbr 且取消防抖持久化（中间态不落盘）', () => {
        expect(typeof celCoupling).toBe('function');
        setEnvState({ groundPbrEnabled: true }, true);
        celCoupling(true);
        // setEnvState 先 schedule（setTimeout），随后 cancelEnvPersistTimer 取消（clearTimeout）
        expect(clearTimeout).toHaveBeenCalled();
    });

    it('cel 关闭：恢复原值并重新调度持久化（最终态落盘）', () => {
        setEnvState({ groundPbrEnabled: true }, true);
        celCoupling(true);
        vi.mocked(setTimeout).mockClear();
        vi.mocked(clearTimeout).mockClear();
        celCoupling(false);
        expect(setTimeout).toHaveBeenCalledWith(expect.any(Function), 500);
    });

    it('cel 激活但原始 groundPbr=false：无临时切换，不触发持久化', () => {
        setEnvState({ groundPbrEnabled: false }, true);
        vi.mocked(setTimeout).mockClear();
        vi.mocked(clearTimeout).mockClear();
        celCoupling(true);
        expect(setTimeout).not.toHaveBeenCalled();
        expect(clearTimeout).not.toHaveBeenCalled();
    });
});
