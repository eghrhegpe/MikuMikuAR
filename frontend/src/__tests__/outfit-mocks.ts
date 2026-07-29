// outfit-mocks.ts — 共享 vi.mock 工厂（同步，Mock 类静态 import）
// 对应原 outfit.test.ts 顶部 Babylon / babylon-mmd 桩集。
// 禁用 vi.importActual 包裹（hoist 期 __vi_import_X__ not initialized），改为静态 import
// 真实 mock 类，保证与 SUT 被 mock 的导入同一引用。
import { vi } from 'vitest';
import {
    MockEngine,
    MockScene,
    MockHemisphericLight,
    MockDirectionalLight,
    MockLight,
    MockArcRotateCamera,
    MockCamera,
    MockDefaultRenderingPipeline,
    MockTexture,
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

export const mockEngine = () => ({ Engine: MockEngine });
export const mockScene = () => ({ Scene: MockScene });
export const mockHemisphericLight = () => ({ HemisphericLight: MockHemisphericLight });
export const mockDirectionalLight = () => ({ DirectionalLight: MockDirectionalLight });
export const mockLight = () => ({ Light: MockLight });
export const mockArcRotateCamera = () => ({ ArcRotateCamera: MockArcRotateCamera });
export const mockCamera = () => ({ Camera: MockCamera });
export const mockDefaultRenderingPipeline = () => ({ DefaultRenderingPipeline: MockDefaultRenderingPipeline });
export const mockTexture = () => ({ Texture: MockTexture });

export const mockMmdCamera = () => ({ MmdCamera: MockMmdCamera });
export const mockRegisterMmdModelLoaders = () => ({ RegisterMmdModelLoaders: MockRegisterMmdModelLoaders });
export const mockRegisterDxBmpTextureLoader = () => ({ RegisterDxBmpTextureLoader: MockRegisterDxBmpTextureLoader });
export const mockGetMmdWasmInstance = () => ({ GetMmdWasmInstance: MockGetMmdWasmInstance });
export const mockMmdWasmRuntime = () => ({ MmdWasmRuntime: MockMmdWasmRuntime });
export const mockVmdLoader = () => ({ VmdLoader: MockVmdLoader });
export const mockMmdWasmAnimation = () => ({ MmdWasmAnimation: MockMmdWasmAnimation });
export const mockMmdStandardMaterialProxy = () => ({ MmdStandardMaterialProxy: MockMmdStandardMaterialProxy });
export const mockMmdRuntimeShared = () => ({ MmdRuntimeShared: MockMmdRuntimeShared });

export const mockEmpty = () => ({});
export const mockSinglePhysicsRelease = () => ({ MmdWasmInstanceTypeSPR: class Mock {} });

export const mockSceneModule = () => ({ scene: {} });
export const mockT = () => ({ t: (key: string) => key });
export const mockToast = () => ({ showInfoToast: vi.fn() });
