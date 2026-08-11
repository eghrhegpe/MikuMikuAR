// model-manager 系列合并（constructor/bone-overlay/focus/physics/physics-categories/transform/vmd-morph 7 文件 → 1）
// [2026-08] 同系列合并以省 isolate 单文件 import 成本（vitest.config 同款先例）。
// 7 文件结构完全同构：全 node 环境 + @ts-nocheck + 7 条 Babylon vi.mock +
// 1 条 transform 特有 material mock（babylon-factories）+ 共享 model-manager-mocks
// 工厂，共享样板原在 7 文件重复 7 份，现收敛为一份。
// 各 describe 按原主题分区保留，行为不变（physics-categories 的 describe 因与
// physics 同名，按语义改名 "ModelManager physics categories"）。
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
    createTestMesh,
    createTestMaterial,
    setupModelWithBones,
    instSet,
    makeObservableScene,
} from './model-manager-mocks';
import { mockMaterial } from './mocks/babylon-factories';
import { setFocusedModelId, setModelRegistry } from '../core/config';
import { ModelManager } from '../scene/manager/model-manager';

vi.mock('@babylonjs/core/scene', () => babylonSceneModule());
vi.mock('@babylonjs/core/Meshes/mesh', () => babylonMeshModule());
vi.mock('@babylonjs/core/Meshes/meshBuilder', () => babylonMeshBuilderModule());
vi.mock('@babylonjs/core/Misc/observable', () => babylonObservableModule());
vi.mock('@babylonjs/core/Maths/math.vector', () => babylonMathVectorModule());
vi.mock('@babylonjs/core/Maths/math.color', () => babylonMathColorModule());
vi.mock('@babylonjs/core/Materials/standardMaterial', () => babylonStandardMaterialModule());
vi.mock('@babylonjs/core/Materials/material', () => mockMaterial());

// ======== constructor + basic state（原 model-manager.constructor.test.ts） ========
describe('ModelManager constructor + basic state', function () {
    let mgr, scene, onChange, autoFrame;

    beforeEach(function () {
        setFocusedModelId(null);
        onChange = vi.fn();
        autoFrame = vi.fn();
        scene = makeObservableScene();
        mgr = new ModelManager(scene, onChange, autoFrame);
    });

    it('creates with empty registry and null focus', function () {
        expect(mgr.size).toBe(0);
        expect(mgr.focusedModelId).toBeNull();
        expect(mgr.focused()).toBeUndefined();
        expect(mgr.focusedMmdModel()).toBeNull();
    });

    it('focused() returns undefined when no model is focused', function () {
        expect(mgr.focused()).toBeUndefined();
    });

    it('focusedMmdModel() returns null when no model is focused', function () {
        expect(mgr.focusedMmdModel()).toBeNull();
    });

});

describe('ModelManager registry CRUD', function () {
    let mgr, scene, onChange;

    beforeEach(function () {
        setFocusedModelId(null);
        onChange = vi.fn();
        scene = makeObservableScene();
        mgr = new ModelManager(scene, onChange, vi.fn());
    });

    it('register adds model and size/get/getAll work', function () {
        const a = makeModelInstance('a');
        const b = makeModelInstance('b');
        mgr.register(a);
        mgr.register(b);

        expect(mgr.size).toBe(2);
        expect(mgr.get('a')).toBe(a);
        expect(mgr.get('b')).toBe(b);
        expect(mgr.get('nope')).toBeUndefined();
        expect(mgr.getAll()).toEqual([a, b]);
    });

    it('register is idempotent - same id overwrites', function () {
        const a1 = makeModelInstance('a', { name: 'first' });
        const a2 = makeModelInstance('a', { name: 'second' });
        mgr.register(a1);
        mgr.register(a2);

        expect(mgr.size).toBe(1);
        expect(mgr.get('a').name).toBe('second');
    });

    it('findByFilePath returns first exact match', function () {
        mgr.register(makeModelInstance('a', { filePath: 'X:/foo/char.pmx' }));
        mgr.register(makeModelInstance('b', { filePath: 'X:/bar/char.pmx' }));

        expect(mgr.findByFilePath('X:/foo/char.pmx').id).toBe('a');
        expect(mgr.findByFilePath('X:/bar/char.pmx').id).toBe('b');
        expect(mgr.findByFilePath('not/exist.pmx')).toBeUndefined();
    });
});

describe('ModelManager storeRigidBodyState', function () {
    let mgr, scene;

    beforeEach(function () {
        setFocusedModelId(null);
        scene = makeObservableScene();
        mgr = new ModelManager(scene, vi.fn(), vi.fn());
    });

    it('stores a copy of the rigid body state', function () {
        const original = new Uint8Array([1, 0, 1, 1]);
        mgr.storeRigidBodyState('m1', original);

        const stored = mgr._initialRigidBodyStates.get('m1');
        expect(stored).toBeInstanceOf(Uint8Array);
        expect(Array.from(stored)).toEqual([1, 0, 1, 1]);

        // Verify it is a copy, not the same reference
        original[0] = 99;
        expect(stored[0]).toBe(1);
    });
});

