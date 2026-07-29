// material-editor-mocks.ts — 共享 vi.mock 工厂 re-export（ADR-206 Phase 1）
// Babylon/BMD 工厂统一来自 model-preset-mocks.ts（单一规范源），
// 本文件保留别名映射 + 将「值类型 mock」求值为 plain object（消费者按值引用，非函数调用）。
// 原 165 行 → 42 行。

import {
    mockPhysicsEngineComponent,
    mockTgaTextureLoader,
    mockSinglePhysicsRelease,
    mockMmdWasmRuntimeModelAnimation,
    mockMmdModelLoaderDefault,
    mockTextureAlphaCheckerVertex,
    mockTextureAlphaCheckerFragment,
} from './mocks/babylon-factories';

// ---- 函数工厂 → 别名 re-export（消费者按函数引用使用） ----
export {
    mockEngine as engineModuleFactory,
    mockScene as sceneModuleFactory,
    mockNode as nodeModuleFactory,
    mockLight as lightModuleFactory,
    mockHemisphericLight as hemiLightModuleFactory,
    mockDirectionalLight as dirLightModuleFactory,
    mockArcRotateCamera as arcRotCamModuleFactory,
    mockCamera as cameraModuleFactory,
    mockMathColor as mathColorModuleFactory,
    mockMathVector as mathVectorModuleFactory,
    mockStandardMaterial as stdMatModuleFactory,
    mockMaterial as materialModuleFactory,
    mockMesh as meshModuleFactory,
    mockPostProcess as postProcessModuleFactory,
    mockSceneLoader as sceneLoaderModuleFactory,
    mockDefaultRenderingPipeline as defaultRenderingPipelineModuleFactory,
    mockMmdCamera as mmdCameraModuleFactory,
    mockMmdDynamic as mmdRegisterLoadersFactory,
    mockDxBmpTextureLoader as mmdRegisterDxBmpFactory,
    mockMmdWasmInstance as mmdGetWasmInstanceFactory,
    mockMmdWasmRuntime as mmdWasmRuntimeFactory,
    mockVmdLoader as mmdVmdLoaderFactory,
    mockMmdWasmAnimation as mmdWasmAnimationFactory,
    mockMmdStandardMaterialProxy as mmdStdMaterialProxyFactory,
    mockMmdRuntimeShared as mmdRuntimeSharedFactory,
} from './mocks/babylon-factories';

// ---- 空模块桩（消费者按值引用，非函数调用） ----
export const physicsEngineModuleMock = mockPhysicsEngineComponent();
export const tgaLoaderModuleMock = mockTgaTextureLoader();
export const mmdSinglePhysicsReleaseMock = mockSinglePhysicsRelease();
export const mmdRuntimeModelAnimMock = mockMmdWasmRuntimeModelAnimation();
export const mmdModelLoaderDefaultMock = mockMmdModelLoaderDefault();
export const mmdTextureAlphaVertexMock = mockTextureAlphaCheckerVertex();
export const mmdTextureAlphaFragmentMock = mockTextureAlphaCheckerFragment();
