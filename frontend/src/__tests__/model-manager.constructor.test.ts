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
