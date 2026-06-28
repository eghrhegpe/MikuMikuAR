import { describe, it, expect, beforeEach, vi } from "vitest";
import {
    modelRegistry, dom, setMmdRuntime,
} from "../core/config";

vi.mock("@babylonjs/core/Engines/engine", () => ({
    Engine: class MockEngine {
        _features = { trackUbosInFrame: false, doNotHandleContextLost: true };
        _renderLoops: Array<() => void> = [];
        _renderPassIdCounter = 0;
        runRenderLoop() {}
        stopRenderLoop() {}
        getRenderWidth() { return 800; }
        getRenderHeight() { return 600; }
        resize() {}
        clear() {}
        getClassName() { return "Engine"; }
        setHardwareScalingLevel() {}
        getHardwareScalingLevel() { return 1; }
        createRenderPassId() { return 0; }
        releaseRenderPassId() {}
    },
}));

vi.mock("@babylonjs/core/scene", () => ({
    Scene: class MockScene {
        _uniqueIdCounter = 0;
        clearColor = { r: 0, g: 0, b: 0, a: 1 };
        _engine: any;
        constructor(engine: any) { this._engine = engine; }
        getEngine() { return this._engine; }
        getClassName() { return "Scene"; }
        getUniqueId() { return this._uniqueIdCounter++; }
        registerBeforeRender() {}
        unregisterBeforeRender() {}
        executeWhenReady() {}
        addCamera() {}
        removeCamera() {}
        activeCamera = null;
        meshes: any[] = [];
        getLightByName() { return null; }
        getMeshByName() { return null; }
        onBeforeRenderObservable = { add() { return {}; }, remove() {} };
        onDisposeObservable = { add() { return {}; } };
        animationPropertiesOverride = null;
        metadata = null;
        _pickWithRayInverseMatrix = null;
        _transformMatrix = null;
        _viewMatrix = null;
        _projectionMatrix = null;
        _shadowsGenerator = {};
        renderEnabled = true;
        autoClear = true;
        _activeMeshes = { _length: 0 };
        _activeMeshesFrozen = false;
        _activeParticleSystems: any[] = [];
        _activeSkeletons: any[] = [];
        _activeAnimatables: any[] = [];
    },
}));

vi.mock("@babylonjs/core/Lights/hemisphericLight", () => ({
    HemisphericLight: class MockHemisphericLight {
        intensity = 0; diffuse: any = null; groundColor: any = null;
        _scene: any;
        constructor() {}
        getClassName() { return "HemisphericLight"; }
    },
}));

vi.mock("@babylonjs/core/Lights/directionalLight", () => ({
    DirectionalLight: class MockDirectionalLight {
        intensity = 0; diffuse: any = null;
        _scene: any;
        constructor() {}
        getClassName() { return "DirectionalLight"; }
    },
}));

vi.mock("@babylonjs/core/Physics/v2/physicsEngineComponent", () => ({}));

vi.mock("@babylonjs/core/Cameras/arcRotateCamera", () => ({
    ArcRotateCamera: class MockArcRotateCamera {
        alpha = 0; beta = 0; radius = 0;
        lowerRadiusLimit = 0; upperRadiusLimit = 0;
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
        r = 0; g = 0; b = 0;
        constructor(r = 0, g = 0, b = 0) { this.r = r; this.g = g; this.b = b; }
        set(r: number, g: number, b: number) { this.r = r; this.g = g; this.b = b; }
        clone() { return new MockColor3(this.r, this.g, this.b); }
        toArray() { return [this.r, this.g, this.b]; }
    },
    Color4: class MockColor4 {
        r = 0; g = 0; b = 0; a = 1;
        constructor(r = 0, g = 0, b = 0, a = 1) { this.r = r; this.g = g; this.b = b; this.a = a; }
        clone() { return new MockColor4(this.r, this.g, this.b, this.a); }
    },
}));

vi.mock("@babylonjs/core/Maths/math.vector", () => ({
    Vector3: class MockVector3 {
        x = 0; y = 0; z = 0;
        constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
        clone() { return new MockVector3(this.x, this.y, this.z); }
    },
    Matrix: class MockMatrix {
        m = new Float32Array(16);
        constructor() { this.m.fill(0); }
        getClassName() { return "Matrix"; }
        static Identity() { return new MockMatrix(); }
    },
    TmpVectors: { Vector3: [] },
}));

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

