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

        const callbacks = scene._callbacks;
        const boneCallbacks = callbacks.filter(function (cb) {
            return cb !== mgr._clothUpdateObserver;
        });
        expect(boneCallbacks.length).toBeGreaterThanOrEqual(1);
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
