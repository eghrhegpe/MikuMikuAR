# 水面预设点击后水面消失且开关/滑条不可逆（NaN uniform 污染）

**日期**: 2026-07-17
**严重程度**: 🔴 P1（点击任一水面预设即导致水面永久消失，开关与所有滑条均无法唤回，须重新进入界面才恢复）
**影响范围**: `frontend/src/scene/env/env-water.ts`（`buildWaterPresetEnvState` / `_syncWaterUniforms`）
**发现方式**: 用户反馈「点水面预设水面消失，开关/滑条都不影响」+ 反例推理定位

---

## 问题描述

环境菜单 → 水面，点击任意预设（平静 / 涟漪 / 海浪 / 风暴 / 热带）后，水面**立即消失**；此后无论拨水面开关、调任何滑条，水面都不再出现。重新进入界面（用默认非污染 envState）材质又正常加载。

> 关键反例（来自用户）：水面原本是开启的、重新进入界面材质正常、`preset-chip` 下方其它选项（滑条等）全部正常。说明问题**只由预设点击触发**，且与水面开关状态无关——直接否定了「预设缺 `waterEnabled` 导致不开启水面」的简单假设（若只是缺开启字段，开着的水面不该消失）。

---

## 排查时间线

### 第一轮（误判）：缺 `waterEnabled`

初看 `env-feature-levels.ts:812` 的预设 onClick 仅调用 `buildWaterPresetEnvState(wp)`，怀疑预设不开启水面。但用户反例（原本已开）否定此路径——开着的水面不会因「不写开启字段」而消失。隔离复现测试（NullEngine）也证实：`createWater`/`disposeWater` 序列中材质不会意外变 null。

### 第二轮（锁定）：undefined → NaN uniform

复查 `buildWaterPresetEnvState`（env-water.ts:1184-1185）写入了 `waterHorizonFade: preset.waterHorizonFade` 与 `waterSkyColorBlend: preset.waterSkyColorBlend`，而 `WATER_PRESETS`（env-water.ts:1056 起，5 个条目）**全未定义这两个字段** → 二者为 `undefined`。

```typescript
// buildWaterPresetEnvState（修复前）
waterHorizonFade: preset.waterHorizonFade,      // undefined
waterSkyColorBlend: preset.waterSkyColorBlend,  // undefined
```

`Object.assign(envState, { waterHorizonFade: undefined, waterSkyColorBlend: undefined })` 把 envState 这两个字段**污染为 undefined**。

`_syncWaterUniforms`（env-water.ts:493、496）**无条件**把它们写给着色器：

```typescript
mat.setFloat('uSkyColorBlend', state.waterSkyColorBlend);  // undefined → NaN
mat.setFloat('uHorizonFade', state.waterHorizonFade);      // undefined → NaN
```

### 现象闭环

| 环节 | 结果 |
|------|------|
| `setEnvState` 污染 envState | `waterHorizonFade` / `waterSkyColorBlend` 变 `undefined` |
| 真实引擎 `setFloat(undefined)` | uniform 变成 **NaN** → 水面渲染消失 |
| 被污染 envState 被后续**所有** `setEnvState` 复用 | 拨开关/滑条都重建出 NaN 水面 → **不可逆** |
| 重新进入用默认非-undefined 值 | 正常加载 |

### 为什么 NullEngine 隔离测试抓不到

NullEngine 不真正向 GPU 写 uniform，`setFloat(undefined)` 不会表现为材质 null 或可见性异常，仅在前端 TypeScript 层静默通过。这是初判盲区的根因——必须用「断言预设不产生 undefined 字段」而非「复现 NaN 材质」来验证。

---

## 修复清单

| # | 缺陷 | 文件 | 修复 |
|---|------|------|------|
| 1 | 预设写入 `undefined` 字段 | `env-water.ts:1184-1185` | `waterHorizonFade: preset.waterHorizonFade ?? 0`、`waterSkyColorBlend: preset.waterSkyColorBlend ?? 0`（源头兜底，不再污染 envState） |
| 2 | uniform 同步无防御 | `env-water.ts:493` | `mat.setFloat('uSkyColorBlend', state.waterSkyColorBlend ?? 0)` |
| 3 | uniform 同步无防御 | `env-water.ts:496` | `mat.setFloat('uHorizonFade', state.waterHorizonFade ?? 0)` |

> 相关（非根因）：上一轮在 `env-feature-levels.ts:812` 预设 onClick 中补 `waterEnabled: true`，使点预设自带「开启水面」语义，符合预期，保留。

---

## 教训

1. **`?? 0` 兜底必须成对** — 源头（数据映射）和消费者（uniform 写入）都要防御；只补一处仍可能在别的数据源（如分类预设快照）漏网。
2. **`setFloat(undefined)` 是静默 NaN** — Babylon.js 的 `setFloat` 不会抛错，但真实引擎下 NaN uniform 会导致整个材质异常且不报错，定位极难。
3. **NullEngine 不能替代真实渲染验证** — 涉及 GPU uniform / 着色器可见性的 bug，NullEngine 永远「通过」。断言应针对「数据是否干净」而非「渲染是否可见」。
4. **用户反例比静态分析更可靠** — 「原本开着的水面不该因缺开启字段消失」这一反例直接推翻了初判，应优先用反例收敛假设空间。
5. **预设数据与映射字段必须对称** — `WATER_PRESETS` 新增字段时，`buildWaterPresetEnvState` 必须同步处理缺省，否则会写入 undefined 污染全局状态。
