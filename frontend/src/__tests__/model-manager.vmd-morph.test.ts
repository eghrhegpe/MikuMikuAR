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
