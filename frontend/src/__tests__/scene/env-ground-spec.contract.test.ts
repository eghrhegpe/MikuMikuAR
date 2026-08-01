// env-ground-spec.contract.test.ts — ADR-226 Phase 3 一致性合约测试
//
// 双重护栏：
//   A. spec 内部契约：buildGroundMaterialSpec 重建产物 == applyGroundMaterialSpec 原地产物
//      （同一结构性 spec 下，从 stateA 重建后原地切到 stateB，应与直接重建 stateB 等价）
//   B. 迁移护栏：legacy applyGround（重建 / 原地）产物 == spec 模块（createGroundMeshFromSpec /
//      applyGroundMaterialSpec）产物。Phase 1/2 把 applyGround 改接 spec 时，此合约直接抓回归。
//
// 排除出「材质刷新」契约的字段（非刷新属性，二者可不同，不视为分叉）：
//   - uOffset / vOffset：tickGround 每帧动画值，首帧后趋同
//   - backFaceCulling：一次性材质标志（已对齐 legacy 设 false）

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { Material } from '@babylonjs/core/Materials/material';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { PBRMaterial } from '@babylonjs/core';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';

// 隔离 env-impl / env-context / env-reflection，避免重型链（clouds/particles/renderer→scene）
vi.mock('../../scene/env/env-impl', () => {
    if (!(globalThis as any).__groundSpecScene) {
        (globalThis as any).__groundSpecScene = null;
    }
    if (!(globalThis as any).__groundSpecEnvSys) {
        (globalThis as any).__groundSpecEnvSys = { ground: { mesh: null as any } };
    }
    return {
        _envSys: (globalThis as any).__groundSpecEnvSys,
        getScene: () => (globalThis as any).__groundSpecScene as Scene,
        ensureEnvUpdateObserver: () => {},
    };
});
vi.mock('../../scene/env/_shared/env-context', () => {
    if (!(globalThis as any).__groundSpecEnvSys) {
        (globalThis as any).__groundSpecEnvSys = { ground: { mesh: null as any } };
    }
    return {
        _envSys: (globalThis as any).__groundSpecEnvSys,
        getScene: () => (globalThis as any).__groundSpecScene as Scene,
        initEnvImpl: () => {},
        isInitialized: () => true,
        getPipeline: () => null,
        INFINITE_GROUND_SIZE: 2000,
        effectiveGroundSize: (groundSize: number, infiniteEnabled: boolean) =>
            infiniteEnabled ? 2000 : groundSize,
    };
});
vi.mock('../../scene/env/env', () => ({ ensureEnvUpdateObserver: () => {} }));
// ADR-151: 避免 env-reflection → renderer → performance → scene 重链
vi.mock('../../scene/env/env-reflection', () => ({ getPlanarQualityOverride: () => null }));
// 防御：env-terrain 经 env-ground 间接拉 scene.ts 模块级 new Scene()，单测桩掉
vi.mock('../../scene/scene', () => ({ scene: {} as unknown as Scene }));

import { _envSys } from '../../scene/env/env-impl';
import {
    applyGround,
    disposeGround,
    clearGroundTexCache,
    type GroundMat,
} from '../../scene/env/env-ground';
import {
    buildGroundMaterialSpec,
    specKey,
    groundSpecNeedsRebuild,
    applyGroundMaterialSpec,
    createGroundMeshFromSpec,
} from '../../scene/env/env-ground-spec';
import { GROUND_PRESETS, buildGroundPresetEnvState } from '../../scene/env/env-ground-presets';
import type { EnvState } from '@/core/types';
import { disposeTextureCache } from '../../scene/env/_shared/env-texture';

// 1×1 透明 PNG，避免外部贴图用例触发网络/异步加载
const TINY_PNG =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC';

let engine: NullEngine;
let scene: Scene;

beforeEach(() => {
    engine = new NullEngine();
    scene = new Scene(engine);
    (globalThis as any).__groundSpecScene = scene;
    (globalThis as any).__groundSpecEnvSys.ground.mesh = null;
    clearGroundTexCache();
});

