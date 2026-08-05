import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { Scene } from '@babylonjs/core/scene';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { GroundMesh } from '@babylonjs/core/Meshes/groundMesh';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';

// 隔离全局 scene 单例：env-terrain.ts 从 env-ground.ts 导入 _effectiveBumpLevel，
// 后者传递性拉起 scene/render/performance.ts → scene/scene.ts。scene.ts 模块顶层
// new Scene(engine) 在 vitest 下会崩——Engine 已被别名到 mocks/engine-mock.ts，
// 该 mock 无 scenes 数组，真实 Scene 构造器执行 engine.scenes.push(this) 时抛
// "Cannot read properties of undefined (reading 'push')"。
// 被测的 hash2/valueNoise/fbm/generateTerrainHeightmapURL 均为纯函数，不依赖 scene
// 单例，故 mock 掉顶层 Scene 构造即可（与 env-impl.test.ts 同一模式）。
vi.mock('../../scene/scene', () => ({
    scene: {} as unknown as Scene,
}));

import {
    hash2,
    valueNoise,
    fbm,
    generateTerrainHeightmapURL,
    applyTerrainMaterial,
    createHeightmapGround,
    clearTerrainGeneration,
} from '../../scene/env/env-terrain';
import { envState } from '@/core/config';
import { underwaterFogController } from '../../scene/env/env-underwater-fog';

// happy-dom 无真实 2D canvas；为 generateTerrainHeightmapURL 提供最小桩：
// createImageData 返回真实 Uint8ClampedArray（FBM 像素写入），putImageData 捕获它，
// toDataURL 返回像素缓冲的 FNV-1a 校验和 —— 从而锁定「FBM → 高度图像素」映射，
// 而不依赖真实 PNG 编码（该编码在 happy-dom 下不可用）。
let restoreCanvas: () => void;
beforeAll(() => {
    let captured: { data: Uint8ClampedArray } | null = null;
    const fakeCanvas = {
        width: 0,
        height: 0,
        getContext: () => ({
            createImageData: (w: number, h: number) => {
                const data = new Uint8ClampedArray(w * h * 4);
                return { data, width: w, height: h };
            },
            putImageData: (img: { data: Uint8ClampedArray }) => {
                captured = img;
            },
        }),
        toDataURL: () => {
            const d = captured!.data;
            let h = 2166136261 >>> 0;
            for (let i = 0; i < d.length; i++) {
                h ^= d[i];
                h = Math.imul(h, 16777619) >>> 0;
            }
            return `data:image/png;base64,${h.toString(16)}`;
        },
    };
    const orig = document.createElement.bind(document);
    (document as any).createElement = (tag: string) =>
        tag === 'canvas' ? (fakeCanvas as any) : orig(tag);
    restoreCanvas = () => {
        (document as any).createElement = orig;
    };
});

afterAll(() => restoreCanvas());

describe('env-terrain FBM（确定性函数输出锁定）', () => {
    it('hash2：确定性、随坐标/种子变化、落在 [0,1)', () => {
        // 锁定精确值（重构 hash2 会改变 → 捕获回归）
        expect(hash2(0, 0, 1337)).toBe(0.34160740937609396);
        expect(hash2(0, 0, 1337)).toBe(0.34160740937609396); // 同输入复现
        expect(hash2(0, 0, 9999)).toBe(0.26923139469447344);
        // 不同坐标 → 不同值
        expect(hash2(1, 1, 1337)).not.toBe(hash2(0, 0, 1337));
        // 范围
        const v = hash2(3, 7, 42);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
    });

    it('valueNoise：确定性、落在 [0,1]', () => {
        const v = valueNoise(0.5, 0.5, 1337);
        expect(v).toBe(0.2547532315377037);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
        expect(valueNoise(0.5, 0.5, 1337)).toBe(v); // 复现
    });

    it('fbm：确定性、约 [-1,1]、octaves 影响结果', () => {
        const f = fbm(10, 10, 1337, 5, 0.06);
        expect(f).toBe(-0.4172433351084645);
        // octaves=1 退化为单倍频，仍在 [-1,1]
        const f1 = fbm(10, 10, 1337, 1, 0.06);
        expect(f1).toBeGreaterThanOrEqual(-1);
        expect(f1).toBeLessThanOrEqual(1);
        expect(f1).not.toBe(f); // 层数不同 → 地形不同
        expect(fbm(10, 10, 1337, 5, 0.06)).toBe(f); // 复现
    });

    it('generateTerrainHeightmapURL：输出 data URL、确定性可锁', () => {
        const url = generateTerrainHeightmapURL({
            height: 4,
            scale: 0.06,
            seed: 1337,
            octaves: 5,
        });
        expect(url.startsWith('data:image/png;base64,')).toBe(true);
        // 同参数 → 同校验和（锁定 FBM → 像素映射）
        const url2 = generateTerrainHeightmapURL({
            height: 4,
            scale: 0.06,
            seed: 1337,
            octaves: 5,
        });
        expect(url).toBe(url2);
        expect(url).toBe('data:image/png;base64,17e2571');
        // 不同种子 → 不同地形
        const urlSeed = generateTerrainHeightmapURL({
            height: 4,
            scale: 0.06,
            seed: 9999,
            octaves: 5,
        });
        expect(urlSeed).toBe('data:image/png;base64,5ecd5e91');
        expect(urlSeed).not.toBe(url);
    });
});

