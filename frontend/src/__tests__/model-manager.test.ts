// @ts-nocheck — 大量 Babylon.js mock 类型无法通过编译时验证（vi.mock 运行时替换）
// Comprehensive unit tests for ModelManager
// Raises coverage of model-manager.ts from ~20% to 60%+ lines.
// Vitest hoists vi.mock calls - the factory uses require() for shared mocks.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ---- Module Mocks (hoisted by vitest before all imports) ----

vi.mock('@babylonjs/core/scene', () => {
    const m = require('./mocks/babylon-classes.ts');
    return { Scene: m.MockScene };
});

vi.mock('@babylonjs/core/Meshes/mesh', () => {
    const m = require('./mocks/babylon-classes.ts');
    const MeshCls = m.MockMesh;
    MeshCls.MergeMeshes = vi.fn(() => null);
    return { Mesh: MeshCls };
});

vi.mock('@babylonjs/core/Meshes/meshBuilder', () => {
    const m = require('./mocks/babylon-classes.ts');
    const MockMeshCls = m.MockMesh;
    return {
        MeshBuilder: {
            CreateSphere: vi.fn(function () {
                const s = new MockMeshCls('bone_joint');
                s.position.copyFrom = vi.fn();
                s.position.x = 0;
                s.position.y = 0;
                s.position.z = 0;
                return s;
            }),
            CreateLineSystem: vi.fn(() => ({
                name: 'bone_overlay_lines',
                color: { r: 1, g: 1, b: 1 },
                isPickable: false,
                setEnabled: vi.fn(),
                isEnabled: vi.fn(() => true),
                getVerticesData: vi.fn(() => null),
                updateVerticesData: vi.fn(),
                dispose: vi.fn(),
                getClassName: () => 'LinesMesh',
            })),
        },
    };
});

vi.mock('@babylonjs/core/Misc/observable', () => ({
    Observer: class {},
}));

vi.mock('@babylonjs/core/Maths/math.vector', () => {
    const m = require('./mocks/babylon-classes.ts');
    const V3 = m.MockVector3;
    V3.prototype.minimizeInPlace = function (v) {
        this.x = Math.min(this.x, v.x);
        this.y = Math.min(this.y, v.y);
        this.z = Math.min(this.z, v.z);
        return this;
    };
    V3.prototype.maximizeInPlace = function (v) {
        this.x = Math.max(this.x, v.x);
        this.y = Math.max(this.y, v.y);
        this.z = Math.max(this.z, v.z);
        return this;
    };
    V3.prototype.subtract = function (v) {
        return new V3(this.x - v.x, this.y - v.y, this.z - v.z);
    };
    return { Vector3: V3 };
});

vi.mock('@babylonjs/core/Maths/math.color', () => {
    const m = require('./mocks/babylon-classes.ts');
    return { Color3: m.MockColor3 };
});

vi.mock('@babylonjs/core/Materials/standardMaterial', () => {
    const m = require('./mocks/babylon-classes.ts');
    return { StandardMaterial: m.MockStandardMaterial };
});

// ---- Imports ----

