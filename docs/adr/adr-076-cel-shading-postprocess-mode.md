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
3. ~~**与手动调参冲突** — 卡通化开启期间手动调 exposure 等会被记录为"卡通值"，关闭时恢复的是开启前的旧值而非手动调过的新值~~ **已修复（2026-07-19 修订，见下）**
4. **游戏模型专属** — 对原生 MMD 模型（已有 toon 贴图）效果不明显，主要面向游戏提取模型

---

## 关联 ADR

- ADR-024 渲染增强 Phase 2 — `reflectionTexture` 后挂路径 + PBR 延期决策（morph 致命风险），本 ADR 延续"不换材质类型"边界
- ADR-069 材质面板纹理支持审计 — toon/sphere 贴图槽位审计，本 ADR 针对游戏模型缺失 toon 的兜底方案
- ADR-046 渲染自定义模式 — `DefaultRenderingPipeline` 的既有参数管理体系

---

## 修订记录

### 2026-07-19 Rev 1：动态快照 + 递归栈溢出修复

**修掉的限制**：原限制 #3「与手动调参冲突」。

**修订机制**：在 `_applyRenderState` 入口新增动态快照同步逻辑——卡通化开启期间（`_celShadingMode === true`），凡用户手动调用 `setRenderState` 修改 6 个卡通管控字段（`s.celShadingMode === undefined` 表示非开关自身预设应用调用），实时同步到 `_originalRenderState`。关闭时恢复的就是用户调过的最新意图，而非开启前的旧快照。

```ts
if (_celShadingMode && s.celShadingMode === undefined && _originalRenderState) {
    if (s.exposure !== undefined) _originalRenderState.exposure = s.exposure;
    if (s.contrast !== undefined) _originalRenderState.contrast = s.contrast;
    if (s.toneMapping !== undefined) _originalRenderState.toneMapping = s.toneMapping;
    if (s.bloomEnabled !== undefined) _originalRenderState.bloomEnabled = s.bloomEnabled;
    if (s.bloomWeight !== undefined) _originalRenderState.bloomWeight = s.bloomWeight;
    if (s.fxaaEnabled !== undefined) _originalRenderState.fxaaEnabled = s.fxaaEnabled;
}
```

**附带修复**：关闭卡通化时的无限递归栈溢出 bug。原代码 `_applyRenderState(_originalRenderState)` 中，快照里的 `celShadingMode: false` 会再次进入 else 分支（`s.celShadingMode !== undefined`），而 `_originalRenderState` 仍非空 → 无限递归 → 栈溢出 → `setRenderState` 抛 `RangeError`，`_triggerAutoSave` / `scheduleRefresh` 不执行，UI 显示与 pipeline 实际值脱节，表现为「色调映射之类的菜单被重置为默认值」。

修复方式：递归前清空 `_originalRenderState`，并从快照中剥离 `celShadingMode` 字段后再递归：

```ts
const snapshot = _originalRenderState;
_originalRenderState = null;
const { celShadingMode: _ignored, ...rest } = snapshot;
_applyRenderState(rest);
```

**不影响**：
- 快照/恢复核心机制不变
- 序列化行为不变（`celShadingMode` 仍持久化，`_originalRenderState` 仍为内存态）
- UI 不变
- `transitionRenderState` 中间帧逻辑不变（中间帧调 `_applyRenderState` 时 `s.celShadingMode === undefined`，但中间帧只改数值字段，6 个卡通管控字段中有 5 个是数值/布尔，会同步进快照——这是期望行为，过渡目标值即用户最终意图）

**仍待决（限制 #1 升级）**：用户反馈现行 6 个参数组合（exposure/contrast/toneMapping ACES/bloom/bloomWeight/fxaa）实际上做不出真正的卡通化效果，仅是"调色倾向"。后续可选方向：
1. **诚实重命名**：i18n key 从 `scene.celShading` 改为 `scene.softToning`（柔和调色），UI 文案与实际效果对齐
2. **升级为真正 cel-shading**：自定义 `PostProcess` shader 实现 posterize（色阶量化 `floor(color * levels) / levels`）+ Sobel 边缘描边，挂到 `DefaultRenderingPipeline` 末尾。30~80 行 shader，无材质改动，仍符合本 ADR "不触碰材质类型" 边界
3. **保留现状**：作为游戏提取模型「光难调」的快速兜底预设，承认非真正卡通化