afterEach(() => {
    disposeGround();
    (globalThis as any).__groundSpecEnvSys.ground.mesh = null;
    (globalThis as any).__groundSpecScene = null;
    scene.dispose();
    engine.dispose();
});

// ──────────────── 状态构造：以 metalStage 预设为基底，强制补全所有 material 字段 ────────────────
function makeState(overrides: Partial<EnvState> = {}): EnvState {
    const base = buildGroundPresetEnvState(GROUND_PRESETS.metalStage) as Record<string, unknown>;
    return {
        ...base,
        groundVisibleEnabled: true,
        groundType: 'flat',
        groundInfiniteEnabled: false,
        groundSize: 500,
        groundLevel: 0,
        groundPitch: 0,
        groundRoll: 0,
        reflectionQuality: 'off',
        groundReflectionQuality: 'off',
        groundReflectionBlend: 0,
        groundPbrEnabled: false,
        groundProceduralTexture: 'none',
        groundProceduralSeed: 42,
        groundProceduralScale: 1,
        groundTextureEnabled: false,
        groundTexture: '',
        groundTextureScale: 1,
        groundTextureRotation: 0,
        groundStyle: 'solid',
        groundColor: [0.2, 0.6, 0.9],
        groundLineColor: [1, 1, 1],
        groundGridSize: 1,
        groundOverlay: 'none',
        groundPattern: 'grid',
        groundNormalTexture: '',
        groundNormalStrength: 1,
        groundMetallic: 0,
        groundRoughness: 0.6,
        groundReflectionBlur: 0,
        groundReflectionDistort: 0.3,
        groundScrollSpeedX: 0,
        groundScrollSpeedZ: 0,
        groundEdgeFade: 0,
        groundAlpha: 0.6,
        ...overrides,
    } as unknown as EnvState;
}

// ──────────────── 材质指纹：仅抽取「刷新相关」标量，排除动画/一次性标志 ────────────────
interface MatFingerprint {
    isPBR: boolean;
    alpha: number;
    transparencyMode: number | null;
    albedoColor: [number, number, number];
    metallic: number | null;
    roughness: number | null;
    hasBump: boolean;
    bumpLevel: number | null;
    hasMetallicTex: boolean;
    hasAlbedoTex: boolean;
    uScale: number | null;
    vScale: number | null;
    hasOpacity: boolean;
}

function fingerprint(mat: Material | null): MatFingerprint {
    if (!mat) throw new Error('fingerprint: material is null');
    const isPBR = mat instanceof PBRMaterial;
    const sm = mat as StandardMaterial;
    const pm = mat as PBRMaterial;
    const tex = (isPBR ? pm.albedoTexture : sm.diffuseTexture) as Texture | null;
    const color = isPBR ? pm.albedoColor : sm.diffuseColor;
    return {
        isPBR,
        alpha: mat.alpha,
        transparencyMode: isPBR ? pm.transparencyMode : null,
        albedoColor: [color.r, color.g, color.b],
        metallic: isPBR ? pm.metallic : null,
        roughness: isPBR ? pm.roughness : null,
        hasBump: isPBR ? !!pm.bumpTexture : false,
        bumpLevel: isPBR && pm.bumpTexture ? pm.bumpTexture.level : null,
        hasMetallicTex: isPBR ? !!pm.metallicTexture : false,
        hasAlbedoTex: !!tex,
        uScale: tex instanceof Texture ? tex.uScale : null,
        vScale: tex instanceof Texture ? tex.vScale : null,
        hasOpacity: !!(mat as unknown as { opacityTexture?: unknown }).opacityTexture,
    };
}

// spec 侧用偏移 seed 隔离程序化纹理缓存，避免与 legacy 侧共享同一缓存 normal 纹理
// （disposeGround 在两次捕获间会 null 被处置材质的 bumpTexture 引用，导致共享缓存状态污染）。
// seed 只影响纹理像素内容，不影响 bump/metallic/roughness 的「存在性 + level」编排产物，断言安全。
function withSpecSeed(state: EnvState): EnvState {
    return { ...state, groundProceduralSeed: (state.groundProceduralSeed ?? 0) + 1000 } as EnvState;
}

