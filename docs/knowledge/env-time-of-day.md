---
tier: architecture
kind: env_time_of_day
name: 时间流转与太阳角系统
category: env
scope:
  - frontend/src/scene/env/env-time-of-day.ts
source_files:
  - frontend/src/scene/env/env-time-of-day.ts
adr:
  - ADR-148
  - ADR-120
  - ADR-173
  - ADR-176
  - ADR-204
  - ADR-238
symbols:
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
  - envSunAngle 始终钳制在 [-15, 90] 范围内，超出时环绕
  - _timeOfDayTick 在 !envState.timeOfDayActive 或 _timeOfDayPaused 时直接返回
  - tick 中 sunAngle 变化 ≥ AUTO_LINK_THRESHOLD_DEG 时才触发 applyEnvStateFacade（防抖动）
  - 预设动画期间 _timeOfDayPaused = true，新调用会取消上一帧的动画 observer
  - stopTimeOfDay 注销 _unregisterTimeOfDay 后置空，防重复注销
  - syncTimeOfDayFromEnv 复位 _timeOfDayPaused/_timeOfDayBeforePreset（HMR 残留防断）
  - tick 中间分支（≥0.4°）dispatch 前同步 envState.sunAngle（防订阅者读到过期角度）
  - applyEnvPresetByCategory 无动画过渡，直接 setEnvState 类别字段（天空类额外 setEnvSunAngle）
tests:
  - frontend/src/__tests__/env-bridge/time-of-day.int.test.ts
  - frontend/src/__tests__/env-bridge/presets.int.test.ts
  - frontend/src/__tests__/env-bridge/middleware.int.test.ts
use_when:
  - 时间流转
  - 太阳角
  - 预设动画
  - 环境预设
---

# 时间流转与太阳角系统

## 系统概览
Env Time-of-Day：从 env-bridge 拆出的时间流转 + 太阳角 + 环境预设动画模块（ADR-148 Phase 5 瘦身）。核心职责：`envSunAngle` 缓存（消除双源漂移）、time-of-day 帧 tick、预设动画过渡（2 秒 lerp）、分类预设应用。

## 核心职责
- **太阳角缓存**：`envSunAngle`（模块内高频变量）+ `envState.sunAngle`（持久化源），经 `setEnvState` 中间件反向同步消除漂移
- **time-of-day tick**：`_timeOfDayTick` 每帧递增太阳角（`_timeOfDaySpeed * dt`），超出 [-15, 90] 时环绕
- **预设动画**：`applyEnvPreset(name)` → `applyEnvPresetObject(preset)`，2 秒 lerp 过渡天空颜色 + 光照，期间暂停 time-of-day（`_timeOfDayPaused`）
- **分类预设**：`applyEnvPresetByCategory(preset)`，无动画过渡，精确还原

## 对外 API（节选）
- `setEnvSunAngle(deg: number)` — 设置太阳角 [-15, 90]
- `getEnvSunAngle(): number` — 读取太阳角
- `startTimeOfDay(speed?: number)` — 启动时间流转
- `stopTimeOfDay()` — 停止时间流转（注销 tick 回调 + 持久化）
- `isTimeOfDayActive(): boolean` — 是否激活
- `getTimeOfDaySpeed(): number` / `setTimeOfDaySpeed(s: number)`
- `syncTimeOfDayFromEnv()` — 启动时从持久化 envState 恢复
- `applyEnvPreset(name: string): boolean` — 应用内置预设（带动画过渡）
- `applyEnvPresetObject(preset): boolean` — 应用自定义预设对象（参数为结构兼容 `EnvPreset` 的内联类型 `env-time-of-day.ts:257`，非具名 `EnvPreset`）
- `applyEnvPresetByCategory(preset: CategorizedEnvPreset): boolean` — 应用分类预设（无过渡）

## 不变量
- `envSunAngle` 始终钳制在 [-15, 90] 范围内，超出时环绕
- `_timeOfDayTick` 在 `!envState.timeOfDayActive` 或 `_timeOfDayPaused` 时直接返回
- tick 中 sunAngle 变化 ≥ `AUTO_LINK_THRESHOLD_DEG` 时才触发 `applyEnvStateFacade`（防抖动），天空色变化 ≥ 0.4 时才 `dispatchEnvChange`
- 预设动画期间 `_timeOfDayPaused = true`，动画完成后恢复
- 新 `applyEnvPreset` 调用会取消上一帧的动画 observer（`_presetAnimId` 递增守卫）
- `stopTimeOfDay` 注销 `_unregisterTimeOfDay` 后置空，防重复注销
- 启动时调用 `syncTimeOfDayFromEnv()` 从 `envState.timeOfDaySpeed` 恢复模块变量

## 与其他子系统关系
- 依赖 `env-bridge.ts` 的 `setEnvState` / `registerEnvStateMiddleware`（同步 envSunAngle 中间件）
- 依赖 `env-persist.ts` 的 `persistEnvState` / `cancelEnvPersistTimer`
- 依赖 `env-lighting.ts` 的 `deriveLighting` / `TIME_OF_DAY_PRESETS`
- 依赖 `render/lighting.ts` 的 `_updateSunDisc` / `setLightState`
- 依赖 `env-dispatcher.ts` 的 `dispatchEnvChange` / `registerSceneTickCallback`
- 被 `env.ts` 门面 re-export

## 验证入口
- 命令：`cd frontend && npm run test`