vi.mock("@babylonjs/core/Lights/Shadows/shadowGenerator", () => ({
    ShadowGenerator: class MockShadowGenerator {
        constructor() {}
        getClassName() { return "ShadowGenerator"; }
        addShadowCaster() {}
        getShadowMap() { return null; }
    },
}));

vi.mock("@babylonjs/core/Loading/sceneLoader", () => ({
    ImportMeshAsync: async () => ({ meshes: [] }),
}));

vi.mock("@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline", () => ({
    DefaultRenderingPipeline: class MockPipeline {
        constructor() {}
        getClassName() { return "DefaultRenderingPipeline"; }
    },
}));

vi.mock("@babylonjs/core/Particles/gpuParticleSystem", () => ({
    GPUParticleSystem: class MockGPUParticleSystem {
        constructor() {}
        getClassName() { return "GPUParticleSystem"; }
    },
}));

vi.mock("@babylonjs/core/Particles/particleSystem", () => ({
    ParticleSystem: class MockParticleSystem {
        constructor() {}
        getClassName() { return "ParticleSystem"; }
    },
}));

vi.mock("@babylonjs/core/Particles/webgl2ParticleSystem", () => ({}));

vi.mock("@babylonjs/materials/grid/gridMaterial", () => ({
    GridMaterial: class MockGridMaterial {
        constructor() {}
        getClassName() { return "GridMaterial"; }
    },
}));

vi.mock("@babylonjs/core/Materials/Textures/baseTexture", () => ({
    BaseTexture: class MockBaseTexture {
        constructor() {}
        getClassName() { return "BaseTexture"; }
    },
}));

vi.mock("@babylonjs/core/Materials/Textures/texture", () => ({
    Texture: class MockTexture {
        url = "";
        name = "";
        constructor(url: string) { this.url = url; this.name = url; }
        getClassName() { return "Texture"; }
    },
}));

vi.mock("@babylonjs/core/Materials/Textures/cubeTexture", () => ({
    CubeTexture: class MockCubeTexture {
        constructor() {}
        getClassName() { return "CubeTexture"; }
    },
}));

vi.mock("babylon-mmd/esm/Runtime/mmdStandardMaterialProxy", () => ({
    MmdStandardMaterialProxy: class Mock {},
}));

vi.mock("babylon-mmd/esm/Runtime/mmdRuntimeShared", () => ({
    MmdRuntimeShared: class Mock {},
}));

vi.mock("babylon-mmd/esm/Loader/mmdModelLoader.default", () => ({}));

vi.mock("babylon-mmd/esm/Loader/Shaders/textureAlphaChecker.vertex", () => ({}));
vi.mock("babylon-mmd/esm/Loader/Shaders/textureAlphaChecker.fragment", () => ({}));

vi.mock("../scene-menu", () => ({
    getSceneStack: () => null,
}));

vi.mock("../outfit", () => ({
    loadOutfits: async () => null,
    applyOutfitVariant: () => {},
    resetOutfit: () => {},
}));

vi.mock("../lipsync", () => ({
    LipSyncState: {},
    DEFAULT_LIPSYNC_STATE: { mode: "off", intensity: 0.5, phonemeMap: {} },
    findLipMorph: () => null,
    amplitudeToWeight: () => 0,
}));

vi.mock("../procedural-motion", () => ({
    ProcMotionState: {},
    ProcMotionMode: {},
    DEFAULT_PROC_STATE: { mode: "off", intensity: 0.5, speed: 1, autoSwitch: false },
    generateIdleVmd: () => new ArrayBuffer(100),
    generateAutoDanceVmd: () => new ArrayBuffer(100),
    shouldAutoDance: () => false,
    shouldIdle: () => false,
}));

vi.mock("../beat-detector", () => ({
    BeatDetector: class MockBeatDetector {
        detectBeatsFromEnergies() { return []; }
        bpmFromIntervals() { return 120; }
        reset() {}
        getBPM() { return 120; }
        getBeatPhase() { return 0; }
    },
}));

vi.mock("../audio", () => ({
    syncAudioPlayback: () => {},
    loadAudioFile: async () => {},
    setVolume: () => {},
    setAudioOffset: () => {},
    getAudioPath: () => "",
    getAudioName: () => "",
    getVolume: () => 1,
    getAudioOffset: () => 0,
    isAudioPlaying: () => false,
    resumeAudio: () => {},
    pauseAudio: () => {},
    attachBeatDetector: () => {},
    loadAndPlayAudio: async () => {},
    stopAudio: () => {},
    clearAudio: () => {},
}));