// 重建产物（spec 模块）：走真实入口 createGroundMeshFromSpec，它会先 setGroundActualSize(meshSize)
// 再 applyGroundMaterialSpec，使 _groundActualSize 与 legacy applyGround 重建同源（否则纹理密度公式失真）
function rebuildSpec(state: EnvState): MatFingerprint {
    const s = withSpecSeed(state);
    disposeGround();
    disposeTextureCache();
    const mesh = createGroundMeshFromSpec(s, scene);
    return fingerprint(mesh.material as Material);
}

// 原地产物（spec 模块）：从 A 重建后原地切到 B（A、B 同结构性 spec）
function inplaceSpec(stateA: EnvState, stateB: EnvState): MatFingerprint {
    const sa = withSpecSeed(stateA);
    const sb = withSpecSeed(stateB);
    disposeGround();
    disposeTextureCache();
    const mesh = createGroundMeshFromSpec(sa, scene);
    const mat = mesh.material as GroundMat;
    applyGroundMaterialSpec(mat, sb, scene, false);
    return fingerprint(mat);
}

// legacy 重建产物：dispose 清空 mesh → 强制走重建路径
function rebuildLegacy(state: EnvState): MatFingerprint {
    disposeGround();
    disposeTextureCache(); // 清空程序化/外部纹理缓存，避免与上一 capture 共享缓存纹理导致不确定
    applyGround(state);
    const mesh = _envSys.ground.mesh;
    expect(mesh, 'legacy applyGround 应已构建网格').not.toBeNull();
    return fingerprint(mesh!.material as Material);
}

// legacy 原地产物：A 重建后原地切 B（同 key → 原地路径）
function inplaceLegacy(stateA: EnvState, stateB: EnvState): MatFingerprint {
    disposeGround();
    disposeTextureCache();
    applyGround(stateA);
    applyGround(stateB);
    const mesh = _envSys.ground.mesh;
    expect(mesh, 'legacy applyGround 应已构建网格').not.toBeNull();
    return fingerprint(mesh!.material as Material);
}

// ──────────────── Suite 1 — Spec 单一性 / 确定性 ────────────────
describe('ADR-226 buildGroundMaterialSpec — 单一性与确定性', () => {
    it('同输入两次调用 deep-equal（无隐式随机/副作用）', () => {
        const s = makeState({ groundStyle: 'checker', groundProceduralTexture: 'wood', groundPbrEnabled: true });
        expect(buildGroundMaterialSpec(s)).toEqual(buildGroundMaterialSpec(s));
    });
    it('specKey 对结构性字段敏感、对纯外观字段稳定', () => {
        const a = makeState({ groundStyle: 'checker' });
        const keyA = specKey(buildGroundMaterialSpec(a));
        // 外观变更（alpha/roughness）不改变 key
        const b = makeState({ groundStyle: 'checker', groundRoughness: 0.2, groundAlpha: 0.1 });
        expect(specKey(buildGroundMaterialSpec(b))).toBe(keyA);
        // 结构变更（style）改变 key
        const c = makeState({ groundStyle: 'solid' });
        expect(specKey(buildGroundMaterialSpec(c))).not.toBe(keyA);
    });
});

