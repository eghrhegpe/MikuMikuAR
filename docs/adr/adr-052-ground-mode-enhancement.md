# ADR-052: 地面模式增强 —— 网格大小/第二颜色/高度/纹理旋转

**日期**：2026-07-06
> **状态**：已完成
> **关联**：ADR-024(渲染管线)

---

## 背景

地面模式原有 4 种渲染模式（纯色/网格/棋盘格/纹理），但每种模式的参数固化 —— 网格大小固定 1 unit、线色自动为 1.5 倍亮偏差值、棋盘格格子固定 16px、地面硬编码在 y=-0.05、纹理无旋转控制。用户缺少精细调参能力。

### 需求

1. 网格/棋盘格的大小可连续调节（0.5–5）
2. 网格线色和棋盘格第二色独立可控（不再由主色派生）
3. 地面高度 Y 轴可调，配合水面/模型定位
4. 纹理模式支持自定义图片上传 + 旋转角度（0–360°）

---

## 方案：统一 EnvState 扩展 + 渲染层就地更新

### 新字段

在 `EnvState` 接口中新增 4 个字段：

```typescript
// frontend/src/core/types.ts
groundTextureRotation: number;  // 纹理旋转角度 0–360，默认 0
groundGridSize: number;         // 网格/棋盘格尺寸 0.5–5，默认 1
groundLineColor: [number, number, number]; // 网格线色/棋盘格第二色，默认 [0.5, 0.5, 0.55]
```

`groundLevel` 已在 state 中存在（line 253），原未暴露到 UI，此次一并加入。

### 方案细节

#### 1. 网格渲染（`GridMaterial`）

原有逻辑：`gridRatio = 1`（固定），`lineColor = mainColor * 1.5`（派生）。

改为用 `groundGridSize` 设 `gridRatio`，用 `groundLineColor` 直接设 `lineColor`。`GridMaterial` 的 `gridRatio` 表示每个网格单元的尺寸（场景单位），增大 = 格子变大。

#### 2. 棋盘格渲染（Canvas texture）

原有逻辑：固定 `tileSize=16`（128x128 canvas → 8x8 格子），第二色亮度 = `0.6 * groundColor`。

改为：
- `tileSize = max(4, 16 * groundGridSize)` — 格子大小正比于 gridSize，与 GridMaterial.gridRatio 语义一致
- 用 `groundLineColor` 替换硬编码 `0.6` 倍数
- canvas 数据 URL → `Texture` 实时重建

#### 3. 地面高度

原有 `ground.position.y = -0.05`，改为 `ground.position.y = state.groundLevel`。

更新路径（`keyChanged === false` 分支）中也增加 `_envSys.ground.mesh.position.y = state.groundLevel`，支持高度滑块实时响应。

#### 4. 纹理旋转

Babylon.js `Texture` 没有直接旋转 API。使用 UV offset 模拟旋转：

```
angle = groundTextureRotation * PI / 180
uOffset = 0.5 * (1 - cos(angle)) + 0.5 * sin(angle)
vOffset = 0.5 * (1 - cos(angle)) - 0.5 * sin(angle)
```

此方法在不需要自定义 shader 的前提下实现了纹理居中旋转。精度受 UV 变换限制但在 0–360° 范围足够视觉一致。

#### 5. 自定义纹理上传

参考粒子粒子的 `customTexture` 模式（`buildParticleLevel`）：
- 用 `<input type="file" accept="image/*">` 触发文件选择
- `FileReader.readAsDataURL` → 生成 data URL → 写入 `groundTexture` 字段
- 额外「清除」按钮，恢复为无自定义纹理状态
- 支持 data URL 的纹理 URL 前缀检测（`data:`）在 `resolveStaticAsset` 中原样返回

### UI 面板结构（`buildGroundLevel`）

