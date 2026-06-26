// vi.mock must be hoisted BEFORE imports
vi.mock("@babylonjs/core/Engines/engine", () => ({
    Engine: class MockEngine {
        _features = { trackUbosInFrame: false, doNotHandleContextLost: true };
        _renderLoops: Array<() => void> = [];
        _renderPassIdCounter = 0;
        _renderPassIds: number[] = [];
        runRenderLoop(cb: () => void) { this._renderLoops.push(cb); }
        stopRenderLoop() { this._renderLoops = []; }
        getRenderWidth() { return 800; }
        getRenderHeight() { return 600; }
        resize() {}
        clear() {}
        getClassName() { return "Engine"; }
        setHardwareScalingLevel() {}
        getHardwareScalingLevel() { return 1; }
        createRenderPassId() { const id = this._renderPassIdCounter++; this._renderPassIds.push(id); return id; }
        releaseRenderPassId(id: number) { const i = this._renderPassIds.indexOf(id); if (i >= 0) this._renderPassIds.splice(i, 1); }
    },
}));

vi.mock("@babylonjs/core/scene", () => ({
    Scene: class MockScene {
        _uniqueIdCounter = 0;
        clearColor = { r: 0, g: 0, b: 0, a: 1 };
        _engine: any;
        actionManager = null;
        metadata = null;
        constructor(engine: any) { this._engine = engine; }
        getEngine() { return this._engine; }
        getClassName() { return "Scene"; }
        getUniqueId() { return this._uniqueIdCounter++; }
        registerBeforeRender() {}
        unregisterBeforeRender() {}
        executeWhenReady() {}
        getMeshByName() { return null; }
        addCamera() {}
        removeCamera() {}
        activeCamera = null;
        meshes: any[] = [];
        materials: any[] = [];
    },
}));

vi.mock("@babylonjs/core/node", () => ({
    Node: class MockNode {
        _scene: any;
        constructor(name: string, scene: any) { this._scene = scene; }
        getScene() { return this._scene; }
    },
}));

vi.mock("@babylonjs/core/Lights/light", () => ({
    Light: class MockLight {
        _scene: any;
        intensity = 1;
        diffuse: any = null;
        specular: any = null;
        constructor(name: string, scene: any) { this._scene = scene; }
        getScene() { return this._scene; }
        dispose() {}
        getClassName() { return "Light"; }
    },
}));

vi.mock("@babylonjs/core/Lights/hemisphericLight", () => ({
    HemisphericLight: class MockHemisphericLight {
        intensity = 1;
        diffuse: any = null;
        groundColor: any = null;
        _scene: any;
        constructor(name: string, dir: any, scene: any) { this._scene = scene; }
        getClassName() { return "HemisphericLight"; }
    },
}));

vi.mock("@babylonjs/core/Lights/directionalLight", () => ({
    DirectionalLight: class MockDirectionalLight {
        intensity = 1;
        diffuse: any = null;
        _scene: any;
        constructor(name: string, dir: any, scene: any) { this._scene = scene; }
        getClassName() { return "DirectionalLight"; }
    },
}));

vi.mock("@babylonjs/core/Cameras/arcRotateCamera", () => ({
    ArcRotateCamera: class MockArcRotateCamera {
        alpha = 0; beta = 0; radius = 0;
        lowerRadiusLimit = 0; upperRadiusLimit = 0;
        panningSensibility = 50;
        constructor() {}
        getClassName() { return "ArcRotateCamera"; }
        attachControl() {}
        setTarget() {}
        dispose() {}
    },
}));

vi.mock("@babylonjs/core/Cameras/camera", () => ({
    Camera: class MockCamera {
        constructor() {}
        getClassName() { return "Camera"; }
    },
}));

