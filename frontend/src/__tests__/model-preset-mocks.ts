// model-preset-mocks.ts — 薄 re-export shim（ADR-206 Phase 2）
// Babylon/BMD 工厂已提升至 mocks/babylon-factories.ts（单一规范源）。
// 本文件保留 app 级 mock + re-export，确保 7 个消费者无需改 import 路径。

import { vi } from 'vitest';

// ---- re-export Babylon/BMD 工厂（向后兼容） ----
export {
    mockEngine,
    mockScene,
    mockNode,
    mockLight,
    mockHemisphericLight,
    mockDirectionalLight,
    mockArcRotateCamera,
    mockCamera,
    mockMathColor,
    mockMathVector,
    mockStandardMaterial,
    mockMaterial,
    mockMesh,
    mockTexture,
    mockPostProcess,
    mockSceneLoader,
    mockDefaultRenderingPipeline,
    mockPhysicsEngineComponent,
    mockTgaTextureLoader,
    mockMmdCamera,
    mockMmdDynamic,
    mockDxBmpTextureLoader,
    mockMmdWasmInstance,
    mockSinglePhysicsRelease,
    mockMmdWasmRuntime,
    mockVmdLoader,
    mockMmdWasmAnimation,
    mockMmdWasmRuntimeModelAnimation,
    mockMmdStandardMaterialProxy,
    mockMmdRuntimeShared,
    mockMmdModelLoaderDefault,
    mockTextureAlphaCheckerVertex,
    mockTextureAlphaCheckerFragment,
} from './mocks/babylon-factories';

// ---- app mocks ----
export const mockToast = () => ({ showInfoToast: vi.fn() });
export const mockPlayback = () => ({ updatePlaybackUI: vi.fn() });
