// mocks/babylon-factories.ts — Babylon.js / babylon-mmd vi.mock 工厂（ADR-206 Phase 2）
// 单一规范源：所有 Babylon/BMD 相关的 vi.mock 工厂函数集中于此。
// 依赖 mocks/babylon-classes.ts（底层 Mock 类定义）+ mocks/babylon-mmd-mocks.ts（BMD Mock 类）。
//
// 约束：工厂必须「同步 + 静态 import Mock 类」，否则 vi.mock 的 hoist 会引用未初始化的导入绑定。
// 不可用 vi.importActual(...) 包裹（hoist 期触发 __vi_import_X__ not initialized）。

import {
    MockEngine,
    MockScene,
    MockNode,
    MockLight,
    MockHemisphericLight,
    MockDirectionalLight,
    MockArcRotateCamera,
    MockCamera,
    MockColor3,
    MockColor4,
    MockVector3,
    MockMatrix,
    MockQuaternion,
    MockStandardMaterial,
    MockMaterial,
    MockAbstractMesh,
    MockMesh,
    MockPostProcess,
    MockImportMeshAsync,
    MockDefaultRenderingPipeline,
    MockTexture,
} from './babylon-classes';
import {
    MockMmdCamera,
    MockRegisterMmdModelLoaders,
    MockRegisterDxBmpTextureLoader,
    MockGetMmdWasmInstance,
    MockMmdWasmRuntime,
    MockVmdLoader,
    MockMmdWasmAnimation,
    MockMmdStandardMaterialProxy,
    MockMmdRuntimeShared,
} from './babylon-mmd-mocks';

// ---- babylon.js core mocks ----
export const mockEngine = () => ({ Engine: MockEngine });
export const mockScene = () => ({ Scene: MockScene });
export const mockNode = () => ({ Node: MockNode });
export const mockLight = () => ({ Light: MockLight });
export const mockHemisphericLight = () => ({ HemisphericLight: MockHemisphericLight });
export const mockDirectionalLight = () => ({ DirectionalLight: MockDirectionalLight });
export const mockArcRotateCamera = () => ({ ArcRotateCamera: MockArcRotateCamera });
export const mockCamera = () => ({ Camera: MockCamera });
export const mockMathColor = () => ({
    Color3: MockColor3,
    Color4: MockColor4,
    TmpColors: { Color3: [] },
});
export const mockMathVector = () => ({
    Vector3: MockVector3,
    Matrix: MockMatrix,
    Quaternion: MockQuaternion,
    TmpVectors: { Vector3: [] },
});
export const mockStandardMaterial = () => ({ StandardMaterial: MockStandardMaterial });
export const mockMaterial = () => ({ Material: MockMaterial });
export const mockMesh = () => ({ AbstractMesh: MockAbstractMesh, Mesh: MockMesh });
export const mockTexture = () => ({ Texture: MockTexture });
export const mockPostProcess = () => ({ PostProcess: MockPostProcess });
export const mockSceneLoader = () => ({ ImportMeshAsync: MockImportMeshAsync });
export const mockDefaultRenderingPipeline = () => ({
    DefaultRenderingPipeline: MockDefaultRenderingPipeline,
});
export const mockPhysicsEngineComponent = () => ({});
export const mockTgaTextureLoader = () => ({});

// ---- babylon-mmd mocks ----
export const mockMmdCamera = () => ({ MmdCamera: MockMmdCamera });
export const mockMmdDynamic = () => ({ RegisterMmdModelLoaders: MockRegisterMmdModelLoaders });
export const mockDxBmpTextureLoader = () => ({
    RegisterDxBmpTextureLoader: MockRegisterDxBmpTextureLoader,
});
export const mockMmdWasmInstance = () => ({ GetMmdWasmInstance: MockGetMmdWasmInstance });
export const mockSinglePhysicsRelease = () => ({
    MmdWasmInstanceTypeSPR: class Mock {},
});
export const mockMmdWasmRuntime = () => ({ MmdWasmRuntime: MockMmdWasmRuntime });
export const mockVmdLoader = () => ({ VmdLoader: MockVmdLoader });
export const mockMmdWasmAnimation = () => ({ MmdWasmAnimation: MockMmdWasmAnimation });
export const mockMmdWasmRuntimeModelAnimation = () => ({});
export const mockMmdStandardMaterialProxy = () => ({
    MmdStandardMaterialProxy: MockMmdStandardMaterialProxy,
});
export const mockMmdRuntimeShared = () => ({ MmdRuntimeShared: MockMmdRuntimeShared });
export const mockMmdModelLoaderDefault = () => ({});
export const mockTextureAlphaCheckerVertex = () => ({});
export const mockTextureAlphaCheckerFragment = () => ({});
