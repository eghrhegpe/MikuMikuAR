// model-preset-mocks.ts — 共享 vi.mock 工厂（ADR-204 P3，拆自 model-preset.test.ts）
// 注意：工厂必须「同步 + 静态 import Mock 类」，否则 vi.mock 的 hoist 会引用到尚未初始化的导入绑定。
// 与 model-manager-mocks.ts 同理——Mock 类在文件顶部静态 import，工厂仅做对象组装。
// 不可用 `vi.importActual(...)` 包裹（hoist 期会触发 __vi_import_X__ not initialized）。
import { vi } from 'vitest';
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
} from './mocks/babylon-classes';
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
} from './mocks/babylon-mmd-mocks';

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

// ---- app mocks ----
export const mockToast = () => ({ showInfoToast: vi.fn() });
export const mockPlayback = () => ({ updatePlaybackUI: vi.fn() });
