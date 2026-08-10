/**
 * [doc:adr-229] setupE2ECapture 双运行时开关测试（P8-A diff-coverage 补测）。
 *
 * bb5972e9 钩子收敛：普通 dev 页面不再裸露 21 个可写全局——e2e 钩子
 * （__capture/__state/__scene）仅 isHeadless（?e2e=1）或 VITE_E2E_MODE 注入；
 * __dumpBones 保留 DEV/VITE_E2E_MODE 注入。本测试验证三态：
 *   1) e2e 模式（isHeadless=true）：全部钩子注入
 *   2) 非 e2e 模式（isHeadless=false）：仅 __dumpBones，e2e 钩子不注入
 *   3) __scene getter 数值可读（fps/meshCount/currentAnimation 等）
 *
 * 隔离：vi.mock 掉 scene/config/outfit/wind-physics/model-ops/logger/
 * e2e-state-bridge/lighting/renderer 全部外部依赖，不拉真实渲染器。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// 可切换的 isHeadless 状态（ESM live binding：getter 每次访问读取最新值）
const state = vi.hoisted(() => ({ isHeadless: true }));

vi.mock('../scene/scene', () => ({
    scene: { meshes: [], render: vi.fn() },
    engine: { getFps: () => 30 },
    get isHeadless() {
        return state.isHeadless;
    },
    focusedModel: () => null,
    modelManager: {},
}));
vi.mock('@/scene/manager/outfit', () => ({
    loadOutfits: vi.fn(),
    applyOutfitVariant: vi.fn(),
}));
vi.mock('../core/config', () => ({
    envState: { windSpeed: 0, windEnabled: false },
    mmdRuntime: null,
}));
vi.mock('@/scene/physics/wind-physics', () => ({
    isWindPhysicsActive: () => false,
}));
vi.mock('../scene/manager/model-ops', () => ({
    removeFocusedModel: vi.fn(),
}));
vi.mock('../core/logger', () => ({
    logInfo: vi.fn(),
}));
vi.mock('../core/e2e-state-bridge', () => ({
    getE2EStateReader: () => null,
}));
vi.mock('../scene/render/lighting', () => ({
    isLightingReady: () => false,
}));
vi.mock('../scene/render/renderer', () => ({
    isRenderReady: () => false,
}));
vi.mock('../scene/motion/bone-override', () => ({
    dumpBoneHierarchy: () => ({
        totalBones: 12,
        totalOverridden: 3,
    }),
}));

import { setupE2ECapture } from '../core/dev-hooks';

function clearHooks(): void {
    const w = window as unknown as Record<string, unknown>;
    delete w.__dumpBones;
    delete w.__capture;
    delete w.__state;
    delete w.__scene;
}

describe('setupE2ECapture 双运行时开关（钩子收敛，ADR-229）', () => {
    beforeEach(() => {
        clearHooks();
    });

    it('e2e 模式（isHeadless=true）：注入 __dumpBones + 全部 e2e 钩子', () => {
        state.isHeadless = true;
        setupE2ECapture();
        const w = window as unknown as Record<string, unknown>;
        expect(typeof w.__dumpBones).toBe('function');
        expect(typeof w.__capture).toBe('function');
        expect(w.__scene).toBeDefined();
    });

    it('非 e2e 模式（isHeadless=false）：仅 __dumpBones，e2e 钩子不注入', () => {
        state.isHeadless = false;
        setupE2ECapture();
        const w = window as unknown as Record<string, unknown>;
        expect(typeof w.__dumpBones).toBe('function');
        expect(w.__capture).toBeUndefined();
        expect(w.__state).toBeUndefined();
        expect(w.__scene).toBeUndefined();
    });

    it('__scene 数值 getter 可读（meshCount/fps/currentAnimation）', () => {
        state.isHeadless = true;
        setupE2ECapture();
        const scene = (window as unknown as { __scene: Record<string, unknown> }).__scene;
        expect(scene.meshCount).toBe(0); // mock scene.meshes = []
        expect(scene.fps).toBe(30); // mock engine.getFps
        expect(scene.currentAnimation).toBe('idle'); // focusedModel() = null
        expect(scene.windPhysicsActive).toBe(false);
    });

    it('__dumpBones 调用走通 bone-override 动态导入（devMode）', async () => {
        state.isHeadless = true;
        setupE2ECapture();
        const w = window as unknown as { __dumpBones: () => Promise<unknown> };
        const dump = await w.__dumpBones();
        expect(dump).toEqual({ totalBones: 12, totalOverridden: 3 });
    });

    it('__capture 在 headless 下返回空串（无 backbuffer 兜底）', async () => {
        state.isHeadless = true;
        setupE2ECapture();
        const w = window as unknown as { __capture: () => Promise<string> };
        expect(await w.__capture()).toBe('');
    });
});