// ======== bone overlay + dispose（原 model-manager.bone-overlay.test.ts） ========
describe('ModelManager bone overlay', function () {
    let mgr, scene, onChange, bones, mmd;

    beforeEach(function () {
        setFocusedModelId(null);
        onChange = vi.fn();
        scene = makeObservableScene();
        mgr = new ModelManager(scene, onChange, vi.fn());

        // Bone hierarchy: center -> waist -> upper
        bones = [makeBone('center', []), makeBone('waist', []), makeBone('upper', [])];
        bones[1].parentBone = bones[0];
        bones[2].parentBone = bones[1];

        mmd = makeMmdModel(bones, []);
        const inst = makeModelInstance('m1', {
            mmdModel: mmd,
            showBoneLines: false,
            showBoneJoints: false,
        });
        mgr.register(inst);
    });

    it('setBoneLinesVis creates overlay when show=true and no overlay exists', function () {
        mgr.setBoneLinesVis('m1', true);

        expect(mgr._boneOverlayMap.has('m1')).toBe(true);
        const entry = mgr._boneOverlayMap.get('m1');
        expect(entry.lineSystem).toBeDefined();
        expect(entry.joints.length).toBeGreaterThan(0);
        expect(entry.update).toBeInstanceOf(Function);
        expect(mgr.get('m1').showBoneLines).toBe(true);
        expect(onChange).toHaveBeenCalled();
    });

    it('setBoneLinesVis destroys overlay when show=false and overlay exists', function () {
        mgr.setBoneLinesVis('m1', true);
        expect(mgr._boneOverlayMap.has('m1')).toBe(true);

        mgr.setBoneLinesVis('m1', false);

        expect(mgr._boneOverlayMap.has('m1')).toBe(false);
        expect(mgr.get('m1').showBoneLines).toBe(false);
    });

    it('setBoneLinesVis with joints also true keeps overlay', function () {
        mgr.setBoneLinesVis('m1', true);
        mgr.setBoneJointsVis('m1', true);

        mgr.setBoneLinesVis('m1', false);

        expect(mgr._boneOverlayMap.has('m1')).toBe(true);
        const entry = mgr._boneOverlayMap.get('m1');
        expect(entry.lineSystem.setEnabled).toHaveBeenCalledWith(false);
    });

    it('setBoneJointsVis creates overlay when show=true and no overlay exists', function () {
        mgr.setBoneJointsVis('m1', true);

        expect(mgr._boneOverlayMap.has('m1')).toBe(true);
        expect(mgr.get('m1').showBoneJoints).toBe(true);
        expect(onChange).toHaveBeenCalled();
    });

    it('setBoneJointsVis with lines also true keeps overlay', function () {
        mgr.setBoneJointsVis('m1', true);
        mgr.setBoneLinesVis('m1', true);

        mgr.setBoneJointsVis('m1', false);

        expect(mgr._boneOverlayMap.has('m1')).toBe(true);
    });

    it('setBoneJointsVis destroys overlay when show=false and no lines active', function () {
        mgr.setBoneJointsVis('m1', true);
        expect(mgr._boneOverlayMap.has('m1')).toBe(true);

        mgr.setBoneJointsVis('m1', false);
        expect(mgr._boneOverlayMap.has('m1')).toBe(false);
    });

    it('setBoneLinesVis is no-op for unknown id', function () {
        expect(function () {
            mgr.setBoneLinesVis('nope', true);
        }).not.toThrow();
    });

    it('setBoneJointsVis is no-op for unknown id', function () {
        expect(function () {
            mgr.setBoneJointsVis('nope', true);
        }).not.toThrow();
    });

    it('createBoneOverlay is no-op when no mmdModel', function () {
        mgr.register(makeModelInstance('no-mmd', { mmdModel: null }));
        mgr.setBoneLinesVis('no-mmd', true);
        expect(mgr._boneOverlayMap.has('no-mmd')).toBe(false);
    });

    it('createBoneOverlay is no-op when bones array is empty', function () {
        mgr.register(makeModelInstance('empty', { mmdModel: makeMmdModel([], []) }));
        mgr.setBoneLinesVis('empty', true);
        expect(mgr._boneOverlayMap.has('empty')).toBe(false);
    });

    it('ensureBoneUpdateObserver creates scene observer', function () {
        mgr.setBoneLinesVis('m1', true);

        expect(mgr._boneUpdateObserver).not.toBeNull();
        expect(scene._callbacks.length).toBeGreaterThanOrEqual(1);
    });

    it('bone overlay is created only once (double toggle)', function () {
        mgr.setBoneLinesVis('m1', true);
        const firstEntry = mgr._boneOverlayMap.get('m1');

        mgr.setBoneLinesVis('m1', true);

        expect(mgr._boneOverlayMap.get('m1')).toBe(firstEntry);
    });
});

