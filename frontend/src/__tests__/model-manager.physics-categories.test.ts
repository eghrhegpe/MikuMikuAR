// @ts-nocheck — Babylon.js mock 类型由 vi.mock 运行时替换（见 ./model-manager-mocks）
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    babylonSceneModule,
    babylonMeshModule,
    babylonMeshBuilderModule,
    babylonObservableModule,
    babylonMathVectorModule,
    babylonMathColorModule,
    babylonStandardMaterialModule,
    makeModelInstance,
    makeMmdModel,
    makeBone,
    setupModelWithBones,
    makeObservableScene,
} from './model-manager-mocks';
import { setFocusedModelId } from '../core/config';
import { ModelManager } from '../scene/manager/model-manager';

vi.mock('@babylonjs/core/scene', () => babylonSceneModule());
vi.mock('@babylonjs/core/Meshes/mesh', () => babylonMeshModule());
vi.mock('@babylonjs/core/Meshes/meshBuilder', () => babylonMeshBuilderModule());
vi.mock('@babylonjs/core/Misc/observable', () => babylonObservableModule());
vi.mock('@babylonjs/core/Maths/math.vector', () => babylonMathVectorModule());
vi.mock('@babylonjs/core/Maths/math.color', () => babylonMathColorModule());
vi.mock('@babylonjs/core/Materials/standardMaterial', () => babylonStandardMaterialModule());

