---
kind: env_time_of_day
name: 时间流转与环境预设动画
category: env
scope:
  - frontend/src/scene/env/env-time-of-day.ts
source_files:
  - frontend/src/scene/env/env-time-of-day.ts
adr:
  - ADR-148
  - ADR-120
symbols:
  - envSunAngle
  - setEnvSunAngle
  - getEnvSunAngle
  - startTimeOfDay
  - stopTimeOfDay
  - isTimeOfDayActive
  - getTimeOfDaySpeed
  - setTimeOfDaySpeed
  - syncTimeOfDayFromEnv
  - applyEnvPreset
  - applyEnvPresetObject
  - applyEnvPresetByCategory
invariants:
  - envSunAngle 与 envState.sunAngle 双源同步：setEnvState({sunAngle}) 经 syncEnvSunAngle 中间件反向同步 envSunAngle，消除双源漂移
  - envState.timeOfDayActive 是用户意图（持久化，start/stop 写入）；_timeOfDayPaused 是预设动画临时暂停标志（不持久化）
  - 预设动画用 _presetAnimId generation 计数器做过期判定，新动画启动时旧动画自动 dispose
  - _timeOfDayTick 用真实 deltaTime（scene.deltaTime/1000）递增，兼容高刷新率屏幕
tests:
  - frontend/src/__tests__/env-bridge.test.ts
use_when:
  - 时间流转
  - 太阳角度
  - 环境预设
  - 日夜变化
  - 预设动画过渡
  - 用户自定义预设
---

## 系统概览
Env Time-of-Day：时间流转、太阳角度与环境预设动画模块。从 `env-bridge.ts` 拆出（ADR-148 Phase 5），管理 envSunAngle 模块缓存、time-of-day tick 循环、预设动画过渡（2s lerp）、分类预设应用（ADR-120）。通过 `registerEnvStateMiddleware` 注册 `syncEnvSunAngle` 中间件消除双源漂移。

## 核心职责
- `env-time-of-day.ts` — 太阳角缓存、time-of-day tick、预设动画过渡、分类预设应用
- `_timeOfDayTick` 每帧递增 envSunAngle，达阈值时触发 `applyEnvStateFacade` 全量更新（避免每帧重计算光照）
- `applyEnvPresetObject` 启动 2s 过渡动画（天空色 + 光照 lerp），动画期间暂停 time-of-day
- `applyEnvPresetByCategory`（ADR-120）按类别直接 setEnvState，无过渡（用户自定义预设追求精确还原）

## 对外 API（节选）
- `setEnvSunAngle(deg)` / `getEnvSunAngle()` — 太阳角读写（钳制到 [-15, 90]）
- `startTimeOfDay(speed?)` / `stopTimeOfDay()` / `isTimeOfDayActive()` — time-of-day 生命周期
- `setTimeOfDaySpeed(s)` / `getTimeOfDaySpeed()` — 流转速度
- `applyEnvPreset(name)` — 应用内置预设（TIME_OF_DAY_PRESETS）
- `applyEnvPresetObject(preset)` — 应用任意预设对象（支持用户自定义，带 2s 动画过渡）
- `applyEnvPresetByCategory(preset)` — ADR-120 分类应用（无过渡）
- `syncTimeOfDayFromEnv()` — 启动时从 envState 恢复模块变量

## 关键约定
- envSunAngle 是模块内缓存（高频 tick + 滑块 bind 读取），envState.sunAngle 是持久化源；两者必须同步（见 `syncEnvSunAngle` 中间件）
- 预设动画期间 `_timeOfDayPaused = true`，动画结束自动恢复（仅当动画前 time-of-day 是 active 时）
- 预设动画用 `_presetAnimId` generation 计数器过期判定，新动画启动使旧动画自动停止
- tick 内 `applyEnvStateFacade` 跳过 setEnvState 全链路（避免每帧防抖持久化 + dispatcher 全量分发）
- 天空色更新节流：50ms 间隔（`SKY_UPDATE_INTERVAL`），避免每帧重计算 procedural sky
- 性能埋点：tick 内 `applyEnvStateFacade` 耗时 > 2ms 时 logWarn 提示

## 与其他子系统关系
- 依赖 `env-bridge.ts`（`setEnvState`/`setPresetAnimActive`/`registerEnvStateMiddleware`/`applyEnvStateFacade`）
- 依赖 `env-persist.ts`（`persistEnvState`/`cancelEnvPersistTimer`）— 动画结束/stopTimeOfDay 时立即 flush
- 依赖 `env-dispatcher.ts`（`dispatchEnvChange`/`registerSceneTickCallback`）
- 依赖 `env-impl.ts`（`ensureEnvUpdateObserver`）、`env-lighting.ts`（`deriveLighting`/`TIME_OF_DAY_PRESETS`/`CategorizedEnvPreset`）
- 依赖 `render/lighting.ts`（`setLightState`/`getLightState`/`setSkipLightAutoSave`/`_updateSunDisc`）
- 被 `env-sky-levels.ts`（天空菜单）和 `env.ts` 门面调用
