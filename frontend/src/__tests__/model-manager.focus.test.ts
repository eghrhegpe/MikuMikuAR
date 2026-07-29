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
    createTestMesh,
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
