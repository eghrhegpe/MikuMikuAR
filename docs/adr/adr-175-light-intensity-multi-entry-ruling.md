# ADR-175: 光照强度多入口设计意图裁决

> **状态**: ✅ 已裁决（裁决为「保留多入口，不收敛为单入口」；无代码改动，仅固化契约）
> **日期**: 2026-07-22
- **相关**：ADR-132（envBrightness 统一标量）、ADR-137（envState 单源 Schema）、ADR-138（env-dispatcher 解循环）

## 背景与问题

ADR-132 落地 `envBrightness`（EB）统一标量后，光照强度的写入点散落在三处，审核时被反复盘问为「幽灵双写」候选：

| 入口 | 文件:行 | 触发时机 | 公式 |
|------|---------|----------|------|
| A | [env-bridge.ts:106](file:///c:/Users/zhujieling11/MikuMikuAR/frontend/src/scene/env/env-bridge.ts#L106) | envState 变（天空色 / EB / sunAngle 等派生键） | `hemi.intensity = getLightState().hemiIntensity * EB` |
| B | [lighting.ts:260](file:///c:/Users/zhujieling11/MikuMikuAR/frontend/src/scene/render/lighting.ts#L260) | 用户调灯光滑块（`setLightState`） | `hemiLight.intensity = s.hemiIntensity * EB` |
| C | [lighting.ts:207](file:///c:/Users/zhujieling11/MikuMikuAR/frontend/src/scene/render/lighting.ts#L207) | EB 变化时 rebake | `hemiLight.intensity *= ratio`（`ratio = EB_new / EB_prev`） |

表面看三处都在写 `hemiLight.intensity`，疑似违反「状态来源唯一」原则。本 ADR 裁决这是**职责分离的设计意图**，非反模式。

## 决策

**保留三入口，不收敛为单入口。** 三入口通过 `getLightState()` 的「基准值中介」契约协同，各司其职。

### 三入口职责边界

| 入口 | 职责 | 输入语义 | 为何不能合并 |
|------|------|----------|-------------|
| **A 派生入口** | 环境派生光照（天空色 / sunAngle → 灯光） | `_LIGHT_SYNC_KEYS` 触发 `deriveLighting` 重新计算基准 | 派生逻辑依赖 `skyColorTop` 等环境字段，与用户直调无关；若并入 B 需把 envState 透传入 setLightState，割断 env-dispatcher 解耦成果（ADR-138） |
| **B 用户入口** | 用户直调灯光滑块 | `LightState`（用户意图） | 灯光滑块需即时响应，不能等 envState 派发；并入 A 会让滑块拖动走 dispatcher 一圈，引入帧延迟 |
| **C rebake 入口** | EB 变化时等比缩放已存储强度 | `ratio = EB_new / EB_prev` | EB 是横切所有子系统的标量（ADR-132），若走 A/B 需重算基准值，但 EB 变化时基准值（用户/派生意图）未变，只需等比缩放；rebake 保持用户微调成果不被覆盖 |

### 中介契约：`getLightState()` 返回基准值

[lighting.ts:225](file:///c:/Users/zhujieling11/MikuMikuAR/frontend/src/scene/render/lighting.ts#L225) 中 `getLightState().hemiIntensity` 返回的是**已除 EB 的基准值**：

```ts
hemiIntensity: lightingState.hemiLight.intensity / envBrightness,
```

这一除法是三入口协同的**契约锚点**：
- 入口 A 读基准值 × EB → 写回绝对值
- 入口 B 接收用户基准值 × EB → 写回绝对值
- 入口 C 直接 ×ratio → 等比缩放绝对值，基准值随之漂移但语义不变（下次 A/B 读时再除 EB 还原）

**契约不变量**：`getLightState().hemiIntensity` 始终等于「不含 EB 的用户/派生意图基准值」。任何新写入点必须维护此不变量——写绝对值前先除 EB，或走 rebake 等比路径。

### 为何不是幽灵双写

「幽灵双写」反模式的特征是**同一意图被多处隐式修改，状态变化不可追踪**。本三入口满足以下条件，不构成反模式：

1. **意图不同**：A 是环境派生，B 是用户直调，C 是横切缩放——三者输入语义正交
2. **可追踪**：三处都在显式函数中（`_applyEnvStateFacade` / `setLightState` / `rebakeEnvBrightness`），无模块级变量隐式写入
3. **无竞态**：A 在 `setEnvState` 同步链中执行，B 由 UI 事件同步调用，C 在 A 的 EB 变更分支内同步调用——均无异步交错
4. **中介一致**：三处公式均通过 `getLightState()` 基准值或等比 ratio 协同，不会出现「A 写基准值、B 读绝对值」的漂移

### 强行收敛为单入口的代价

若强行收敛到「单一写入点」：
- **方案 X（并入 B）**：envState 派生需走 `setLightState`，但 `setLightState` 在 `render/lighting.ts`，需反向 import envState 派生逻辑 → 重建 env-bridge → lighting 循环依赖（ADR-138 刚拆掉）
- **方案 Y（并入 A）**：用户灯光滑块需走 `setEnvState` 触发 dispatcher，引入一帧延迟 + 滑块拖动卡顿
- **方案 Z（并入 C）**：派生与用户意图都走 rebake 等比路径，但派生时基准值变了（天空色变 → dirIntensity 重算），等比缩放语义错误

三种收敛方案均付出大于收益的代价。

## 影响面

- **代码**：无改动。本 ADR 仅固化既有契约。
- **审核**：后续审核光照模块时，三入口不再标记为「重复写入候选」，改为按本 ADR 契约校验（基准值不变量、意图正交性、无竞态）。
- **扩展**：新增光照写入点必须（a）维护 `getLightState()` 基准值不变量，或（b）走 rebake 等比路径，并在该点注释引用本 ADR。

## 风险与缓解

| 风险 | 等级 | 缓解 |
|------|------|------|
| 后续误判为重复写入而强行收敛 | 🟡 中 | 本 ADR 显式裁决 + 审核清单引用 |
| 基准值不变量被新代码破坏 | 🟠 高 | 新增写入点强制走 A/B/C 之一，PR review 校验 |
| rebake 在极端 ratio 下数值漂移 | 🟢 低 | `rebakeEnvBrightness` 已有 `ratio <= 0` 守卫（lighting.ts:206） |

## 未决项

- 无。本 ADR 为终局裁决，除非光照架构发生 ADR-132 级别的范式变更，否则不重开。
