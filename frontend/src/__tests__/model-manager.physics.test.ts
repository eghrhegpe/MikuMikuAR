// @vitest-environment node
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

    it('setPhysics enables by restoring stored rigid body states', function () {
        const states = new Uint8Array([1, 0, 1, 0, 1]);
        const mmd = makeMmdModel([], [], states);
        const inst = makeModelInstance('m1', { mmdModel: mmd, physicsEnabled: false });
        mgr.register(inst);
        mgr.storeRigidBodyState('m1', new Uint8Array([1, 1, 1, 1, 1]));

        mgr.setPhysics('m1', true);

        expect(inst.physicsEnabled).toBe(true);
        expect(Array.from(states)).toEqual([1, 1, 1, 1, 1]);
        expect(onChange).toHaveBeenCalled();
    });

    it('setPhysics disables by filling states with 0', function () {
        const states = new Uint8Array([1, 1, 1]);
        const mmd = makeMmdModel([], [], states);
        const inst = makeModelInstance('m1', { mmdModel: mmd, physicsEnabled: true });
        mgr.register(inst);

        mgr.setPhysics('m1', false);

        expect(inst.physicsEnabled).toBe(false);
        expect(Array.from(states)).toEqual([0, 0, 0]);
    });

    it('setPhysics toggles flag even without mmdModel', function () {
        const inst = makeModelInstance('m1', { mmdModel: null, physicsEnabled: true });
        mgr.register(inst);

        mgr.setPhysics('m1', false);
        expect(inst.physicsEnabled).toBe(false);

        mgr.setPhysics('m1', true);
        expect(inst.physicsEnabled).toBe(true);
    });

    it('setPhysics fills with 1 when stored state length mismatches', function () {
        const states = new Uint8Array([0, 0, 0]);
        const mmd = makeMmdModel([], [], states);
        mgr.register(makeModelInstance('m1', { mmdModel: mmd, physicsEnabled: false }));
        mgr.storeRigidBodyState('m1', new Uint8Array([1]));

        mgr.setPhysics('m1', true);

        expect(Array.from(states)).toEqual([1, 1, 1]);
    });

    it('setPhysics preserves physics category state (does not clear on toggle)', function () {
        const states = new Uint8Array([1, 1]);
        const mmd = makeMmdModel([], [], states);
        mgr.register(makeModelInstance('m1', { mmdModel: mmd }));
        mgr._physicsCatState.set('m1', new Map([['skirt', false]]));

        mgr.setPhysics('m1', false);
        // setPhysics 只控制总开关，不应清除分类状态（防止 setPhysicsCategory 联动时丢失其他类别）
        expect(mgr._physicsCatState.has('m1')).toBe(true);
        expect(mgr._physicsCatState.get('m1')?.get('skirt')).toBe(false);
    });

    it('setPhysics with null rigidBodyStates does not crash', function () {
        const mmd = makeMmdModel([], []);
        mmd.rigidBodyStates = null;
        mgr.register(makeModelInstance('m1', { mmdModel: mmd }));
        expect(function () {
            mgr.setPhysics('m1', false);
        }).not.toThrow();
    });

    it('setPhysics is no-op for unknown id', function () {
        expect(function () {
            mgr.setPhysics('nope', true);
        }).not.toThrow();
    });

    it('getPhysicsCategories returns categories from bone classification', function () {
        const bones = [
            makeBone('\u30b9\u30ab\u30fc\u30c8', [0, 1]),
            makeBone('\u80f8', [2, 3]),
            makeBone('\u9aea', [4]),
        ];
        const id = setupModelWithBones(mgr, bones);

        const cats = mgr.getPhysicsCategories(id);
        expect(cats).toContain('skirt');
        expect(cats).toContain('chest');
        expect(cats).toContain('hair');
        expect(cats).not.toContain('accessory');
    });

    it('getPhysicsCategories returns [] when no mmdModel', function () {
        mgr.register(makeModelInstance('m1', { mmdModel: null }));
        expect(mgr.getPhysicsCategories('m1')).toEqual([]);
    });

    it('getPhysicsCategories returns [] when no bones match', function () {
        const id = setupModelWithBones(mgr, [makeBone('leg', [0]), makeBone('arm', [1])]);
        expect(mgr.getPhysicsCategories(id)).toEqual([]);
    });

    it('getPhysicsCatState returns null initially', function () {
        const id = setupModelWithBones(mgr, [makeBone('skirt', [0])]);
        expect(mgr.getPhysicsCatState(id)).toBeNull();
    });

    it('getPhysicsCatState returns recorded category state', function () {
        const id = setupModelWithBones(mgr, [makeBone('skirt', [0])]);
        mgr._physicsCatState.set(id, new Map([['skirt', false]]));

        const state = mgr.getPhysicsCatState(id);
        expect(state).toEqual({ skirt: false });
    });

    it('isPhysicsCategoryEnabled returns true by default', function () {
        const id = setupModelWithBones(mgr, [makeBone('skirt', [0])]);
        expect(mgr.isPhysicsCategoryEnabled(id, 'skirt')).toBe(true);
    });

    it('isPhysicsCategoryEnabled returns stored state', function () {
        const id = setupModelWithBones(mgr, [makeBone('skirt', [0])]);
        mgr._physicsCatState.set(id, new Map([['skirt', false]]));
        expect(mgr.isPhysicsCategoryEnabled(id, 'skirt')).toBe(false);
    });
});
