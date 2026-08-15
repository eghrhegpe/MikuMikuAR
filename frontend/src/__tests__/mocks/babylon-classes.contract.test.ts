// @vitest-environment node
/**
 * [doc:mock-strategy] babylon-classes 手抄 mock 的类型契约测试
 *
 * 问题：babylon-classes.ts 全手抄 mock 类，零类型引用——真实 Babylon 升级后
 * 接口变更（如 Engine 增 scenes 属性，env-terrain.test.ts:11-13 曾踩坑）只能在
 * 运行期暴露，无法编译期拦截。
 *
 * 方案：
 * - 编译期：对全部手抄 mock 类做「公开成员名 ⊆ 真实类型公开成员名」断言；
 *   mock 若引用真实类型不存在的公开成员（字段/方法），本文件即编译失败。
 *   私有成员（`_` 前缀）不检查——mock 内部字段与真实实现细节无关。
 * - 编译期：对全部 mock 类做参数逆变签名断言，mock 方法必须收得下真实方法
 *   的入参（含可选参数/重载形态），失败键用 false 保留避免联合吸收。
 * - 编译期：对含静态公开成员的 mock 类做静态成员名子集断言。
 * - 运行期：动态 import 真实 Babylon（用 .js 后缀绕过 vitest 的 Engine mock
 *   别名），逐一对比 getClassName，避免「自证」——mock 与真实类行为漂移时失败。
 *
 * 已知限制：
 * 1. 签名断言只查参数方向，不校验返回类型——精简 mock 的返回类型（自身类/宽松值）
 *    天然不是真实类型的子类型，全签名 extends 检查必然误报。
 * 2. `_` 前缀成员完全豁免——mock 新增的 `_` 开头幻影公开成员不会被拦截。
 * 3. 若某 mock 类含真实类型没有的「有意扩展」成员（如测试辅助方法），
 *    需用 Omit 显式豁免并在此注释说明理由，避免误报。
 *
 * 类型断言在声明点即校验约束，无需运行；运行期 getClassName 对比只在测试执行时加载真实模块。
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

/** 签名级断言：mock 方法参数必须能接受真实类型同名方法的参数（参数逆变）。
 *  注意只查参数，不查返回类型——精简 mock 的返回类型（自身类/宽松值）天然
 *  不是真实类型的子类型，全签名 extends 检查必然误报。参数方向才有约束力：
 *  真实调用方传入的参数，mock 方法必须收得下。
 *  每个键内联双重函数性检查，避免 Parameters<Real[K]> 在 mapped type 中失窄。
 *  失败键用 false 而非 never 保留在联合中，避免 never 被联合吸收导致假阳性。 */
type AssertSignatures<Mock, Real> = {
    [K in PublicKeys<Mock> & PublicKeys<Real>]:
        Mock[K] extends (...a: any[]) => any
            ? Real[K] extends (...a: any[]) => any
                ? Parameters<Real[K]> extends Parameters<Mock[K]>
                    ? true
                    : false
                : true
            : true;
}[PublicKeys<Mock> & PublicKeys<Real>] extends true ? true : never;

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

// ===== 静态成员子集断言（mock 有静态公开成员时，静态名也必须存在于真实类） =====
const _nodeStaticShape: Assert<AssertPublicSubset<typeof MockNode, typeof RealNode>> = true;
const _vector2StaticShape: Assert<AssertPublicSubset<typeof MockVector2, typeof RealVector2>> = true;
const _vector3StaticShape: Assert<AssertPublicSubset<typeof MockVector3, typeof RealVector3>> = true;
const _quatStaticShape: Assert<AssertPublicSubset<typeof MockQuaternion, typeof RealQuaternion>> = true;
const _matrixStaticShape: Assert<AssertPublicSubset<typeof MockMatrix, typeof RealMatrix>> = true;
const _materialStaticShape: Assert<AssertPublicSubset<typeof MockMaterial, typeof RealMaterial>> = true;

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
const _hemiSig: Assert<AssertSignatures<MockHemisphericLight, RealHemisphericLight>> = true;
const _dirSig: Assert<AssertSignatures<MockDirectionalLight, RealDirectionalLight>> = true;
const _stdMatSig: Assert<AssertSignatures<MockStandardMaterial, RealStandardMaterial>> = true;
const _abstractMeshSig: Assert<AssertSignatures<MockAbstractMesh, RealAbstractMesh>> = true;
const _meshSig: Assert<AssertSignatures<MockMesh, RealMesh>> = true;
const _texSig: Assert<AssertSignatures<MockTexture, RealTexture>> = true;
const _cubeTexSig: Assert<AssertSignatures<MockCubeTexture, RealCubeTexture>> = true;
const _shadowSig: Assert<AssertSignatures<MockShadowGenerator, RealShadowGenerator>> = true;
const _postSig: Assert<AssertSignatures<MockPostProcess, RealPostProcess>> = true;
const _pipelineSig: Assert<
    AssertSignatures<MockDefaultRenderingPipeline, RealDefaultRenderingPipeline>
> = true;
const _gpuParticleSig: Assert<
    AssertSignatures<MockGPUParticleSystem, RealGPUParticleSystem>
> = true;
const _particleSig: Assert<AssertSignatures<MockParticleSystem, RealParticleSystem>> = true;
const _pbrSig: Assert<AssertSignatures<MockPBRMaterial, RealPBRMaterial>> = true;
const _gridSig: Assert<AssertSignatures<MockGridMaterial, RealGridMaterial>> = true;
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

