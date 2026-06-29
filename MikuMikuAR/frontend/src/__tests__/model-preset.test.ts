// Set up minimal DOM so config.ts's `dom` object gets valid element references
vi.hoisted(() => {
    const ids = [
        "renderCanvas", "statusBar", "loading", "btnMainAction",
        "btnMotionPopup",
        "playbackBar", "btnPlayPause", "btnLoopToggle",
        "timeDisplay", "seekBar", "seekProgress", "loadingText",
        "btnSettings",
        "btnScene", "sceneOverlay",
    ];
    for (const id of ids) {
        const el = document.createElement("div");
        el.id = id;
        document.body.appendChild(el);
    }
});

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

import { describe, it, expect, beforeEach, afterEach, vi, beforeAll } from "vitest";
import {
    serializeModelPreset,
    applyModelPreset,
    ModelPresetFile,
} from "../menus/library";
import {
    stopVMD,
    getMatState,
    applyMatState,
    _catState,
    _matState,
    _matEnabled,
} from "../scene/scene";
import * as sceneModule from "../scene/scene";
import { modelRegistry, dom, setMmdRuntime, setIsPlaying, isPlaying, mmdRuntime } from "../core/config";
import { updatePlaybackUI } from "../scene/scene-playback";

// ======== Test setup ========

function cloneColor(c: any) { return { ...c, clone() { return cloneColor(this); } }; }

const BASE_MAT_COLOR = { r: 1, g: 1, b: 1, set() {}, clone() { return cloneColor(this); } };

/** Create a fake mesh with the minimal interface needed by scene.ts operations. */
function fakeMesh(name = "mesh0"): any {
    return {
        name,
        position: { x: 0, y: 0, z: 0, set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; } },
        scaling: { setAll(v: number) { /* noop */ } },
        rotation: { y: 0 },
        setEnabled(_v: boolean) { /* noop */ },
        material: {
            name,
            alpha: 1,
            diffuseColor: { ...BASE_MAT_COLOR, clone() { return { ...this }; } },
            specularColor: { ...BASE_MAT_COLOR, clone() { return { ...this }; } },
            specularPower: 50,
            ambientColor: { ...BASE_MAT_COLOR, clone() { return { ...this }; } },
        },
    };
}

/** Create N fake meshes, each with material name `mat{idx}`. */
function fakeMeshes(count: number): any[] {
    return Array.from({ length: count }, (_, i) => {
        const m = fakeMesh(`mat${i}`);
        return m;
    });
}

/** Create a fake ModelInstance, register it in modelRegistry, and return the id. */
function createModel(id: string, meshCount = 1, overrides?: Partial<any>): string {
    const defaults = {
        id,
        name: "test-model",
        filePath: "D:/models/test.pmx",
        port: 1234,
        modelDir: "D:/models",
        meshes: fakeMeshes(meshCount),
        rootMesh: fakeMeshes(1)[0],
        vmdData: null,
        vmdName: "",
        vmdPath: null,
        animationDuration: 0,
        kind: "actor",
        visible: true,
        opacity: 1,
        wireframe: false,
        showBones: false,
        physicsEnabled: true,
        scaling: 1,
        rotationY: 0,
    };
    modelRegistry.set(id, { ...defaults, ...overrides } as any);
    return id;
}

function cleanup(): void {
    modelRegistry.clear();
    _catState.clear();
    _matState.clear(); _matEnabled.clear();
    setMmdRuntime(null);
    setIsPlaying(false);
}