vi.mock("@babylonjs/core/Maths/math.color", () => ({
    Color3: class MockColor3 {
        r: number; g: number; b: number;
        constructor(r = 0, g = 0, b = 0) { this.r = r; this.g = g; this.b = b; }
        set(r: number, g: number, b: number) { this.r = r; this.g = g; this.b = b; }
        clone() { return new MockColor3(this.r, this.g, this.b); }
        toArray() { return [this.r, this.g, this.b]; }
        toLinearSpace() { return this; }
        toGammaSpace() { return this; }
    },
    Color4: class MockColor4 {
        r: number; g: number; b: number; a: number;
        constructor(r = 0, g = 0, b = 0, a = 1) { this.r = r; this.g = g; this.b = b; this.a = a; }
        clone() { return new MockColor4(this.r, this.g, this.b, this.a); }
        toArray() { return [this.r, this.g, this.b, this.a]; }
    },
    TmpColors: { Color3: [] },
}));

vi.mock("@babylonjs/core/Maths/math.vector", () => {
    class MockVector3 {
        x: number; y: number; z: number;
        constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
        clone() { return new MockVector3(this.x, this.y, this.z); }
        add(v: MockVector3) { return new MockVector3(this.x + v.x, this.y + v.y, this.z + v.z); }
        scale(s: number) { return new MockVector3(this.x * s, this.y * s, this.z * s); }
        length() { return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z); }
        normalize() { return this; }
    }
    class MockMatrix {
        m = new Float32Array(16);
        constructor() { this.m.fill(0); }
        getClassName() { return "Matrix"; }
        invertToRef() {}
        multiplyToRef() {}
        getRotationMatrixToRef() {}
        decompose() { return { translation: new MockVector3(), rotation: new MockVector3(), scaling: new MockVector3() }; }
        static Identity() { return new MockMatrix(); }
        static IdentityToRef() {}
        static RotationYToRef() {}
    }
    return { Vector3: MockVector3, Matrix: MockMatrix, TmpVectors: { Vector3: [] } };
});

vi.mock("@babylonjs/core/Materials/standardMaterial", () => ({
    StandardMaterial: class MockStandardMaterial {
        name = "";
        diffuseColor = { r: 1, g: 1, b: 1, set() {}, clone() { return { ...this }; } };
        specularColor = { r: 0.8, g: 0.8, b: 0.8, set() {}, clone() { return { ...this }; } };
        specularPower = 50;
        ambientColor = { r: 0.3, g: 0.3, b: 0.3, set() {}, clone() { return { ...this }; } };
        alpha = 1;
        constructor(name: string) { this.name = name; }
        getClassName() { return "StandardMaterial"; }
        clone() { return this; }
        dispose() {}
    },
}));

vi.mock("@babylonjs/core/Materials/material", () => ({
    Material: class MockMaterial {
        name = "";
        getClassName() { return "Material"; }
    },
}));

vi.mock("@babylonjs/core/Meshes/mesh", () => ({
    AbstractMesh: class MockAbstractMesh {
        position = { x: 0, y: 0, z: 0 };
        name = "";
    },
    Mesh: class MockMesh {
        position = { x: 0, y: 0, z: 0 };
        name = "";
        material = null;
        getClassName() { return "Mesh"; }
    },
}));

vi.mock("@babylonjs/core/PostProcesses/postProcess", () => ({
    PostProcess: class MockPostProcess {
        constructor() {}
    },
}));

vi.mock("@babylonjs/core/Loading/sceneLoader", () => ({
    ImportMeshAsync: async () => ({ meshes: [] }),
}));

vi.mock("@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline", () => ({
    DefaultRenderingPipeline: class MockPipeline {
        constructor() {}
    },
}));

vi.mock("@babylonjs/core/Physics/v2/physicsEngineComponent", () => ({}));

vi.mock("@babylonjs/core/Materials/Textures/Loaders/tgaTextureLoader", () => ({}));