describe('ModelManager dispose', function () {
    let mgr, scene, onChange;

    beforeEach(function () {
        setFocusedModelId(null);
        onChange = vi.fn();
        scene = makeObservableScene();
        mgr = new ModelManager(scene, onChange, vi.fn());
    });

    it('removes bone update observer', function () {
        const bones = [makeBone('center', []), makeBone('waist', [])];
        bones[1].parentBone = bones[0];
        const mmdModel = makeMmdModel(bones, []);
        mgr.register(makeModelInstance('m1', { mmdModel: mmdModel }));
        mgr.setBoneLinesVis('m1', true);
        expect(mgr._boneUpdateObserver).not.toBeNull();

        mgr.dispose();

        expect(mgr._boneUpdateObserver).toBeNull();
    });

    it('does not crash when called without any setup', function () {
        expect(function () {
            mgr.dispose();
        }).not.toThrow();
    });
});

// ======== focus + arrange + remove（原 model-manager.focus.test.ts） ========
describe('ModelManager focus + arrange', function () {
    let mgr, scene, onChange, autoFrame;

    beforeEach(function () {
        setFocusedModelId(null);
        onChange = vi.fn();
        autoFrame = vi.fn();
        scene = makeObservableScene();
        mgr = new ModelManager(scene, onChange, autoFrame);
    });

    it('focus sets focusedModelId and calls onChange + autoFrame with bounds', function () {
        const mesh = createTestMesh('root');
        const inst = makeModelInstance('m1', { meshes: [mesh] });
        mgr.register(inst);

        mgr.focus('m1');

        expect(mgr.focusedModelId).toBe('m1');
        expect(onChange).toHaveBeenCalled();
        expect(autoFrame).toHaveBeenCalledTimes(1);
        const center = autoFrame.mock.calls[0][0];
        const extent = autoFrame.mock.calls[0][1];
        expect(center.x).toBeCloseTo(0);
        expect(center.y).toBeCloseTo(0.75);
        expect(center.z).toBeCloseTo(0);
        expect(extent).toBeCloseTo(1.5);
    });

    it('focus with unknown id clears focus', function () {
        setFocusedModelId('existing');
        mgr.focus('unknown');
        expect(mgr.focusedModelId).toBeNull();
    });

    it('focused() returns the focused model instance', function () {
        const inst = makeModelInstance('m1');
        mgr.register(inst);
        mgr.focus('m1');
        expect(mgr.focused()).toBe(inst);
    });

    it('focusedMmdModel() returns the mmdModel of the focused instance', function () {
        const mmd = makeMmdModel([], []);
        const inst = makeModelInstance('m1', { mmdModel: mmd });
        mgr.register(inst);
        mgr.focus('m1');
        expect(mgr.focusedMmdModel()).toBe(mmd);
    });

    it('focusedMmdModel() returns null when focused model has no mmdModel', function () {
        const inst = makeModelInstance('m1', { mmdModel: null });
        mgr.register(inst);
        mgr.focus('m1');
        expect(mgr.focusedMmdModel()).toBeNull();
    });

    it('arrange positions models in a horizontal row', function () {
        const meshA = createTestMesh('a');
        const meshB = createTestMesh('b');
        const meshC = createTestMesh('c');
        mgr.register(makeModelInstance('a', { meshes: [meshA] }));
        mgr.register(makeModelInstance('b', { meshes: [meshB] }));
        mgr.register(makeModelInstance('c', { meshes: [meshC] }));

        mgr.arrange();

        expect(meshA.position.x).toBeCloseTo(-3, 1);
        expect(meshB.position.x).toBeCloseTo(0, 1);
        expect(meshC.position.x).toBeCloseTo(3, 1);
        expect(onChange).toHaveBeenCalled();
    });

    it('arrange does nothing with no models', function () {
        expect(function () {
            mgr.arrange();
        }).not.toThrow();
    });

    it('arrange with single model places at center', function () {
        const mesh = createTestMesh('only');
        mgr.register(makeModelInstance('only', { meshes: [mesh] }));
        mgr.arrange();
        expect(mesh.position.x).toBeCloseTo(0);
    });
});

