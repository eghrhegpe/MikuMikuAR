# ADR-132: 环境亮度统一标量（EnvBrightness Unification）

- **状态**：已实施（2026-07-21 UI/i18n/预设层补齐闭环）
- **日期**：2026-07-18
- **相关**：ADR-113（体积云）、ADR-115（水面 glint）、ADR-026（环境系统增强）、ADR-120（环境预设分类）

## 背景与问题

环境光照体系当前由**五套互不相干的亮度旋钮**各自驱动，没有任何统一标量把"天空 / 云 / IBL / 环境光 / 方向光"的明暗基准耦合起来：

| 旋钮 | envState 字段 | UI 绑定 | 主要消费位置 | 作用对象 |
|------|--------------|---------|--------------|----------|
| 天空亮度 | `skyBrightness` | `env:sky` (0.1–5) | `env-sky.ts:96` `drawSkyGradient` | 天空底色 |
| 环境/IBL | `envIntensity` | `env:env` | `env-bridge.ts:248`（环境色）、`env-sky.ts:278/392`（IBL 立方体）、`env-water.ts:453`（水面 cubemap 反射） | 场景环境光 + 反射 |
| 太阳强度 | `dirIntensity`（`light.dirIntensity`） | `env:sky:sunIntensity` (0–1) | 方向光 intensity + `env-clouds.ts` `brightness` | 云主亮 + Mesh 主光 |
| 半球光 | `hemiIntensity` | — | `env-bridge.ts:243` | 补光 |
| 云亮度 | `brightness`（派生自 `dirIntensity*1.5`） | 无独立 UI | `env-clouds.ts` | 云整体 |

这导致两个结构性缺陷：

1. **昼夜割裂（用户目检确认）**：夜晚 `dirIntensity` 下降时，云与 Mesh 变暗，但 `skyBrightness` 不变 → 天空依旧亮蓝、水面反射依旧亮蓝。五套旋钮中没有任何一个能"一次性把全局压暗"。
2. **云层脱离环境（ADR-115 遗留）**：云层 `brightness` 只吃太阳 `dirIntensity*1.5`，完全不吃 `skyBrightness`/`envIntensity`。在 21:48 的预研中已临时让云暗部（ambient 项）接入 `skyBrightness`，但增益偏弱（仅作用于暗部，亮部 S 项仍只吃太阳），未解决根因——**缺统一基准**。

该问题在 ADR-115 体积云调优期间被发现，用户明确诊断为"亮度体系好迷"。本 ADR 将其上升为正式架构决策。

## 决策

引入**一等环境主亮度标量 `envBrightness`**（默认 `1.0`，UI 范围 `0.1–3`），作为天空 / 云 / IBL / 环境光 / 方向光的**统一明暗基准**。

每个子系统的"绝对亮度" = 其现有计算 × `envBrightness`；保留既有的 `skyBrightness` / `envIntensity` / `dirIntensity` / `hemiIntensity` 作为**在 `envBrightness` 基准之上的风格化微调乘子**（默认取值维持现状，使默认观感零变化）。

```ts
// 派生规则（所有消费点统一套用）
const EB = state.envBrightness;                 // 主标量，默认 1.0
const effectiveSky   = state.skyBrightness * EB; // 天空底色
const effectiveEnv   = state.envIntensity * EB;  // IBL / 环境色 / 水面反射
const effectiveSun   = state.dirIntensity  * EB; // 方向光 + 云 brightness 基准
```

语义变化：`dirIntensity` 从"绝对太阳强度"退居为"相对主亮度的光照对比度乘子"；`envBrightness` 成为昼夜/全局明暗的唯一主控。

## 方案（细化设计）

> 设 `EB = state.envBrightness ?? 1`，各消费点统一乘 `EB`。下列行号均来自 2026-07-18 实测。

