# ADR-022: 预设治理 — 统一管理范围与分级架构

> **状态**: 提议
> **日期**: 2026-07-04
> **关联**: ADR-013(天空盒)、ADR-014(模型预设库)、env-lighting-unification.md

---

## 0. 问题陈述

当前项目存在 **3 套预设子系统**，24 个内置预设散落在 3 个菜单域中，各系统独立演进，缺乏统一治理：

| 症状 | 具体表现 |
|------|---------|
| **天空里塞了用户预设** | 环境弹窗"天空"子面板同时渲染 10 个氛围预设 + 用户保存的系统预设快照，用户预设混在天空芯片组中 |
| **同名两套 ENV_PRESETS** | `env-lighting.ts` 和 `env-preset-levels.ts` 各有一套 `ENV_PRESETS`，分别控制不同范围但名称容易混淆 |
| **参数范围重叠** | 氛围预设、系统预设、渲染预设三者都包含 `exposure` + `toneMapping`，应用顺序决定最终效果但用户不可控 |
| **水面预设无家可归** | 水面预设挂在环境弹窗的 `env-feature-levels` 里，与天空、灯光、粒子并列，没有独立的预设管理区 |
| **分类逻辑不统一** | 氛围预设按"时间线+场景"分类，渲染预设按"风格"分类，系统预设按"用途"分类 — 三种维度无统一逻辑 |

## 1. 预设分级架构

将所有预设重新组织为 **三级架构**，每级有明确的管理范围和不可逾越的职责边界：

```
┌─────────────────────────────────────────────────┐
│  L3 · 场景预设 (Scene Preset)                    │
│  管理范围: 全量快照 — 模型+动作+音频+舞台+灯光+     │
│            摄影+环境+渲染+水面 = 完整场景            │
│  内置: 无                                         │
│  用户: 保存/加载 .mmascene                         │
├─────────────────────────────────────────────────┤
│  L2 · 环境预设 (Environment Preset)                │
│  管理范围: 天空 + 光照 + 渲染 + 地面 + 水面 + 粒子   │
│  内置: ≤ 8 个精选组合                               │
│  用户: 保存/加载自定义环境组合                       │
├─────────────────────────────────────────────────┤
│  L1 · 单域预设 (Domain Preset)  ← 精简后的芯片组    │
│  ┌─────────┬──────────┬──────────┬──────────┐    │
│  │ 天空氛围  │ 渲染风格  │ 水面      │ (模型预设)  │    │
│  │ ≤ 6 个   │ ≤ 6 个   │ ≤ 5 个   │ 用户自定义  │    │
│  └─────────┴──────────┴──────────┴──────────┘    │
└─────────────────────────────────────────────────┘
```

## 2. 各级预设管理范围（硬边界）

### L1: 单域预设 — 只管自己的一亩三分地

| 预设域 | 管理范围（允许读写的字段） | 禁止触碰的字段 |
|--------|--------------------------|--------------|
| **天空氛围** | `skyColorTop`, `skyColorBot`, `sunAngle`, `azimuth` | 光照、渲染、地面、水面、粒子 — 全部禁止 |
| **渲染风格** | `bloom*`, `fxaaEnabled`, `outline*`, `toneMapping`, `exposure`, `contrast`, `fov`, `vignette*`, `dof*`, `chromaticAberration*`, `grain*` | 天空、光照、地面、水面 — 全部禁止 |
| **水面** | `waterColor`, `waterTransparency`, `waterWaveHeight`, `waterAnimSpeed`, `foam*`, `fresnel*`, `caustic*`, `ripple*` | 天空、光照、渲染、地面 — 全部禁止 |
| **模型预设** | `model`, `visibility`, `vmd`, `audio`, `material` (含 `materialEnabled`【待修复】) | 环境、渲染、其他模型 — 全部禁止 |

**规则**: L1 预设只能修改自己域内的字段。`exposure` 和 `toneMapping` 归渲染风格独占，天空氛围预设不再包含这两个字段。

### L2: 环境预设 — 组合型预设，可跨域但只限环境+光照+渲染

| 允许组合的域 | 包含字段 |
|-------------|---------|
| 天空 | `skyColorTop/Bot/Mid`, `skyBrightness`, `skyMode` |
| 光照 | `hemiIntensity`, `dirIntensity`, `dirColor`, `hemiColor`, `shadowEnabled`, `shadowType` |
| 渲染 | `exposure`, `toneMapping`, `vignetteEnabled/Darkness` |
| 地面 | `groundMode`, `groundColor` |
| 水面 | `particleEnabled`, `particleType` (注: 粒子归属环境域而非天空域) |
| 粒子 |  |

**禁止**: 不包含 `bloom*`, `outline*`, `dof*`, `chromaticAberration*`, `grain*` 等高级后处理参数。这些属于 L1 渲染风格的独占领域。

### L3: 场景预设 — 全量快照，上帝视角

序列化所有状态。L3 不设内置预设，全部由用户创建。

## 3. 精简方案 — 预设数量和命名

### L1 天空氛围: 10 → 6

**保留**（覆盖完整时间线 + 极端场景）:

