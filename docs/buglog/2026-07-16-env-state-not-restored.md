# 环境状态恢复失败：config.json 写入时机不可靠 + 场景文件 env 被 skipEnv 跳过

**日期**: 2026-07-16
**严重程度**: 🔴 P1（重启后环境设置丢失，所有环境菜单显示默认值）
**影响范围**: `frontend/src/core/init.ts`（restoreEnvState）+ `frontend/src/scene/scene-serialize.ts`（tryRestoreLastScene/deserializeScene）+ `frontend/src/scene/env/env-bridge.ts`（setEnvState）
**发现方式**: 用户反馈"自动载入、保存功能失效"，加 log 后定位

---

## 问题描述

重启应用后，环境菜单（天空/地面/水面/粒子等）全部恢复默认值，用户之前保存的 env 设置丢失。场景文件（last_scene.json）中包含正确的 env 状态，但未被应用。

---

## 排查时间线

### 第一轮：级联 auto-save 覆盖场景文件

加 log 后看到启动时序：

```
[auto-load] Scene file version: v1, models: 0
[auto-save] triggerAutoSaveImpl() called × N
[auto-save] len=5614 → SaveLastScene()  ← 持续写入空场景
```

**根因**：`deserializeScene()` 调用 `setCameraState()` / `setLightState()` / `setRenderState()`，这些函数内部都调 `triggerAutoSave()`。恢复过程中触发多次 auto-save，把空场景（0 模型）写回 `last_scene.json`。

**修复**：`scene-serialize.ts` 新增 `_suppressAutoSave` 标志，`deserializeScene` 期间抑制 auto-save。

### 第二轮：restoreEnvState 绕过 setEnvState 中央入口

```
[env-restore] skyMode: color  ← config.json 里是默认值
```

发现 `restoreEnvState()` 用 `Object.assign(envState, loaded)` + `applyEnvState()`（`env.ts` 的全量无条件重建），不走 `setEnvState` 的 `migrateEnvState` + `_applyEnvStateFacade` 路径。但这只是表面问题，**真正的原因是 config.json 里的 env 状态本身就是默认值**。

### 第三轮：数据源优先级倒挂

经分析，env 状态有两个存储位置：

| 数据源 | 写入时机 | 可靠性 |
|--------|---------|--------|
| `config.json`（`SetEnvState`） | `beforeunload` 时 fire-and-forget（Wails async binding） | ❌ 可能未完成 |
| `last_scene.json`（`SaveLastScene`） | `beforeunload` 时 fire-and-forget | ✅ 通常能完成（简单文件写入） |

`SetEnvState` 的 Go 实现走 `updateConfig` → `writeConfig`（JSON marshal + tmp 写入 + rename × 2 目录），路径较长。`SaveLastScene` 只是 `os.Create` + `WriteString` + `Sync`，路径短。

`beforeunload` 事件处理是同步的，Wails binding 是异步 fire-and-forget。页面销毁时，`SetEnvState` 往往来不及完成，而 `SaveLastScene` 通常能完成。

**但 `tryRestoreLastScene()` 调用 `deserializeScene(data, true)` 时传了 `skipEnv=true`，场景文件中的 env 状态被跳过。** 所以 UI 永远只看 config.json 的默认值。

---

## 修复清单

| # | 缺陷 | 文件 | 修复 |
|---|------|------|------|
| 1 | deserializeScene 期间级联 auto-save | `scene-serialize.ts` | 新增 `_suppressAutoSave` 标志 + `setSuppressAutoSave()`，`triggerAutoSaveImpl` 检查标志后跳过 |
| 2 | restoreEnvState 绕过 setEnvState 中央入口 | `init.ts` | 改调 `setEnvState(loaded, true)`，由 `setSuppressAutoSave(true/false)` 包裹 |
| 3 | 场景文件 env 被 skipEnv 跳过 | `scene-serialize.ts` | `tryRestoreLastScene` 中 deserializeScene 后，从场景数据提取 env 并调用 `setEnvState(envFromScene, true)` 覆盖 |

---

## 教训

### 1. beforeunload 中的 async Wails binding 不可靠

`beforeunload` 事件是同步的，Wails binding 是异步 fire-and-forget。页面销毁时，复杂 binding（如 `writeConfig` 的 tmp+rename）可能未完成。**简单文件写入（如 `SaveLastScene`）通常能完成，复杂链路（如 `SetEnvState` → `updateConfig` → `writeConfig`）则可能失败。**

**替代方案**：建立两个数据源的优先级关系。如果两个数据源同时存在，场景文件（last_scene.json）的优先级应高于 config.json，因为场景文件的写入路径更短、更可靠。

### 2. skipEnv 的设计缺陷

`deserializeScene` 的 `skipEnv` 参数最初是为了避免恢复场景时重复应用 env 状态（因为 `restoreEnvState` 已经先一步从 config.json 加载了）。但这个假设建立在"config.json 的 env 状态一定是最新的"基础上，而这个假设不成立。

**教训**：当一个状态有两个存储入口时，不要假设某个入口"一定是最新的"。应该总是在恢复时比较两个入口的时间戳或版本，择优使用。或者更简单：场景恢复后，强制用场景文件中的 env 状态覆盖。

### 3. 防抖定时器的副作用

`setEnvState` 的 `_envPersistTimer` 在 `restoreEnvState` 阶段也被调度了（即使 `skipAutoSave=true`，timer 仍会启动）。500ms 后 timer 触发，把刚恢复的默认值写回 config.json，造成"写入默认值"的假象。

**教训**：`setEnvState` 的 `skipAutoSave` 参数只跳过了 `triggerAutoSave`，但没有跳过 `_envPersistTimer`。应该在恢复阶段也抑制 `_envPersistTimer`，或者恢复后主动清除 timer。