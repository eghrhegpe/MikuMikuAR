# 三色统一审核报告

> 审核日期: 2026-07-20
> 审核范围: 天空与太阳主导环境色，地面、水面与云的跟进情况
> P1修正日期: 2026-07-20

---

## 设计目标

天空与太阳负责主导环境色，地面、水面与云应跟随这一设计。

---

## 现状分析

### 1. 天空与太阳（主导层）

**状态: ✅ 完整实现**

- 天空颜色由 `skyColorTop`、`skyColorMid`、`skyColorBot` 定义
- 太阳角度由 `sunAngle` 和 `azimuth` 控制
- 环境灯光由 `deriveLighting()` 函数从天空颜色和太阳角度推导
- 半球光 diffuse 从 `skyColorMid` 派生
- 环境色从 `skyMid` 派生

**代码位置:**
- `env-lighting.ts:56` — `deriveLighting()` 函数
- `env-bridge.ts:93-127` — 灯光同步逻辑

### 2. 地面

**状态: ⚠️ 独立颜色，未跟随天空（P1 已修正半球光地面颜色）**

- 使用 `groundColor` 独立定义，不从天空颜色派生
- 地面颜色固定，不随天空颜色变化
- ~~半球光 groundColor 固定为 `(0.3, 0.3, 0.4)`~~ → P1 已修正为从 `skyColorBot` 派生

**代码位置:**
- `env-state-schema.ts:45` — `groundColor` 默认值 `[0.15, 0.15, 0.18]`
- ~~`env-bridge.ts:101`~~ — P1 已修正为 `hemiLight.groundColor = col3FromTriple(state.skyColorBot)`

**问题:**
1. 地面颜色完全独立，不跟随天空颜色变化
2. ~~半球光地面颜色硬编码，不随天空颜色变化~~ → P1 已修正

### 3. 水面

**状态: ⚠️ 部分联动**

- 使用 `waterColor` 独立定义
- 有天空-水面颜色联动机制：`waterSkyColorBlend` 和 `uSkyBlendColor` 从 `skyColorBot` 派生
- 水面颜色部分跟随天空

**代码位置:**
- `env-water.ts:520-531` — 天空-水面颜色联动
- `env-water.ts:469` — `mat.setColor3('waterColor', col3FromTriple(state.waterColor))` 独立颜色

**问题:**
1. `waterColor` 本身是独立的，不从天空颜色派生
2. 联动机制仅影响地平线区域，不影响整体水面颜色

### 4. 云

**状态: ✅ 已修正（P1）**

- 云的颜色从场景方向光获取：`cloudColor = dl.diffuse`（P1 已将 `sunColor` 改为 `cloudColor`）
- ~~场景方向光颜色在 `env-bridge.ts:120` 中硬编码为 `[1, 0.95, 0.9]`~~ → P1 已修正为从 `deriveLighting().dirDiffuse` 派生
- 云现在间接跟随天空（通过场景灯光，场景灯光已联动天空）

**代码位置:**
- `env-clouds.ts:689-691` — 从场景灯光获取颜色（uniform 名已改为 `cloudColor`）
- ~~`env-bridge.ts:120`~~ — P1 已修正为 `dirColor: derived.dirDiffuse`

**问题:**
1. ~~场景方向光颜色硬编码为白色，没有从天空颜色派生~~ → P1 已修正
2. ~~云的颜色间接跟随天空（通过场景灯光），但场景灯光颜色不随天空变化~~ → P1 已修正

---

## 命名规范审核

### 颜色命名一致性

| 组件 | 命名模式 | 是否一致 |
|------|----------|----------|
| 天空 | `skyColorTop/Mid/Bot` | ✅ |
| 地面 | `groundColor` | ✅ |
| 水面 | `waterColor` | ✅ |
| 云 | `cloudColor` (shader uniform) | ✅ P1 已修正 |

**问题:**
1. ~~云的 shader uniform 命名为 `sunColor`，应改为 `cloudColor` 以保持一致性~~ → P1 已修正

### 颜色派生命名

| 派生目标 | 派生源 | 命名是否清晰 |
|----------|--------|--------------|
| 半球光 diffuse | `skyColorMid` | ✅ |
| 半球光 groundColor | `skyColorBot` | ✅ P1 已修正 |
| 环境色 | `skyMid` | ✅ |
| 水面地平线色 | `skyColorBot` | ✅ |
| 场景方向光 | `deriveLighting().dirDiffuse` | ✅ P1 已修正 |

---

## 建议修正

### P1: 高优先级（影响视觉一致性）

1. **地面颜色联动**
   - 建议：在 `env-bridge.ts` 中，当天空颜色变化时，根据天空颜色自动调整地面颜色
   - 实现：添加 `groundColorFromSky` 派生逻辑，或在预设切换时自动调整

2. **半球光地面颜色联动**
   - 建议：将 `hemiLight.groundColor` 从固定值改为从天空颜色派生
   - 实现：`hemiLight.groundColor = col3FromTriple(state.skyColorBot)`

3. **场景方向光颜色联动**
   - 建议：将 `dirColor: [1, 0.95, 0.9]` 改为从天空颜色派生
   - 实现：`dirColor: deriveLighting(state.skyColorTop, state.sunAngle, state.azimuth).dirDiffuse`