// --- babylon-mmd mocks ---
vi.mock("babylon-mmd/esm/Runtime/mmdCamera", () => ({
    MmdCamera: class MockMmdCamera {
        static _RotationMatrix: any = null;
        static _UpVector: any = null;
        static _TargetVector: any = null;
        position = { x: 0, y: 10, z: -15 };
        target = { x: 0, y: 0, z: 0 };
        animate() {}
    },
}));

vi.mock("babylon-mmd/esm/Loader/dynamic", () => ({
    RegisterMmdModelLoaders: () => {},
}));

vi.mock("babylon-mmd/esm/Loader/registerDxBmpTextureLoader", () => ({
    RegisterDxBmpTextureLoader: () => {},
}));

vi.mock("babylon-mmd/esm/Runtime/Optimized/mmdWasmInstance", () => ({
    GetMmdWasmInstance: async () => null,
}));

vi.mock("babylon-mmd/esm/Runtime/Optimized/InstanceType/singlePhysicsRelease", () => ({
    MmdWasmInstanceTypeSPR: class Mock {},
}));

vi.mock("babylon-mmd/esm/Runtime/Optimized/mmdWasmRuntime", () => ({
    MmdWasmRuntime: class Mock {
        registerMesh() {}
        setMeshVisibility() {}
        setMeshOpacity() {}
        setMeshWireframe() {}
    },
}));

vi.mock("babylon-mmd/esm/Loader/vmdLoader", () => ({
    VmdLoader: class Mock {
        static LoadAsync() {}
    },
}));

vi.mock("babylon-mmd/esm/Runtime/Optimized/Animation/mmdWasmAnimation", () => ({
    MmdWasmAnimation: class Mock {
        runtimeAnimations: any[] = [];
    },
}));

vi.mock("babylon-mmd/esm/Runtime/Optimized/Animation/mmdWasmRuntimeModelAnimation", () => ({}));

vi.mock("babylon-mmd/esm/Runtime/mmdStandardMaterialProxy", () => ({
    MmdStandardMaterialProxy: class Mock {},
}));

vi.mock("babylon-mmd/esm/Runtime/mmdRuntimeShared", () => ({
    MmdRuntimeShared: class Mock {},
}));

vi.mock("babylon-mmd/esm/Loader/mmdModelLoader.default", () => ({}));

vi.mock("babylon-mmd/esm/Loader/Shaders/textureAlphaChecker.vertex", () => ({}));

vi.mock("babylon-mmd/esm/Loader/Shaders/textureAlphaChecker.fragment", () => ({}));

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
    _catOf,
    _catState,
    _matState,
    _applyAll,
    getMatParams,
    setMatParams,
    resetSingleMatParams,
    resetAllMatParams,
    getMatCatParams,
    setMatCatParams,
    getMatDetailList,
    getMatState,
    applyMatState,
} from "../scene";
import { modelRegistry } from "../config";

// ======== _catOf material classification ========

describe("_catOf material classification", () => {
    it('classifies "skin" as 皮肤', () => {
        expect(_catOf("skin")).toBe("皮肤");
    });

    it('classifies "face" as 皮肤', () => {
        expect(_catOf("face")).toBe("皮肤");
    });

    it('classifies "髪" as 头发', () => {
        expect(_catOf("髪")).toBe("头发");
    });

    it('classifies "hair" as 头发', () => {
        expect(_catOf("hair")).toBe("头发");
    });

    it('classifies "eye" as 眼睛', () => {
        expect(_catOf("eye")).toBe("眼睛");
    });

    it('classifies "目" as 眼睛', () => {
        expect(_catOf("目")).toBe("眼睛");
    });

    it('classifies "pupil" as 眼睛', () => {
        expect(_catOf("pupil")).toBe("眼睛");
    });

    it('classifies unknown names as 服装', () => {
        expect(_catOf("skirt")).toBe("服装");
        expect(_catOf("shoes")).toBe("服装");
        expect(_catOf("ribbon")).toBe("服装");
    });

    it("is case insensitive", () => {
        expect(_catOf("Skin")).toBe("皮肤");
        expect(_catOf("FACE")).toBe("皮肤");
        expect(_catOf("Hair")).toBe("头发");
    });

    it('classifies "kihada" (肌) as 皮肤', () => {
        expect(_catOf("kihada")).toBe("皮肤");
    });

    it('classifies "body" as 皮肤', () => {
        expect(_catOf("body")).toBe("皮肤");
    });

    it('classifies "ahoge" as 头发', () => {
        expect(_catOf("ahoge")).toBe("头发");
    });
});

