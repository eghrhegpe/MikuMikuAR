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
const state = vi.hoisted(() => ({
    isHeadless: true,
    // 可切换的 focusedModel 返回值（driver.applyOutfit 分支）
    model: null as { id: string } | null,
}));

vi.mock('../scene/scene', () => ({
    scene: { meshes: [], render: vi.fn() },
    engine: { getFps: () => 30 },
    get isHeadless() {
        return state.isHeadless;
    },
    focusedModel: () => state.model,
    modelManager: { models: [] },
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
    getE2EStateReader: () => (path: string): unknown => path,
}));
vi.mock('../scene/render/lighting', () => ({
    isLightingReady: () => true,
}));
vi.mock('../scene/render/renderer', () => ({
    isRenderReady: () => true,
}));
vi.mock('../scene/motion/bone-override', () => ({
    dumpBoneHierarchy: () => ({
        totalBones: 12,
        totalOverridden: 3,
    }),
}));
vi.mock('@babylonjs/core/Meshes/meshBuilder', () => ({
    MeshBuilder: { CreateBox: vi.fn(() => ({ name: 'e2e-test-mesh', material: null, dispose: vi.fn() })) },
}));
vi.mock('@babylonjs/core/Materials/standardMaterial', () => ({
    StandardMaterial: class {
        diffuseColor: unknown = null;
    },
}));
vi.mock('@babylonjs/core/Maths/math.color', () => ({
    Color3: class {
        r = 1;
        g = 0;
        b = 0;
    },
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

    it('__state 注入且 isLightingReady/isRenderReady 返回真实就绪状态（守卫域探测）', () => {
        state.isHeadless = true;
        setupE2ECapture();
        const w = window as unknown as { __state: { get: (p: string) => unknown; isLightingReady: boolean; isRenderReady: boolean } };
        expect(w.__state).toBeDefined();
        expect(w.__state.get('light.foo')).toBe('light.foo'); // mock reader 原样返回 path
        expect(w.__state.isLightingReady).toBe(true); // mock isLightingReady
        expect(w.__state.isRenderReady).toBe(true); // mock isRenderReady
    });

    it('__scene.driver.applyOutfit：无聚焦模型时返回 false（不抛）', async () => {
        state.isHeadless = true;
        state.model = null;
        setupE2ECapture();
        const scene = (window as unknown as { __scene: { driver: { applyOutfit: (v: string) => Promise<boolean> } } }).__scene;
        await expect(scene.driver.applyOutfit('variant-a')).resolves.toBe(false);
    });

    it('__scene.driver.setWindSpeed / removeActiveModel / clearTestMeshes 可调用（写钩子收敛到 driver）', () => {
        state.isHeadless = true;
        setupE2ECapture();
        const scene = (window as unknown as { __scene: { driver: Record<string, unknown> } }).__scene;
        expect(typeof scene.driver.setWindSpeed).toBe('function');
        expect(typeof scene.driver.removeActiveModel).toBe('function');
        expect(typeof scene.driver.createTestMesh).toBe('function');
        expect(typeof scene.driver.clearTestMeshes).toBe('function');
        // 实际调用不抛（headless + mock scene.meshes=[]）
        (scene.driver.setWindSpeed as (s: number) => void)(2.5);
        (scene.driver.removeActiveModel as () => void)();
        (scene.driver.clearTestMeshes as () => void)();
    });

    it('__scene.driver.createTestMesh 走通 Babylon mock 创建（meshCount 增长）', async () => {
        state.isHeadless = true;
        setupE2ECapture();
        const scene = (window as unknown as { __scene: { driver: { createTestMesh: () => Promise<void> } } }).__scene;
        await expect(scene.driver.createTestMesh()).resolves.toBeUndefined();
    });

    it('物理探针 / outfitVariants 在无 runtime 时安全返回兜底值', async () => {
        state.isHeadless = true;
        state.model = null;
        setupE2ECapture();
        const scene = (window as unknown as {
            __scene: {
                rigidBodyCount: number;
                rigidBodyBundleCount: number;
                outfitVariants: () => Promise<{ variants: string[]; error: string | null }>;
            };
        }).__scene;
        expect(scene.rigidBodyCount).toBe(0); // mmdRuntime = null → 0
        expect(scene.rigidBodyBundleCount).toBe(0);
        await expect(scene.outfitVariants()).resolves.toEqual({ variants: [], error: null }); // focusedModel = null
    });
});
