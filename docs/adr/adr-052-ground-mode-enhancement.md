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