// ======== Per-Material State Management ========

function mockMat(name: string) {
    return {
        name,
        diffuseColor: { r: 1, g: 1, b: 1, set() {}, clone() { return { r: 1, g: 1, b: 1 }; } },
        specularColor: { r: 0.8, g: 0.8, b: 0.8, set() {}, clone() { return { r: 0.8, g: 0.8, b: 0.8 }; } },
        specularPower: 50,
        ambientColor: { r: 0.3, g: 0.3, b: 0.3, set() {}, clone() { return { r: 0.3, g: 0.3, b: 0.3 }; } },
    };
}

function regModel(id: string, meshCount: number, names?: string[]): void {
    const meshes = Array.from({ length: meshCount }, (_, i) => ({
        material: mockMat(names?.[i] ?? `mat${i}`),
    }));
    // @ts-expect-error duck-typed mock meshes
    modelRegistry.set(id, { meshes });
}

function cleanupModels(): void {
    for (const key of modelRegistry.keys()) {
        if (key.startsWith("model") || key === "_applyAll_test" || key === "model_rm" || key === "model_c" || key === "model_as") {
            modelRegistry.delete(key);
        }
    }
}

describe("per-material parameter state management", () => {
    beforeEach(() => {
        _catState.clear();
        _matState.clear();
        regModel("model1", 3);
        regModel("model2", 2);
    });

    afterEach(() => {
        cleanupModels();
    });

    describe("getMatParams", () => {
        it("returns null for unset material", () => {
            expect(getMatParams("model1", 0)).toBeNull();
        });
    });

    describe("setMatParams", () => {
        it("sets diffuse multiplier for a single material", () => {
            setMatParams("model1", 0, { diffuseMul: 0.5 });
            const params = getMatParams("model1", 0);
            expect(params).not.toBeNull();
            expect(params!.diffuseMul).toBe(0.5);
            expect(params!.specularMul).toBe(1);
            expect(params!.shininess).toBe(50);
            expect(params!.ambientMul).toBe(1);
        });

        it("sets specular multiplier for a single material", () => {
            setMatParams("model1", 0, { specularMul: 1.5 });
            const params = getMatParams("model1", 0);
            expect(params!.specularMul).toBe(1.5);
        });

        it("preserves previously set params when updating", () => {
            setMatParams("model1", 0, { diffuseMul: 0.5 });
            setMatParams("model1", 0, { shininess: 100 });
            const params = getMatParams("model1", 0);
            expect(params!.diffuseMul).toBe(0.5);
            expect(params!.shininess).toBe(100);
        });

        it("tracks multiple materials independently", () => {
            setMatParams("model1", 0, { diffuseMul: 0.3 });
            setMatParams("model1", 1, { diffuseMul: 0.7 });
            setMatParams("model2", 0, { diffuseMul: 1.2 });

            expect(getMatParams("model1", 0)!.diffuseMul).toBe(0.3);
            expect(getMatParams("model1", 1)!.diffuseMul).toBe(0.7);
            expect(getMatParams("model2", 0)!.diffuseMul).toBe(1.2);
        });
    });

    describe("modified tracking", () => {
        it("marks material as modified after setting params", () => {
            const list0 = getMatDetailList("model1");
            const modified0 = list0.find(e => e.index === 0);
            expect(modified0?.modified ?? false).toBe(false);

            setMatParams("model1", 0, { diffuseMul: 0.5 });

            const list1 = getMatDetailList("model1");
            const modified1 = list1.find(e => e.index === 0);
            expect(modified1?.modified).toBe(true);
        });

        it("returns correct modified count across materials", () => {
            setMatParams("model1", 0, { diffuseMul: 0.5 });
            setMatParams("model1", 1, { shininess: 80 });
            const list = getMatDetailList("model1");
            expect(list.filter(e => e.modified)).toHaveLength(2);
        });
    });

    describe("resetSingleMatParams", () => {
        beforeEach(() => {
            _catState.clear();
            _matState.clear();
            regModel("model1", 3);
            regModel("model2", 2);
        });

        it("removes the parameter entry for a single material", () => {
            setMatParams("model1", 0, { diffuseMul: 0.5 });
            expect(getMatParams("model1", 0)).not.toBeNull();

            resetSingleMatParams("model1", 0);
            expect(getMatParams("model1", 0)).toBeNull();
        });

        it("does not affect other materials", () => {
            setMatParams("model1", 0, { diffuseMul: 0.5 });
            setMatParams("model1", 1, { diffuseMul: 0.7 });

            resetSingleMatParams("model1", 0);
            expect(getMatParams("model1", 0)).toBeNull();
            expect(getMatParams("model1", 1)).not.toBeNull();
        });
    });

    describe("resetAllMatParams", () => {
        it("clears all per-material params for a model", () => {
            setMatParams("model1", 0, { diffuseMul: 0.5 });
            setMatParams("model1", 1, { shininess: 80 });
            setMatParams("model1", 2, { ambientMul: 0.3 });

            resetAllMatParams("model1");
            expect(getMatParams("model1", 0)).toBeNull();
            expect(getMatParams("model1", 1)).toBeNull();
            expect(getMatParams("model1", 2)).toBeNull();
        });

        it("does not affect other models", () => {
            setMatParams("model1", 0, { diffuseMul: 0.5 });
            setMatParams("model2", 0, { diffuseMul: 0.7 });

            resetAllMatParams("model1");
            expect(getMatParams("model2", 0)).not.toBeNull();
        });
    });

    describe("model removal cleans up state", () => {
        beforeEach(() => {
            _catState.clear();
            _matState.clear();
            regModel("model_rm", 2);
        });

        it("removeModel cleans _catState and _matState", () => {
            setMatCatParams("model_rm", "皮肤", { diffuseMul: 1.5 });
            setMatParams("model_rm", 0, { diffuseMul: 0.5 });

            _catState.delete("model_rm");
            _matState.delete("model_rm");

            expect(getMatCatParams("model_rm", "皮肤")).toEqual({ diffuseMul: 1, specularMul: 1, shininess: 50, ambientMul: 1 });
            expect(getMatParams("model_rm", 0)).toBeNull();
        });
    });
});

