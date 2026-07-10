# ADR-076: 卡通化渲染后处理模式

**日期**：2026-07-09
> **状态**: ✅ 已实施（2026-07-10）

---

## 背景

用户反馈游戏内提取模型（如《少女前线2：追放》妮基塔）在 PBR 标准光照下"光很难调，要么过曝要么黑皮"。

根因分析：

1. **游戏模型贴图参数为引擎定制** — diffuse/specular/toon 的数值范围按游戏引擎光照管线校准，直接套入 Babylon.js StandardMaterial 会导致高光炸裂或暗部死黑
2. **PBR 色调映射在 MMD 模型上表现极端** — exposure 稍高就过曝，稍低就黑皮，可调窗口极窄
3. **MMD 原生 toon 贴图提供色阶分段** — 但游戏提取模型常缺失 toon 或 toon 路径损坏（见 ADR-069 审计），色阶过渡全靠光照线性插值，缺乏卡通"色块感"

用户诉求：**不逐材质调参，一键让角色看起来像卡通渲染**。

---

## 决策

**在后处理层（`DefaultRenderingPipeline`）实现 cel-shading 开关，不改动材质系统。**

### 为什么不替换为真正的 CelMaterial / ToonMaterial

| 方案 | 优点 | 致命风险 |
|------|------|----------|
| 替换 StandardMaterial → CelMaterial | 真正的色阶量化 | babylon-mmd morph 绑死 StandardMaterial（ADR-024 同样的 PBR 致命风险），换材质会表情失效 |
| NodeMaterial 自定义着色器 | 灵活控制色阶 | 维护成本高，与 babylon-mmd 版本升级冲突 |
| **后处理参数组合（本方案）** | 零材质改动，开关式，可逆 | 非真正色阶量化，仅是"卡通倾向" |

延续 ADR-024 / ADR-069 的边界：**不触碰材质类型，morph 安全第一**。

### 参数组合

开启时自动应用以下后处理参数，关闭时恢复用户之前的设置：

| 参数 | 默认值 | 卡通化值 | 效果 |
|------|--------|----------|------|
| `exposure` | 1.0 | 0.7 | 压低高光，避免过曝 |
| `contrast` | 1.0 | 1.4 | 增强明暗分界，模拟色块 |
| `toneMapping` | OFF | ACES | 压缩动态范围，保留暗部细节 |
| `bloomEnabled` | false | true | 边缘发光，增强卡通感 |
| `bloomWeight` | 0 | 0.25 | 轻微泛光，不过曝 |
| `fxaaEnabled` | false | true | 平滑边缘，模拟卡通描边 |

### 为什么不直接做色阶量化后处理

Babylon.js 的 `DefaultRenderingPipeline` 不内置 posterize 后处理。自行实现需要写 `PostProcess` shader，维护成本高且与 SSR/SSAO 等现有后处理链的渲染顺序需要仔细排序。当前参数组合已能显著改善"光难调"问题，性价比最高。

---

## 实施

### 代码改动

| 文件 | 改动 |
|------|------|
| [renderer.ts](file:///c:/Users/zhujieling11/MikuMikuAR/frontend/src/scene/render/renderer.ts) | `RenderState` 新增 `celShadingMode: boolean`（L70）；模块变量 `_celShadingMode` + `_originalRenderState`（L89-90）；`getRenderState()` / `defaultRenderState()` 支持；`_applyRenderState` 新增 cel-shading 快照/恢复逻辑块（L589-607）；`transitionRenderState` boolKeys 支持（L683）|
| [scene-render-levels.ts](file:///c:/Users/zhujieling11/MikuMikuAR/frontend/src/menus/scene-render-levels.ts) | 色调映射折叠区内、对比度滑块下方新增 `celShading` 开关（`addToggleRow`，图标 `lucide:sparkles`）|
| 5 个 locale 文件 | `scene.celShading` 已有 5 种语言翻译（zh-CN/zh-TW/en/ja/ko）|

### 状态快照机制

- `_originalRenderState`：模块级变量，开启卡通化时快照当前 6 个参数
- 关闭时从快照恢复，快照清空
- **不参与序列化**：`celShadingMode` 本身会序列化（保存到场景文件），但 `_originalRenderState` 是运行时内存状态，不持久化
- **与用户手动调参互斥**：卡通化开启期间，用户手动调 exposure/contrast 等会覆盖卡通值，但关闭时仍恢复到开启前的快照

### UI 位置

```
场景菜单 → 渲染 → 后处理 → 色调映射 ▸ → 卡通化渲染 [开关]
```

---

## 限制

1. **非真正色阶量化** — 本方案是后处理参数组合，不是真正的 cel-shading shader。对比度提升模拟色块感，但渐变仍是线性的
2. **参数固定** — 6 个卡通参数硬编码在 `_applyRenderState` 中，用户无法微调（如果需要可后续暴露滑块）
3. **与手动调参冲突** — 卡通化开启期间手动调 exposure 等会被记录为"卡通值"，关闭时恢复的是开启前的旧值而非手动调过的新值
4. **游戏模型专属** — 对原生 MMD 模型（已有 toon 贴图）效果不明显，主要面向游戏提取模型

---

## 关联 ADR

- ADR-024 渲染增强 Phase 2 — `reflectionTexture` 后挂路径 + PBR 延期决策（morph 致命风险），本 ADR 延续"不换材质类型"边界
- ADR-069 材质面板纹理支持审计 — toon/sphere 贴图槽位审计，本 ADR 针对游戏模型缺失 toon 的兜底方案
- ADR-046 渲染自定义模式 — `DefaultRenderingPipeline` 的既有参数管理体系