// ──────────────── Suite 2 — groundSpecNeedsRebuild（diffSpec 契约） ────────────────
describe('ADR-226 groundSpecNeedsRebuild — diffSpec 契约', () => {
    const base = makeState({ groundStyle: 'checker' });
    const baseSpec = buildGroundMaterialSpec(base);

    it('仅改外观字段（alpha/rough/metal/normal/edgeFade/scroll/scale）不触发重建', () => {
        const appearanceOnly: Partial<EnvState>[] = [
            { groundAlpha: 0.1 },
            { groundRoughness: 0.2 },
            { groundMetallic: 0.5 },
            { groundNormalStrength: 0.3 },
            { groundEdgeFade: 0.4 },
            { groundScrollSpeedX: 0.1 },
            { groundTextureScale: 0.5 },
        ];
        for (const ov of appearanceOnly) {
            const next = buildGroundMaterialSpec(makeState({ groundStyle: 'checker', ...ov }));
            expect(groundSpecNeedsRebuild(baseSpec, next), `外观变更 ${JSON.stringify(ov)} 不应触发重建`).toBe(false);
        }
    });

    it('改结构字段（geometry/pbr/source/reflection）触发重建', () => {
        const structural: Partial<EnvState>[] = [
            { groundInfiniteEnabled: true },
            { groundPbrEnabled: true },
            { groundProceduralTexture: 'wood', groundPbrEnabled: true },
            { groundStyle: 'solid' },
            { groundSize: 800 },
            { reflectionQuality: 'medium' },
            { groundType: 'terrain' },
        ];
        for (const ov of structural) {
            const next = buildGroundMaterialSpec(makeState({ groundStyle: 'checker', ...ov }));
            expect(groundSpecNeedsRebuild(baseSpec, next), `结构变更 ${JSON.stringify(ov)} 应触发重建`).toBe(true);
        }
    });
});

// ──────────────── Suite 3 — 核心契约：spec 重建产物 == spec 原地产物 ────────────────
// 代表矩阵：四类材质来源 × [flat, infinite]，每个 case 的 B 仅改外观字段（同结构性 spec）
describe('ADR-226 重建产物 == 原地产物（spec 内部）', () => {
    interface Case {
        name: string;
        a: Partial<EnvState>; // 基底（结构性）
        b: Partial<EnvState>; // 仅外观差异
    }
    const cases: Case[] = [
        { name: 'solid/flat', a: { groundStyle: 'solid' }, b: { groundAlpha: 0.2, groundRoughness: 0.3, groundEdgeFade: 0.4 } },
        { name: 'canvas/flat', a: { groundStyle: 'checker' }, b: { groundAlpha: 0.9, groundTextureScale: 0.5, groundNormalStrength: 0.4, groundEdgeFade: 0.3 } },
        { name: 'procedural/flat', a: { groundProceduralTexture: 'wood', groundPbrEnabled: true, groundStyle: 'texture' }, b: { groundAlpha: 0.3, groundRoughness: 0.2, groundMetallic: 0.7 } },
        { name: 'texture/flat', a: { groundTextureEnabled: true, groundTexture: TINY_PNG, groundStyle: 'texture' }, b: { groundAlpha: 0.5, groundTextureScale: 0.5, groundRoughness: 0.4 } },
        { name: 'solid/infinite', a: { groundStyle: 'solid', groundInfiniteEnabled: true }, b: { groundAlpha: 0.2, groundEdgeFade: 0.5 } },
        { name: 'canvas/infinite', a: { groundStyle: 'checker', groundInfiniteEnabled: true }, b: { groundTextureScale: 0.5, groundNormalStrength: 0.6 } },
        { name: 'procedural/infinite', a: { groundProceduralTexture: 'metal', groundPbrEnabled: true, groundInfiniteEnabled: true, groundStyle: 'texture' }, b: { groundRoughness: 0.1, groundMetallic: 0.9 } },
    ];

    for (const c of cases) {
        it(`[${c.name}] 重建(stateB) == 原地(A→B)`, () => {
            const stateA = makeState(c.a);
            const stateB = makeState({ ...c.a, ...c.b });
            // 结构性必须一致，否则不是有效原地迁移
            expect(groundSpecNeedsRebuild(buildGroundMaterialSpec(stateA), buildGroundMaterialSpec(stateB)),
                'A→B 必须是同结构性 spec（否则测试无效）').toBe(false);
            expect(rebuildSpec(stateB)).toEqual(inplaceSpec(stateA, stateB));
        });
    }
});