### 1. 类型基座
- `core/types.ts`（`EnvState`）：新增 `envBrightness: number;`（默认 `1.0`）。
- `internal/app/app.go:415` `EnvState` struct，在 `EnvIntensity`（425 行）后插入：
  ```go
  EnvBrightness    float64    `json:"envBrightness"`
  ```
- 铁律：前端 `EnvState` 字段必须同步存在于 Go 端，否则序列化丢失。

### 2. UI 主旋钮（`menus/env-feature-levels.ts`）
- 建议新增独立层级 `buildBrightnessLevel()` 挂 env 根菜单首位；或就近插入 `buildSkyLevel`（85 行）的 `env:sky:presets`（90 行）之上：
  ```ts
  {
      id: 'env:sky:globalBrightness',
      label: 'env.environmentBrightness',
      control: { bind: 'env.envBrightness', min: 0.1, max: 3, step: 0.05 },
  }
  ```
- 绑定 `env.envBrightness`，默认 `1.0`。精确层级位置于阶段 1 实施时依顶层组装定夺。

### 3. 消费点迁移（统一 ×EB）— 精确 diff

| # | 文件:行 | 当前代码 | 新代码 | 说明 |
|---|---------|----------|--------|------|
| 1 | `env-sky.ts:174,197` | `state.skyBrightness` | `state.skyBrightness * EB` | 天空底色 |
| 1b | `env-sky.ts:247,367` | skyKey 含 `state.skyBrightness` | 改含 `state.skyBrightness * EB` | 缓存键同步，否则 EB 变化不触发重绘 |
| 2 | `env-sky.ts:392` | `loadSkyCube(..., state.envIntensity)` | `loadSkyCube(..., state.envIntensity * EB)` | IBL 强度；278 的 `scene.environmentIntensity` 随之含 EB |
| 3 | `env-bridge.ts:243` | `hemiLight.intensity = getLightState().hemiIntensity` | `= getLightState().hemiIntensity * EB` | 半球光 |
| 4 | `env-bridge.ts:248` | `min(state.envIntensity * 0.15, 0.5)` | `min(state.envIntensity * 0.15 * EB, 0.5 * EB)` | 场景环境色 |
| 5 | `render/lighting.ts:379` | `dirLight.intensity = s.dirIntensity` | `= s.dirIntensity * EB` | **方向光（太阳）= EB 主缩放入口** |
| 6 | `env-clouds.ts:696` | `const brightness = Math.max(0.02, Math.min(1.5, dl.intensity * 1.5))` | 不变（`dl.intensity` 已在 #5 含 EB） | 云亮部 S 项自动跟随 |
| 7 | `env-clouds.ts:516` | `vec3 ambient = cloudCol * 0.15 * (1.0 - T) * brightness * skyBrightness` | `vec3 ambient = cloudCol * 0.15 * (1.0 - T) * skyBrightness * EB` | **移除 brightness 因子**，暗部只吃天光基准 → 修复矛盾 A 部分 + 规避 EB² |
| 8 | `env-water.ts:453` | `mat.setFloat('envIntensity', hasEnv ? (scene.environmentIntensity ?? 0.8) : 0)` | 不变 | 读 `scene.environmentIntensity`（#2 已含 EB）+ 反射天空 RT（#1 已含 EB）→ 天然跟随，**免双重乘** |

### 4. 关键设计决策：双重乘规避
- **EB 仅在源头乘一次**：方向光（#5）是太阳绝对强度的统一缩放入口，云亮部（#6）、Mesh 主光随之跟随。
- **云 ambient（#7）去 brightness 因子**：原公式把太阳 brightness 乘进暗部，既不物理（暗部不应随太阳变亮）又导致 EB² 双重乘。改为只吃 `skyBrightness * EB`，EB 仅出现一次。
- **水面（#8）不改**：其 envIntensity 取自 `scene.environmentIntensity`（#2 已含 EB），天空 RT 反射也在 #1 含 EB；若再乘 EB 将重复。这是"明细调研"才发现的自然耦合，避免画蛇添足。