// ======== Category-level parameter state ========

describe("category-level parameter state", () => {
    beforeEach(() => {
        _catState.clear();
        _matState.clear();
        regModel("model_c", 2);
    });

    afterEach(() => {
        cleanupModels();
    });

    it("setMatCatParams and getMatCatParams roundtrip", () => {
        setMatCatParams("model_c", "皮肤", { diffuseMul: 1.2, specularMul: 0.8 });
        const p = getMatCatParams("model_c", "皮肤");
        expect(p.diffuseMul).toBe(1.2);
        expect(p.specularMul).toBe(0.8);
    });

    it("unset category returns defaults", () => {
        const p = getMatCatParams("model_c", "头发");
        expect(p.diffuseMul).toBe(1);
        expect(p.specularMul).toBe(1);
        expect(p.shininess).toBe(50);
        expect(p.ambientMul).toBe(1);
    });
});

// ======== applyMatState ========

describe("applyMatState MaterialCategory cast", () => {
    beforeEach(() => {
        _catState.clear();
        _matState.clear();
        regModel("model_as", 5);
    });

    afterEach(() => {
        cleanupModels();
    });

    it("applies category params from preset state", () => {
        applyMatState("model_as", {
            categories: {
                "皮肤": { diffuseMul: 1.5, specularMul: 0.8, shininess: 30, ambientMul: 1 },
            },
        });
        const p = getMatCatParams("model_as", "皮肤");
        expect(p.diffuseMul).toBe(1.5);
    });

    it("applies override params from preset state", () => {
        applyMatState("model_as", {
            overrides: {
                3: { diffuseMul: 1.5, specularMul: 0.5, shininess: 10, ambientMul: 1.2 },
            },
        });
        const p = getMatParams("model_as", 3);
        expect(p!.shininess).toBe(10);
    });

    it("handles empty state gracefully", () => {
        applyMatState("model_as", {});
        // Real getMatDetailList returns all meshes with default params and modified=false
        const list = getMatDetailList("model_as");
        expect(list.length).toBeGreaterThan(0);
        expect(list.every(e => !e.modified)).toBe(true);
    });
});

