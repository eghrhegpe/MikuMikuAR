# 第③轮审核 — 环境门面 + 地形

## env-impl.ts (1065行)

**总体结论：⚠️ 有条件通过**

**文件：** `frontend/src/scene/env/env-impl.ts`
**角色：** 环境系统门面(Facade)，整合 Sky(3模式)、Ground(5模式+镜面反射 Phase B)、Fog、`envUpdateObserver`(每帧统一回调)、`sceneTickCallback` 注册表、跨子系统重导出(water/clouds/particles)
**ADR 参考：** ADR-052(地面架构), ADR-083(地面模式扩展)
**测试：** ❌ 无直接单元测试；`environment-integration.test.ts` 覆盖基础 ground/fog 行为但不 import 本模块函数

---

### 导入图谱

导入关系：`env-impl.ts` ←→ `env-water.ts`（循环依赖）
- env-impl 重导出 env-water 的 `initWater/disposeWater/setWaterEnabled`
- env-water `import { getScene } from './env-impl'`
- 运行时通过延迟求值（函数调用而非类实例化时解析）避免死循环

依赖的其他模块：`env-terrain.ts`(高度图地形)、所有 env-* 子模块均在运行时按需初始化。

### 状态读写追踪

| 状态 | 类型 | 写入点 | 读取点 | 唯一性 |
|------|------|--------|--------|--------|
| `_envSys` | 模块级变量 | initEnvironment | 所有 env-* 函数 | ✅ 单一来源 |
| `_envState` | EnvironmentState | initEnvironment, setter | getter, 子模块 | ✅ 单一来源 |
| `_edgeFadeTexCache` | Map<number, Texture> | getEdgeFadeTexture | getEdgeFadeTexture | ✅ 但无 dispose |
| `sceneTickCallbacks` | Map<string, () => void> | addSceneTickCallback | envUpdateObserver | ✅ |

### 类型安全 — 🟠 P2

| # | 位置 | 问题 | 严重度 |
|---|------|------|--------|
| 1 | L613-614 | `as any` 写 `FreeCamera` 私有属性（如 `_currentTarget`） | 🟠 P2 |
| 2 | L416, L509 | `canvas.getContext('2d')!` 非空断言 | 🟡 P3 |

2 处 `as any` 有注释说明原因（访问 Babylon.js 私有相机属性），但未论证运行时安全性。缺一句类似 `// FreeCamera always available at this point — initialized in initEnvironment()`。

### 资源管理 — 🟡 P3

`_edgeFadeTexCache` 是一个 `Map<number, Texture>`，在 `getEdgeFadeTexture()` 中按需创建 Texture 并缓存。**无 dispose 机制**。估算：
- 约 101 个不同尺寸的条目（根据调用模式预估）
- 每个 ~250KB（小尺寸 fade texture）
- 总泄漏上限 ~25MB

### 功能正确性 — 🟡 P3

| # | 问题 | 位置 | 风险 |
|---|------|------|------|
| 1 | `canvas.getContext('2d')!` | L416, L509 | 非浏览器环境抛错 |
| 2 | `REFRESHRATE_RENDER_ONCE` 回退 | L408 | `getScene().getEngine().setRenderLoop(...)` 在 dispose 后调用可能报错 |

### 测试覆盖 — 🔴 P1

无直接单元测试。`environment-integration.test.ts` 覆盖基础 ground/fog 行为，但**不 import 本模块任何函数**。Sky/ground/fog 各模式切换、`addSceneTickCallback` 注册表、`_edgeFadeTexCache` 路径均无测试。

### 设计质量 — ✅

| 设计模式 | 说明 |
|----------|------|
| Facade 模式 | Sky/Ground/Fog 三个子领域通过独立函数组织，clients 只 import 顶层函数 |
| 状态可追踪 | 所有环境状态在 `_envState` 中集中管理，无幽灵路径 |
| 子模块按需导入 | water/clouds/particles 通过动态 import 延迟加载，减小首屏包体积 |
| tick 注册表 | `sceneTickCallback` 允许多个消费者注册每帧回调，避免重复注册 observer |

---

## env-terrain.ts (218行)

**总体结论：⚠️ 有条件通过**

**文件：** `frontend/src/scene/env/env-terrain.ts`
**角色：** 纯工具模块 — 确定性噪声、高度图生成、Terrain Ground 创建
**ADR 参考：** ADR-052(地面)，ADR-083(地面模式扩展)
**测试：** `env-terrain.test.ts` (~100行，覆盖 hash2/valueNoise/fbm 确定性)

---

### 导入图谱

`env-terrain.ts` 是独立工具模块，不依赖 `env-impl.ts` 或任何其他 env-* 模块。无循环依赖风险。

### 类型安全 — 🟡 P3

| # | 位置 | 问题 | 严重度 |
|---|------|------|--------|
| 1 | L57 | `canvas.getContext('2d')!` 非空断言 | 🟡 P3 |

### 测试覆盖 — ✅

~100 行测试覆盖 `hash2`、`valueNoise`、`fbm` 三个核心函数的确定性（相同输入→相同输出）。`generateTerrainHeightmapURL` 和 `applyTerrainMaterial` 未直接测试。

### 功能正确性 — 🟢 P4

| # | 问题 | 位置 | 风险 |
|---|------|------|--------|
| 1 | `applyElevationColoring` 在 `groundTerrainHeight=0` 时 `range=0` | 约 L180 | 除以零 → `NaN` → vertex color 异常 |
| 2 | 负 `seed` 不保证确定性 | L20-30 | 哈希函数对负数输入可能产生非确定性结果 |

### 设计质量 — ✅

三层抽象清晰：`hash2 → valueNoise → fbm → generateTerrainHeightmapURL → GroundMesh`

纯函数设计，方便测试。256² 灰度高度图通过 dataURL 传递给 `GroundMesh` 异步创建。

---

## 风险清单

| 文件 | 观察 | 建议 |
|------|------|------|
| 🔴 P1 | env-impl.ts | 零直接单元测试 | 最小添加：Sky模式切换 + ground模式切换 + addSceneTickCallback注册/触发 |
| 🟠 P2 | env-impl.ts:613-614 | as any 写私有属性缺安全性注释 | 追加：`// FreeCamera guaranteed initialized at this point` |
| 🟡 P3 | env-impl.ts | `_edgeFadeTexCache` 无 dispose | 在 `disposeEnvironment()` 中遍历 `_edgeFadeTexCache.values()` 调用 `.dispose()` |
| 🟡 P3 | env-impl.ts:416,509 | 非空断言 | 改 `if (!ctx) throw` 或 fallback |
| 🟡 P3 | env-impl.ts ↔ env-water.ts | 循环依赖 | 将 `getScene` 抽出到 `env-state.ts` |
| 🟢 P4 | env-terrain.ts:~180 | 除以零 | 加 `if (range === 0) return` guard |