### 2026-07-19 Rev 2：诚实重命名（方向 1 已实施）

**问题**：用户反馈「这几个选项不可能制作出卡通化的效果」，与限制 #1 自述的"非真正色阶量化"一致，但 UI 文案「卡通化渲染 / Cel-shading」误导用户期望真正的卡通着色。

**修订**：采纳方向 1（诚实重命名）。UI 文案改为「柔和调色」，与实际效果（exposure↓ + contrast↑ + ACES + 轻微 bloom + fxaa 的调色组合）对齐。

| 语言 | 原文案 | 新文案 |
|------|--------|--------|
| zh-CN | 卡通化渲染 | 柔和调色 |
| zh-TW | 卡通化渲染 | 柔和調色 |
| en | Cel-shading | Soft toning |
| ja | セルシェーディング | ソフト調色 |
| ko | 셀 쉐이딩 | 소프트 토닝 |

**图标**：`lucide:sparkles`（暗示卡通魔法）→ `lucide:droplet`（调色/液态感，与「色调映射」折叠组上下文一致）。

**不改**：
- i18n key 仍为 `scene.celShading`（避免 5 个 locale 文件 key 重命名 + 全局搜索替换的连锁改动；key 是稳定标识符，文案才是用户可见层）
- 代码字段名 `celShadingMode` / `_celShadingMode` / `_originalRenderState` 仍保持，避免状态序列化兼容性破坏（已保存的场景文件中 `celShadingMode: true/false` 仍可正确反序列化）
- ADR 标题仍为「卡通化渲染后处理模式」（历史命名，保留可追溯性；实际效果以本修订记录为准）

**遗留**：限制 #1（非真正色阶量化）仍存在。如未来需要真正的卡通着色效果，走方向 2（自定义 posterize + Sobel shader），届时可考虑新建 ADR-076B 而非修订本 ADR。

### 2026-07-22 Rev 3：设计契合度完善（缺口 #1 + 命名分层 + anime 组合预设）

**背景**：审查发现「卡通化 Cel-shading 后处理」与「渲染预设」两套状态机未打通，导致 3 处设计—使用场景不契合：
1. **缺口 #1（预设不可忠实还原）**：`celShadingMode` 开启分支（`renderer.ts` `_applyRenderState`）无条件硬码 6 参（exposure 0.7 / contrast 1.4 / ACES / bloom 0.25 / fxaa），丢弃调用方已携带的同名字段。后果：用户保存的 cel 观感（含手动微调）被强制覆盖回 0.7，违反预设系统"保存当前观感→精确还原"契约。
2. **命名重叠**：`celShadingMode` 开关已在 Rev 2 改名为"柔和调色"，但 `cartoon` FILTER_PRESET 仍标"卡通"，两者都暗示 cel-shading 而都不是，语义重叠无层次。
3. **无一键 anime**：经典动漫观感 = 色块感 + 描边，需手动同时开 cel 开关 + cartoon 预设，无组合入口。

**修订**：
- **缺口 #1 修复**（`renderer.ts`：`_applyRenderState` cel-ON 分支）：改为 `s.exposure ?? 0.7` 等"尊重已提供字段、仅回填默认"，cel 预设现可忠实还原用户自定义参数。UI 开关（仅传 `celShadingMode:true`）行为不变，仍回填 0.7 默认值。
- **命名分层**：`cartoon` 预设 5 语言文案改为"描边风 / Outline / アウトライン / 아웃라인"，与"柔和调色"形成 `柔和调色（cel 观感）` ⊂ `描边风（outline）` ⊂ `动漫（两者组合）` 的层级。
- **新增 `anime` 组合预设**（`scene-render-presets.ts` `FILTER_PRESETS`）：`celShadingMode:true + outlineEnabled:true + ACES + exposure 0.7 + contrast 1.4 + bloom 0.3 + fxaa`，一键 anime 观感；同步 `FILTER_PRESET_LABELS` / `FILTER_PRESET_DESCS` 与 5 语言 locale。芯片 UI 由 `buildPresetsSchema` 自动遍历生成，无需额外改动。