function applySpies(): void {
    vi.restoreAllMocks();
    vi.spyOn(sceneModule, "setModelPosition").mockImplementation((id, x, y, z) => {
        const inst = modelRegistry.get(id);
        if (!inst) return;
        if (inst.rootMesh?.position?.set) inst.rootMesh.position.set(x, y, z);
        const mesh = inst.meshes?.[0];
        if (mesh?.position?.set) mesh.position.set(x, y, z);
    });
    vi.spyOn(sceneModule, "setModelScaling").mockImplementation((id, scaling) => {
        const inst = modelRegistry.get(id);
        if (inst) inst.scaling = scaling;
    });
    vi.spyOn(sceneModule, "setModelRotationY").mockImplementation((id, rotationY) => {
        const inst = modelRegistry.get(id);
        if (inst) inst.rotationY = rotationY;
    });
    vi.spyOn(sceneModule, "setModelVisibility").mockImplementation((id, visible) => {
        const inst = modelRegistry.get(id);
        if (inst) inst.visible = visible;
    });
    vi.spyOn(sceneModule, "setModelOpacity").mockImplementation((id, opacity) => {
        const inst = modelRegistry.get(id);
        if (inst) inst.opacity = opacity;
    });
    vi.spyOn(sceneModule, "setModelWireframe").mockImplementation((id, wireframe) => {
        const inst = modelRegistry.get(id);
        if (inst) inst.wireframe = wireframe;
    });
    vi.spyOn(sceneModule, "stopVMD").mockImplementation((id) => {
        const inst = modelRegistry.get(id);
        if (!inst) return;
        if (inst.mmdModel && mmdRuntime) {
            inst.mmdModel.setRuntimeAnimation(null);
        }
        inst.vmdData = null;
        inst.vmdName = "";
        inst.vmdPath = null;
        inst.animationDuration = 0;
        if (isPlaying) {
            mmdRuntime?.pauseAnimation();
            setIsPlaying(false);
        }
        updatePlaybackUI();
    });
}

beforeEach(() => {
    cleanup();
    applySpies();
});

beforeAll(() => {
    dom.statusBar = document.createElement("div") as HTMLDivElement;
    dom.playbackBar = document.createElement("div") as HTMLDivElement;
    dom.btnPlayPause = document.createElement("button") as HTMLButtonElement;
    dom.btnLoopToggle = document.createElement("button") as HTMLButtonElement;
    dom.timeDisplay = document.createElement("span") as HTMLSpanElement;
    dom.seekProgress = document.createElement("div") as HTMLDivElement;
});

// ======== serializeModelPreset — basic shape ========

describe("serializeModelPreset", () => {
    it("serializes a full model into valid JSON with all fields", () => {
        createModel("m1", 1, {
            filePath: "D:/models/miku.pmx",
            name: "初音ミク",
            kind: "actor",
            scaling: 1.2,
            rotationY: 0.5,
            visible: true,
            opacity: 1,
            wireframe: false,
            vmdPath: "D:/motions/dance.vmd",
            vmdName: "ダンス",
        });
        // Set rootMesh position
        const inst = modelRegistry.get("m1")!;
        inst.rootMesh.position.x = 1.5;
        inst.rootMesh.position.y = 0;
        inst.rootMesh.position.z = -2;

        const json = serializeModelPreset("m1");
        const parsed = JSON.parse(json);

        expect(parsed.version).toBe(1);
        expect(parsed.model.filePath).toBe("D:/models/miku.pmx");
        expect(parsed.model.name).toBe("初音ミク");
        expect(parsed.model.kind).toBe("actor");
        expect(parsed.transform.positionX).toBe(1.5);
        expect(parsed.transform.positionY).toBe(0);
        expect(parsed.transform.positionZ).toBe(-2);
        expect(parsed.transform.scaling).toBe(1.2);
        expect(parsed.transform.rotationY).toBe(0.5);
        expect(parsed.visibility.visible).toBe(true);
        expect(parsed.visibility.opacity).toBe(1);
        expect(parsed.visibility.wireframe).toBe(false);
        expect(parsed.vmd.name).toBe("ダンス");
        expect(parsed.vmd.path).toBe("D:/motions/dance.vmd");
        expect(parsed.audio).toBeUndefined();
    });

    it("returns empty string for non-existent model", () => {
        expect(serializeModelPreset("nonexistent")).toBe("");
    });

    it("defaults position to 0 when rootMesh is null", () => {
        createModel("m1", 1, { rootMesh: null });
        const json = serializeModelPreset("m1");
        const parsed = JSON.parse(json);
        expect(parsed.transform.positionX).toBe(0);
        expect(parsed.transform.positionY).toBe(0);
        expect(parsed.transform.positionZ).toBe(0);
    });

    it("returns null vmd path and name when no VMD loaded", () => {
        createModel("m1", 1, { vmdPath: null, vmdName: "" });
        const json = serializeModelPreset("m1");
        const parsed = JSON.parse(json);
        expect(parsed.vmd.path).toBeNull();
        expect(parsed.vmd.name).toBe("");
    });

    it("includes material state when categories/overrides are set", () => {
        createModel("m1", 4);
        applyMatState("m1", {
            categories: {
                "皮肤": { diffuseMul: 1.2, specularMul: 0.8, shininess: 30, ambientMul: 1 },
            },
            overrides: {
                3: { diffuseMul: 1.5, specularMul: 0.5, shininess: 10, ambientMul: 1.2 },
            },
        });

        const json = serializeModelPreset("m1");
        const parsed = JSON.parse(json);

        expect(parsed.materialCategories["皮肤"].diffuseMul).toBe(1.2);
        expect(parsed.materialOverrides["3"].shininess).toBe(10);
    });

    it("preserves numeric precision for transform values", () => {
        createModel("m1");
        const inst = modelRegistry.get("m1")!;
        inst.rootMesh.position.x = 0.123456789;
        inst.rootMesh.position.y = -3.14;
        inst.rootMesh.position.z = 42;
        inst.scaling = 0.75;
        inst.rotationY = 1.570796;

        const json = serializeModelPreset("m1");
        const parsed = JSON.parse(json);

        expect(parsed.transform.positionX).toBeCloseTo(0.123456789, 5);
        expect(parsed.transform.positionY).toBe(-3.14);
        expect(parsed.transform.scaling).toBe(0.75);
        expect(parsed.transform.rotationY).toBeCloseTo(1.570796, 5);
    });
});

