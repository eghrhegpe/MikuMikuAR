// [doc:mock-strategy] 集中式 Babylon.js mock — 覆盖常用子模块路径
//
// 注册到 vitest.config.ts setupFiles 后，所有测试自动获得 Babylon 子模块 mock，
// 无需每个测试文件手动 vi.mock() 常用类。
//
// 注意：vi.mock 按模块路径匹配，子模块路径（如 @babylonjs/core/Maths/math.vector）
// 与 barrel（@babylonjs/core）是独立入口，需各自 mock。
//
// 测试文件仍可针对特定子模块自行 vi.mock() 覆盖，本地 mock 优先级高于 setup。

import { vi } from 'vitest';
import {
    MockScene,
    MockEngine,
    MockNode,
    MockLight,
    MockHemisphericLight,
    MockDirectionalLight,
    MockCamera,
    MockArcRotateCamera,
    MockColor3,
    MockColor4,
    MockVector3,
    MockQuaternion,
    MockMatrix,
    MockMaterial,
    MockStandardMaterial,
    MockAbstractMesh,
    MockMesh,
    MockBaseTexture,
    MockTexture,
    MockCubeTexture,
    MockShadowGenerator,
    MockPostProcess,
    MockDefaultRenderingPipeline,
    MockGPUParticleSystem,
    MockParticleSystem,
    MockGridMaterial,
} from './babylon-classes';

// ── Core barrel ──────────────────────────────────────
vi.mock('@babylonjs/core', () => ({
    Scene: MockScene,
    Engine: MockEngine,
    Node: MockNode,
    Light: MockLight,
    HemisphericLight: MockHemisphericLight,
    DirectionalLight: MockDirectionalLight,
    Camera: MockCamera,
    ArcRotateCamera: MockArcRotateCamera,
    FreeCamera: MockCamera,
    UniversalCamera: MockCamera,
    Color3: MockColor3,
    Color4: MockColor4,
    Vector3: MockVector3,
    Quaternion: MockQuaternion,
    Matrix: MockMatrix,
    Material: MockMaterial,
    StandardMaterial: MockStandardMaterial,
    PBRMaterial: MockMaterial,
    AbstractMesh: MockAbstractMesh,
    Mesh: MockMesh,
    MeshBuilder: { CreateGround: vi.fn(), CreateBox: vi.fn(), CreateSphere: vi.fn(), CreateCylinder: vi.fn() },
    BaseTexture: MockBaseTexture,
    Texture: MockTexture,
    CubeTexture: MockCubeTexture,
    MirrorTexture: MockTexture,
    RenderTargetTexture: MockTexture,
    ShadowGenerator: MockShadowGenerator,
    PostProcess: MockPostProcess,
    DefaultRenderingPipeline: MockDefaultRenderingPipeline,
    GPUParticleSystem: MockGPUParticleSystem,
    ParticleSystem: MockParticleSystem,
    GridMaterial: MockGridMaterial,
    Plane: class { normalize() {} },
    Viewport: class { toJSON() { return {} } },
    Surface: class { },
    Animation: class { },
    Animatable: class { },
    Logger: { Log: vi.fn(), Warn: vi.fn(), Error: vi.fn() },
    Observable: class {
        add() { return vi.fn() }
        remove() {}
        clear() {}
        notifyObservers() {}
    },
    SceneOptimizer: class { static OptimizeAsync = vi.fn() },
    SceneOptimizerOptions: class { static ModerateDegradationAllowed = vi.fn() },
    PerformanceConfigurator: class { static SetCollections = vi.fn() },
    Color3Gradient: class { },
    ColorGradient: class { },
    FactorGradient: class { },
    Tools: class { static RandomId = vi.fn() },
    // 默认导出 — 部分模块通过 export default 导出
    default: { Scene: MockScene, Engine: MockEngine },
}));

// ── Sub-module paths ─────────────────────────────────

// Scene
vi.mock('@babylonjs/core/scene', () => ({ Scene: MockScene }));

// Engine
vi.mock('@babylonjs/core/Engines/engine', () => ({ Engine: MockEngine }));

// Cameras
vi.mock('@babylonjs/core/Cameras/camera', () => ({ Camera: MockCamera }));
vi.mock('@babylonjs/core/Cameras/arcRotateCamera', () => ({ ArcRotateCamera: MockArcRotateCamera }));
vi.mock('@babylonjs/core/Cameras/freeCamera', () => ({ FreeCamera: MockCamera }));
vi.mock('@babylonjs/core/Cameras/universalCamera', () => ({ UniversalCamera: MockCamera }));

// Math
vi.mock('@babylonjs/core/Maths/math.vector', () => ({
    Vector3: MockVector3,
    Quaternion: MockQuaternion,
    Matrix: MockMatrix,
}));
vi.mock('@babylonjs/core/Maths/math.color', () => ({ Color3: MockColor3, Color4: MockColor4 }));

// Lights
vi.mock('@babylonjs/core/Lights/light', () => ({ Light: MockLight }));
vi.mock('@babylonjs/core/Lights/hemisphericLight', () => ({ HemisphericLight: MockHemisphericLight }));
vi.mock('@babylonjs/core/Lights/directionalLight', () => ({ DirectionalLight: MockDirectionalLight }));
vi.mock('@babylonjs/core/Lights/shadowLight', () => ({ ShadowLight: MockLight }));

// Meshes
vi.mock('@babylonjs/core/Meshes/abstractMesh', () => ({ AbstractMesh: MockAbstractMesh }));
vi.mock('@babylonjs/core/Meshes/mesh', () => ({ Mesh: MockMesh }));
vi.mock('@babylonjs/core/Meshes/meshBuilder', () => ({ MeshBuilder: { CreateGround: vi.fn(), CreateBox: vi.fn(), CreateSphere: vi.fn(), CreateCylinder: vi.fn() } }));

// Materials
vi.mock('@babylonjs/core/Materials/material', () => ({ Material: MockMaterial }));
vi.mock('@babylonjs/core/Materials/standardMaterial', () => ({ StandardMaterial: MockStandardMaterial }));
vi.mock('@babylonjs/core/Materials/PBR/pbrMaterial', () => ({ PBRMaterial: MockMaterial }));

// Textures
vi.mock('@babylonjs/core/Materials/Textures/baseTexture', () => ({ BaseTexture: MockBaseTexture }));
vi.mock('@babylonjs/core/Materials/Textures/texture', () => ({ Texture: MockTexture }));
vi.mock('@babylonjs/core/Materials/Textures/cubeTexture', () => ({ CubeTexture: MockCubeTexture }));
vi.mock('@babylonjs/core/Materials/Textures/mirrorTexture', () => ({ MirrorTexture: MockTexture }));
vi.mock('@babylonjs/core/Materials/Textures/renderTargetTexture', () => ({ RenderTargetTexture: MockTexture }));

// Post-processes
vi.mock('@babylonjs/core/PostProcesses/postProcess', () => ({ PostProcess: MockPostProcess }));
vi.mock('@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline', () => ({ DefaultRenderingPipeline: MockDefaultRenderingPipeline }));

// Particles
vi.mock('@babylonjs/core/Particles/gpuParticleSystem', () => ({ GPUParticleSystem: MockGPUParticleSystem }));
vi.mock('@babylonjs/core/Particles/particleSystem', () => ({ ParticleSystem: MockParticleSystem }));

// Misc
vi.mock('@babylonjs/core/Misc/observable', () => ({
    Observable: class {
        add() { return vi.fn() }
        remove() {}
        clear() {}
        notifyObservers() {}
    },
}));