**不影响**：快照/恢复核心机制、序列化（key 不变）、`cartoon` 预设原有参数化能力、真 cel-shading（限制 #1）仍待方向 2。

**验证**：`cd frontend && npm run build` + `npm run test` 通过；新增 anime 预设经 `transitionRenderState({...defaultRenderState(), ...anime})` 路径验证 cel 参数被忠实应用。

### 2026-07-22 Rev 4：方向 2 落地——真 cel-shading 后处理（posterize + Sobel）

**问题**：Rev 2/Rev 3 仍保留限制 #1「非真正色阶量化」——`celShadingMode` 仅是调色参数组合（柔和调色），无 posterize / Sobel 后处理，做不出真正卡通着色的色块感与描边。用户期望的"卡通化 Cel-shading"根因未消除。

**修订**：采纳方向 2，在 `DefaultRenderingPipeline` 末尾挂自定义 `PostProcess` shader，零材质改动，仍守 ADR-076「不触碰材质类型」边界。

**实现**：
- `renderer.ts` 新增 `Effect.ShadersStore['celShadingFragmentShader']`：对最终图像做 `floor(color * colorLevels) / colorLevels` 色阶量化（posterize）+ 基于亮度的 Sobel 边缘检测，边缘处压暗形成黑描边。
- 新增 `_ensureCelPostProcess(enabled)`：复用 ADR-114 接触阴影 `PostProcess` 范式（`camera.attachPostProcess`），将 cel PP 挂相机后处理链末尾，运行于色调映射 + bloom 之后。
- `celShadingMode` 开关驱动：`_applyRenderState` cel-ON 分支创建并挂接 cel PP（保留既有柔和调色参数组合打底），cel-OFF 分支销毁 PP；`disposeRenderer` 级联释放 `_celPP`。
- 新增 3 个可调参数（序列化进 `RenderState`，场景文件可持久化）：
  - `celColorLevels` 2–8（色阶段数，默认 4）
  - `celEdgeThreshold` 0–1（Sobel 边缘灵敏度，默认 0.2）
  - `celEdgeStrength` 0–1（描边强度，默认 0.6）
- `getRenderState` / `defaultRenderState` 同步读取与默认；`_applyRenderState` 无条件更新模块变量（PP `onApply` handler 每帧读取，过渡中间帧即生效）；`transitionRenderState` 的 `numericKeys` 收录三者，anime 预设过渡可平滑插值。
- `scene-render-levels.ts`：在"柔和调色"开关下新增 3 个滑块（`visibleWhen: celShadingMode`），暴露实时微调。
- `scene-render-presets.ts` `anime` 预设补充 `celColorLevels:4 / celEdgeThreshold:0.15 / celEdgeStrength:0.7`，一键 anime 观感现为"柔和调色 + 真色块量化 + 黑描边 + 描边"完整组合。
- 5 语言 locale 新增 `scene.celColorLevels / celEdgeThreshold / celEdgeStrength` 文案。

**效果**：开启"柔和调色"即获得真正 cel-shading（色块化 + 黑描边），可经滑块微调色阶数与描边强度/灵敏度；anime 预设一键直达完整动漫观感。限制 #1 正式消除。

**不影响**：morph / 材质类型（仍零改动）；快照/恢复机制；序列化 key 兼容（旧存档 `celShadingMode` 仍可反序列化）；ContactShadow / SSR / SSAO 等既有后处理链。

**验证**：`cd frontend && npm run build`（tsc + vite）0 错误；`npm run test` 1858/1858 全绿；anime 预设经 `transitionRenderState` 路径验证 cel 参数（含 posterize/Sobel PP 创建）被忠实应用。
