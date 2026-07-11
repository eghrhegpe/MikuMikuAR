# 第①轮审核 — 环境水面 (env-water.ts)

**总体结论：⚠️ 有条件通过**

**文件：** `frontend/src/scene/env/env-water.ts` (约960行)
**依赖：** 导入 `env-impl.ts` (getScene) — 循环依赖对端
**测试：** `env-water.test.ts` (440行，覆盖 LOD 可见性、波相位连续性、预设参数、涟漪生命周期、dispose、水下过渡、反射 RT 帧跳过)

---

## 审核维度

### 类型安全 — 🟠 P2

| # | 文件:行 | 问题 | 严重度 |
|---|---------|------|--------|
| 1 | env-water.ts:~490 | `as any` 访问 `_mirrorCam` 内部 API | 🟠 P2 |
| 2 | env-water.ts:~610 | `as any` 访问内部属性 | 🟠 P2 |
| 3 | env-water.ts:~720 | `as any` 类型绕过 | 🟠 P2 |
| 4 | env-water.ts:~810 | `as any` 类型绕过 | 🟠 P2 |
| 5 | env-water.ts:~880 | `as any` 类型绕过 | 🟠 P2 |

5 处 `as any` 均涉及访问 Babylon.js 内部/私有 API（反射相机、镜像纹理），为引擎限制。缺一句注释说明为何此处的 `as any` 在运行时是安全的（如 "babylon.js mirror camera internal API — no public type available"）。

### 资源管理 — ✅

所有 Babylon 对象的创建与释放严格配对：

| 对象 | 创建函数 | 释放函数 | 配对状态 |
|------|----------|----------|----------|
| LOD 网格 ×3 | `createWaterLOD()` | `disposeWater()` | ✅ |
| ShaderMaterial | `createWaterMaterial()` | `disposeWater()` | ✅ |
| 反射观察者 | `_reflectionObserver` | `disposeWater()` | ✅ |
| 反射 RenderTarget | `_reflectionRT` | `disposeWater()` | ✅ |
| 反射相机 | `_mirrorCam` | `disposeWater()` | ✅ |
| 焦散 PostProcess | `_causticPP` | `disposeWater()` | ✅ |
| 染色 PostProcess | `_tintPP` | `disposeWater()` | ✅ |

`disposeWater()` 使用幂等模式（`if (!this._waterMesh) return`），防止双释放。

### 测试覆盖 — ✅ (但有一处隐患)

440 行测试覆盖：
- LOD 级别可见性切换
- 波相位在 LOD 切换时的连续性
- 预设参数的正确应用
- 波方向归一化
- 涟漪生命周期（创建→传播→消失）
- `dispose()` 完整性
- 水下过渡（caustic/tint PostProcess 可见性）
- 反射 RT 帧跳过（空摄像机时不渲染）

**⚠️ 隐患：** `beforeAll` 中全局替换 `document.createElement` (`document.createElement = () => canvas`)，但 `afterAll` 只恢复为 `null` 而非原函数。若其他测试在 `afterAll` 后依赖 `createElement`，会导致意外行为。

**未覆盖：** `disableWaterReflection()` 函数无任何测试。

### 功能正确性 — 🟡 P3

| # | 问题 | 位置 | 风险 |
|---|------|------|------|
| 1 | `disposeWater()` 中调用 `this._envSys.getScene()` | L979 | `getScene()` 返回 `null` 时直接访问属性抛 NPE。应加 `const scene = this._envSys.getScene(); if (!scene) return;` |

### 设计质量 — ✅

| 设计模式 | 说明 |
|----------|------|
| LOD 兄弟网格策略 | 3 个独立网格在不同距离激活，共享同一 Material，无过渡闪烁 |
| 相位连续累加 | 波相位在 LOD 切换时使用累加偏移而非重置，保证视觉连续 |
| 涟漪回收池 | 涟漪对象有生命周期管理，过期自动回收 |
| 单 Observer 聚合 | 所有水面更新集中在单个 `scene.onBeforeRenderObservable` 中 |
| 反射帧跳过 | 空摄像机时跳过反射 RT 渲染，节约 GPU |

---

## 风险清单

| 文件 | 观察 | 建议 |
|------|------|------|
| 🟠 P2 | env-water.ts:490+: 5处 as any | 每处追加注释说明为何运行时安全，如 `// babylon.js internal API — no public interface` |
| 🟡 P3 | env-water.ts:979: getScene() 无 null guard | 加 `if (!scene) return` 确保 dispose 安全 |
| 🟡 P3 | env-water.test.ts: beforeAll 覆盖 createElement | afterAll 中恢复原始函数而非置 null |
| 🟢 P4 | env-water.test.ts | 添加 `disableWaterReflection()` 的测试用例 |

---

## 改进建议（按优先级）

1. **P2** — 为 5 处 `as any` 补充安全性注释
2. **P3** — `disposeWater()` 加 `getScene()` null guard
3. **P3** — 修复 `afterAll` 中 `createElement` 恢复逻辑
4. **P4** — 添加 `disableWaterReflection()` 测试
