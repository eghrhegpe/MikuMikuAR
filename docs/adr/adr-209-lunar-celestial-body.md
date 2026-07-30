# ADR-209: 月亮 —— 第二天体的渐进式设计（复用太阳骨架）

- **状态**: 📝 规划
- **日期**: 2026-07-30
- **相关**: ADR-013（天空盒改进）、ADR-026（环境系统增强）、ADR-080（观察者级联预设动画）、ADR-137（EnvState 单一源 Schema）
- **源码锚点**: `scene/render/lighting-sun.ts:_ensureSunDisc/_updateSunDisc`、`scene/env/env-lighting.ts:deriveLighting/TIME_OF_DAY_PRESETS`、`scene/env/env-time-of-day.ts:_timeOfDayTick`

## 背景

当前场景只有"太阳"一个天体，且它是三位一体的存在：

1. **主光源** —— `deriveLighting()`（`env-lighting.ts`）按 `sunAngle`（-15°~90°）推导方向光的方向、颜色、强度，太阳是唯一的天光引擎。
2. **可见圆盘** —— `_ensureSunDisc()`（`lighting-sun.ts`）用一个直径 60、`emissiveColor(1, 0.9, 0.7)` 的球体常驻在光线来源方向，纯作调光参照、不参与光照计算；显隐由 `aboveHorizon = d.y < 0` 控制。
3. **昼夜循环** —— `_timeOfDayTick()`（`env-time-of-day.ts`）让 `sunAngle` 随时间递增，越过 90° 回卷到 -15°。

**空缺**：夜晚是靠"把太阳落到地平线下（`night` 预设 `sunAngle: -6`）+ 天空刷成深蓝"模拟的。此时 `deriveLighting` 夜间分支把方向光强度压到接近 0，太阳圆盘沉到地平线下被隐藏——**夜空一片空无**，缺少月亮这一自然对象。

## 设计决策

### 核心原则：月亮是太阳的"影子孪生"，不另起系统

已有天体模型是"**一个方向 → 光照 + 一颗圆盘**"。月亮完全套用这套骨架，仅参数不同（冷色、反方向、较小直径）。**禁止**新写独立的 `moon-system`——那会引入第二套天体状态与显隐逻辑，滑向推倒重来，违背通用化/复用原则。

### 渐进式三层路径（按投入递增，可逐层落地）

#### P4 · 夜空装饰（最小闭环）

- 将 `_ensureSunDisc` 抽象为 `_ensureCelestialDisc(kind: 'sun' | 'moon')`，太阳/月亮共用创建与释放路径（`_disposeSunDisc` 同步扩展为释放两个圆盘）。
- 月盘挂在太阳**反方向**（`dirLight.direction` 取反），冷色 `emissiveColor(0.8, 0.85, 1.0)`，直径略小于太阳。
- 显隐规则复用现成的 `aboveHorizon = d.y < 0`：太阳落下（夜间）时月亮升起，天然此消彼长。
- 特点：不改光照、不改 `envState`、无新持久化字段，成本最低。

#### P3 · 月光补光

- 改 `deriveLighting` 夜间分支（`sunAngle < 0`）：不再把方向光强度压到 0，而是给一缕冷色微光（约白天的 3~5%）。
- 收益：夜晚模型不再是纯黑剪影，有月色轮廓，画面耐看。

#### P2 · 完整第二天体

- 新增 `moonPhase`（月相）、可选 `moonAngle`（脱离"严格反日"约束）等字段，接入 env 预设表与持久化。
- 需走完整状态字段流程：`envState` Schema 扩展、序列化、旧存档迁移。成本最高，另立 ADR 细化。

## 关键约束与坑点

- **夜晚判定必须与预设对齐**：`night` / `neon` 预设用"太阳沉到 -6° + 深蓝天空"模拟夜晚（`env-lighting.ts:TIME_OF_DAY_PRESETS`）。上月亮时，月亮出现条件要与这两个预设的夜晚判定对齐，否则会出现"预设说是夜晚、月亮却因 `sunAngle` 逻辑未触发"的鬼影状态（双源漂移）。
- **资源配对**：新增的月盘 Mesh + StandardMaterial 必须在 `_disposeSunDisc`（或重命名后的 `_disposeCelestialDiscs`）中级联释放，避免与太阳圆盘同样的 `StandardMaterial` 泄漏风险。
- **热路径零负担**：P4/P3 不新增 `envState` 渲染字段，`_timeOfDayTick` 高频路径仅多一次圆盘位置更新，无额外 `setEnvState` 派发。

## 影响

- 夜景表现力提升：夜空有月、夜色有光，摆脱纯黑空无。
- 复用而非新增：太阳圆盘骨架通用化为"天体圆盘"，长期可维护。
- P4/P3 对存档与渲染热路径零侵入；P2 涉及 Schema 演进，届时另开 ADR。

## 测试（落地时补充）

本 ADR 为规划性质，暂不含实现与测试。落地各层时补充：

- P4：月盘在夜间（`sunAngle < 0`）可见、白天隐藏；`_disposeCelestialDiscs` 释放后无 Mesh/Material 残留。
- P3：夜间方向光强度非 0 且为冷色，白天分支不受影响。
- P2：`moonPhase`/`moonAngle` 字段序列化往返一致；旧存档缺字段时走默认值迁移。
