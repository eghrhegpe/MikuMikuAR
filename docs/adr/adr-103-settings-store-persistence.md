# ADR-103: SettingsStore 接入 setUIState 持久化链路

> **状态**: 已完成
> **日期**: 2026-07-13

## 一、问题背景

当前设置系统存在两套存储路径，职责不清：

| 存储路径 | 职责 | 持久化方式 | 覆盖范围 |
|----------|------|-----------|---------|
| `uiState` + `setUIState()` | 用户配置偏好 | Go `SetUIState()` → `config.json` | UI 缩放/主题/截图/快捷键等 |
| `SettingsStore` | 音频运行时参数 | 纯前端 signal（内存） | volume/muted/sfx 等 9 个 key |

**问题**：`SettingsStore` 的 9 个音频设置在应用重启后丢失，导致用户每次打开都要重新调整音量。

## 二、决策

让 `SettingsStore` 在每次 `set()` 后触发 `schedulePersistUI()`，将音频设置写入 `uiState` 并通过现有持久化链路同步到 Go 后端。

### 架构调整

```
┌─────────────────────────────────────────────────────────────┐
│                     SettingsStore.set()                     │
│         ↓ (修改内存 signal)                                  │
│         ↓ (触发 SETTINGS_UPDATED 事件)                       │
│         ↓ (新增: 写入 uiState)                               │
│         ↓ (新增: schedulePersistUI() → 500ms 防抖)           │
│         ↓                                                    │
│   flushUIState() → SetUIState(Go) → config.json.UiState     │
└─────────────────────────────────────────────────────────────┘
```

### 技术细节

1. **字段映射**：`SettingsStore` 的 9 个 key 直接映射到 `uiState` 的同名字段
2. **触发时机**：`SettingsStore.set()` 末尾调用 `schedulePersistUI()`
3. **重启恢复**：应用启动时，从 Go 读取的 `uiState` 回写到 `SettingsStore`
4. **去重保护**：`setUIState()` 内部用 `Object.assign`，不会覆盖其他字段

## 三、实施步骤

### Phase 1: SettingsStore 接入持久化触发

**修改文件**: `frontend/src/lib/settings-store.ts`

- 导入 `schedulePersistUI` 和 `uiState`
- 在 `set()` 方法末尾写入 `uiState` 并调用 `schedulePersistUI()`
- 在 `reset()` 方法末尾同样处理

### Phase 2: 重启恢复

**修改文件**: `frontend/src/scene/env/env-bridge.ts` 或初始化入口

- 在环境初始化完成后，读取 `uiState` 中的音频字段回写到 `SettingsStore`

### Phase 3: Go 端支持（如需要）

检查 `config.json` 的 `UiState` 结构是否需要扩展以容纳新增的音频字段。

## 四、风险与应对

| 风险 | 应对 |
|------|------|
| 循环依赖（settings-store → env-bridge → state → settings-store） | 延迟导入 `schedulePersistUI`，或通过 barrel re-export 规避 |
| `uiState` 字段冲突 | 使用前缀命名（如 `audioVolume`）或直接复用现有 key |
| 性能抖动（频繁 set 导致过多持久化） | `schedulePersistUI` 已有 500ms 防抖，无需额外处理 |

## 五、测试验证

| 测试场景 | 验证方式 |
|----------|---------|
| 修改音量后重启，设置保留 | 手动测试 |
| 快速连续修改多个音频设置，仅触发一次持久化 | 日志观察防抖效果 |
| 重置所有音频设置，配置正确回退 | 测试 `reset()` 方法 |
| 其他 UI 设置不受影响 | 验证 `uiState` 其他字段完整性 |