// ======== applyTerrainMaterial 集成测试 ========

describe('applyTerrainMaterial — P1 uninstall 守卫', () => {
    let engine: NullEngine;
    let scene: Scene;

    beforeEach(() => {
        engine = new NullEngine();
        scene = new Scene(engine);
    });

    afterEach(() => {
        scene.dispose();
        engine.dispose();
    });

    it('PBRMaterial 旧材质销毁前调用 underwaterFogController.uninstall', () => {
        const spy = vi.spyOn(underwaterFogController, 'uninstall');
        const ground = MeshBuilder.CreateGround('g', { width: 10, height: 10 }, scene) as GroundMesh;
        ground.material = new PBRMaterial('oldPBR', scene);

        applyTerrainMaterial(ground, envState, scene);

        expect(spy).toHaveBeenCalledTimes(1);
        spy.mockRestore();
    });

    it('StandardMaterial 旧材质销毁前调用 underwaterFogController.uninstall', () => {
        const spy = vi.spyOn(underwaterFogController, 'uninstall');
        const ground = MeshBuilder.CreateGround('g', { width: 10, height: 10 }, scene) as GroundMesh;
        ground.material = new StandardMaterial('oldStd', scene);

        applyTerrainMaterial(ground, envState, scene);

        expect(spy).toHaveBeenCalledTimes(1);
        spy.mockRestore();
    });

    it('无旧材质时不调用 uninstall', () => {
        const spy = vi.spyOn(underwaterFogController, 'uninstall');
        const ground = MeshBuilder.CreateGround('g', { width: 10, height: 10 }, scene) as GroundMesh;

        applyTerrainMaterial(ground, envState, scene);

        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
    });
});

// ======== createHeightmapGround onReady 陈旧回调守卫（P3-①） ========

describe('createHeightmapGround — onReady 陈旧回调守卫', () => {
    let engine: NullEngine;
    let scene: Scene;

    beforeEach(() => {
        engine = new NullEngine();
        scene = new Scene(engine);
        clearTerrainGeneration();
    });

    afterEach(() => {
        scene.dispose();
        engine.dispose();
    });

    it('onReady 对已 dispose 的 mesh 不调用回调（terrain→移除/换 flat 场景）', () => {
        // 捕获 CreateGroundFromHeightMap 的 onReady，手动控制触发时序，
        // 复现「旧地形 mesh 被销毁后，异步 onReady 才到达」的竞态。
        let capturedOnReady: ((mesh: GroundMesh) => void) | undefined;
        // mock 签名与上游 CreateGroundFromHeightMap 对齐；仅用于拦截 onReady 触发时机
        const spy = vi
            .spyOn(MeshBuilder, 'CreateGroundFromHeightMap')
            .mockImplementation(((_name: string, _url: string, options: { onReady?: (m: GroundMesh) => void }) => {
                capturedOnReady = options.onReady;
                return MeshBuilder.CreateGround('envGround', { width: 10, height: 10 }, scene) as GroundMesh;
            }) as never);

        const onReady = vi.fn();
        const hg = createHeightmapGround(envState, scene, onReady);
        expect(capturedOnReady).toBeDefined();

        // 模拟 terrain→flat/hidden 重建路径：旧 mesh 被 dispose，_terrainGen 未递增
        hg.dispose();

        // 延迟到达的 onReady：mesh 已销毁，不得执行 applyTerrainMaterial（防僵尸材质泄漏）
        capturedOnReady?.(hg as unknown as GroundMesh);

        expect(onReady).not.toHaveBeenCalled();
        spy.mockRestore();
    });

    it('onReady 对存活 mesh 正常触发（修复不误伤正常路径）', () => {
        let capturedOnReady: ((mesh: GroundMesh) => void) | undefined;
        const spy = vi
            .spyOn(MeshBuilder, 'CreateGroundFromHeightMap')
            .mockImplementation(((_name: string, _url: string, options: { onReady?: (m: GroundMesh) => void }) => {
                capturedOnReady = options.onReady;
                return MeshBuilder.CreateGround('envGround', { width: 10, height: 10 }, scene) as GroundMesh;
            }) as never);

        const onReady = vi.fn();
        const hg = createHeightmapGround(envState, scene, onReady);
        expect(capturedOnReady).toBeDefined();

        // 存活 mesh + 代际匹配 → onReady 正常触发（守卫不误伤）
        capturedOnReady?.(hg as unknown as GroundMesh);

        expect(onReady).toHaveBeenCalledTimes(1);
        spy.mockRestore();
    });
});