// Mock babylon-mmd side-effect imports
vi.mock("babylon-mmd/esm/Loader/dynamic", () => ({ RegisterMmdModelLoaders: () => {} }));
vi.mock("babylon-mmd/esm/Loader/registerDxBmpTextureLoader", () => ({ RegisterDxBmpTextureLoader: () => {} }));
vi.mock("babylon-mmd/esm/Runtime/Optimized/mmdWasmInstance", () => ({ GetMmdWasmInstance: async () => null }));
vi.mock("babylon-mmd/esm/Runtime/Optimized/InstanceType/singlePhysicsRelease", () => ({}));
vi.mock("babylon-mmd/esm/Loader/vmdLoader", () => ({ VmdLoader: class MockVmdLoader {} }));
vi.mock("babylon-mmd/esm/Runtime/Optimized/Animation/mmdWasmAnimation", () => ({ MmdWasmAnimation: class MockMmdWasmAnimation {} }));
vi.mock("babylon-mmd/esm/Runtime/Optimized/Animation/mmdWasmRuntimeModelAnimation", () => ({}));
vi.mock("babylon-mmd/esm/Runtime/mmdRuntimeShared", () => ({ MmdRuntimeShared: class MockMmdRuntimeShared {} }));
vi.mock("babylon-mmd/esm/Loader/mmdModelLoader.default", () => ({}));
vi.mock("@babylonjs/core/Materials/Textures/Loaders/tgaTextureLoader", () => ({}));
vi.mock("@babylonjs/core/Materials/Textures/Loaders/hdrTextureLoader", () => ({}));
vi.mock("@babylonjs/core/Materials/Textures/Loaders/exrTextureLoader", () => ({}));
vi.mock("babylon-mmd/esm/Loader/Shaders/textureAlphaChecker.vertex", () => ({}));
vi.mock("babylon-mmd/esm/Loader/Shaders/textureAlphaChecker.fragment", () => ({}));

import {
    buildModelDetailLevel,
    buildModelInfoLevel,
    buildTransformLevel,
    buildVisibilityLevel,
    buildModelTagsLevel,
    buildMorphPreviewLevel,
} from "../model-detail";
import type { PopupLevel } from "../core/config";

function fakeMesh(name = "mat0"): any {
    return {
        name,
        position: { x: 0, y: 0, z: 0, set() {} },
        scaling: { setAll() {} },
        rotation: { y: 0 },
        setEnabled() {},
        getTotalVertices() { return 1000; },
        getTotalIndices() { return 3000; },
        material: {
            name,
            alpha: 1,
            diffuseColor: { r: 1, g: 1, b: 1, clone() { return { ...this }; } },
            specularColor: { r: 0.8, g: 0.8, b: 0.8, clone() { return { ...this }; } },
            specularPower: 50,
            ambientColor: { r: 0.3, g: 0.3, b: 0.3, clone() { return { ...this }; } },
        },
    };
}

