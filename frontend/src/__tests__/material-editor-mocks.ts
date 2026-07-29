// @ts-nocheck — vi.mock 工厂 + 纯数据 helper（material-editor 拆分测试用）
// mock 类静态导入自 ./mocks/babylon-classes/./mocks/babylon-mmd-mocks，
// 保证与 SUT 被 mock 的导入同一引用。
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

// ---- vi.mock 工厂 ----

export function engineModuleFactory() { return { Engine: MockEngine }; }
export function sceneModuleFactory() { return { Scene: MockScene }; }
export function nodeModuleFactory() { return { Node: MockNode }; }
export function lightModuleFactory() { return { Light: MockLight }; }
export function hemiLightModuleFactory() { return { HemisphericLight: MockHemisphericLight }; }
export function dirLightModuleFactory() { return { DirectionalLight: MockDirectionalLight }; }
export function arcRotCamModuleFactory() { return { ArcRotateCamera: MockArcRotateCamera }; }
export function cameraModuleFactory() { return { Camera: MockCamera }; }
export function mathColorModuleFactory() { return { Color3: MockColor3, Color4: MockColor4, TmpColors: { Color3: [] } }; }
export function mathVectorModuleFactory() { return { Vector3: MockVector3, Matrix: MockMatrix, Quaternion: MockQuaternion, TmpVectors: { Vector3: [] } }; }
export function stdMatModuleFactory() { return { StandardMaterial: MockStandardMaterial }; }
export function materialModuleFactory() { return { Material: MockMaterial }; }
export function meshModuleFactory() { return { AbstractMesh: MockAbstractMesh, Mesh: MockMesh }; }
export function postProcessModuleFactory() { return { PostProcess: MockPostProcess }; }
export function sceneLoaderModuleFactory() { return { ImportMeshAsync: MockImportMeshAsync }; }
export function defaultRenderingPipelineModuleFactory() { return { DefaultRenderingPipeline: MockDefaultRenderingPipeline }; }
export const physicsEngineModuleMock = {};
export const tgaLoaderModuleMock = {};

// ---- babylon-mmd 工厂 ----
export function mmdCameraModuleFactory() { return { MmdCamera: MockMmdCamera }; }
export function mmdRegisterLoadersFactory() { return { RegisterMmdModelLoaders: MockRegisterMmdModelLoaders }; }
export function mmdRegisterDxBmpFactory() { return { RegisterDxBmpTextureLoader: MockRegisterDxBmpTextureLoader }; }
export function mmdGetWasmInstanceFactory() { return { GetMmdWasmInstance: MockGetMmdWasmInstance }; }
export const mmdSinglePhysicsReleaseMock = { MmdWasmInstanceTypeSPR: class Mock {} };
export function mmdWasmRuntimeFactory() { return { MmdWasmRuntime: MockMmdWasmRuntime }; }
export function mmdVmdLoaderFactory() { return { VmdLoader: MockVmdLoader }; }
export function mmdWasmAnimationFactory() { return { MmdWasmAnimation: MockMmdWasmAnimation }; }
export const mmdRuntimeModelAnimMock = {};
export function mmdStdMaterialProxyFactory() { return { MmdStandardMaterialProxy: MockMmdStandardMaterialProxy }; }
export function mmdRuntimeSharedFactory() { return { MmdRuntimeShared: MockMmdRuntimeShared }; }
export const mmdModelLoaderDefaultMock = {};
export const mmdTextureAlphaVertexMock = {};
export const mmdTextureAlphaFragmentMock = {};

// ---- 纯数据 helper（无 import 依赖，可直接在各拆分文件引用）----

export function _mockMat(name: string) {
    return {
        name,
        diffuseColor: { r: 1, g: 1, b: 1, set() {}, clone() { return { r: 1, g: 1, b: 1 }; } },
        specularColor: { r: 0.8, g: 0.8, b: 0.8, set() {}, clone() { return { r: 0.8, g: 0.8, b: 0.8 }; } },
        specularPower: 50,
        ambientColor: { r: 0.3, g: 0.3, b: 0.3, set() {}, clone() { return { r: 0.3, g: 0.3, b: 0.3 }; } },
    };
}
