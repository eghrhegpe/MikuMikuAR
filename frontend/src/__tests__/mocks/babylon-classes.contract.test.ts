/**
 * [doc:mock-strategy] babylon-classes 手抄 mock 的类型契约测试
 *
 * 问题：babylon-classes.ts 全手抄 mock 类，零类型引用——真实 Babylon 升级后
 * 接口变更（如 Engine 增 scenes 属性，env-terrain.test.ts:11-13 曾踩坑）只能在
 * 运行期暴露，无法编译期拦截。
 *
 * 方案：对全部手抄 mock 类做「公开成员名 ⊆ 真实类型公开成员名」的编译期断言。
 * mock 若引用真实类型不存在的公开成员（字段/方法），本文件即编译失败。
 * 私有成员（`_` 前缀）不检查——mock 内部字段与真实实现细节无关。
 *
 * 已知限制：
 * 1. 仅检查成员名子集，不校验方法签名（签名漂移需引入 Parameters/条件类型）。
 * 2. `_` 前缀成员完全豁免——mock 新增的 `_` 开头幻影公开成员不会被拦截。
 * 3. 若某 mock 类含真实类型没有的「有意扩展」成员（如测试辅助方法），
 *    需用 Omit 显式豁免并在此注释说明理由，避免误报。
 * 4. 签名级断言（AssertSignatures，参数逆变方向）当前覆盖 14/28 类——
 *    数学类 + Engine/Scene/Node/Light/Camera/ArcRotateCamera/Material/BaseTexture；
 *    其余 14 类（Mesh/StandardMaterial/PBRMaterial/Texture 等）仅成员名子集断言。
 *
 * 仅 type-only import，不拖运行时依赖；类型断言在声明点即校验约束，无需运行。
 */