// ======== applyModelPreset — transform application ========

describe("applyModelPreset", () => {
    it("applies transform values (position, scaling, rotationY) to model instance", async () => {
        createModel("m1");
        const preset: ModelPresetFile = {
            version: 1,
            model: { filePath: "D:/miku.pmx", name: "miku", kind: "actor" },
            transform: { positionX: 2, positionY: 1, positionZ: -3, scaling: 1.5, rotationY: 1.57 },
            visibility: {},
            vmd: { path: null, name: "" },
        };

        await applyModelPreset("m1", JSON.stringify(preset));

        const inst = modelRegistry.get("m1")!;
        expect(inst.meshes[0].position.x).toBe(2);
        expect(inst.meshes[0].position.y).toBe(1);
        expect(inst.meshes[0].position.z).toBe(-3);
        expect(inst.scaling).toBe(1.5);
        expect(inst.rotationY).toBe(1.57);
    });

    it("applies visibility settings", async () => {
        createModel("m1");
        const preset: ModelPresetFile = {
            version: 1,
            model: { filePath: "D:/miku.pmx", name: "miku", kind: "actor" },
            transform: {},
            visibility: { visible: false, opacity: 0.5, wireframe: true },
            vmd: { path: null, name: "" },
        };

        await applyModelPreset("m1", JSON.stringify(preset));

        const inst = modelRegistry.get("m1")!;
        expect(inst.visible).toBe(false);
        expect(inst.opacity).toBe(0.5);
        expect(inst.wireframe).toBe(true);
    });

    it("stops VMD and clears VMD state when preset has no VMD path", async () => {
        createModel("m1", 1, {
            vmdData: new ArrayBuffer(10),
            vmdName: "dance",
            vmdPath: "dance.vmd",
            animationDuration: 30,
        });

        const preset: ModelPresetFile = {
            version: 1,
            model: { filePath: "D:/miku.pmx", name: "miku", kind: "actor" },
            transform: {},
            visibility: {},
            vmd: { path: null, name: "" },
        };

        await applyModelPreset("m1", JSON.stringify(preset));

        const inst = modelRegistry.get("m1")!;
        expect(inst.vmdData).toBeNull();
        expect(inst.vmdName).toBe("");
        expect(inst.vmdPath).toBeNull();
        expect(inst.animationDuration).toBe(0);
    });

    it("applies material state (categories and overrides)", async () => {
        createModel("m1");
        const preset: ModelPresetFile = {
            version: 1,
            model: { filePath: "D:/miku.pmx", name: "miku", kind: "actor" },
            transform: {},
            visibility: {},
            vmd: { path: null, name: "" },
            materialCategories: {
                "皮肤": { diffuseMul: 0.8, specularMul: 1.2, shininess: 100, ambientMul: 0.9 },
            },
            materialOverrides: {
                0: { diffuseMul: 1.5, specularMul: 0.5, shininess: 10, ambientMul: 1.2 },
            },
        };

        await applyModelPreset("m1", JSON.stringify(preset));

        const state = getMatState("m1");
        expect(state).not.toBeNull();
        expect(state!.categories["皮肤"].shininess).toBe(100);
        expect(state!.overrides[0].diffuseMul).toBe(1.5);
    });

    it("handles model not in registry without throwing", async () => {
        const preset: ModelPresetFile = {
            version: 1,
            model: { filePath: "D:/miku.pmx", name: "miku", kind: "actor" },
            transform: {},
            visibility: {},
            vmd: { path: null, name: "" },
        };
        // No model registered — should call setStatus but not throw
        await expect(applyModelPreset("nonexistent", JSON.stringify(preset))).resolves.toBeUndefined();
    });
});

