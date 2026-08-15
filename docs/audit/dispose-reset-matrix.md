# Env / Lighting / Camera 模块级状态 Dispose 复位矩阵

> 目的：回应提交史审计中的 P1「env 系幽灵状态残留系统性复发」。本文档盘点各模块级单例状态与对应 dispose/reset 路径，标记是否已复位，供后续“一次补齐”和防复发。
> 方法：grep 模块级 `let`/`const` 可变状态 + 精读 dispose/reset 函数 + 对照现有测试。

## 结论摘要

- 多数模块已有较完整复位（`env-impl`、`env-sky`、`env-water`、`env-particles`、`env-reflection`、`lighting`、`camera-state`）。
- 仍缺少一张“谁负责复位”的显式矩阵，且存在少量需要主模型决策的语义缺口（见文末）。
- 当前未发现新的明确“漏置空”热点；P1 更多是**治理/收口问题**而非仍在大面积复发。

## 矩阵

| 模块 | 模块级状态 | dispose/reset 入口 | 状态 |
|---|---|---|---|
| `scene/render/lighting.ts` | `hemiLight` / `dirLight` | `disposeLighting()` → `safeDispose` | ✅ |
| | `envSysShadow` | `disposeLighting()` → `generator` 释放 + `envSysShadow = null` | ✅（round61 补） |
| | `scene` / `triggerAutoSave` | `disposeLighting()` → `null` | ✅ |
| | `activeTransitionObs` / `coneUpdateHandle` / `personalLightTickHandle` / `stageFollowTickHandle` | `disposeLighting()` → dispose + null | ✅ |
| | `stageLights` / `stageShadows` / `stageCones` | `disposeLighting()` → clear | ✅ |
| | `stageLightCounter` / `activeStageLightId` / `skipLightAutoSave` / `shadowEnabled` | `disposeLighting()` → 复位 | ✅ |
| | `_brightnessBakeBase` / `_brightnessBakedRatio` | `disposeLighting()` → 复位 | ✅ |
| | `_guardWarnedKeys` | 未清空（Set 仅防日志风暴，非状态残留） | ⚠️ 可接受 |
| `scene/render/lighting-follow.ts` | `_entries` | `disposeAllPersonalLights()` → `detachPersonalLight` 逐个删除 | ✅ |
| | `_userPersonalLightDefault` | `resetPersonalLightDefault()` | ✅ |
| `scene/env/env-impl.ts` | `_envUpdateObserver` | `disposeEnvUpdateObserver()` → `safeDispose` | ✅ |
| | `_prevParticleEnabled` / `_prevSplash` / `_prevCustomTexture` | `disposeEnvUpdateObserver()` → 复位 | ✅ |
| | `env-context._scene/_pipeline` | `resetEnvContext()` | ✅ |
| `scene/env/env-sky.ts` | `_skyFollowHandle` | `disposeSky()` → `safeDispose` | ✅ |
| | `skyMesh` / `skyCubeTexture` / `skyDynamicTex` | `disposeSky()` → `safeDispose` | ✅ |
| | `_proceduralEnvTexture` / `_lastSkyCubePath` / `_lastProceduralSkyKey` | `disposeSky()` → 复位 | ✅ |
| | `_texStarsImg` / `_texStarsImgUrl` / `_texStarsGeneration` | `clearStarsTexCache()`（由 `disposeEnvUpdateObserver` 调） | ✅ |
| `scene/env/env-clouds.ts` | `_cloudFollowHandle` / `_cloudUpdateHandle` | `disposeClouds()` → `safeDispose` | ✅ |
| | `_volCloudMat` / `_volCloudMesh` / `_noiseTex3D` / `_blueNoiseTex` | `disposeClouds()` → `safeDispose` | ✅ |
| `scene/env/env-water.ts` | `_waterUpdateObserver` / `_waterScene` | `disposeWater()` → 置空 | ✅ |
| | 水面 mesh / LOD / 相位 / 涟漪 / 地面涟漪 / 细节法线 / 水下 flag | `disposeWater()` → 委托各 reset/dispose | ✅ |
| `scene/env/env-particles.ts` | `_splashPoolReady` / `_collisionObserver` / 基础发射参数 / 纹理缓存 | `disposeParticles()` / `disposeSplash()` | ✅ |
| `scene/env/env-reflection.ts` | `_reflectionProbe` / `_probeRefreshObserver` / `_lastProbeRefresh` / `_arSuspended` / `_probeCreateFailed` | `disposeReflection()` / `_disposeProbe()` | ✅ |
| `scene/env/env-time-of-day.ts` | `_unregisterTimeOfDay` | `stopTimeOfDay()` / `disposeEnvUpdateObserver()` 的 `clearSceneTickCallbacks()` | ✅ |
| | `_timeOfDayPaused` / `_timeOfDayBeforePreset` / `_lastSkySunAngle` / `_lastAutoLinkSunAngle` | `syncTimeOfDayFromEnv()` + 预设动画收口 | ✅（无独立 dispose，依赖 env-impl 清 tick + sync 复位） |
| `scene/env/_shared/env-context.ts` | `_scene` / `_pipeline` | `resetEnvContext()` | ✅ |
| `scene/camera/camera-state.ts` | `_currentCamera` / `_scene` / `_canvas` / `_previousMode` / `_viewMatrixHandle` / 双轴与 auto 状态 | `resetCameraState()` | ✅ |

## 仍需决策 / 可改进

1. **P1 治理收口**：矩阵已存在，建议后续把“dispose 后必须复位”做成 `check:dispose-reset` 静态规则或至少纳入代码评审 checklist，避免再靠提交史追查。
2. **`lighting.ts` 的 `_guardWarnedKeys`**：非状态残留，但若希望 HMR 后重新告警，可考虑 `disposeLighting` 时清空；当前保留可减少日志噪音，需产品/维护者确认。
3. **`env-time-of-day.ts` 无独立 dispose**：目前由 `disposeEnvUpdateObserver` 的 `clearSceneTickCallbacks` 间接清理；若未来 time-of-day 注册不再走 scene tick，需要补显式 reset。
4. **P2 safeDisposeScene / P3 reentrancy guard 等**：见 `audit-pending.md` 六类设计可疑点，不在本矩阵内展开。