```
[显示地面] toggle
[地面高度] slider (-5 … 5)
[地面模式] modeSlider (纯色 | 网格 | 棋盘格 | 纹理)
[地面色] colorSlider (RGB)

纯色/棋盘格 → [透明度] slider

网格 → [网格大小] slider + [网格线色] colorSlider
棋盘格 → [棋盘格大小] slider + [第二颜色] colorSlider

纹理 → [纹理预设 chips] + [自定义纹理 file picker] + [纹理缩放] slider + [纹理旋转] slider
```

---

## 对比方案

| 方案 | 优点 | 缺点 | 结论 |
|------|------|------|------|
| **A. 现有参数扩展（选中）** | 改动最小，向后兼容 | 纹理旋转不够精确 | ✅ |
| B. 自定义 ShaderMaterial | 可实现任意材质效果 | 维护成本高，无编辑器工具链支持 | ❌ |
| C. 新增 Ground 子类 | 封装性好 | 幅度过大，当前需求热更新即可满足 | ❌ |

---

## 状态持久化

新字段随 `envState` 通过 `scene-serialize.ts` 自动序列化到 `Config.env`。Go 侧的 `EnvState` 结构体为 `omitempty`，新字段在旧配置不存在时用前端默认值补全（`state.ts` 内定）。

---

## 涉及文件

| 文件 | 操作 | 说明 |
|------|------|------|
| `core/types.ts` | 修改 | `EnvState` 接口新增 3 个字段 |
| `core/state.ts` | 修改 | 新增字段默认值 |
| `menus/env-feature-levels.ts` | 修改 | `buildGroundLevel` 渲染新 UI 控件 |
| `scene/env/env-impl.ts` | 修改 | `applyGround` / `applyCheckerGround` 消费新参数 |
| `__tests__/env-state.test.ts` | 修改 | 同步测试全量字段列表 |

---

## 追加记录：地形模式（`heightmap` / Route A）— 2026-07-08

> 本段为 ADR-052 的延伸。地面新增第 5 种模式 `heightmap`：程序化 FBM 噪声生成高度图 → `CreateGroundFromHeightMap` 建**带碰撞**地形网格，MMD 模型可真正站在坡面上。

### 决策：Route A（真实可踩地形）vs Route B（fork 水面着色器）

| 方案 | 优点 | 缺点 | 结论 |
|------|------|------|------|
| **A. CreateGroundFromHeightMap + FBM（选中）** | Babylon 自动生成与视觉一致的碰撞网格；`GroundMesh.getHeightAtCoordinates` 可直接贴地；模型真能站坡 | 高度图异步加载需 `onReady` 回调处理贴地时序；subdivisions 高（200）略增建网格成本 | ✅ |
| B. 复制水面 `WATER_VERT_SRC` 把 Gerstner 求和替换为 FBM | 复用着色器骨架、可动画 | **无碰撞**，模型仍浮在固定高度；且会继承水面 `wavePhase` 冻结 bug（见坑点 2） | ❌ |

结论：目标是「模型在起伏地面上站得住」，必须走 A。B 仅适合纯视觉动态地表，与需求不符。

### 新字段

```typescript
// frontend/src/core/types.ts
groundMode: 'solid' | 'grid' | 'checker' | 'texture' | 'heightmap';
groundTerrainHeight: number;  // 振幅（峰谷差），默认 4
groundTerrainScale:  number;  // 噪声频率/密度，默认 0.06
groundTerrainSeed:   number;  // 确定性种子，默认 1337
groundTerrainOctaves:number;  // FBM 层数，默认 5
```

### 实现要点（详见 `scene/env/env-terrain.ts`）