describe('ModelManager physics', function () {
    let mgr, scene, onChange;

    beforeEach(function () {
        setFocusedModelId(null);
        onChange = vi.fn();
        scene = makeObservableScene();
        mgr = new ModelManager(scene, onChange, vi.fn());
    });

    it('setPhysicsCategory enables a category and restores initial state', function () {
        const states = new Uint8Array([0, 0, 0, 0, 0]);
        const bones = [makeBone('skirt', [1])];
        const mmd = makeMmdModel(bones, [], states);
        mgr.register(makeModelInstance('m1', { mmdModel: mmd }));
        mgr.storeRigidBodyState('m1', new Uint8Array([9, 1, 9, 9, 9]));

        mgr.setPhysicsCategory('m1', 'skirt', true);

        expect(states[1]).toBe(1);
    });

    it('setPhysicsCategory disables a category (sets state to 0)', function () {
        const states = new Uint8Array([1, 1, 1]);
        const bones = [makeBone('skirt', [1])];
        const mmd = makeMmdModel(bones, [], states);
        mgr.register(makeModelInstance('m1', { mmdModel: mmd }));
        mgr.storeRigidBodyState('m1', new Uint8Array([1, 1, 1]));

        mgr.setPhysicsCategory('m1', 'skirt', false);

        expect(states[1]).toBe(0);
    });

    it('setPhysicsCategory auto-enables physics when sub-category enabled while physics off', function () {
        const states = new Uint8Array([0, 0]);
        const bones = [makeBone('skirt', [0])];
        const mmd = makeMmdModel(bones, [], states);
        const inst = makeModelInstance('m1', { mmdModel: mmd, physicsEnabled: false });
        mgr.register(inst);
        mgr.storeRigidBodyState('m1', new Uint8Array([1, 1]));

        mgr.setPhysicsCategory('m1', 'skirt', true);

        expect(inst.physicsEnabled).toBe(true);
        expect(states[0]).toBe(1);
        expect(mgr.isPhysicsCategoryEnabled('m1', 'skirt')).toBe(true);
    });

    it('setPhysicsCategory is no-op for unknown id', function () {
        expect(function () {
            mgr.setPhysicsCategory('nope', 'skirt', true);
        }).not.toThrow();
    });

    it('setPhysicsCategory is no-op without mmdModel', function () {
        mgr.register(makeModelInstance('m1', { mmdModel: null }));
        expect(function () {
            mgr.setPhysicsCategory('m1', 'skirt', true);
        }).not.toThrow();
    });

    it('setPhysicsCategory records state in _physicsCatState', function () {
        const id = setupModelWithBones(mgr, [makeBone('skirt', [0])]);
        mgr.setPhysicsCategory(id, 'skirt', false);
        expect(mgr.isPhysicsCategoryEnabled(id, 'skirt')).toBe(false);
    });

    it('setPhysicsCategory is no-op when no rigidBodyStates', function () {
        const mmd = makeMmdModel([makeBone('skirt', [0])], []);
        mmd.rigidBodyStates = null;
        mgr.register(makeModelInstance('m1', { mmdModel: mmd }));
        expect(function () {
            mgr.setPhysicsCategory('m1', 'skirt', false);
        }).not.toThrow();
    });

    // [fix:physics-cat-persist] serialize→reload→restore 回合：分类开关跨重载还原
    it('physics category state survives serialize->reload roundtrip via stable id', function () {
        const stableId = 'uuid-1234-stable';

        // —— 会话 1：用户关掉裙子物理 ——
        const states1 = new Uint8Array([1, 1, 1]);
        const mmd1 = makeMmdModel([makeBone('skirt', [1]), makeBone('hair', [2])], [], states1);
        mgr.register(makeModelInstance(stableId, { mmdModel: mmd1 }));
        mgr.storeRigidBodyState(stableId, new Uint8Array([1, 1, 1]));
        mgr.setPhysicsCategory(stableId, 'skirt', false);

        // 序列化侧：getPhysicsCatState 差异化落盘（仅 false 项）
        const pcs = mgr.getPhysicsCatState(stableId);
        expect(pcs).toEqual({ skirt: false });
        const saved = {};
        for (const cat of Object.keys(pcs)) {
            if (!pcs[cat]) {
                saved[cat] = false;
            }
        }
        expect(saved).toEqual({ skirt: false });

        // —— 会话 2：全新 manager（重载），模型以同一稳定 id 注册（ADR-193）——
        const mgr2 = new ModelManager(makeObservableScene(), vi.fn(), vi.fn());
        const states2 = new Uint8Array([1, 1, 1]);
        const mmd2 = makeMmdModel([makeBone('skirt', [1]), makeBone('hair', [2])], [], states2);
        mgr2.register(makeModelInstance(stableId, { mmdModel: mmd2 }));
        mgr2.storeRigidBodyState(stableId, new Uint8Array([1, 1, 1]));

        // 恢复侧：deserializeModels 回放 physicsCategories
        for (const cat of Object.keys(saved)) {
            mgr2.setPhysicsCategory(stableId, cat, saved[cat]);
        }

        expect(mgr2.isPhysicsCategoryEnabled(stableId, 'skirt')).toBe(false);
        expect(mgr2.isPhysicsCategoryEnabled(stableId, 'hair')).toBe(true);
        expect(states2[1]).toBe(0); // 裙子刚体已停用
        expect(states2[2]).toBe(1); // 头发刚体保持
    });

    // Bone classification tests via getPhysicsCategories
    it('classifyBonePhysics matches skirt patterns', function () {
        const id = setupModelWithBones(mgr, [
            makeBone('skirt', [0]),
            makeBone('\u30b9\u30ab\u30fc\u30c8', [1]),
            makeBone('frill', [2]),
            makeBone('hem', [3]),
        ]);
        expect(mgr.getPhysicsCategories(id)).toContain('skirt');
    });

    it('classifyBonePhysics matches chest patterns', function () {
        const id = setupModelWithBones(mgr, [
            makeBone('\u80f8', [0]),
            makeBone('chest', [1]),
            makeBone('bust', [2]),
        ]);
        expect(mgr.getPhysicsCategories(id)).toContain('chest');
    });

    it('classifyBonePhysics matches hair patterns', function () {
        const id = setupModelWithBones(mgr, [
            makeBone('\u9aea', [0]),
            makeBone('hair', [1]),
            makeBone('ahoge', [2]),
            makeBone('bangs', [3]),
            makeBone('ponytail', [4]),
        ]);
        expect(mgr.getPhysicsCategories(id)).toContain('hair');
    });

    it('classifyBonePhysics matches accessory patterns', function () {
        const id = setupModelWithBones(mgr, [
            makeBone('ribbon', [0]),
            makeBone('collar', [1]),
            makeBone('tie', [2]),
            makeBone('accessory', [3]),
        ]);
        expect(mgr.getPhysicsCategories(id)).toContain('accessory');
    });
});