// ──────────────── Suite 4 — 迁移护栏：legacy 重建 == spec 重建 ────────────────
describe('ADR-226 迁移护栏 — legacy 重建 == spec 重建', () => {
    const cases: { name: string; ov: Partial<EnvState> }[] = [
        { name: 'solid/flat', ov: { groundStyle: 'solid' } },
        { name: 'canvas/flat', ov: { groundStyle: 'checker' } },
        { name: 'procedural/flat', ov: { groundProceduralTexture: 'wood', groundPbrEnabled: true, groundStyle: 'texture' } },
        { name: 'texture/flat', ov: { groundTextureEnabled: true, groundTexture: TINY_PNG, groundStyle: 'texture' } },
        { name: 'solid/infinite', ov: { groundStyle: 'solid', groundInfiniteEnabled: true } },
        { name: 'canvas/infinite', ov: { groundStyle: 'checker', groundInfiniteEnabled: true } },
        { name: 'procedural/infinite', ov: { groundProceduralTexture: 'metal', groundPbrEnabled: true, groundInfiniteEnabled: true, groundStyle: 'texture' } },
    ];

    for (const c of cases) {
        it(`[${c.name}] legacy applyGround 重建 == spec createGroundMeshFromSpec`, () => {
            const state = makeState({ ...c.ov, groundTextureScale: 1 }); // scale=1 时 legacy 与 spec 密度公式等价
            expect(rebuildLegacy(state)).toEqual(rebuildSpec(state));
        });
    }

    it('canvas + textureScale≠1：Phase 1 后 legacy 重建改调 spec，漏除 scale 的 bug 已消除（legacy==spec）', () => {
        const scale = 3;
        const legacy = rebuildLegacy(makeState({ groundStyle: 'checker', groundTextureScale: scale }));
        const spec = rebuildSpec(makeState({ groundStyle: 'checker', groundTextureScale: scale }));
        const meshSize = 500;
        // Phase 1 前：legacy 重建路径 uScale = meshSize/10（漏除 scale，bug）；spec 修正为 meshSize/10/scale。
        // Phase 1 后 legacy 重建路径改调 createGroundMeshFromSpec，该 bug 自然消失，legacy 与 spec 一致。
        expect(legacy.uScale).toBeCloseTo(meshSize / 10 / scale);
        expect(spec.uScale).toBeCloseTo(meshSize / 10 / scale);
        expect(legacy.uScale).toBeCloseTo(spec.uScale as number);
    });
});

// ──────────────── Suite 5 — 迁移护栏：legacy 原地 == spec 原地 ────────────────
describe('ADR-226 迁移护栏 — legacy 原地 == spec 原地', () => {
    const cases: { name: string; a: Partial<EnvState>; b: Partial<EnvState> }[] = [
        { name: 'solid/flat', a: { groundStyle: 'solid' }, b: { groundAlpha: 0.2, groundRoughness: 0.3 } },
        { name: 'canvas/flat', a: { groundStyle: 'checker' }, b: { groundAlpha: 0.9, groundNormalStrength: 0.4 } },
        { name: 'procedural/flat', a: { groundProceduralTexture: 'wood', groundPbrEnabled: true, groundStyle: 'texture' }, b: { groundAlpha: 0.3, groundRoughness: 0.2 } },
        { name: 'texture/flat', a: { groundTextureEnabled: true, groundTexture: TINY_PNG, groundStyle: 'texture' }, b: { groundAlpha: 0.5, groundRoughness: 0.4 } },
    ];

    for (const c of cases) {
        it(`[${c.name}] legacy 原地(A→B) == spec 原地(A→B)`, () => {
            const stateA = makeState({ ...c.a, groundTextureScale: 1 });
            const stateB = makeState({ ...c.a, ...c.b, groundTextureScale: 1 });
            expect(groundSpecNeedsRebuild(buildGroundMaterialSpec(stateA), buildGroundMaterialSpec(stateB)),
                'A→B 必须同结构性 spec').toBe(false);
            expect(inplaceLegacy(stateA, stateB)).toEqual(inplaceSpec(stateA, stateB));
        });
    }
});

// ──────────────── Suite 4/5 结束 ────────────────