// ======== getMatState / applyMatState — real scene.ts functions ========

describe("getMatState / applyMatState", () => {
    it("returns null when no material adjustments have been made", () => {
        createModel("m1");
        expect(getMatState("m1")).toBeNull();
    });

    it("roundtrips material categories through getMatState after applyMatState", () => {
        createModel("m1");
        applyMatState("m1", {
            categories: {
                "皮肤": { diffuseMul: 1.2, specularMul: 0.8, shininess: 30, ambientMul: 1 },
                "头发": { diffuseMul: 1, specularMul: 1.5, shininess: 80, ambientMul: 0.9 },
            },
        });

        const state = getMatState("m1");
        expect(state).not.toBeNull();
        expect(state!.categories["皮肤"].diffuseMul).toBe(1.2);
        expect(state!.categories["头发"].specularMul).toBe(1.5);
    });

    it("roundtrips per-material overrides", () => {
        createModel("m1", 8);
        applyMatState("m1", {
            overrides: {
                3: { diffuseMul: 1.5, specularMul: 0.5, shininess: 10, ambientMul: 1.2 },
                7: { diffuseMul: 0.8, specularMul: 1.2, shininess: 100, ambientMul: 0.9 },
            },
        });

        const state = getMatState("m1");
        expect(state).not.toBeNull();
        expect(state!.overrides[3].shininess).toBe(10);
        expect(state!.overrides[7].diffuseMul).toBe(0.8);
    });

    it("empty state makes no changes", () => {
        createModel("m1");
        applyMatState("m1", {});
        expect(getMatState("m1")).toBeNull();
    });

    it("applies state with string-keyed overrides (Object.entries cast)", () => {
        createModel("m1", 4);
        // Simulate what JSON.parse produces: overrides as Record<string, T>
        const overrides: Record<string, { diffuseMul: number; specularMul: number; shininess: number; ambientMul: number }> = {
            "3": { diffuseMul: 1.5, specularMul: 0.5, shininess: 10, ambientMul: 1.2 },
        };
        applyMatState("m1", { overrides: overrides as any });

        const state = getMatState("m1");
        expect(state!.overrides[3].diffuseMul).toBe(1.5);
    });
});

// ======== stopVMD — real scene.ts function ========

describe("stopVMD", () => {
    it("clears all VMD state fields on the instance", () => {
        createModel("m1", 1, {
            vmdData: new ArrayBuffer(10),
            vmdName: "dance",
            vmdPath: "dance.vmd",
            animationDuration: 30,
        });

        stopVMD("m1");

        const inst = modelRegistry.get("m1")!;
        expect(inst.vmdData).toBeNull();
        expect(inst.vmdName).toBe("");
        expect(inst.vmdPath).toBeNull();
        expect(inst.animationDuration).toBe(0);
    });

    it("calls mmdModel.setRuntimeAnimation when model has mmdModel", () => {
        const setRuntimeAnim = vi.fn();

        createModel("m1", 1, {
            mmdModel: { setRuntimeAnimation: setRuntimeAnim },
        });
        setMmdRuntime({ pauseAnimation: vi.fn() } as any);

        stopVMD("m1");

        expect(setRuntimeAnim).toHaveBeenCalledWith(null);
    });

    it("pauses animation and sets isPlaying to false when was playing", () => {
        const pauseAnim = vi.fn();
        createModel("m1");
        setIsPlaying(true);
        setMmdRuntime({ stopAnimation: vi.fn(), pauseAnimation: pauseAnim } as any);

        stopVMD("m1");

        expect(pauseAnim).toHaveBeenCalled();
        expect(modelRegistry.get("m1")!.vmdData).toBeNull();
    });

    it("handles non-existent model without throwing", () => {
        expect(() => stopVMD("nonexistent")).not.toThrow();
    });
});