// 真实 Babylon 模块的运行时路径。使用 .js 后缀绕过 vitest.config.ts 中
// `@babylonjs/core/Engines/engine` 指向 engine-mock.ts 的别名，确保这里对比的是真实实现。
const realClassModules = [
    ['MockEngine', '@babylonjs/core/Engines/engine.js', 'Engine'],
    ['MockScene', '@babylonjs/core/scene.js', 'Scene'],
    ['MockNode', '@babylonjs/core/node.js', 'Node'],
    ['MockLight', '@babylonjs/core/Lights/light.js', 'Light'],
    ['MockHemisphericLight', '@babylonjs/core/Lights/hemisphericLight.js', 'HemisphericLight'],
    ['MockDirectionalLight', '@babylonjs/core/Lights/directionalLight.js', 'DirectionalLight'],
    ['MockCamera', '@babylonjs/core/Cameras/camera.js', 'Camera'],
    ['MockArcRotateCamera', '@babylonjs/core/Cameras/arcRotateCamera.js', 'ArcRotateCamera'],
    ['MockColor3', '@babylonjs/core/Maths/math.color.js', 'Color3'],
    ['MockColor4', '@babylonjs/core/Maths/math.color.js', 'Color4'],
    ['MockVector2', '@babylonjs/core/Maths/math.vector.js', 'Vector2'],
    ['MockVector3', '@babylonjs/core/Maths/math.vector.js', 'Vector3'],
    ['MockQuaternion', '@babylonjs/core/Maths/math.vector.js', 'Quaternion'],
    ['MockMatrix', '@babylonjs/core/Maths/math.vector.js', 'Matrix'],
    ['MockMaterial', '@babylonjs/core/Materials/material.js', 'Material'],
    ['MockStandardMaterial', '@babylonjs/core/Materials/standardMaterial.js', 'StandardMaterial'],
    ['MockAbstractMesh', '@babylonjs/core/Meshes/abstractMesh.js', 'AbstractMesh'],
    ['MockMesh', '@babylonjs/core/Meshes/mesh.js', 'Mesh'],
    ['MockBaseTexture', '@babylonjs/core/Materials/Textures/baseTexture.js', 'BaseTexture'],
    ['MockTexture', '@babylonjs/core/Materials/Textures/texture.js', 'Texture'],
    ['MockCubeTexture', '@babylonjs/core/Materials/Textures/cubeTexture.js', 'CubeTexture'],
    ['MockShadowGenerator', '@babylonjs/core/Lights/Shadows/shadowGenerator.js', 'ShadowGenerator'],
    ['MockPostProcess', '@babylonjs/core/PostProcesses/postProcess.js', 'PostProcess'],
    ['MockDefaultRenderingPipeline', '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline.js', 'DefaultRenderingPipeline'],
    ['MockGPUParticleSystem', '@babylonjs/core/Particles/gpuParticleSystem.js', 'GPUParticleSystem'],
    ['MockParticleSystem', '@babylonjs/core/Particles/particleSystem.js', 'ParticleSystem'],
    ['MockPBRMaterial', '@babylonjs/core/Materials/PBR/pbrMaterial.js', 'PBRMaterial'],
    ['MockGridMaterial', '@babylonjs/materials/grid/gridMaterial.js', 'GridMaterial'],
] as const;

const mockClassByName = {
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
};

describe('babylon-classes mock 形状契约', () => {
    it('核心 mock 类可实例化（编译期断言已由上方类型检查锁定）', () => {
        // 真实 Engine.getClassName() 返回 'ThinEngine'，mock 必须保持一致
        expect(new MockEngine().getClassName()).toBe('ThinEngine');
        expect(new MockScene().getClassName()).toBe('Scene');
        expect(new MockVector3(1, 2, 3).length()).toBeCloseTo(Math.sqrt(14), 5);
        expect(new MockColor3(1, 0, 0).toArray()).toEqual([1, 0, 0]);
        expect(MockMatrix.Identity().getClassName()).toBe('Matrix');
    });

    it('所有 mock 的 getClassName 与真实 Babylon 运行时一致（防自证）', async () => {
        const realModules = await Promise.all(
            realClassModules.map(([, modulePath]) => import(modulePath))
        );

        realClassModules.forEach(([mockName, , realExportName], index) => {
            const MockClass = mockClassByName[mockName as keyof typeof mockClassByName];
            const RealClass = (realModules[index] as Record<string, unknown>)[realExportName] as
                | { prototype?: { getClassName?(this: unknown): unknown } }
                | undefined;
            if (!MockClass) {
                throw new Error(`Mock class not found in mockClassByName: ${mockName}`);
            }
            if (!RealClass || typeof RealClass.prototype?.getClassName !== 'function') {
                throw new Error(`Real class ${realExportName} from ${realClassModules[index][1]} has no getClassName`);
            }
            if (typeof MockClass.prototype?.getClassName !== 'function') {
                throw new Error(`Mock class ${mockName} has no getClassName`);
            }
            const mockClassName = MockClass.prototype.getClassName.call({});
            const realClassName = RealClass.prototype.getClassName!.call({});
            expect(mockClassName).toBe(realClassName);
        });
    });
});
