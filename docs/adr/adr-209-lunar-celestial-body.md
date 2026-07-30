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

#### P4 · 夜空装饰（最小闭环）— PIC: （待指派）

- **抽通用天体盘 helper，避免单函数职责过载**：新增 `_ensureDisc(name: string, color: Color3)` 与 `_updateDisc(dir: Vector3, intensityScaled: number, forceVisible: boolean)`，太阳/月亮各自薄封装。原 `_updateSunDisc`（`lighting-sun.ts:30-49`）内含 `hasIntensity` 门控（行 37-38）、位置在 `-d`；月亮需"不受 intensity 限制、永远可见、位置 `-d`"，**不可直接复用**，否则污染单函数、违反「职责过载」反模式。
- 月盘挂在太阳**反方向**（`dirLight.direction` 取反，`-d`），冷色 `emissiveColor(0.8, 0.85, 1.0)`，直径略小于太阳（如 45）；`isPickable=false`、`disableLighting=true`，与太阳盘（lighting-sun.ts:22/24）一致，**不参与 IBL/PBR 光照计算**。
- **月亮方位澄清（P2 落地前必决）**：夜晚 `deriveLighting` 把 `dirY = sunAngle <= 0 ? 0`（`env-lighting.ts:90`），方向光方向是**水平**的；若直接 `-d` 取反，月亮盘会贴在**地平线**而非天穹。落地前二选一：①固定仰角（如 30°）+ 水平方位与太阳相反；②艺术化地平线参照，在本文显式注明"刻意如此"。
- **状态来源唯一**：月亮盘为纯可视化参照，**不入 `envState`、不序列化、不进任何预设**（`TIME_OF_DAY_PRESETS` / `buildGroundPresetEnvState` 等均不沾），避免引入第二状态源，违背 AGENTS「状态来源唯一」原则。
- **调用点**：在 `_timeOfDayTick`（`env-time-of-day.ts:74` 调 `_updateSunDisc`）同帧、或 `lighting` 渲染循环注册 `_updateMoonDisc`，保证高频路径每帧更新位置。
- **释放**：`_disposeSunDisc` 更名为 `_disposeCelestialDiscs`（或在其内级联释放 `lightingState.moonDisc`），`disposeRenderer` 已配对，StandardMaterial 不泄漏。
- 特点：不改光照、不改 `envState`、无新持久化字段，成本最低。

#### P3 · 月光补光

- 改 `deriveLighting` 夜间分支（`sunAngle <= 0`，与 env-lighting.ts:68/89/90 的 `<= 0` 边界对齐，非 `< 0`）：不再把方向光强度压到 0，而是给一缕冷色微光（约白天的 3~5%）。
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

- P4：月盘在夜间（`sunAngle <= 0`）可见、白天隐藏；`_disposeCelestialDiscs` 释放后无 Mesh/Material 残留；月亮盘 `isPickable=false`、`disableLighting=true`、不参与 IBL/PBR。
- P3：夜间方向光强度非 0 且为冷色，白天分支不受影响。
- P2：`moonPhase`/`moonAngle` 字段序列化往返一致；旧存档缺字段时走默认值迁移。

## 审核记录（2026-07-30）

审核结论：**有条件通过（Conditional Pass）**。状态仍为「规划」，P1–P3 未实施。逐项核对了 ADR 引用的三个源码锚点（`lighting-sun.ts` / `env-lighting.ts` / `env-time-of-day.ts`），事实基本准确，P4 设计有两处需在动手前澄清。

### 事实核对

| 断言 | 代码现状 | 结论 |
|------|----------|------|
| 太阳盘直径 60、`emissiveColor(1,0.9,0.7)` | lighting-sun.ts:17,21 | ✅ 准确 |
| `night: sunAngle=-6`、`neon: sunAngle=-5` | env-lighting.ts:130,146 | ✅ 准确 |
| 太阳盘显隐由 `aboveHorizon = d.y < 0` 控制 | lighting-sun.ts:36-38 实际为 `aboveHorizon && hasIntensity` | ⚠️ 简化，P4 须牢记月亮绕过 `hasIntensity` |
| 夜间分支 `sunAngle < 0` 压平方向光 | env-lighting.ts:68/89/90 实际为 `<= 0` | ⚠️ 边界 off-by-one，已统一修正为 `<= 0` |

### 已采纳建议（已写入上文明文）

- 🟠 **P2 月亮方位**：夜晚 `dirY = sunAngle <= 0 ? 0`（`env-lighting.ts:90`）使方向光水平，直接 `-d` 取反会让月亮贴地平线。已在 P4 标「落地前必决」，二选一方位方案。
- 🟡 **P3 复用 vs 职责过载**：放弃"直接复用 `_updateSunDisc`"，改为抽 `_ensureDisc` / `_updateDisc(dir, intensityScaled, forceVisible)`，日月薄封装。
- 🟡 **状态来源唯一**：明确月亮盘不入 `envState`、不序列化、不进预设。
- 🟡 **调用点**：在 `_timeOfDayTick`（`env-time-of-day.ts:74`）同帧注册 `_updateMoonDisc`。
- 🟢 **PIC / 物理属性 / 边界措辞**：P4 补 PIC 占位；验收补 `isPickable=false`、`disableLighting=true`、不参与 IBL/PBR；全文 `< 0` → `<= 0`。

### 遗留（需作者在 P4 动手前拍板）

1. P2 月亮方位的两种方案选其一（固定仰角 30° vs 地平线参照）。
2. P2 完整"第二天体"另立 ADR 的编号/标题待补（本文仅引用"另立的第二天体 ADR"）。