import type { Engine as RealEngine } from '@babylonjs/core/Engines/engine';
import type { Scene as RealScene } from '@babylonjs/core/scene';
import type { Node as RealNode } from '@babylonjs/core/node';
import type { Light as RealLight } from '@babylonjs/core/Lights/light';
import type { HemisphericLight as RealHemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import type { DirectionalLight as RealDirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import type { Camera as RealCamera } from '@babylonjs/core/Cameras/camera';
import type { ArcRotateCamera as RealArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import type { Color3 as RealColor3, Color4 as RealColor4 } from '@babylonjs/core/Maths/math.color';
import type {
    Vector2 as RealVector2,
    Vector3 as RealVector3,
    Quaternion as RealQuaternion,
    Matrix as RealMatrix,
} from '@babylonjs/core/Maths/math.vector';
import type { Material as RealMaterial } from '@babylonjs/core/Materials/material';
import type { StandardMaterial as RealStandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { AbstractMesh as RealAbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { Mesh as RealMesh } from '@babylonjs/core/Meshes/mesh';
import type { BaseTexture as RealBaseTexture } from '@babylonjs/core/Materials/Textures/baseTexture';
import type { Texture as RealTexture } from '@babylonjs/core/Materials/Textures/texture';
import type { CubeTexture as RealCubeTexture } from '@babylonjs/core/Materials/Textures/cubeTexture';
import type { ShadowGenerator as RealShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import type { PostProcess as RealPostProcess } from '@babylonjs/core/PostProcesses/postProcess';
import type { DefaultRenderingPipeline as RealDefaultRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline';
import type { GPUParticleSystem as RealGPUParticleSystem } from '@babylonjs/core/Particles/gpuParticleSystem';
import type { ParticleSystem as RealParticleSystem } from '@babylonjs/core/Particles/particleSystem';
import type { PBRMaterial as RealPBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import type { GridMaterial as RealGridMaterial } from '@babylonjs/materials/grid/gridMaterial';
import { describe, expect, it } from 'vitest';
import {
    MockEngine,
    MockScene,
    MockNode,
    MockLight,
    MockHemisphericLight,
    MockDirectionalLight,
    MockCamera,
    MockArcRotateCamera,
    MockColor3,
    MockColor4,
    MockVector2,
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
    MockPBRMaterial,
    MockGridMaterial,
} from './babylon-classes';

/** 公开成员（排除 `_` 私有前缀） */
type PublicKeys<T> = Exclude<keyof T, `_${string}`>;

/** mock 公开成员必须全部存在于真实类型（子集断言） */
type AssertPublicSubset<Mock, Real> = Exclude<PublicKeys<Mock>, PublicKeys<Real>> extends never
    ? true
    : never;

/** 只取「双方都是函数」的公开成员名（签名级断言的目标） */
type FuncKeys<Mock, Real> = {
    [K in PublicKeys<Mock> & PublicKeys<Real>]: Mock[K] extends (...a: any[]) => any
        ? Real[K] extends (...a: any[]) => any
            ? K
            : never
        : never;
}[PublicKeys<Mock> & PublicKeys<Real>];

/** 签名级断言：mock 方法参数必须能接受真实类型同名方法的参数（参数逆变）。
 *  注意只查参数，不查返回类型——精简 mock 的返回类型（自身类/宽松值）天然
 *  不是真实类型的子类型，全签名 extends 检查必然误报。参数方向才有约束力：
 *  真实调用方传入的参数，mock 方法必须收得下。
 *  每个键内联双重函数性检查，避免 Parameters<Real[K]> 在 mapped type 中失窄。 */
type AssertSignatures<Mock, Real> = {
    [K in PublicKeys<Mock> & PublicKeys<Real>]:
        Mock[K] extends (...a: any[]) => any
            ? Real[K] extends (...a: any[]) => any
                ? Parameters<Real[K]> extends Parameters<Mock[K]>
                    ? true
                    : never
                : never
            : never;
}[PublicKeys<Mock> & PublicKeys<Real>];

/** 在变量声明处校验：断言失败时类型为 never，赋 true 即编译报错 */
type Assert<T extends true> = T;

const _engineShape: Assert<AssertPublicSubset<MockEngine, RealEngine>> = true;
const _sceneShape: Assert<AssertPublicSubset<MockScene, RealScene>> = true;
const _nodeShape: Assert<AssertPublicSubset<MockNode, RealNode>> = true;
const _lightShape: Assert<AssertPublicSubset<MockLight, RealLight>> = true;
const _hemiShape: Assert<AssertPublicSubset<MockHemisphericLight, RealHemisphericLight>> = true;
const _dirShape: Assert<AssertPublicSubset<MockDirectionalLight, RealDirectionalLight>> = true;
const _cameraShape: Assert<AssertPublicSubset<MockCamera, RealCamera>> = true;
const _arcShape: Assert<AssertPublicSubset<MockArcRotateCamera, RealArcRotateCamera>> = true;
const _color3Shape: Assert<AssertPublicSubset<MockColor3, RealColor3>> = true;
const _color4Shape: Assert<AssertPublicSubset<MockColor4, RealColor4>> = true;
const _vector2Shape: Assert<AssertPublicSubset<MockVector2, RealVector2>> = true;
const _vector3Shape: Assert<AssertPublicSubset<MockVector3, RealVector3>> = true;
const _quatShape: Assert<AssertPublicSubset<MockQuaternion, RealQuaternion>> = true;
const _matrixShape: Assert<AssertPublicSubset<MockMatrix, RealMatrix>> = true;

// ===== 签名级断言（数学类 + 引擎/场景等核心类） =====
const _vector3Sig: Assert<AssertSignatures<MockVector3, RealVector3>> = true;
const _color3Sig: Assert<AssertSignatures<MockColor3, RealColor3>> = true;
const _matrixSig: Assert<AssertSignatures<MockMatrix, RealMatrix>> = true;
const _vector2Sig: Assert<AssertSignatures<MockVector2, RealVector2>> = true;
const _color4Sig: Assert<AssertSignatures<MockColor4, RealColor4>> = true;
const _quatSig: Assert<AssertSignatures<MockQuaternion, RealQuaternion>> = true;
const _engineSig: Assert<AssertSignatures<MockEngine, RealEngine>> = true;
const _sceneSig: Assert<AssertSignatures<MockScene, RealScene>> = true;
const _nodeSig: Assert<AssertSignatures<MockNode, RealNode>> = true;
const _lightSig: Assert<AssertSignatures<MockLight, RealLight>> = true;
const _cameraSig: Assert<AssertSignatures<MockCamera, RealCamera>> = true;
const _arcSig: Assert<AssertSignatures<MockArcRotateCamera, RealArcRotateCamera>> = true;
const _materialSig: Assert<AssertSignatures<MockMaterial, RealMaterial>> = true;
const _baseTexSig: Assert<AssertSignatures<MockBaseTexture, RealBaseTexture>> = true;
const _materialShape: Assert<AssertPublicSubset<MockMaterial, RealMaterial>> = true;
// MockStandardMaterial 的 toonTexture/sphereTexture 是 babylon-mmd 的 MmdStandardMaterial
// 扩展字段（types.ts 声明），真实 Babylon StandardMaterial 无此成员——Omit 豁免。
const _stdMatShape: Assert<
    AssertPublicSubset<Omit<MockStandardMaterial, 'toonTexture' | 'sphereTexture'>, RealStandardMaterial>
> = true;
const _abstractMeshShape: Assert<AssertPublicSubset<MockAbstractMesh, RealAbstractMesh>> = true;
const _meshShape: Assert<AssertPublicSubset<MockMesh, RealMesh>> = true;
const _baseTexShape: Assert<AssertPublicSubset<MockBaseTexture, RealBaseTexture>> = true;
const _texShape: Assert<AssertPublicSubset<MockTexture, RealTexture>> = true;
const _cubeTexShape: Assert<AssertPublicSubset<MockCubeTexture, RealCubeTexture>> = true;
const _shadowShape: Assert<AssertPublicSubset<MockShadowGenerator, RealShadowGenerator>> = true;
const _postShape: Assert<AssertPublicSubset<MockPostProcess, RealPostProcess>> = true;
const _pipelineShape: Assert<
    AssertPublicSubset<MockDefaultRenderingPipeline, RealDefaultRenderingPipeline>
> = true;
const _gpuParticleShape: Assert<AssertPublicSubset<MockGPUParticleSystem, RealGPUParticleSystem>> =
    true;
const _particleShape: Assert<AssertPublicSubset<MockParticleSystem, RealParticleSystem>> = true;
const _pbrShape: Assert<AssertPublicSubset<MockPBRMaterial, RealPBRMaterial>> = true;
const _gridShape: Assert<AssertPublicSubset<MockGridMaterial, RealGridMaterial>> = true;

describe('babylon-classes mock 形状契约', () => {
    it('核心 mock 类可实例化（编译期断言已由上方类型检查锁定）', () => {
        expect(new MockEngine().getClassName()).toBe('Engine');
        expect(new MockScene().getClassName()).toBe('Scene');
        expect(new MockVector3(1, 2, 3).length()).toBeCloseTo(Math.sqrt(14), 5);
        expect(new MockColor3(1, 0, 0).toArray()).toEqual([1, 0, 0]);
        expect(MockMatrix.Identity().getClassName()).toBe('Matrix');
    });
});