import { ModelManager } from '../scene/manager/model-manager';
import { setFocusedModelId } from '../core/config';
import { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { Vector3 as MockVector3 } from '@babylonjs/core/Maths/math.vector';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';

// ---- Helpers ----

function makeModelInstance(id: string, overrides?: any): ModelInstance {
    overrides = overrides || {};
    return Object.assign(
        {
            id: id,
            name: id,
            filePath: 'D:/models/' + id + '.pmx',
            port: 12345,
            modelDir: 'D:/models',
            kind: 'actor',
            visible: true,
            opacity: 1,
            wireframe: false,
            showBoneLines: false,
            showBoneJoints: false,
            physicsEnabled: true,
            scaling: 1,
            rotationY: 0,
            vmdData: null,
            vmdName: '',
            vmdPath: null,
            animationDuration: 0,
            meshes: [],
            mmdModel: null,
            rootMesh: null,
            outfitFile: undefined,
            activeVariant: undefined,
            _origTextures: undefined,
            _origParams: undefined,
        },
        overrides
    );
}

function createTestMesh(name, mat) {
    const mesh = new Mesh(name);
    mesh.material = mat || new StandardMaterial(name + '_mat');
    mesh.position = {
        x: 0,
        y: 0,
        z: 0,
        set: function (x, y, z) {
            this.x = x;
            this.y = y;
            this.z = z;
        },
    } as any;
    mesh.scaling = {
        x: 1,
        y: 1,
        z: 1,
        setAll: function (v) {
            this.x = this.y = this.z = v;
        },
    } as any;
    mesh.rotation = { x: 0, y: 0, z: 0 } as any;
    mesh.dispose = vi.fn();
    mesh.setEnabled = vi.fn();
    mesh.computeWorldMatrix = vi.fn();
    mesh.getBoundingInfo = vi.fn(function () {
        return {
            boundingBox: {
                minimumWorld: { x: -0.5, y: 0, z: -0.5 },
                maximumWorld: { x: 0.5, y: 1.5, z: 0.5 },
            },
        } as any;
    }) as any;
    return mesh;
}

function makeBone(name, rigidBodyIndices) {
    rigidBodyIndices = rigidBodyIndices || [];
    return {
        name: name,
        rigidBodyIndices: rigidBodyIndices,
        parentBone: null,
        getWorldTranslationToRef: vi.fn(),
        worldMatrix: new Float32Array(16),
    };
}

function makeMmdModel(bones?: any[], morphs?: any[], rigidBodyStates?: Uint8Array) {
    bones = bones || [];
    morphs = morphs || [];
    rigidBodyStates = rigidBodyStates || new Uint8Array(10).fill(1);
    const boneMap = new Map(
        bones.map(function (b) {
            return [b.name, b];
        })
    );
    for (let i = 0; i < bones.length; i++) {
        if (typeof bones[i].parentBone === 'string') {
            bones[i].parentBone = boneMap.get(bones[i].parentBone) || null;
        }
    }
    return {
        runtimeBones: bones,
        morph: {
            morphs: morphs,
            setMorphWeight: vi.fn(),
            getMorphWeight: vi.fn(function () {
                return 0;
            }),
            resetMorphWeights: vi.fn(),
        },
        rigidBodyStates: rigidBodyStates,
        setRuntimeAnimation: vi.fn(),
        createRuntimeAnimation: vi.fn(),
    };
}

function makeObservableScene() {
    const scene = new Scene() as any;
    const callbacks: any[] = [];
    scene.onBeforeRenderObservable = {
        add: function (cb: any) {
            callbacks.push(cb);
            return cb;
        },
        remove: function (cb: any) {
            const idx = callbacks.indexOf(cb);
            if (idx >= 0) {
                callbacks.splice(idx, 1);
            }
        },
    };
    scene.deltaTime = 0.016;
    scene._callbacks = callbacks;
    return scene;
}

function instSet(mgr, id, props) {
    const inst = mgr.get(id);
    if (inst) {
        for (const k in props) {
            if (Object.hasOwn(props, k)) {
                inst[k] = props[k];
            }
        }
    }
}

// ---- Tests ----

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

    it('onChange and autoFrame are stored as constructor params', function () {
        expect(onChange).not.toHaveBeenCalled();
        expect(autoFrame).not.toHaveBeenCalled();
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

describe('ModelManager visibility / opacity / wireframe', function () {
    let mgr, scene, onChange, mesh, mat;

    beforeEach(function () {
        setFocusedModelId(null);
        onChange = vi.fn();
        scene = makeObservableScene();
        mgr = new ModelManager(scene, onChange, vi.fn());

        mat = new StandardMaterial('test_mat');
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

    it('setPhysics clears physics category state on toggle', function () {
        const states = new Uint8Array([1, 1]);
        const mmd = makeMmdModel([], [], states);
        mgr.register(makeModelInstance('m1', { mmdModel: mmd }));
        mgr._physicsCatState.set('m1', new Map([['skirt', false]]));

        mgr.setPhysics('m1', false);
        expect(mgr._physicsCatState.has('m1')).toBe(false);
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

    // Physics categories

    function setupModelWithBones(bones) {
        const maxIdx = bones.reduce(function (max, b) {
            return Math.max(
                max,
                b.rigidBodyIndices.length > 0 ? Math.max.apply(null, b.rigidBodyIndices) : 0
            );
        }, 0);
        const states = new Uint8Array(maxIdx + 1 || 4);
        const mmd = makeMmdModel(bones, [], states);
        const id = 'm1';
        mgr.register(makeModelInstance(id, { mmdModel: mmd }));
        return id;
    }

    it('getPhysicsCategories returns categories from bone classification', function () {
        const bones = [
            makeBone('\u30b9\u30ab\u30fc\u30c8', [0, 1]),
            makeBone('\u80f8', [2, 3]),
            makeBone('\u9aea', [4]),
        ];
        const id = setupModelWithBones(bones);

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
        const id = setupModelWithBones([makeBone('leg', [0]), makeBone('arm', [1])]);
        expect(mgr.getPhysicsCategories(id)).toEqual([]);
    });

    it('getPhysicsCatState returns null initially', function () {
        const id = setupModelWithBones([makeBone('skirt', [0])]);
        expect(mgr.getPhysicsCatState(id)).toBeNull();
    });

    it('getPhysicsCatState returns recorded category state', function () {
        const id = setupModelWithBones([makeBone('skirt', [0])]);
        mgr._physicsCatState.set(id, new Map([['skirt', false]]));

        const state = mgr.getPhysicsCatState(id);
        expect(state).toEqual({ skirt: false });
    });

    it('isPhysicsCategoryEnabled returns true by default', function () {
        const id = setupModelWithBones([makeBone('skirt', [0])]);
        expect(mgr.isPhysicsCategoryEnabled(id, 'skirt')).toBe(true);
    });

    it('isPhysicsCategoryEnabled returns stored state', function () {
        const id = setupModelWithBones([makeBone('skirt', [0])]);
        mgr._physicsCatState.set(id, new Map([['skirt', false]]));
        expect(mgr.isPhysicsCategoryEnabled(id, 'skirt')).toBe(false);
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
        const id = setupModelWithBones([makeBone('skirt', [0])]);
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

    // Bone classification tests via getPhysicsCategories
    it('classifyBonePhysics matches skirt patterns', function () {
        const id = setupModelWithBones([
            makeBone('skirt', [0]),
            makeBone('\u30b9\u30ab\u30fc\u30c8', [1]),
            makeBone('frill', [2]),
            makeBone('hem', [3]),
        ]);
        expect(mgr.getPhysicsCategories(id)).toContain('skirt');
    });

    it('classifyBonePhysics matches chest patterns', function () {
        const id = setupModelWithBones([
            makeBone('\u80f8', [0]),
            makeBone('chest', [1]),
            makeBone('bust', [2]),
        ]);
        expect(mgr.getPhysicsCategories(id)).toContain('chest');
    });

    it('classifyBonePhysics matches hair patterns', function () {
        const id = setupModelWithBones([
            makeBone('\u9aea', [0]),
            makeBone('hair', [1]),
            makeBone('ahoge', [2]),
            makeBone('bangs', [3]),
            makeBone('ponytail', [4]),
        ]);
        expect(mgr.getPhysicsCategories(id)).toContain('hair');
    });

    it('classifyBonePhysics matches accessory patterns', function () {
        const id = setupModelWithBones([
            makeBone('ribbon', [0]),
            makeBone('collar', [1]),
            makeBone('tie', [2]),
            makeBone('accessory', [3]),
        ]);
        expect(mgr.getPhysicsCategories(id)).toContain('accessory');
    });
});

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
        expect(entry.overlay).toBeDefined();
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

describe('ModelManager captureThumbnail', function () {
    let mgr, scene;

    beforeEach(function () {
        setFocusedModelId(null);
        scene = makeObservableScene();
        mgr = new ModelManager(scene, vi.fn(), vi.fn());
    });

    it('captures canvas to base64, strips header, calls saveFn', async function () {
        const canvas = {
            toDataURL: vi.fn(function () {
                return 'data:image/png;base64,rawdata123';
            }),
        };
        const saveFn = vi.fn(function () {
            return Promise.resolve();
        });

        await mgr.captureThumbnail('/test.pmx', canvas, saveFn);

        expect(canvas.toDataURL).toHaveBeenCalledWith('image/png', 0.8);
        expect(saveFn).toHaveBeenCalledWith('/test.pmx', 'rawdata123');
    });

    it('handles saveFn rejection gracefully', async function () {
        const spy = vi.spyOn(console, 'warn').mockImplementation(function () {});
        const canvas = {
            toDataURL: vi.fn(function () {
                return 'data:image/png;base64,raw';
            }),
        };
        const saveFn = vi.fn(function () {
            return Promise.reject(new Error('save failed'));
        });

        await mgr.captureThumbnail('/test.pmx', canvas, saveFn);

        expect(spy).toHaveBeenCalled();
        spy.mockRestore();
    });

    it('handles canvas error gracefully', async function () {
        const spy = vi.spyOn(console, 'warn').mockImplementation(function () {});
        const canvas = {
            toDataURL: vi.fn(function () {
                throw new Error('canvas error');
            }),
        };
        const saveFn = vi.fn();

        await mgr.captureThumbnail('/test.pmx', canvas, saveFn);

        expect(spy).toHaveBeenCalled();
        expect(saveFn).not.toHaveBeenCalled();
        spy.mockRestore();
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
