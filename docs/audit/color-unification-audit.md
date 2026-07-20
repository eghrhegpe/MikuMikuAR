# 三色统一审核报告

> 审核日期: 2026-07-20
> 审核范围: 天空与太阳主导环境色，地面、水面与云的跟进情况

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

**状态: ⚠️ 独立颜色，未跟随天空**

- 使用 `groundColor` 独立定义，不从天空颜色派生
- 地面颜色固定，不随天空颜色变化
- 半球光 groundColor 固定为 `(0.3, 0.3, 0.4)`

**代码位置:**
- `env-state-schema.ts:45` — `groundColor` 默认值 `[0.15, 0.15, 0.18]`
- `env-bridge.ts:101` — `hemiLight.groundColor = new Color3(0.3, 0.3, 0.4)` 硬编码

**问题:**
1. 地面颜色完全独立，不跟随天空颜色变化
2. 半球光地面颜色硬编码，不随天空颜色变化

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

**状态: ⚠️ 从场景灯光获取，但场景灯光颜色硬编码**

- 云的颜色从场景方向光获取：`sunColor = dl.diffuse`
- 场景方向光颜色在 `env-bridge.ts:120` 中硬编码为 `[1, 0.95, 0.9]`
- 云没有直接从天空颜色派生

**代码位置:**
- `env-clouds.ts:689-691` — 从场景灯光获取颜色
- `env-bridge.ts:120` — `dirColor: [1, 0.95, 0.9]` 硬编码

**问题:**
1. 场景方向光颜色硬编码为白色，没有从天空颜色派生
2. 云的颜色间接跟随天空（通过场景灯光），但场景灯光颜色不随天空变化

---

## 命名规范审核

### 颜色命名一致性

| 组件 | 命名模式 | 是否一致 |
|------|----------|----------|
| 天空 | `skyColorTop/Mid/Bot` | ✅ |
| 地面 | `groundColor` | ✅ |
| 水面 | `waterColor` | ✅ |
| 云 | `sunColor` (shader uniform) | ⚠️ 应为 `cloudColor` |

**问题:**
1. 云的 shader uniform 命名为 `sunColor`，应改为 `cloudColor` 以保持一致性

### 颜色派生命名

| 派生目标 | 派生源 | 命名是否清晰 |
|----------|--------|--------------|
| 半球光 diffuse | `skyColorMid` | ✅ |
| 环境色 | `skyMid` | ✅ |
| 水面地平线色 | `skyColorBot` | ✅ |
| 场景方向光 | 硬编码 `[1, 0.95, 0.9]` | ❌ 应从天空颜色派生 |

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

| 文件 | 行号 | 问题描述 |
|------|------|----------|
| `env-bridge.ts` | 101 | `hemiLight.groundColor` 硬编码 |
| `env-bridge.ts` | 120 | `dirColor: [1, 0.95, 0.9]` 硬编码 |
| `env-clouds.ts` | 672, 703 | `sunColor` uniform 命名不一致 |
| `env-state-schema.ts` | 45 | `groundColor` 默认值独立 |
| `env-water.ts` | 469 | `waterColor` 独立定义 |

---

## 结论

**总体结论: 有条件通过**

天空与太阳主导环境色的设计已完整实现，但地面、水面与云的颜色未完全跟随。主要问题：

1. **地面颜色完全独立**，不跟随天空颜色变化
2. **水面颜色部分联动**，但整体仍独立
3. **云颜色间接跟随**，但场景灯光颜色硬编码
4. **半球光地面颜色硬编码**，不随天空颜色变化

建议按 P1 优先级进行修正，以实现真正的三色统一。