// ======== _applyAll ordering tests with duck-typed materials ========

function makeMockMat(origR = 1, origG = 1, origB = 1) {
    return {
        name: "skin",
        diffuseColor: { r: origR, g: origG, b: origB, set(r: number, g: number, b: number) { this.r = r; this.g = g; this.b = b; }, clone() { return { ...this, r: this.r, g: this.g, b: this.b }; } },
        specularColor: { r: 0.8, g: 0.8, b: 0.8, set(r: number, g: number, b: number) { this.r = r; this.g = g; this.b = b; }, clone() { return { ...this, r: this.r, g: this.g, b: this.b }; } },
        specularPower: 50,
        ambientColor: { r: 0.3, g: 0.3, b: 0.3, set(r: number, g: number, b: number) { this.r = r; this.g = g; this.b = b; }, clone() { return { ...this, r: this.r, g: this.g, b: this.b }; } },
    };
}

describe("_applyAll ordering: per-material overrides category on re-apply", () => {
    const TEST_ID = "_applyAll_test";

    beforeEach(() => {
        _catState.clear();
        _matState.clear();
        const old = modelRegistry.get(TEST_ID);
        if (old) modelRegistry.delete(TEST_ID);
    });

    afterEach(() => {
        if (modelRegistry.get(TEST_ID)) modelRegistry.delete(TEST_ID);
    });

    it("per-material diffuse overrides category after category re-apply", () => {
        const mats = [makeMockMat(1, 1, 1)];
        // @ts-expect-error duck-typed mock material
        modelRegistry.set(TEST_ID, { meshes: [{ material: mats[0] }] });

        setMatCatParams(TEST_ID, "皮肤", { diffuseMul: 0.5, specularMul: 1, shininess: 50, ambientMul: 1 });
        _applyAll(TEST_ID);
        expect(mats[0].diffuseColor.r).toBeCloseTo(0.5);

        setMatParams(TEST_ID, 0, { diffuseMul: 0.9, specularMul: 1, shininess: 50, ambientMul: 1 });
        expect(mats[0].diffuseColor.r).toBeCloseTo(0.9);

        setMatCatParams(TEST_ID, "皮肤", { diffuseMul: 0.3, specularMul: 1, shininess: 50, ambientMul: 1 });
        _applyAll(TEST_ID);
        expect(mats[0].diffuseColor.r).toBeCloseTo(0.9);
    });

    it("per-material specular overrides category after category re-apply", () => {
        const mats = [makeMockMat(1, 1, 1)];
        // @ts-expect-error duck-typed mock material
        modelRegistry.set(TEST_ID, { meshes: [{ material: mats[0] }] });

        setMatCatParams(TEST_ID, "皮肤", { diffuseMul: 1, specularMul: 0.5, shininess: 50, ambientMul: 1 });
        _applyAll(TEST_ID);

        setMatParams(TEST_ID, 0, { diffuseMul: 1, specularMul: 2, shininess: 50, ambientMul: 1 });
        expect(mats[0].specularColor.r).toBeCloseTo(1.6);

        setMatCatParams(TEST_ID, "皮肤", { diffuseMul: 1, specularMul: 0.2, shininess: 50, ambientMul: 1 });
        _applyAll(TEST_ID);
        expect(mats[0].specularColor.r).toBeCloseTo(1.6);
    });

    it("per-material shininess survives category re-apply", () => {
        const mats = [makeMockMat(1, 1, 1)];
        // @ts-expect-error duck-typed mock material
        modelRegistry.set(TEST_ID, { meshes: [{ material: mats[0] }] });

        setMatCatParams(TEST_ID, "皮肤", { diffuseMul: 1, specularMul: 1, shininess: 50, ambientMul: 1 });
        _applyAll(TEST_ID);

        setMatParams(TEST_ID, 0, { diffuseMul: 1, specularMul: 1, shininess: 120, ambientMul: 1 });
        expect(mats[0].specularPower).toBe(120);

        setMatCatParams(TEST_ID, "皮肤", { diffuseMul: 1, specularMul: 1, shininess: 30, ambientMul: 1 });
        _applyAll(TEST_ID);
        expect(mats[0].specularPower).toBe(120);
    });

    it("per-material ambient overrides category after category re-apply", () => {
        const mats = [makeMockMat(1, 1, 1)];
        // @ts-expect-error duck-typed mock material
        modelRegistry.set(TEST_ID, { meshes: [{ material: mats[0] }] });

        setMatCatParams(TEST_ID, "皮肤", { diffuseMul: 1, specularMul: 1, shininess: 50, ambientMul: 0.5 });
        _applyAll(TEST_ID);

        setMatParams(TEST_ID, 0, { diffuseMul: 1, specularMul: 1, shininess: 50, ambientMul: 1.5 });
        expect(mats[0].ambientColor.r).toBeCloseTo(0.45);

        setMatCatParams(TEST_ID, "皮肤", { diffuseMul: 1, specularMul: 1, shininess: 50, ambientMul: 0.1 });
        _applyAll(TEST_ID);
        expect(mats[0].ambientColor.r).toBeCloseTo(0.45);
    });

    it("multiple material indices are independent under re-apply", () => {
        const m1 = makeMockMat(1, 1, 1);
        const m2 = makeMockMat(1, 1, 1);
        // @ts-expect-error duck-typed mock material
        modelRegistry.set(TEST_ID, { meshes: [{ material: m1 }, { material: m2 }] });

        setMatCatParams(TEST_ID, "皮肤", { diffuseMul: 0.5, specularMul: 1, shininess: 50, ambientMul: 1 });
        _applyAll(TEST_ID);

        setMatParams(TEST_ID, 0, { diffuseMul: 0.9, specularMul: 1, shininess: 50, ambientMul: 1 });
        _applyAll(TEST_ID);

        expect(m1.diffuseColor.r).toBeCloseTo(0.9);
        expect(m2.diffuseColor.r).toBeCloseTo(0.5);

        _applyAll(TEST_ID);
        expect(m1.diffuseColor.r).toBeCloseTo(0.9);
        expect(m2.diffuseColor.r).toBeCloseTo(0.5);
    });
});