- **确定性值噪声 FBM**：整数哈希值噪声（非 `Math.random`），同 `(seed, scale, octaves, height)` 必复现同一地形；输出 256² 灰度高度图 data URL。
- **`createHeightmapGround()`**：`MeshBuilder.CreateGroundFromHeightMap('envGround', dataURL, { width:60, height:60, subdivisions:200, minHeight:-h/2, maxHeight:+h/2, onReady })`，返回 `pickable=true` 的 `GroundMesh`（自动带碰撞）。
- **贴地 API**：`env-impl.ts` 导出 `getGroundHeightAt(x,z)`（转发 `GroundMesh.getHeightAtCoordinates`，收 world 坐标返 world Y）与 `setOnTerrainReady(cb)`（地形网格 `onReady` 后触发）。
- **模型贴地**：`model-loader.ts` 加载后 `rootMesh.position.y = getGroundHeightAt(x,z)`；并注册 `setOnTerrainReady`，在地形重建后**重新贴地所有已加载模型**。
- **调参重建**：`env-bridge.ts` 的 `groundKeys` 增加 4 个地形参数，`applyGround` 的 `typeKey` 含地形参数 → 拖滑杆即重建网格（高度图网格无法像材质属性那样热更新）。

### 坑点（Pitfalls）

1. **水面 Gerstner 波形公式不可复用**：Gerstner = 周期行进海浪；地形要的是多倍频噪声（FBM/ridged），数学不对口。且经查 `env-water.ts` 的 `_waterPhase` 全程无 `+=` 自增，波高几何实际处于**冻结静态**，沿用其动画路径需自行补递增逻辑。
2. **`getHeightAtCoordinates(x,z)` 语义**：收 **world 坐标**、返 **world Y**（Babylon 内部已做世界矩阵反变换）。勿传 local 坐标，也勿二次叠加网格 `position.y`。
3. **高度图异步加载**：`CreateGroundFromHeightMap` 在 `onReady` 前网格尚未生成，spawn 时 `getHeightAtCoordinates` 不可用。方案：spawn 先回退 `groundLevel`，`onReady` 回调触发 `getGroundHeightAt` 重新贴地——否则模型浮空且永不落地。
4. **碰撞保真度依赖 subdivisions**：200 细分对 60×60 地面足够；过低 → 碰撞块面化，模型踩进坡里。
5. **避免循环依赖**：`env-impl.ts` 不反向 import `model-loader`；贴地通过 `setOnTerrainReady` 回调注册，由 model 侧主动订阅。
6. **测试契约分离**：`__tests__/mocks/binding-factories.ts` 的 `createMockEnvState` 返回的是 `bindings/.../models.ts`（Go 契约镜像，与 `core/types.ts` 失同步、不含 `groundTexture` 等字段），不可往其中加前端 `EnvState` 字段，否则违反契约类型；前端真实 `EnvState` 字面量测试（如 `env-state.test.ts`）才需同步补字段。

### 追加涉及文件

| 文件 | 操作 | 说明 |
|------|------|------|
| `core/types.ts` | 修改 | `groundMode` 加 `'heightmap'` + 4 个地形字段 |
| `core/state.ts` | 修改 | 4 个地形字段默认值 |
| `scene/env/env-terrain.ts` | **新增** | FBM 值噪声 → 高度图 dataURL + `createHeightmapGround()` |
| `scene/env/env-impl.ts` | 修改 | heightmap 分支；导出 `getGroundHeightAt` / `setOnTerrainReady` |
| `scene/env/env-bridge.ts` | 修改 | `groundKeys` 加 4 个地形参数 |
| `menus/env-feature-levels.ts` | 修改 | 地面模式加「地形」；仅 heightmap 显示 4 个滑杆 |
| `core/i18n/locales/*.ts` (5 语言) | 修改 | 新增 `env.heightmap` / `env.terrainHeight` / `env.terrainScale` / `env.terrainSeed` / `env.terrainOctaves` |
| `scene/manager/model-loader.ts` | 修改 | spawn 贴地 + 注册 `setOnTerrainReady` 重贴地 |
| `__tests__/env-state.test.ts` | 修改 | 同步全量 `EnvState` 字段 |
