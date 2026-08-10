/**
 * [doc:mock-strategy] babylon-classes 手抄 mock 的类型契约测试
 *
 * 问题：babylon-classes.ts 全手抄 mock 类，零类型引用——真实 Babylon 升级后
 * 接口变更（如 Engine 增 scenes 属性，env-terrain.test.ts:11-13 曾踩坑）只能在
 * 运行期暴露，无法编译期拦截。
 *
 * 方案：对核心 mock 类做「公开成员名 ⊆ 真实类型公开成员名」的编译期断言。
 * mock 若引用真实类型不存在的公开成员（字段/方法），本文件即编译失败。
 * 私有成员（`_` 前缀）不检查——mock 内部字段与真实实现细节无关。
 *
 * 仅 type-only import，不拖运行时依赖；类型断言在声明点即校验约束，无需运行。
 */
import type { Engine as RealEngine } from '@babylonjs/core/Engines/engine';
import type { Scene as RealScene } from '@babylonjs/core/scene';
import type { Vector3 as RealVector3 } from '@babylonjs/core/Maths/math.vector';
import type { Color3 as RealColor3 } from '@babylonjs/core/Maths/math.color';
import type { Matrix as RealMatrix } from '@babylonjs/core/Maths/math.vector';
import { describe, expect, it } from 'vitest';
import {
    MockEngine,
    MockScene,
    MockVector3,
    MockColor3,
    MockMatrix,
} from './babylon-classes';

/** 公开成员（排除 `_` 私有前缀） */
type PublicKeys<T> = Exclude<keyof T, `_${string}`>;

/** mock 公开成员必须全部存在于真实类型（子集断言） */
type AssertPublicSubset<Mock, Real> = Exclude<PublicKeys<Mock>, PublicKeys<Real>> extends never
    ? true
    : never;

/** 在变量声明处校验：断言失败时类型为 never，赋 true 即编译报错 */
type Assert<T extends true> = T;

const _engineShape: Assert<AssertPublicSubset<MockEngine, RealEngine>> = true;
const _sceneShape: Assert<AssertPublicSubset<MockScene, RealScene>> = true;
const _vector3Shape: Assert<AssertPublicSubset<MockVector3, RealVector3>> = true;
const _color3Shape: Assert<AssertPublicSubset<MockColor3, RealColor3>> = true;
const _matrixShape: Assert<AssertPublicSubset<MockMatrix, RealMatrix>> = true;

describe('babylon-classes mock 形状契约', () => {
    it('核心 mock 类可实例化（编译期断言已由上方类型检查锁定）', () => {
        expect(new MockEngine().getClassName()).toBe('Engine');
        expect(new MockScene().getClassName()).toBe('Scene');
        expect(new MockVector3(1, 2, 3).length()).toBeCloseTo(Math.sqrt(14), 5);
        expect(new MockColor3(1, 0, 0).toArray()).toEqual([1, 0, 0]);
        expect(MockMatrix.Identity().getClassName()).toBe('Matrix');
    });
});