describe('ModelManager remove', function () {
    let mgr, scene, onChange, autoFrame, onRemoveModel;

    beforeEach(function () {
        setFocusedModelId(null);
        onChange = vi.fn();
        autoFrame = vi.fn();
        scene = makeObservableScene();
        mgr = new ModelManager(scene, onChange, autoFrame);
        onRemoveModel = vi.fn();
        mgr.onRemoveModel = onRemoveModel;
    });

    it('removes model, disposes meshes, cleans up internal maps', function () {
        const mesh = createTestMesh('root');
        const inst = makeModelInstance('m1', { meshes: [mesh] });
        mgr.register(inst);
        mgr.register(makeModelInstance('m2'));

        mgr._physicsCatState.set('m1', new Map([['skirt', true]]));
        mgr._initialRigidBodyStates.set('m1', new Uint8Array([1]));

        mgr.remove('m1');

        expect(mgr.get('m1')).toBeUndefined();
        expect(mgr.size).toBe(1);
        expect(mesh.dispose).toHaveBeenCalled();
        expect(onRemoveModel).toHaveBeenCalledWith('m1');
        expect(mgr._physicsCatState.has('m1')).toBe(false);
        expect(mgr._initialRigidBodyStates.has('m1')).toBe(false);
    });

    it('transfers focus to the next model when removing focused', function () {
        mgr.register(makeModelInstance('a'));
        mgr.register(makeModelInstance('b'));
        mgr.focus('b');

        mgr.remove('b');

        expect(mgr.focusedModelId).toBe('a');
    });

    it('clears focus when removing the last model', function () {
        mgr.register(makeModelInstance('a'));
        mgr.focus('a');

        mgr.remove('a');

        expect(mgr.focusedModelId).toBeNull();
    });

    it('is no-op for unknown id', function () {
        mgr.register(makeModelInstance('a'));
        expect(function () {
            mgr.remove('nope');
        }).not.toThrow();
        expect(mgr.size).toBe(1);
        expect(onRemoveModel).not.toHaveBeenCalled();
    });

    it('removeFocused removes the currently focused model', function () {
        mgr.register(makeModelInstance('a'));
        mgr.register(makeModelInstance('b'));
        mgr.focus('a');

        mgr.removeFocused();

        expect(mgr.get('a')).toBeUndefined();
        expect(mgr.size).toBe(1);
    });

    it('removeFocused is no-op when no model is focused', function () {
        mgr.register(makeModelInstance('a'));
        expect(function () {
            mgr.removeFocused();
        }).not.toThrow();
        expect(mgr.size).toBe(1);
    });
});

// ======== physics（原 model-manager.physics.test.ts） ========
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