| key | label | 保留理由 |
|-----|-------|---------|
| `dawn` | 黎明 | 时间线起点 |
| `noon` | 正午 | 时间线中点 |
| `sunset` | 夕阳 | 时间线终点，最常用 |
| `night` | 夜景 | 深夜极端场景 |
| `overcast` | 阴天 | 天气变体 |
| `neon` | 霓虹夜 | 非自然光场景 |

**移除**:

| key | 理由 |
|-----|------|
| `dusk` | 与 sunset 过于接近（仅太阳角差 12°），合并入 sunset |
| `storm` | 阴天已覆盖低亮度天气场景，可通过调节 skyBrightness 实现 |
| `sakura` | 色彩特殊但使用频率低，适合作为 L2 用户自定义预设 |
| `concert` | 与 neon 功能重叠，且演唱会场景更适合作为 L2 环境组合预设 |

**接口变更**: `EnvPreset` 移除 `exposure` 和 `toneMapping` 字段，交由渲染风格域管理。光照参数 (`DerivedLighting`) 保留自动派生，但作为内部实现不暴露给用户。

### L1 渲染风格: 6 → 6（不变）

当前 6 个渲染预设覆盖合理，保持不变：
`standard` / `cinematic` / `cartoon` / `realistic` / `warm` / `cyberpunk`

### L1 水面: 5 → 5（不变）

当前 5 个水面预设覆盖合理，保持不变：
`calm` / `ripple` / `ocean` / `storm` / `tropical`

### L2 环境预设: 3 → 8（精选组合）

L2 是本次整治的重点。将原来的 3 个系统预设扩展为 8 个精选组合，覆盖最常见的使用场景：

| key | label | 天空基调 | 光照特征 | 渲染风格 | 适用场景 |
|-----|-------|---------|---------|---------|---------|
| `stage-a` | 舞台-A | 暗色程序化 | 低环境光+软阴影 | Reinhard + vignette | 舞台表演 |
| `outdoor` | 户外晴天 | 蓝天程序化 | 高亮度 | ACES + 高曝光 | 户外展示 |
| `concert` | 演唱会 | 蓝紫渐变 | 紫色方向光+无阴影 | ACES + vignette | 夜间演出 |
| `studio` | 摄影棚 | 纯色天空 | 三点布光 | ACES | 模型展示/截图 |
| `sunset-glow` | 黄昏柔光 | 暖色渐变 | 暖色方向光 | Reinhard + 暖vignette | 氛围场景 |
| `rainy-day` | 雨天 | 灰色低亮度 | 柔和漫反射 | Neutral | 雨天/水洼场景 |
| `sakura` | 樱花季 | 粉色高亮度 | 暖色柔和 | Reinhard + 高曝光 | 春日/樱花（从L1降级到此） |
| `cyber-city` | 赛博都市 | 深蓝黑+霓虹 | 多色点光 | Neutral + bloom | 夜景/霓虹（与L1渲染联动） |

> **说明**: 原 L1 中移除的 `sakura` 和 `concert` 以更完整的组合形态在 L2 复活。

## 4. 菜单架构重组

### 当前菜单布局（混乱）

```
环境弹窗
├── ☀️ 天空
│   ├── L1 天空氛围预设芯片组（10个）     ← 包含了用户预设快照？
│   ├── skyMode 切换
│   ├── 天空颜色滑块...
│   └── [保存环境预设] 按钮              ← 用户预设出现在天空里！
├── 🌊 水面（混在 env-feature-levels 里）
│   └── 水面预设芯片组（5个）
├── 💡 灯光滑块...
├── 🎭 系统预设
│   ├── 3个内置系统预设
│   └── 用户自定义预设列表（我的预设）
└── ...

场景弹窗
├── 🎭 渲染预设芯片组（6个）
├── 📋 预设场景列表
└── 渲染参数滑块...
```

### 目标菜单布局（清晰）

```
场景弹窗 (Scene)
├── 🎬 预设场景 (L3)           → 用户保存的完整场景快照
├── 🎨 渲染风格 (L1)           → 6 个内置风格芯片组
└── 渲染参数滑块...

环境弹窗 (Environment)
├── 🎭 环境预设 (L2)           → 8 个精选组合 + 用户自定义环境预设 [保存/管理]
│   ├── 内置组合芯片组
│   └── 我的预设 [保存当前环境] [删除]
├── ☀️ 天空氛围 (L1)           → 6 个内置芯片组（纯天空，无 exposure/toneMapping）
│   ├── 预设芯片组
│   └── 天空参数微调滑块
├── 🌊 水面 (L1)               → 5 个内置芯片组
│   ├── 预设芯片组
│   └── 水面参数微调滑块
├── 💡 光照参数
├── 🌍 地面参数
└── ✨ 粒子/特效参数
```

**关键变更**:
1. **"系统预设"重命名为"环境预设"**，提升为环境弹窗的**第一个子面板**
2. **用户预设快照从天空子面板移出**，归属到环境预设的"我的预设"区域
3. **天空氛围预设精简到 6 个**，只管天空颜色和太阳角度
4. **水面提升为独立子面板**（从 env-feature-levels 中独立出来）

