// outfit-mocks.ts — 共享 vi.mock 工厂 re-export（ADR-206 Phase 2）
// Babylon/BMD 工厂来自 mocks/babylon-factories.ts（单一规范源），
// app 级 mock 来自 model-preset-mocks.ts。
// 本文件保留别名映射 + 换装特有 helper。

export {
    mockEngine,
    mockScene,
    mockHemisphericLight,
    mockDirectionalLight,
    mockLight,
    mockArcRotateCamera,
    mockCamera,
    mockDefaultRenderingPipeline,
    mockTexture,
    mockMmdCamera,
    mockMmdDynamic as mockRegisterMmdModelLoaders,
    mockDxBmpTextureLoader as mockRegisterDxBmpTextureLoader,
    mockMmdWasmInstance as mockGetMmdWasmInstance,
    mockMmdWasmRuntime,
    mockVmdLoader,
    mockMmdWasmAnimation,
    mockMmdStandardMaterialProxy,
    mockMmdRuntimeShared,
    mockSinglePhysicsRelease,
} from './mocks/babylon-factories';

export { mockToast } from './model-preset-mocks';

// ---- 换装特有 helper ----
export const mockEmpty = () => ({});
export const mockSceneModule = () => ({ scene: {} });
export const mockT = () => ({ t: (key: string) => key });
