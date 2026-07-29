// @ts-nocheck — Babylon.js mock 类型由 vi.mock 运行时替换（供 model-manager 拆分测试复用）
// Shared Babylon.js mock factories + test helpers for the model-manager split tests.
//
// ADR-206: Babylon 工厂函数统一来自 mocks/babylon-factories.ts（单一规范源），
// 本文件仅保留 model-manager 独有的定制（MergeMeshes 副作用、Vector3 原型补丁）
// 和领域特有 helper（makeModelInstance / createTestMesh 等）。
import { vi } from 'vitest';
import {
    MockScene,
    MockMesh,
    MockVector3,
    MockQuaternion,
    MockMatrix,
    MockStandardMaterial,
} from './mocks/babylon-classes';
import {
    mockScene,
    mockMathColor,
    mockStandardMaterial,
} from './mocks/babylon-factories';

// ---- vi.mock factories (passed by reference into each split file's vi.mock) ----

// 直接复用 babylon-factories（无定制）
export const babylonSceneModule = mockScene;
export const babylonMathColorModule = mockMathColor;
export const babylonStandardMaterialModule = mockStandardMaterial;

export function babylonMeshModule() {
    MockMesh.MergeMeshes = vi.fn(() => null);
    return { Mesh: MockMesh };
}

export function babylonMeshBuilderModule() {
    const MockMeshCls = MockMesh;
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
            CreateLines: vi.fn(() => ({
                name: 'bone_ov_line',
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
}

export function babylonObservableModule() {
    return { Observer: class {} };
}

export function babylonMathVectorModule() {
    const V3 = MockVector3;
    V3.prototype.minimizeInPlace = function (v: any) {
        this.x = Math.min(this.x, v.x);
        this.y = Math.min(this.y, v.y);
        this.z = Math.min(this.z, v.z);
        return this;
    };
    V3.prototype.maximizeInPlace = function (v: any) {
        this.x = Math.max(this.x, v.x);
        this.y = Math.max(this.y, v.y);
        this.z = Math.max(this.z, v.z);
        return this;
    };
    V3.prototype.subtract = function (v: any) {
        return new V3(this.x - v.x, this.y - v.y, this.z - v.z);
    };
    return { Vector3: V3, Quaternion: MockQuaternion, Matrix: MockMatrix };
}

// ---- Helpers ----

export function makeModelInstance(id: string, overrides?: any): any {
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
            rotation: [0, 0, 0] as [number, number, number],
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

export function createTestMesh(name: any, mat?: any) {
    const mesh = new MockMesh(name);
    mesh.material = mat || new MockStandardMaterial(name + '_mat');
    mesh.isVisible = true;
    mesh.position = {
        x: 0,
        y: 0,
        z: 0,
        set: function (x: number, y: number, z: number) {
            this.x = x;
            this.y = y;
            this.z = z;
        },
    } as any;
    mesh.scaling = {
        x: 1,
        y: 1,
        z: 1,
        setAll: function (v: number) {
            this.x = this.y = this.z = v;
        },
    } as any;
    mesh.rotation = {
        x: 0,
        y: 0,
        z: 0,
        set: function (x: number, y: number, z: number) {
            this.x = x;
            this.y = y;
            this.z = z;
        },
    } as any;
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

export function makeBone(name: any, rigidBodyIndices?: any[]) {
    rigidBodyIndices = rigidBodyIndices || [];
    return {
        name: name,
        rigidBodyIndices: rigidBodyIndices,
        parentBone: null,
        getWorldTranslationToRef: vi.fn(),
        worldMatrix: new Float32Array(16),
    };
}

export function makeMmdModel(bones?: any[], morphs?: any[], rigidBodyStates?: Uint8Array) {
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

export function makeObservableScene() {
    const scene = new MockScene() as any;
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

export function createTestMaterial(name: string) {
    return new MockStandardMaterial(name);
}

export function instSet(mgr: any, id: string, props: any) {
    const inst = mgr.get(id);
    if (inst) {
        for (const k in props) {
            if (Object.hasOwn(props, k)) {
                inst[k] = props[k];
            }
        }
    }
}

export function setupModelWithBones(mgr: any, bones: any[]) {
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