// ======== physics categories（原 model-manager.physics-categories.test.ts） ========
describe('ModelManager physics categories', function () {
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

// ======== visibility / opacity / wireframe + transform（原 model-manager.transform.test.ts） ========
describe('ModelManager visibility / opacity / wireframe', function () {
    let mgr, scene, onChange, mesh, mat;

    beforeEach(function () {
        setFocusedModelId(null);
        onChange = vi.fn();
        scene = makeObservableScene();
        mgr = new ModelManager(scene, onChange, vi.fn());
        setModelRegistry(mgr.modelRegistry);

        mat = createTestMaterial('test_mat');
        mesh = createTestMesh('root', mat);
        const inst = makeModelInstance('m1', { meshes: [mesh] });
        mgr.register(inst);
    });

    afterEach(function () {
        // 还原全局 modelRegistry，避免污染后续 describe（transform/VMD-morph 依赖干净全局态）
        setModelRegistry(new Map());
    });

    it('setVisibility updates inst.visible and calls mesh.setEnabled', function () {
        mgr.setVisibility('m1', false);
        expect(mgr.get('m1').visible).toBe(false);
        expect(mesh.setEnabled).toHaveBeenCalledWith(false);
        expect(onChange).toHaveBeenCalled();
    });

    it('setVisibility true restores visibility and sets material wireframe', function () {
        instSet(mgr, 'm1', { wireframe: true });
        mgr.setVisibility('m1', true);
        expect(mgr.get('m1').visible).toBe(true);
        expect(mesh.setEnabled).toHaveBeenCalledWith(true);
        expect(mat.wireframe).toBe(true);
    });

    it('setVisibility with wireframe: StandardMaterial.instanceof works', function () {
        mgr.setWireframe('m1', true);
        mgr.setVisibility('m1', false);
        mgr.setVisibility('m1', true);
        expect(mat.wireframe).toBe(true);
    });

    it('setOpacity clamps to [0,1] and updates mesh material alpha', function () {
        mgr.setOpacity('m1', 0.5);
        expect(mgr.get('m1').opacity).toBe(0.5);
        expect(mat.alpha).toBe(0.5);

        mgr.setOpacity('m1', 2);
        expect(mgr.get('m1').opacity).toBe(1);

        mgr.setOpacity('m1', -1);
        expect(mgr.get('m1').opacity).toBe(0);
        expect(onChange).toHaveBeenCalled();
    });

    it('setWireframe updates inst.wireframe and material.wireframe', function () {
        mgr.setWireframe('m1', true);
        expect(mgr.get('m1').wireframe).toBe(true);
        expect(mat.wireframe).toBe(true);
        expect(onChange).toHaveBeenCalled();

        mgr.setWireframe('m1', false);
        expect(mgr.get('m1').wireframe).toBe(false);
        expect(mat.wireframe).toBe(false);
    });

    it('setVisibility / setOpacity / setWireframe are no-op for unknown id', function () {
        expect(function () {
            mgr.setVisibility('nope', false);
        }).not.toThrow();
        expect(function () {
            mgr.setOpacity('nope', 0.5);
        }).not.toThrow();
        expect(function () {
            mgr.setWireframe('nope', true);
        }).not.toThrow();
    });

    it('setOpacity multiplies with _origAlpha base', function () {
        instSet(mgr, 'm1', { _origAlpha: [0.8] });
        mgr.setOpacity('m1', 0.5);
        expect(mat.alpha).toBeCloseTo(0.4);
    });

    it('setOpacity < 1 switches transparencyMode to ALPHABLEND', function () {
        mat.transparencyMode = 0;
        mgr.setOpacity('m1', 0.5);
        expect(mat.transparencyMode).toBe(2);
    });

    it('setOpacity back to 1 restores transparencyMode to OPAQUE', function () {
        mgr.setOpacity('m1', 0.5);
        expect(mat.transparencyMode).toBe(2);
        mgr.setOpacity('m1', 1);
        expect(mat.transparencyMode).toBe(0);
    });

    it('setOpacity with _origAlpha base and opacity=1 keeps original alpha', function () {
        instSet(mgr, 'm1', { _origAlpha: [0.8] });
        mgr.setOpacity('m1', 1);
        expect(mat.alpha).toBeCloseTo(0.8);
    });
});

describe('ModelManager transform', function () {
    let mgr, scene, onChange, mesh;

    beforeEach(function () {
        setFocusedModelId(null);
        onChange = vi.fn();
        scene = makeObservableScene();
        mgr = new ModelManager(scene, onChange, vi.fn());

        mesh = createTestMesh('root');
        const inst = makeModelInstance('m1', { meshes: [mesh] });
        mgr.register(inst);
    });

    it('setScaling updates inst.scaling (clamped >= 0.01) and mesh scaling', function () {
        mgr.setScaling('m1', 2);
        expect(mgr.get('m1').scaling).toBe(2);
        expect(mesh.scaling.x).toBe(2);
        expect(mesh.scaling.y).toBe(2);
        expect(mesh.scaling.z).toBe(2);
        expect(onChange).toHaveBeenCalled();
    });

    it('setScaling clamps to 0.01 minimum', function () {
        mgr.setScaling('m1', 0);
        expect(mgr.get('m1').scaling).toBe(0.01);

        mgr.setScaling('m1', -5);
        expect(mgr.get('m1').scaling).toBe(0.01);
    });

    it('setRotationY updates inst.rotationY and mesh rotation.y', function () {
        mgr.setRotationY('m1', 1.57);
        expect(mgr.get('m1').rotationY).toBe(1.57);
        expect(mesh.rotation.y).toBe(1.57);
        expect(onChange).toHaveBeenCalled();
    });

    it('setPosition updates root mesh position and calls onChange', function () {
        mgr.setPosition('m1', 10, 20, 30);
        expect(mesh.position.x).toBe(10);
        expect(mesh.position.y).toBe(20);
        expect(mesh.position.z).toBe(30);
        expect(onChange).toHaveBeenCalled();
    });

    it('getPosition returns root mesh position', function () {
        mesh.position.x = 5;
        mesh.position.y = 6;
        mesh.position.z = 7;
        expect(mgr.getPosition('m1')).toEqual([5, 6, 7]);
    });

    it('getPosition returns [0,0,0] for unknown id', function () {
        expect(mgr.getPosition('nope')).toEqual([0, 0, 0]);
    });

    it('getPosition returns [0,0,0] when no meshes', function () {
        mgr.register(makeModelInstance('empty', { meshes: [] }));
        expect(mgr.getPosition('empty')).toEqual([0, 0, 0]);
    });

    it('resetTransform restores defaults and updates meshes', function () {
        instSet(mgr, 'm1', {
            visible: false,
            opacity: 0.5,
            wireframe: true,
            scaling: 2,
            rotationY: 1.5,
        });
        mgr.get('m1').meshes[0].position.x = 10;

        mgr.resetTransform('m1');

        const inst = mgr.get('m1');
        expect(inst.visible).toBe(true);
        expect(inst.opacity).toBe(1);
        expect(inst.wireframe).toBe(false);
        expect(inst.scaling).toBe(1);
        expect(inst.rotationY).toBe(0);
        expect(inst.meshes[0].position.x).toBe(0);
        expect(inst.meshes[0].position.y).toBe(0);
        expect(inst.meshes[0].position.z).toBe(0);
        expect(onChange).toHaveBeenCalled();
    });

    it('resetTransform is no-op for unknown id', function () {
        expect(function () {
            mgr.resetTransform('nope');
        }).not.toThrow();
    });

    it('transform setters are no-op for unknown id', function () {
        expect(function () {
            mgr.setScaling('nope', 2);
        }).not.toThrow();
        expect(function () {
            mgr.setRotationY('nope', 1);
        }).not.toThrow();
        expect(function () {
            mgr.setPosition('nope', 1, 2, 3);
        }).not.toThrow();
    });
});

// ======== VMD / morph（原 model-manager.vmd-morph.test.ts） ========
describe('ModelManager VMD / morph', function () {
    let mgr, scene, onChange;

    beforeEach(function () {
        setFocusedModelId(null);
        onChange = vi.fn();
        scene = makeObservableScene();
        mgr = new ModelManager(scene, onChange, vi.fn());
    });

    it('clearVmdData resets VMD fields and calls onChange', function () {
        const inst = makeModelInstance('m1', {
            vmdData: new ArrayBuffer(10),
            vmdName: 'test.vmd',
            vmdPath: '/test.vmd',
            animationDuration: 60,
        });
        mgr.register(inst);

        mgr.clearVmdData('m1');

        expect(inst.vmdData).toBeNull();
        expect(inst.vmdName).toBe('');
        expect(inst.vmdPath).toBeNull();
        expect(inst.animationDuration).toBe(0);
        expect(onChange).toHaveBeenCalled();
    });

    it('clearVmdData is no-op for unknown id', function () {
        expect(function () {
            mgr.clearVmdData('nope');
        }).not.toThrow();
    });

    it('getMorphs returns morph array from mmdModel', function () {
        const mmd = makeMmdModel(
            [],
            [
                { name: 'a', type: 0 },
                { name: 'smile', type: 1 },
            ]
        );
        mgr.register(makeModelInstance('m1', { mmdModel: mmd }));

        const morphs = mgr.getMorphs('m1');
        expect(morphs).toEqual([
            { name: 'a', type: 0 },
            { name: 'smile', type: 1 },
        ]);
    });

    it('getMorphs returns [] when morph.morphs is undefined', function () {
        const mmd = makeMmdModel([], []);
        mmd.morph.morphs = undefined;
        mgr.register(makeModelInstance('m1', { mmdModel: mmd }));
        expect(mgr.getMorphs('m1')).toEqual([]);
    });

    it('setMorphWeight delegates to mmdModel.morph.setMorphWeight', function () {
        const mmd = makeMmdModel([], [{ name: 'a', type: 0 }]);
        mgr.register(makeModelInstance('m1', { mmdModel: mmd }));

        mgr.setMorphWeight('m1', 'a', 0.8);
        expect(mmd.morph.setMorphWeight).toHaveBeenCalledWith('a', 0.8);
    });

    it('getMorphWeight delegates to mmdModel.morph.getMorphWeight', function () {
        const mmd = makeMmdModel([], [{ name: 'a', type: 0 }]);
        mmd.morph.getMorphWeight.mockReturnValue(0.5);
        mgr.register(makeModelInstance('m1', { mmdModel: mmd }));

        expect(mgr.getMorphWeight('m1', 'a')).toBe(0.5);
        expect(mmd.morph.getMorphWeight).toHaveBeenCalledWith('a');
    });

    it('resetMorphs delegates and calls onChange', function () {
        const mmd = makeMmdModel([], [{ name: 'a', type: 0 }]);
        mgr.register(makeModelInstance('m1', { mmdModel: mmd }));

        mgr.resetMorphs('m1');
        expect(mmd.morph.resetMorphWeights).toHaveBeenCalled();
        expect(onChange).toHaveBeenCalled();
    });

    it('resetMorphs is safe when no mmdModel.morph', function () {
        const mmd = { runtimeBones: [], morph: undefined };
        mgr.register(makeModelInstance('m1', { mmdModel: mmd }));
        expect(function () {
            mgr.resetMorphs('m1');
        }).not.toThrow();
    });

    it('morph methods are safe when mmdModel is undefined (stage model)', function () {
        mgr.register(makeModelInstance('stage1', { mmdModel: undefined, kind: 'stage' }));
        expect(function () {
            expect(mgr.getMorphs('stage1')).toEqual([]);
            mgr.setMorphWeight('stage1', 'a', 0.5);
            expect(mgr.getMorphWeight('stage1', 'a')).toBe(0);
            mgr.resetMorphs('stage1');
        }).not.toThrow();
    });

    it('focusedMmdModel returns null (no throw) for a stale focused id', function () {
        setFocusedModelId('ghost-not-registered');
        let result = null;
        expect(function () {
            result = mgr.focusedMmdModel();
        }).not.toThrow();
        expect(result).toBeNull();
        setFocusedModelId(null);
    });
});

// ======== rotation（全自由度 ADR-126） ========
describe('ModelManager rotation', function () {
    let mgr, scene, onChange, mesh;

    beforeEach(function () {
        setFocusedModelId(null);
        onChange = vi.fn();
        scene = makeObservableScene();
        mgr = new ModelManager(scene, onChange, vi.fn());
        mesh = createTestMesh('root');
        mgr.register(makeModelInstance('m1', { meshes: [mesh] }));
    });

    it('setRotation sets all 3 axes and syncs mesh', function () {
        const { Vector3 } = require('@babylonjs/core/Maths/math.vector');
        const rot = new Vector3(0.1, 0.2, 0.3);
        mgr.setRotation('m1', rot);

        const inst = mgr.get('m1');
        expect(inst.rotation[0]).toBeCloseTo(0.1);
        expect(inst.rotation[1]).toBeCloseTo(0.2);
        expect(inst.rotation[2]).toBeCloseTo(0.3);
        expect(inst.rotationY).toBeCloseTo(0.2);
        expect(mesh.rotation.x).toBeCloseTo(0.1);
        expect(mesh.rotation.y).toBeCloseTo(0.2);
        expect(mesh.rotation.z).toBeCloseTo(0.3);
        expect(onChange).toHaveBeenCalled();
    });

    it('getRotation returns Vector3 of current rotation', function () {
        const inst = mgr.get('m1');
        inst.rotation = [0.5, 1.0, 1.5];
        const result = mgr.getRotation('m1');
        expect(result.x).toBeCloseTo(0.5);
        expect(result.y).toBeCloseTo(1.0);
        expect(result.z).toBeCloseTo(1.5);
    });

    it('getRotation returns null for unknown id', function () {
        expect(mgr.getRotation('nope')).toBeNull();
    });

    it('setRotation is no-op for unknown id', function () {
        expect(function () {
            const { Vector3 } = require('@babylonjs/core/Maths/math.vector');
            mgr.setRotation('nope', new Vector3(1, 2, 3));
        }).not.toThrow();
    });
});

// ======== orbit / positionMode（ADR-049） ========
describe('ModelManager orbit + positionMode', function () {
    let mgr, scene, onChange, mesh;

    beforeEach(function () {
        setFocusedModelId(null);
        onChange = vi.fn();
        scene = makeObservableScene();
        mgr = new ModelManager(scene, onChange, vi.fn());
        mesh = createTestMesh('root');
        mgr.register(makeModelInstance('m1', { meshes: [mesh] }));
    });

    it('setOrbit stores orbit params and positions mesh', function () {
        mgr.setOrbit('m1', 0, 0, 5);
        const inst = mgr.get('m1');
        expect(inst.positionMode).toBe('orbit');
        expect(inst.orbitAzimuth).toBe(0);
        expect(inst.orbitElevation).toBe(0);
        expect(inst.orbitDistance).toBe(5);
        expect(mesh.position.x).toBeCloseTo(0, 1);
        expect(mesh.position.y).toBeCloseTo(0, 1);
        expect(mesh.position.z).toBeCloseTo(5, 1);
        expect(onChange).toHaveBeenCalled();
    });

    it('setOrbit clamps invalid elevation and distance', function () {
        mgr.setOrbit('m1', NaN, 100, -1);
        const inst = mgr.get('m1');
        expect(inst.orbitAzimuth).toBe(0);
        expect(inst.orbitElevation).toBe(90);
        expect(inst.orbitDistance).toBeGreaterThan(0);
    });

    it('getOrbit returns stored orbit params when in orbit mode', function () {
        mgr.setOrbit('m1', 45, 30, 10);
        const orbit = mgr.getOrbit('m1');
        expect(orbit.azimuth).toBe(45);
        expect(orbit.elevation).toBe(30);
        expect(orbit.distance).toBe(10);
    });

    it('getOrbit computes from cartesian when not in orbit mode', function () {
        mesh.position.x = 3;
        mesh.position.y = 4;
        mesh.position.z = 0;
        const orbit = mgr.getOrbit('m1');
        expect(orbit.distance).toBeCloseTo(5, 1);
        expect(orbit.azimuth).toBeCloseTo(Math.atan2(3, 0) * 180 / Math.PI, 0);
    });

    it('getOrbit returns null for unknown id', function () {
        expect(mgr.getOrbit('nope')).toBeNull();
    });

    it('setPositionMode switches to orbit and back', function () {
        mesh.position.x = 5;
        mesh.position.y = 0;
        mesh.position.z = 0;
        mgr.setPositionMode('m1', 'orbit');
        expect(mgr.get('m1').positionMode).toBe('orbit');
        expect(mgr.get('m1').orbitDistance).toBeCloseTo(5, 1);

        mgr.setPositionMode('m1', 'cartesian');
        expect(mgr.get('m1').positionMode).toBe('cartesian');
        expect(onChange).toHaveBeenCalled();
    });

    it('getPositionMode returns cartesian by default', function () {
        expect(mgr.getPositionMode('m1')).toBe('cartesian');
    });

    it('getPositionMode returns cartesian for unknown id', function () {
        expect(mgr.getPositionMode('nope')).toBe('cartesian');
    });

    it('setOrbit is no-op for unknown id', function () {
        expect(function () {
            mgr.setOrbit('nope', 0, 0, 5);
        }).not.toThrow();
    });

    it('setPositionMode is no-op for unknown id', function () {
        expect(function () {
            mgr.setPositionMode('nope', 'orbit');
        }).not.toThrow();
    });
});

// ======== formation ========
describe('ModelManager formation', function () {
    let mgr, scene, onChange;

    beforeEach(function () {
        setFocusedModelId(null);
        onChange = vi.fn();
        scene = makeObservableScene();
        mgr = new ModelManager(scene, onChange, vi.fn());
    });

    it('setFormation positions models in line formation', function () {
        const meshA = createTestMesh('a');
        const meshB = createTestMesh('b');
        const meshC = createTestMesh('c');
        mgr.register(makeModelInstance('a', { meshes: [meshA] }));
        mgr.register(makeModelInstance('b', { meshes: [meshB] }));
        mgr.register(makeModelInstance('c', { meshes: [meshC] }));

        mgr.setFormation('line', 3);

        expect(meshA.position.x).toBeCloseTo(-3, 1);
        expect(meshB.position.x).toBeCloseTo(0, 1);
        expect(meshC.position.x).toBeCloseTo(3, 1);
        expect(onChange).toHaveBeenCalled();
    });

    it('getActiveFormation returns the active formation type', function () {
        expect(mgr.getActiveFormation()).toBeNull();
        mgr.setFormation('circle', 5);
        expect(mgr.getActiveFormation()).toBe('circle');
    });

    it('getActiveFormationSpacing returns the spacing', function () {
        expect(mgr.getActiveFormationSpacing()).toBe(3);
        mgr.setFormation('line', 7);
        expect(mgr.getActiveFormationSpacing()).toBe(7);
    });

    it('arrange clears active formation', function () {
        mgr.setFormation('line', 3);
        expect(mgr.getActiveFormation()).toBe('line');
        mgr.arrange();
        expect(mgr.getActiveFormation()).toBeNull();
    });

    it('setFormation with no models does not throw', function () {
        expect(function () {
            mgr.setFormation('circle', 3);
        }).not.toThrow();
    });
});

// ======== 边界 / 输入校验 ========
describe('ModelManager input validation', function () {
    let mgr, scene, onChange;

    beforeEach(function () {
        setFocusedModelId(null);
        onChange = vi.fn();
        scene = makeObservableScene();
        mgr = new ModelManager(scene, onChange, vi.fn());
        const mesh = createTestMesh('root');
        mgr.register(makeModelInstance('m1', { meshes: [mesh] }));
    });

    it('setScaling with NaN is no-op (does not change scaling or call onChange)', function () {
        expect(function () {
            mgr.setScaling('m1', NaN);
        }).not.toThrow();
        expect(mgr.get('m1').scaling).toBe(1);
        expect(onChange).not.toHaveBeenCalled();
    });

    it('setScaling with Infinity is no-op', function () {
        expect(function () {
            mgr.setScaling('m1', Infinity);
        }).not.toThrow();
        expect(mgr.get('m1').scaling).toBe(1);
        expect(onChange).not.toHaveBeenCalled();
    });

    it('setPosition with NaN coordinates is no-op', function () {
        expect(function () {
            mgr.setPosition('m1', NaN, 0, 0);
        }).not.toThrow();
        expect(onChange).not.toHaveBeenCalled();
    });

    it('focus with frameCamera=false sets focus but skips autoFrame', function () {
        const autoFrame = vi.fn();
        const mgr2 = new ModelManager(scene, onChange, autoFrame);
        const inst = makeModelInstance('m1');
        mgr2.register(inst);

        mgr2.focus('m1', false);

        expect(mgr2.focusedModelId).toBe('m1');
        expect(autoFrame).not.toHaveBeenCalled();
        expect(onChange).toHaveBeenCalled();
    });
});

// ======== dispose 清理骨骼覆盖 ========
describe('ModelManager dispose bone overlay cleanup', function () {
    let mgr, scene;

    beforeEach(function () {
        setFocusedModelId(null);
        scene = makeObservableScene();
        mgr = new ModelManager(scene, vi.fn(), vi.fn());
    });

    it('dispose cleans up bone overlay resources', function () {
        const bones = [makeBone('center', []), makeBone('waist', [])];
        bones[1].parentBone = bones[0];
        const mmdModel = makeMmdModel(bones, []);
        mgr.register(makeModelInstance('m1', { mmdModel: mmdModel }));
        mgr.setBoneLinesVis('m1', true);

        const entry = mgr._boneOverlayMap.get('m1');
        expect(entry).toBeDefined();
        expect(entry.joints.length).toBeGreaterThan(0);
        const lineSystemDispose = entry.lineSystem.dispose; // vi.fn() from CreateLineSystem mock

        mgr.dispose();

        expect(lineSystemDispose).toHaveBeenCalled();
        expect(mgr._boneOverlayMap.size).toBe(0);
    });
});
