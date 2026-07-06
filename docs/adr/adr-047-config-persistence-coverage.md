# ADR-047: 配置持久化覆盖现状

> **状态**: 已完成
> **日期**: 2026-07-06
> **背景**: 2026-07-06 会话中修复了多个配置未持久化的 bug（clothConfig 防抖丢失、调试开关重启重置、相机/时间流逝状态丢失），顺带梳理了全量覆盖情况。

## 一、持久化架构

```
前端 envState / uiState
    ↓ setEnvState() / setUIState()（500ms 防抖）
    ↓ flushEnvState()（visibilitychange / beforeunload 立即刷写）
Go SetEnvState() / SetUIState()
    ↓ updateConfig() → writeConfig()
config.json（settingDir 或 configDir）
```

### 防抖机制

| 防抖对象 | 定时器 | 间隔 | flush 入口 |
|----------|--------|------|-----------|
| `envState` → `SetEnvState` | `_envPersistTimer` | 500ms | `flushEnvState()` |
| 场景 JSON → `SaveLastScene` | `autoSaveTimer` | 2000ms | `saveSceneImmediate()` |

两者均在 `cleanupAndFlushSave()` 中同步刷写（`visibilitychange` + `beforeunload`）。

## 二、已持久化状态

### EnvState（通过 SetEnvState → config.json.Env）

| 分类 | 字段 | 说明 |
|------|------|------|
| 天空 | skyMode, skyColorTop/Mid/Bot, skyTexture, skyRotationY, skyRotationSpeed, skyBrightness, starsEnabled, envIntensity | 天空外观 |
| 地面 | groundVisible, groundMode, groundColor, groundAlpha, groundTexture, groundTextureEnabled, groundTextureScale | 地面系统 |
| 风 | windEnabled, windDirection, windSpeed | 风场 |
| 粒子 | particleEnabled, particleType, particleEmitRate, particleSize, particleSpeed, particleSplash, particleCustomTexture | 粒子系统 |
| 水面 | waterEnabled, waterLevel, waterColor, waterTransparency, waterWaveHeight, waterSize, waterAnimSpeed | 基础水面 |
| 水面高级 | fresnelBias/Power, diffuseStrength, ambientStrength, foamTransitionRange, rippleNormalStrength/GlintStrength, causticColor1/2, causticScrollX/Y, fresnelAlphaInfluence, foamAlphaInfluence | 着色器参数 |
| 水下 | underwaterFogColor, underwaterFogDensity, underwaterChromaticAmount, underwaterToneIntensity, underwaterFogMultiplier | 水下效果 |
| 云 | cloudsEnabled, cloudCover, cloudScale, cloudHeight, cloudThickness, cloudVisibility, cloudGap | 体积云 |
| 雾 | fogEnabled, fogMode, fogColor, fogDensity, fogStart, fogEnd | 雾效 |
| 布料 | clothEnabled, clothConfig (13 字段), clothDebugParticles/Constraints/Colliders | XPBD 布料 |
| 求解器 | solverSubsteps, solverTimeScale, collisionEnabled, bodyCollisionEnabled, groundCollisionEnabled | 物理参数 |
| 太阳 | sunAngle, azimuth | 太阳位置 |
| 灯光 | lightingPresetName | 灯光预设引用 |
| **时间流逝** | **timeOfDayActive, timeOfDaySpeed** | **2026-07-06 新增** |

### UIState（通过 SetUIState → config.json.UiState）

| 字段 | 说明 |
|------|------|
| scale | UI 缩放 |
| popupWidth | 弹窗宽度 |
| accent | 主题色 |
| fontFamily | 字体 |
| animations | 动画开关 |
| blurBg | 背景模糊 |
| performanceMode | 性能模式 |
| screenshotFormat/Quality | 截图设置 |
| **autoCameraEnabled** | **自动机位开关（2026-07-06 新增）** |
| **autoCameraBeatsPerSwitch** | **自动机位切换频率（2026-07-06 新增）** |

### 其他已持久化

| 数据 | 存储位置 | 说明 |
|------|---------|------|
| 场景文件 | config.json.LastScene / 最近场景 preset | 完整场景序列化 |
| 渲染预设 | Go RenderPresets | 用户自定义渲染预设 |
| 环境预设 | Go EnvPresets | 用户自定义环境预设 |
| 模型预设 | Go ModelPresets | 材质/变换预设 |
| 舞蹈套装 | Go DanceSets | VMD + 音频组合 |
| 标签系统 | config.json.Tags | 模型标签 |
| 外部库 | config.json.ExternalPaths | 外部资源库挂载 |
| 下载监听 | config.json.DownloadWatchDir/AutoImport | 自动导入 |
| 快捷键绑定 | UIState.index_signature | 键位映射 |

## 三、未持久化状态（无需持久化）

| 状态 | 原因 |
|------|------|
| `_fov` | 场景序列化时已保存 |
| `_concertAngle` / `_concertPaused` | 会话内临时状态 |
| `_presetAnimId` | 动画 ID，非用户可见 |
| 各种 timer ID / DOM 引用 | 内部实现细节 |
| WASM Bullet 参数 | 由场景物理级别控件管理 |

## 四、已修复的持久化问题

| 问题 | 修复 |
|------|------|
| clothConfig 500ms 防抖 + 关闭丢数据 | `flushEnvState()` 加入 `cleanupAndFlushSave()` |
| 布料调试开关重启重置 | clothDebug* 移入 EnvState |
| 自动机位重启重置 | autoCamera* 移入 UIState |
| 时间流逝重启重置 | timeOfDay* 移入 EnvState |
| config.ts 拆分后文档过时 | AGENTS.md / architecture.md / function-map.md 已更新 |
