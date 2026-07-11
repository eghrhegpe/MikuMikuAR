# ADR-091: 地面纹理统一 —— 4 种样式合并为单一 canvas + StandardMaterial 路径

> **状态**: 已完成

## 1. 背景

地面系统历经 ADR-052（4 种模式增强）、ADR-083（追加 heightmap）、ADR-089（groundType/groundStyle 拆分）后，`applyGround` 中有 **3 条完全独立的渲染路径**：

| 样式 | 技术路径 | 问题 |
|------|---------|------|
| `solid` | `StandardMaterial.diffuseColor` | 无 |
| `grid` | `GridMaterial`（Babylon.js 独立 shader） | WebGL shader 编译延迟导致首次渲染变纯色；重启后才恢复 |
| `checker` | canvas 128×128 → `toDataURL()` → `Texture` → `StandardMaterial` | canvas 分辨率低、toDataURL 编码可能异步、常被  `opacityTexture` 遮挡导致不可见 |
| `texture` | 外部图片 → `Texture` → `StandardMaterial` | 切换样式后需要手动刷新 |

3 条路径维护成本高且各自有独立 bug：grid 切换后变纯色、checker 从未真正显示、纹理切换不自动刷新。

## 2. 决策

**所有非地形（`groundType === 'flat'`）样式统一使用 `canvas → StandardMaterial.diffuseTexture` 单一路径。**

- 删除 `GridMaterial` 依赖（不再需要 `@babylonjs/materials` 包）
- 新增 `_generateGroundTexture(state, scene)` 函数：在 512×512 canvas 上绘制图案后返回 `Texture`
- 新增 `_updateGroundTexture(mat, state)` 函数：原地更新现有 material 的 diffuseTexture
- `applyGround` 的创建路径和原地更新路径统一调用这两个函数
- 纹理样式（`texture`）保留外部图片加载路径，不经过 canvas

### 2.1 canvas 绘制规则

| `groundStyle` | 绘制内容 |
|---------------|---------|
| `solid` | `fillRect(0,0,512,512)` 用 `groundColor` 填充 |
| `grid` | 先用 `groundColor` 填充底，再用 `groundLineColor` 画纵/横网格线（`lineWidth` 随 tileSize 自适应） |
| `checker` | 按 `groundPattern` 绘制（checker/dots/stripes/radial），两色为 `groundColor` + `groundLineColor`，分辨率 512 |

### 2.2 跟随相机

观察者中的 ground follow camera 逻辑从仅限 `groundStyle === 'grid'` 扩展为所有 flat 样式通用。

## 3. 优点

1. **单一渲染路径**：solid/grid/checker 走同一份代码，减少维护成本和 bug
2. **无 shader 编译延迟**：不再依赖 `GridMaterial` 的独立 WebGL shader，切换样式瞬间生效
3. **高分辨率**：canvas 从 128×128 提升到 512×512，网格线/棋盘格更清晰
4. **立即生效**：`_updateGroundTexture` 在颜色/间距/图案变化时直接重画 canvas 并替换 `diffuseTexture`，无需重建 material
5. **一致的透明度处理**：`opacityTexture`（边缘淡出）对所有样式统一挂载，不再为 checker 单独跳过
6. **一致的反射处理**：所有样式都使用 `StandardMaterial`，`buildGroundReflection` 的 `reflectionTexture` 挂载无需条件判断

## 4. 弃用的模块

- `import { GridMaterial } from '@babylonjs/materials/grid/gridMaterial'` — 已删除
- `function applyProceduralGround(ground, state)` — 替换为 `_generateGroundTexture`
- `function _updateCheckerTexture(mat, state)` — 替换为 `_updateGroundTexture`
- 所有 `GridMaterial` 类型引用（含 `applyGroundEdgeFade` 签名中的 `GridMaterial`）— 已删除

## 5. 测试验证

- TypeScript 编译：无错误
- 环境测试：88 个全部通过（env-bridge 72 + env-state 16）
- 全量测试 1266 个中 env 相关全部通过

## 6. 后续优化方向

- canvas 生成可通过 `DynamicTexture` 进一步优化（避免 toDataURL 的 PNG 编码开销）
- 网格线宽度可加 slider 控制，当前固定按 tileSize 比例计算