function createModel(id: string, overrides?: Partial<any>): string {
    const defaults = {
        id,
        name: "test-model",
        filePath: "D:/models/test.pmx",
        port: 1234,
        modelDir: "D:/models",
        meshes: [fakeMesh("mat0")],
        rootMesh: fakeMesh("root"),
        vmdData: null,
        vmdName: "",
        vmdPath: null,
        animationDuration: 0,
        kind: "actor" as const,
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
}

function getLevelLabel(level: PopupLevel): string { return level.label; }

function hasRenderCustom(level: PopupLevel): boolean {
    return typeof level.renderCustom === "function";
}

beforeEach(() => cleanup());

// ======== buildModelDetailLevel ========

describe("buildModelDetailLevel", () => {
    it("returns correct label for existing model", () => {
        createModel("m1", { name: "初音ミク" });
        const level = buildModelDetailLevel("m1");
        expect(level.label).toBe("初音ミク");
        expect(level.dir).toBe("");
        expect(Array.isArray(level.items)).toBe(true);
        expect(hasRenderCustom(level)).toBe(true);
    });

    it("returns fallback label for non-existent model", () => {
        const level = buildModelDetailLevel("nonexistent");
        expect(level.label).toBe("未知模型");
    });

    it("renderCustom creates DOM structure with card elements", () => {
        createModel("m1");
        const level = buildModelDetailLevel("m1");
        const container = document.createElement("div");
        level.renderCustom!(container);

        const lcards = container.querySelectorAll(".lcard");
        expect(lcards.length).toBeGreaterThanOrEqual(4);

        const slideItems = container.querySelectorAll(".slide-item");
        expect(slideItems.length).toBeGreaterThan(0);
    });

    it("cards contain expected action labels", () => {
        createModel("m1");
        const level = buildModelDetailLevel("m1");
        const container = document.createElement("div");
        level.renderCustom!(container);

        const labels = Array.from(container.querySelectorAll(".slide-label")).map(el => el.textContent);
        expect(labels).toContain("模型信息");
        expect(labels).toContain("变换");
        expect(labels).toContain("可见性");
        expect(labels).toContain("材质调节");
        expect(labels).toContain("表情预览");
        expect(labels).toContain("聚焦");
        expect(labels).toContain("移除");
        expect(labels).toContain("保存预设");
        expect(labels).toContain("加载预设");
        expect(labels).toContain("服装变体");
        expect(labels).toContain("用…打开");
    });
});

// ======== buildModelInfoLevel ========

describe("buildModelInfoLevel", () => {
    it("returns valid PopupLevel for existing model", () => {
        createModel("m1", { name: "test" });
        const level = buildModelInfoLevel("m1");
        expect(level.label).toBe("模型信息");
        expect(hasRenderCustom(level)).toBe(true);
    });

    it("returns fallback for non-existent model", () => {
        const level = buildModelInfoLevel("nonexistent");
        expect(level.label).toBe("模型信息");
    });

    it("renderCustom renders info fields", () => {
        const inst = createModel("m1", { mmdModel: { runtimeBones: Array(20), morph: { morphs: Array(10) } } });
        const level = buildModelInfoLevel("m1");
        const container = document.createElement("div");
        level.renderCustom!(container);
        const labels = Array.from(container.querySelectorAll(".slide-label")).map(el => el.textContent);
        expect(labels.some(l => l && l.includes("1,000"))).toBe(true);
        expect(labels.some(l => l && l.includes("20"))).toBe(true);
        expect(labels.some(l => l && l.includes("10"))).toBe(true);
    });
});

// ======== buildTransformLevel ========

describe("buildTransformLevel", () => {
    it("returns valid PopupLevel", () => {
        createModel("m1");
        const level = buildTransformLevel("m1");
        expect(level.label).toBe("变换");
        expect(hasRenderCustom(level)).toBe(true);
    });

    it("renderCustom does not throw", () => {
        createModel("m1");
        const level = buildTransformLevel("m1");
        const container = document.createElement("div");
        expect(() => level.renderCustom!(container)).not.toThrow();
    });
});

// ======== buildVisibilityLevel ========

describe("buildVisibilityLevel", () => {
    it("returns valid PopupLevel", () => {
        createModel("m1");
        const level = buildVisibilityLevel("m1");
        expect(level.label).toBe("可见性");
        expect(hasRenderCustom(level)).toBe(true);
    });

    it("renderCustom does not throw", () => {
        createModel("m1");
        const level = buildVisibilityLevel("m1");
        const container = document.createElement("div");
        expect(() => level.renderCustom!(container)).not.toThrow();
    });
});

// ======== buildModelTagsLevel ========

describe("buildModelTagsLevel", () => {
    it("returns valid PopupLevel", () => {
        createModel("m1");
        const level = buildModelTagsLevel("m1");
        expect(level.label).toBe("模型标签");
        expect(hasRenderCustom(level)).toBe(true);
        expect(level.items).toEqual([]);
    });

    it("returns fallback for non-existent model", () => {
        const level = buildModelTagsLevel("nonexistent");
        expect(level.label).toBe("标签");
    });
});

// ======== buildMorphPreviewLevel ========

describe("buildMorphPreviewLevel", () => {
    it("returns valid PopupLevel", () => {
        createModel("m1");
        const level = buildMorphPreviewLevel("m1");
        expect(level.label).toBe("表情预览");
        expect(hasRenderCustom(level)).toBe(true);
    });

    it("renderCustom does not throw", () => {
        createModel("m1");
        const level = buildMorphPreviewLevel("m1");
        const container = document.createElement("div");
        expect(() => level.renderCustom!(container)).not.toThrow();
    });

    it("renderCustom shows empty state for model with no morphs", () => {
        createModel("m1");
        const level = buildMorphPreviewLevel("m1");
        const container = document.createElement("div");
        level.renderCustom!(container);
        const morphList = container.querySelector(".morph-list");
        expect(morphList).toBeTruthy();
    });
});