### 5. EB 跨子系统访问
- `envBrightness` 属 `EnvState`；#1–4、#7 所在函数已捕获 `state`（envState 单例）→ 直接 `state.envBrightness`。
- #5 在 `render/lighting.ts`，当前读 `LightState`（`s.dirIntensity`）。需注入 EB：实施时确认 lighting.ts 访问 envState 的方式（`import { envState }` 单例或参数透传），与 #1–4 保持一致。

### 6. 预设校准（`menus/env-preset-levels.ts`）
- `EnvPresetConfig.env` 为 `Partial<EnvState>`（148 行），缺省即走默认 `1.0`。为显式与向后兼容，在每个 `env:{}` 块补 `envBrightness: 1`（156/173/189/208/225/243/261…）。
- 子旋钮（skyBrightness/envIntensity/dirIntensity/hemiIntensity）保持原值不变。

### 7. i18n
- 新增 `env.environmentBrightness` 标签（各语言文件），如 `环境亮度` / `Environment Brightness`。
  （注：`env.brightness` 已被天空亮度滑块 `env:sky:brightness` 占用，故主旋钮使用独立键名。）

### 8. 默认值零变化证明
`envBrightness = 1.0` ⇒ 所有 ×EB 退化为现状；预设补 `envBrightness:1` 不改变既有数值 ⇒ **现有所有预设观感零变化**（完全向后兼容）。

## 影响面

- **代码**：`core/types.ts`、`internal/app/app.go`、`env-sky.ts`、`env-clouds.ts`、`env-water.ts`、`env-bridge.ts`、`render/lighting.ts`、`env-feature-levels.ts`、`env-preset-levels.ts`、i18n ×N。
- **行为**：默认 `envBrightness=1.0` 时，所有现有预设观感**零变化**（完全向后兼容）。
- **用户心智**：新增"主亮度"旋钮，解释"统一全局明暗，子旋钮做风格微调"。

## 风险与缓解

| 风险 | 等级 | 缓解 |
|------|------|------|
| 预设亮度关系漂移 | 🟡 中 | 默认 `envBrightness=1` 保持现状；仅当用户主动调主旋钮才变化 |
| 用户失去精细控制 | 🟢 低 | 子旋钮保留，主标量只做全局缩放，不剥夺风格化能力 |
| Go/TS 字段不同步导致序列化缺失 | 🟠 高 | 严格按铁律同步 `internal/app/app.go` EnvState struct |
| 夜间预设需重新目检 | 🟡 中 | 阶段 4 预设校准后逐预设目检 |
| lighting.ts 跨系统取 EB 方式 | 🟡 中 | 阶段 1 实施前确认 lighting.ts 访问 envState 的现有通道 |
| 云 ambient 语义变更（去 brightness） | 🟡 中 | #7 同时修复矛盾 A 部分问题；阶段 4 目检暗部表现 |

## 分阶段实施

- **阶段 0（本 ADR）**：固化方案 + 细化设计（已含精确行号与 diff）。
- **阶段 1（类型+绑定）**：`types.ts` + `app.go` 加 `envBrightness`；UI 加主旋钮；确认 `render/lighting.ts` 访问 envState 通道。
- **阶段 2（消费点）**：按方案表 3 迁移 #1–#8（注意 #6/#8 实为"不改"，仅 #1/#1b/#2/#3/#4/#5/#7 需编辑）。
- **阶段 3（预设+i18n）**：预设补 `envBrightness:1`、补 `env.environmentBrightness` 标签。
- **阶段 4（目检）**：逐预设验证默认观感零变化 + 主旋钮全局响应（天空/云/水面/IBL/Mesh 同步明暗）。

## 未决项（已收敛）

- 保留 `skyBrightness` 与 `envBrightness` 两者（最小化破坏）；若后续确认语义冗余可评估合并。
- 主旋钮精确层级：建议独立 `环境亮度` 层级挂 env 根首位，或就近插 `env:sky:presets` 之上，阶段 1 定夺。
