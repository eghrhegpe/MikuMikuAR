---
kind: configuration_system
name: 配置系统：Go 后端 JSON 持久化 + 前端 Reactivity 状态管理
category: configuration_system
scope:
    - '**'
source_files:
    - internal/app/config.go
    - internal/app/app.go
    - frontend/src/core/state.ts
    - frontend/src/core/env-state-schema.ts
    - frontend/src/core/ui-state.ts
    - text-model/setting/config.json
---

## 系统概览

MikuMikuAR 采用 **Go 后端集中式 JSON 持久化 + 前端 Reactivity 状态管理** 的双层配置架构。Go 端负责配置的加载、迁移、并发安全读写与磁盘持久化；前端通过 Wails 绑定调用 Go API，并在内存中维护响应式状态树。

## 核心文件与职责

- `internal/app/config.go` — 配置加载/写入/迁移核心逻辑，包含 `getConfigUnsafe`、`updateConfig`、`writeConfig`、`finaliseConfig` 等
- `internal/app/app.go` — `Config`、`UIState`、`EnvState`、`OverridePaths` 等数据结构定义，以及路径解析、目录创建等基础设施
- `frontend/src/core/state.ts` — 前端 EnvState 单一源（ADR-137），从 schema 派生默认值并包装为 reactive
- `frontend/src/core/env-state-schema.ts` — EnvState 全部字段的类型 + 默认值 Schema，新增字段只需在此追加
- `frontend/src/core/ui-state.ts` — UI 持久化 store，通过回调机制触发 Go 端持久化
- `text-model/setting/config.json` — 运行时配置文件示例（含 resource_root、override_paths、ui_state、env 等）

## 存储位置与分层

### 双存储层级（Bootstrap → Setting）

```
用户配置目录 (%APPDATA%/MikuMikuAR/)
├── config.json          ← Bootstrap 配置（最小集，仅含 ResourceRoot）
└── setting/             ← 完整配置（当 ResourceRoot 指向资源根时）
    ├── config.json      ← 完整配置副本（覆盖 bootstrap）
    └── index.json       ← 模型索引
```

- `configDir()` → `%APPDATA%/MikuMikuAR/`
- `settingDir(cfg)` → 优先使用 `cfg.OverridePaths.Setting`，否则 `ResourceRoot/setting`，最后回退到 `configDir()`
- `ensureResourceDirs(cfg)` → 自动创建 PMX/VMD/audio/stage/environment/MD-dress/setting/audio/prop 子目录

### Android 特殊处理

- `StorageMode`: `"private"`（应用私有目录）| `"shared"`（`/sdcard/MDD`，需 MANAGE_EXTERNAL_STORAGE）
- 启动时根据 StorageMode 同步 ResourceRoot，旧默认 `/sdcard/MMD` 会被替换

## 配置结构

### Config 主结构（Go）

```go
type Config struct {
    ConfigVersion            int                 // 配置版本（v0→v1: library_root→resource_root 迁移）
    UIState                  UIState             // UI 偏好（缩放/主题/截图/快捷键等）
    ResourceRoot             string              // 总资源根目录
    StorageMode              string              // Android 专用："private"|"shared"
    OverridePaths            OverridePaths       // 各类型路径覆写
    BlenderPath              string
    DisplayNamePriority      string              // "name_jp"|"name_en"|"filename"
    DownloadWatchDir         string
    DownloadAutoImport       bool
    DownloadWatchEnabled     bool
    Favorites                []string            // libraryRef 数组
    RenderPresets            []RenderPreset
    MMDPath                  string
    CustomSoftware           []SoftwareEntry
    Tags                     map[string][]string // libraryRef → []tag
    RecentModels             []string            // 最近打开的模型（最多20条）
    Env                      *EnvState           // 环境状态（nil=使用前端默认）
    LastDirs                 map[string]string   // 对话框最后目录记忆
}
```

### OverridePaths 分类覆写

支持 PMX、VMD、Audio、Prop、Stage、Environment、MD-dress、Setting 八类路径独立覆写，空值表示使用 `ResourceRoot/<默认子目录>`。

### UIState 字段（部分）

Scale、PopupWidth、Accent、FontFamily、Animations、BlurBg、PerformanceMode、ScreenshotFormat/Quality/Dir、ThumbnailResolution、AutoCameraEnabled/BeatsPerSwitch、AutoUpdateEnabled、FpsLimit、Vsync、DefaultPhysicsEnabled、RenderScale、CameraSensitivity、InvertYAxis、AutoScaleModel、AutoCenterModel、MaterialCategoryMap、ResourceViewMode、Volume、AudioOffset、BpmQuantizeEnabled、AutoLoadCompanionAudio、SfxEnabled/SfxVolume、FootstepEnabled/FootstepVolume、KeyBindings 等。

### EnvState 单一源（ADR-137）

前端通过 `ENV_STATE_SCHEMA` 集中定义所有环境相关字段（天空/地面/风/粒子/水面/云/雾/碰撞/光照/时间）的类型与默认值，由 `buildDefaultEnvState()` 派生初始 state，确保前后端结构一致。

## 并发安全与缓存

- `configMu sync.RWMutex` 保护 GetConfig/writeConfig 序列
- `cachedCfg *Config` 内存缓存，仅在 writeConfig 下失效
- `GetConfig()` 使用 RLock，`updateConfig()` 使用 Lock 包裹 mutate + 持久化

## 迁移机制

- `currentConfigVersion = 1`，在 `finaliseConfig` 中执行 v0→v1 迁移（library_root → resource_root）
- 未来扩展：`if cfg.ConfigVersion < 2 { ... }` 预留迁移入口

## 前端状态管理

- `state.ts` 导出四个独立 store（scene/playback/library/ui）+ envState
- `setUIState()` 通过 `_uiPersistCb` 回调触发 `flushUIState()` → `SetUIState(Go)` → `config.json.ui_state`
- `mergeUIState()` 实现部分更新，避免覆盖未传入的字段
- SettingsStore 音频设置通过 ADR-103 接入同一持久化链路

## 开发者约定

1. **新增配置字段**：Go 端在 `Config`/`UIState`/`EnvState` 添加字段 + 对应 `SetXxx()` setter；前端在 `env-state-schema.ts` 追加 Schema 定义
2. **路径变更**：通过 `SetResourceRoot()` / `SetOverridePath()` 修改，自动触发 rescan + reindex
3. **Android 适配**：使用 `SetStorageMode()` 切换 private/shared，不要直接修改 ResourceRoot
4. **UI 状态更新**：统一走 `setUIState()`，禁止直接赋值 `uiState` 字段
5. **配置版本升级**：递增 `currentConfigVersion` 并在 `finaliseConfig` 中添加迁移逻辑
6. **相对路径规范**：ResourceRoot 下的路径以 `./` 前缀存储，跨平台可移植

## 环境变量

项目不使用 `.env` 文件进行运行时配置，构建期环境变量（如 `VITE_URL`、`CI`、`BASELINE_GEN`）仅用于开发/测试流程控制。
