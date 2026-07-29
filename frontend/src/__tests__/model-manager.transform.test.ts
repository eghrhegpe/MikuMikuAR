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
    createTestMaterial,
    instSet,
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

describe('ModelManager visibility / opacity / wireframe', function () {
    let mgr, scene, onChange, mesh, mat;

    beforeEach(function () {
        setFocusedModelId(null);
        onChange = vi.fn();
        scene = makeObservableScene();
        mgr = new ModelManager(scene, onChange, vi.fn());

        mat = createTestMaterial('test_mat');
        mesh = createTestMesh('root', mat);
        const inst = makeModelInstance('m1', { meshes: [mesh] });
        mgr.register(inst);
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