## 5. 技术实施方案

### 5.1 接口变更

```typescript
// env-lighting.ts — EnvPreset 精简
interface EnvPreset {
  label: string;
  skyColorTop: [number, number, number];
  skyColorBot: [number, number, number];
  sunAngle: number;
  azimuth: number;
  // 移除: exposure, toneMapping — 归渲染风格域
}

// env-preset-levels.ts — EnvPresetConfig 保持不变（L2 组合预设）
// 范围: env + lights + render(subset: 仅 exposure/toneMapping/vignette)
```

### 5.2 预设精简

| 操作 | 文件 | 详情 |
|------|------|------|
| 删除 `dusk` 预设 | `env-lighting.ts` | 从 `ENV_PRESETS` 移除 |
| 删除 `storm` 预设 | `env-lighting.ts` | 从 `ENV_PRESETS` 移除 |
| 删除 `sakura` 预设 | `env-lighting.ts` | 从 `ENV_PRESETS` 移除（L2 中有替代） |
| 删除 `concert` 预设 | `env-lighting.ts` | 从 `ENV_PRESETS` 移除（L2 中有替代） |
| 移除 exposure/toneMapping | `env-lighting.ts` | `EnvPreset` 接口 + 所有 6 个预设值 |
| 新增 5 个 L2 内置预设 | `env-preset-levels.ts` | studio / sunset-glow / rainy-day / sakura / cyber-city |
| 同步更新 `DerivedLighting` 派生逻辑 | `env-lighting.ts` | exposure 不再从预设获取，使用当前 RenderState 的值 |

### 5.3 菜单重组

| 操作 | 文件 | 详情 |
|------|------|------|
| 环境预设子面板提升为首个 | `env-menu.ts` | `buildPresetLevel()` 调用顺序调整 |
| 天空氛围子面板移除用户预设按钮 | `env-menu.ts` | 删除 `buildEnvLightingLevel` 中的保存按钮引用 |
| 水面提升为独立子面板 | `env-feature-levels.ts` → `env-water-levels.ts` | 从 feature-levels 中拆出水面相关代码 |
| L1→L2→L3 层级传递机制 | `env-bridge.ts` | 新增 `applyEnvPresetCascade(preset)` — L2 应用时先设 L1 天空参数，再设光照，最后设渲染子集 |

### 5.4 向后兼容

- 用户已保存的自定义环境预设（`.json`）不受影响，加载时自动适配新接口（多余字段忽略）
- `exportEnvPreset` / `importEnvPreset` 格式不变，新增字段为 optional
- L2 预设的 `render` 字段中不再包含 bloom/dof 等高级后处理，已有 L2 用户预设中的这些字段将被忽略

## 6. 实施优先级

| 优先级 | 任务 | 工作量 | 依赖 |
|--------|------|--------|------|
| P0 | EnvPreset 接口移除 exposure/toneMapping | 小 | 无 |
| P0 | 天空氛围预设从 10 精简到 6 | 小 | P0 接口变更 |
| P1 | 环境预设子面板提升 + 重命名 | 中 | P0 |
| P1 | 用户预设快照从天空移到环境预设 | 中 | P1 菜单重组 |
| P1 | 新增 5 个 L2 精选组合预设 | 中 | P0 |
| P2 | 水面独立子面板拆分 | 中 | 无 |
| P2 | L2→L1 级联应用机制 | 中 | P0+P1 |
| P3 | 模型预设 materialEnabled 修复 (ADR-014 遗留) | 小 | 无 |
| P3 | 场景预设 (L3) 全量快照实现 | 大 | 全部 |

## 7. 最终预设清单

### 精简后总量: 25 个内置 + 用户自定义

| 层级 | 域 | 内置数量 | 精简前 | 变化 |
|------|----|---------|-------|------|
| L1 | 天空氛围 | 6 | 10 | -4 |
| L1 | 渲染风格 | 6 | 6 | 0 |
| L1 | 水面 | 5 | 5 | 0 |
| L2 | 环境组合 | 8 | 3 | +5 |
| **合计** | | **25** | **24** | +1 |

虽然总数从 24 增加到 25，但结构从"3 套平行的预设散落在不同菜单"变为"清晰的 3 级层级架构"，每个预设的管理范围有硬边界。用户视角的混乱感大幅降低。

## 8. 命名规范

为避免未来再次出现预设命名混乱，建立统一规范：

| 规则 | 说明 | 示例 |
|------|------|------|
| L1 预设用英文 key | 简短小写，无连字符 | `dawn`, `noon`, `sunset` |
| L2 预设用英文 key + 中文 label | key 用 kebab-case | `stage-a`, `sunset-glow` |
| L1 label 用中文双字 | 简洁统一 | `黎明`, `正午`, `夕阳` |
| L2 label 用中文四字以内 | 描述场景全貌 | `舞台-A`, `户外晴天`, `赛博都市` |
| 禁止同名预设跨域 | 同名 key 不可出现在不同域 | ❌ 两套 `ENV_PRESETS` |