// ======== Babylon property write-through spy test ========

class SpyColor3 {
    r = 0; g = 0; b = 0;
    set = vi.fn((r: number, g: number, b: number) => { this.r = r; this.g = g; this.b = b; });
    clone() { return { r: this.r, g: this.g, b: this.b, set: this.set, clone: () => this }; }
}

function applyPerMatToBabylonMat(
    mat: { diffuseColor: SpyColor3; specularColor: SpyColor3; specularPower: number; ambientColor: SpyColor3 },
    origDiffuse: { r: number; g: number; b: number },
    params: { diffuseMul: number; specularMul: number; shininess: number; ambientMul: number },
): void {
    mat.diffuseColor.set(
        origDiffuse.r * params.diffuseMul,
        origDiffuse.g * params.diffuseMul,
        origDiffuse.b * params.diffuseMul,
    );
    mat.specularColor.set(
        0.8 * params.specularMul,
        0.8 * params.specularMul,
        0.8 * params.specularMul,
    );
    mat.specularPower = params.shininess;
    mat.ambientColor.set(
        0.3 * params.ambientMul,
        0.3 * params.ambientMul,
        0.3 * params.ambientMul,
    );
}

describe("per-material params write through to Babylon material properties", () => {
    it("writes diffuseMul → diffuseColor.set with correct multiplier", () => {
        const mat = {
            diffuseColor: new SpyColor3(),
            specularColor: new SpyColor3(),
            specularPower: 50,
            ambientColor: new SpyColor3(),
        };
        const orig = { r: 0.8, g: 0.6, b: 0.4 };

        applyPerMatToBabylonMat(mat, orig, { diffuseMul: 0.5, specularMul: 1, shininess: 50, ambientMul: 1 });

        expect(mat.diffuseColor.set).toHaveBeenCalledTimes(1);
        expect(mat.diffuseColor.set).toHaveBeenCalledWith(0.4, 0.3, 0.2);
    });

    it("writes specularMul → specularColor.set with correct multiplier", () => {
        const mat = {
            diffuseColor: new SpyColor3(),
            specularColor: new SpyColor3(),
            specularPower: 50,
            ambientColor: new SpyColor3(),
        };

        applyPerMatToBabylonMat(mat, { r: 1, g: 1, b: 1 }, { diffuseMul: 1, specularMul: 1.5, shininess: 50, ambientMul: 1 });

        expect(mat.specularColor.set).toHaveBeenCalledTimes(1);
        expect(mat.specularColor.r).toBeCloseTo(1.2, 10);
        expect(mat.specularColor.g).toBeCloseTo(1.2, 10);
        expect(mat.specularColor.b).toBeCloseTo(1.2, 10);
    });

    it("writes shininess → specularPower assignment", () => {
        const mat = {
            diffuseColor: new SpyColor3(),
            specularColor: new SpyColor3(),
            specularPower: 50,
            ambientColor: new SpyColor3(),
        };

        applyPerMatToBabylonMat(mat, { r: 1, g: 1, b: 1 }, { diffuseMul: 1, specularMul: 1, shininess: 120, ambientMul: 1 });

        expect(mat.specularPower).toBe(120);
    });

    it("writes ambientMul → ambientColor.set with correct multiplier", () => {
        const mat = {
            diffuseColor: new SpyColor3(),
            specularColor: new SpyColor3(),
            specularPower: 50,
            ambientColor: new SpyColor3(),
        };

        applyPerMatToBabylonMat(mat, { r: 1, g: 1, b: 1 }, { diffuseMul: 1, specularMul: 1, shininess: 50, ambientMul: 2 });

        expect(mat.ambientColor.set).toHaveBeenCalledWith(0.6, 0.6, 0.6);
    });

    it("write-through is idempotent", () => {
        const mat = {
            diffuseColor: new SpyColor3(),
            specularColor: new SpyColor3(),
            specularPower: 50,
            ambientColor: new SpyColor3(),
        };
        const orig = { r: 1, g: 1, b: 1 };

        applyPerMatToBabylonMat(mat, orig, { diffuseMul: 0.5, specularMul: 1, shininess: 50, ambientMul: 1 });
        applyPerMatToBabylonMat(mat, orig, { diffuseMul: 0.5, specularMul: 1, shininess: 50, ambientMul: 1 });

        expect(mat.diffuseColor.set).toHaveBeenCalledTimes(2);
        expect(mat.diffuseColor.r).toBeCloseTo(0.5);
    });
});
