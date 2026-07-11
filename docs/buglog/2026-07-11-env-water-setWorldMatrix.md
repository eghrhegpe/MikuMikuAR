# env-water: setWorldMatrix / freezeWorldMatrix 运行时不存在于 FreeCamera

**日期**: 2026-07-11
**严重程度**: P2（潜伏 BUG，当前默认配置不触发）
**影响范围**: env-water.ts + env-impl.ts（水面反射 + 地面反射）
**发现方式**: 代码审核

---

## 问题描述

`_updateMirrorCamera` 和 `_updateGroundMirrorCamera` 中调用了 `FreeCamera.setWorldMatrix()` 和 `FreeCamera.freezeWorldMatrix()`，但这两个方法在 `FreeCamera` 上**不存在**。

```typescript
// env-water.ts:598-599（修复前）
(_mirrorCam as any).setWorldMatrix(mirrorWorld);
(_mirrorCam as any).freezeWorldMatrix();
```

## 根因分析

Babylon.js v9 继承链差异：

| 类 | 继承链 | 有 freezeWorldMatrix? |
|----|--------|----------------------|
| TransformNode | Node → AbstractMesh → TransformNode | ✅ |
| FreeCamera | Node → Camera → TargetCamera → FreeCamera | ❌ |

`freezeWorldMatrix` / `setWorldMatrix` 定义在 `TransformNode` 上（经过 `AbstractMesh`），而 `FreeCamera` 的继承链**不经过** `AbstractMesh`。

实测验证（Babylon.js v9.16.1）：

```bash
node -e "
const {FreeCamera,Vector3,Scene,NullEngine}=require('@babylonjs/core');
const cam=new FreeCamera('t',Vector3.Zero(),new Scene(new NullEngine()));
console.log(typeof cam.setWorldMatrix);      // undefined
console.log(typeof cam.freezeWorldMatrix);   // undefined
console.log(typeof cam._worldMatrix);         // object
"
```

## 为什么没有暴露

默认 `reflectionQuality: 'off'`（`state.ts:383`），`_mirrorRT` 从不创建，`_updateMirrorCamera` 永远不被调用。**一旦用户切换到 high/medium/low，就会抛 `TypeError: _mirrorCam.setWorldMatrix is not a function`**。

## 修复方案

直接设置 `Node` 基类的内部属性（与 `TransformNode.freezeWorldMatrix` 内部实现等价）：

```typescript
// 修复后
(_mirrorCam as any)._worldMatrix = mirrorWorld;
(_mirrorCam as any)._isWorldMatrixFrozen = true;
```

同时移除了 `fov` 的多余 `as any`（`fov` 声明在 `Camera` 上，`FreeCamera` 可直接访问）。

## 教训

1. **`as any` 可以掩盖运行时不存在的方法** — 类型系统不报错 ≠ 运行时存在
2. **默认配置不触发的代码路径需要显式测试** — 反射质量 off → RT 不创建 → mirror camera 代码路径从未执行
3. **继承链不等于方法可用性** — Node 上的方法不一定在 Camera 子类上（Camera 不继承 AbstractMesh）
