// env-ground.test.ts — 地面子系统单元测试
// 纯函数测试 + 模块级状态管理验证

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';

// 隔离 env-impl，避免其重型依赖（clouds/particles/sky 等）干扰；
// _envSys 通过 globalThis 共享同对象，与 env-context mock 一致。
vi.mock('../../scene/env/env-impl', () => {
    if (!(globalThis as any).__groundTestEnvSys) {
        (globalThis as any).__groundTestEnvSys = {
            ground: { mesh: null as any },
        };
    }
    return {
        _envSys: (globalThis as any).__groundTestEnvSys,
        getScene: () => (globalThis as any).__groundTestScene as Scene,
        ensureEnvUpdateObserver: () => {},
    };
});
// env-ground.ts 从 env-context 获取 getScene，故需额外 mock
vi.mock('../../scene/env/env-context', () => {
    if (!(globalThis as any).__groundTestEnvSys) {
        (globalThis as any).__groundTestEnvSys = {
            ground: { mesh: null as any },
        };
    }
    return {
        _envSys: (globalThis as any).__groundTestEnvSys,
        getScene: () => (globalThis as any).__groundTestScene as Scene,
        initEnvImpl: () => {},
        isInitialized: () => true,
        getPipeline: () => null,
    };
});
// ADR-151: env-ground 从 env-reflection 导入 getPlanarQualityOverride，后者会拉入
// renderer→performance→scene 重链（模块级 new Scene()）。单测只关注纯函数，
// 此处桩掉避免测试环境收集期崩溃。
vi.mock('../../scene/env/env-reflection', () => ({
    getPlanarQualityOverride: () => null,
}));

import { _envSys } from '../../scene/env/env-impl';
import {
    clearGroundTexCache,
    setOnTerrainReady,
    setOnGroundChanged,
    GROUND_PRESETS,
    buildGroundPresetEnvState,
    disposeGround,
} from '../../scene/env/env-ground';

let engine: NullEngine;
let scene: Scene;

beforeEach(() => {
    engine = new NullEngine();
    scene = new Scene(engine);
    (globalThis as any).__groundTestScene = scene;
    _envSys.ground.mesh = null;
});

afterEach(() => {
    _envSys.ground.mesh = null;
    (globalThis as any).__groundTestScene = null;
    scene.dispose();
    engine.dispose();
});

// ──────────────── Ground Presets — 所有字段非 undefined ────────────────
describe('Ground Presets — 字段完整性', () => {
    it('buildGroundPresetEnvState 对所有预设不产生 undefined 字段', () => {
        for (const [name, preset] of Object.entries(GROUND_PRESETS)) {
            const mapped = buildGroundPresetEnvState(preset);
            for (const [k, v] of Object.entries(mapped)) {
                expect(v, `preset "${name}": field "${k}" is undefined`).not.toBeUndefined();
            }
        }
    });

    it('每个预设含 label 且非空', () => {
        for (const [name, preset] of Object.entries(GROUND_PRESETS)) {
            expect(preset.label, `preset "${name}" missing label`).toBeTruthy();
        }
    });

    it('buildGroundPresetEnvState 返回包含基础参数', () => {
        const preset = GROUND_PRESETS[Object.keys(GROUND_PRESETS)[0]];
        const state = buildGroundPresetEnvState(preset);
        expect(state).toHaveProperty('groundStyle');
        expect(state).toHaveProperty('groundColor');
        expect(state).toHaveProperty('groundAlpha');
        expect(state).toHaveProperty('reflectionQuality');
    });
});

// ──────────────── clearGroundTexCache 幂等 ────────────────
describe('clearGroundTexCache — 幂等', () => {
    it('可重复调用不抛错', () => {
        expect(() => clearGroundTexCache()).not.toThrow();
        expect(() => clearGroundTexCache()).not.toThrow();
        expect(() => clearGroundTexCache()).not.toThrow();
    });
});

// ──────────────── 回调注册/清除 ────────────────
describe('setOnTerrainReady / setOnGroundChanged — 回调管理', () => {
    it('注册 null 回调不抛错', () => {
        expect(() => setOnTerrainReady(null)).not.toThrow();
        expect(() => setOnGroundChanged(null)).not.toThrow();
    });

    it('注册/清除可重复', () => {
        const cb = vi.fn();
        setOnTerrainReady(cb);
        setOnGroundChanged(cb);
        setOnTerrainReady(null);
        setOnGroundChanged(null);
        expect(() => setOnTerrainReady(null)).not.toThrow();
        expect(() => setOnGroundChanged(null)).not.toThrow();
    });
});

// ──────────────── disposeGround 幂等 ────────────────
describe('disposeGround — 幂等与资源释放', () => {
    it('未初始化时调用不抛错（幂等）', () => {
        expect(() => disposeGround()).not.toThrow();
        expect(() => disposeGround()).not.toThrow();
    });

    it('携带真实网格时释放并置空引用', () => {
        const mat = new StandardMaterial('envGroundMat', scene);
        const mesh = MeshBuilder.CreateGround('envGround', { width: 10, height: 10 }, scene);
        mesh.material = mat;
        _envSys.ground.mesh = mesh;

        disposeGround();

        // 网格引用被置空
        expect(_envSys.ground.mesh).toBeNull();
    });

    it('重复调用 disposeGround 后网格引用仍为 null', () => {
        const mat = new StandardMaterial('envGroundMat', scene);
        const mesh = MeshBuilder.CreateGround('envGround', { width: 10, height: 10 }, scene);
        mesh.material = mat;
        _envSys.ground.mesh = mesh;

        disposeGround();
        disposeGround();

        expect(_envSys.ground.mesh).toBeNull();
    });

    it('网格无 material 时 dispose 不抛错', () => {
        const mesh = MeshBuilder.CreateGround('envGround', { width: 10, height: 10 }, scene);
        // 不设置 material
        _envSys.ground.mesh = mesh;

        expect(() => disposeGround()).not.toThrow();
        expect(_envSys.ground.mesh).toBeNull();
    });
});