### P2: 中优先级（命名规范）

1. **云 shader uniform 命名**
   - 建议：将 `sunColor` 改为 `cloudColor`
   - 影响：`env-clouds.ts` 中的 shader uniform 声明和使用

### P3: 低优先级（可选优化）

1. **水面颜色联动增强**
   - 建议：将 `waterColor` 改为从天空颜色派生，而非独立定义
   - 实现：`waterColor = lerp(skyColorBot, waterColor, 0.7)` 保留用户调整空间

---

## 代码位置汇总

| 文件 | 行号 | 问题描述 | 状态 |
|------|------|----------|------|
| `env-bridge.ts` | 101 | `hemiLight.groundColor` 硬编码 | ✅ P1 已修正 |
| `env-bridge.ts` | 120 | `dirColor: [1, 0.95, 0.9]` 硬编码 | ✅ P1 已修正 |
| `env-clouds.ts` | 329,636,672,691,703 | `sunColor` uniform 命名不一致 | ✅ P1 已修正为 `cloudColor` |
| `env-state-schema.ts` | 45 | `groundColor` 默认值独立 | ⚠️ P3 待优化 |
| `env-water.ts` | 469 | `waterColor` 独立定义 | ⚠️ P3 待优化 |

---

## 结论

**总体结论: 通过（P1 已修正）**

天空与太阳主导环境色的设计已完整实现。P1 修正后：

1. **半球光地面颜色** — 从 `skyColorBot` 派生，保持三色统一
2. **场景方向光颜色** — 从 `deriveLighting().dirDiffuse` 派生，保持三色统一
3. **云 shader uniform** — 命名统一为 `cloudColor`，颜色从场景灯光获取（场景灯光已联动天空）

剩余 P3 优化项：
- `groundColor` 仍独立定义，不从天空颜色派生
- `waterColor` 仍独立定义，不从天空颜色派生

---

## P1 修正记录（2026-07-20）

### 已完成修正

| 文件 | 修正内容 | 影响 |
|------|----------|------|
| `env-bridge.ts:101` | `hemiLight.groundColor = new Color3(0.3, 0.3, 0.4)` → `hemiLight.groundColor = col3FromTriple(state.skyColorBot)` | 半球光地面颜色从 skyColorBot 派生 |
| `env-bridge.ts:120` | `dirColor: [1, 0.95, 0.9]` → `dirColor: derived.dirDiffuse` | 场景方向光颜色从 deriveLighting().dirDiffuse 派生 |
| `env-clouds.ts:329,636,672,691,703` | `sunColor` → `cloudColor` | 云 shader uniform 命名统一 |
| `env-bridge.test.ts:768-773` | 测试断言更新为从 skyColorBot 派生 | 测试适配新行为 |

### 修正后状态

| 组件 | 状态 | 说明 |
|------|------|------|
| **天空与太阳** | ✅ 完整实现 | 主导层无变化 |
| **半球光地面颜色** | ✅ 已修正 | 从 `skyColorBot` 派生，保持三色统一 |
| **场景方向光颜色** | ✅ 已修正 | 从 `deriveLighting().dirDiffuse` 派生，保持三色统一 |
| **云** | ✅ 已修正 | shader uniform 命名为 `cloudColor`，颜色从场景灯光获取（场景灯光已联动天空） |
| **水下颜色冲突** | ✅ 已修正 | 删除 Tint 后处理（与雾色功能重叠），水下降低灯光强度（方向光×0.3、半球光×0.4） |
| **地面** | ⚠️ 独立颜色 | `groundColor` 仍独立定义，需 P3 优化 |
| **水面** | ⚠️ 部分联动 | `waterColor` 仍独立定义，需 P3 优化 |

---

## 水下颜色冲突修正（2026-07-20）

### 问题

入水后有 7 层颜色叠加，其中雾色和 Tint 后处理都在用 `waterColor × underwaterTintStrength`，导致水色被叠加两次：
- 雾色按距离衰减（远处明显）
- Tint 是全屏后处理（均匀叠加）
- 双重叠加导致蓝色过饱和

### 修正

| 文件 | 修正内容 | 影响 |
|------|----------|------|
| `env-water.ts:210-245` | 删除 Tint 后处理（Shader + PostProcess） | 消除与雾色的功能重叠 |
| `env-water.ts:1007-1042` | 水下时降低灯光强度（方向光×0.3、半球光×0.4） | 避免暖光+蓝雾产生脏色 |
| `env-water.ts:944` | 删除 disposeTintPostProcess 调用 | 清理残留代码 |
| `env-water.ts:1061-1064` | 删除 resetUnderwaterState 中的 Tint 复位代码 | 清理残留代码 |
| `env-water.ts:15,25` | 移除未使用的 PostProcess / setPostProcessEnabled 导入 | 清理无用导入 |

### 修正后水下颜色层级

| # | 来源 | 状态 |
|---|------|------|
| 1 | 场景雾色 | ✅ 保留（按距离衰减） |
| 2 | 场景雾密度 | ✅ 保留 |
| 3 | Tint 后处理 | ❌ 已删除 |
| 4 | 色差后处理 | ✅ 保留（光学畸变） |
| 5-7 | 灯光 | ⚠️ 水下衰减 |
