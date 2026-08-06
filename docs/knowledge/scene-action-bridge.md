---
kind: scene_action_bridge
name: 场景动作注入桥
tier: leaf
category: core
scope:
  - frontend/src/core/scene-action-bridge.ts
source_files:
  - frontend/src/core/scene-action-bridge.ts
adr:
  - ADR-238
symbols:
  - registerSceneAction
  - getSceneAction
  - SceneActions
invariants:
  - core 持注入点（Map），scene/menus 侧启动时注册，方向单向，禁止 core 反向 import scene
  - 未注册调用只告警一次（_missingWarned），静默返回 undefined，不抛异常
  - 与 ui-action-bridge 同模式：分字段注册，支持各模块独立注册；registerSceneAction 返回 identity-based 注销 token（与 registerUiAction 契约对称，防 HMR 闭包残留）
tests: []
use_when:
  - 场景动作
  - 桥接
  - initScene
  - initLibrary
  - 模型替换
  - 动作加载
---

# 场景动作注入桥

## 系统概览
**场景动作注入桥**（scene-action-bridge）。ADR-238 为切断 `core/action-defs → scene/*` 反向依赖而设的注入桥：core 持注入点，scene/menus 侧模块启动时经 `registerSceneAction` 注册实现，core 侧经 `getSceneAction` 调用，方向单向。

## 核心职责
- `scene-action-bridge.ts` — 定义 `SceneActions` 接口（40+ 动作字段）+ 注册/读取实现。

## 对外 API（节选）
- `registerSceneAction(key, fn)` — scene/menus 侧注册动作实现（模块加载即注册）。
- `getSceneAction(key)` — core/action-defs 侧读取；未注册返回 `undefined` 并一次性告警。
- `SceneActions` — 动作接口全集：`initScene` / `initLibrary` / `setEnvState` / `replaceModel` / `replaceMotion` / `refreshLibrary` / `saveSceneImmediate` / `setLightState` / `setCameraMode` / `applyEnvPreset` / 撤销恢复 / 动作历史 / 音频 / 换装 / AR 等。

## 与其他子系统关系
- 注册方：`scene/scene.ts`（initScene/initLibrary 等）、`scene/env/*`、`scene/camera/*`、`scene/motion/*`、`menus/library-setup.ts`（initLibrary/refreshLibrary）、`menus/library-actions.ts`（replaceModel/replaceMotion/importFile）、`menus/model-preset.ts`（tryAutoApplyPreset）、`outfit/*`（音频/换装）。
- 消费方：`core/init.ts`（启动编排）、`core/action-defs`（control 动作）、`core/events.ts`（seek/焦点）。

## 不变量
- **方向单向**：core 持注入点，scene/menus 注册，禁止 core 反向静态 import scene。
- **未注册容错**：`getSceneAction` 对缺失 key 只告警一次后静默返回 `undefined`，调用方用 `?.()` 兜底——防止重构破坏导致静默跳过。
- **加载锚点**：桥接注册在模块顶层执行，模块必须被 import 才注册（见 v1.9.1 按钮修复：sideEffects 声明会摇掉未使用 import 的注册模块）。
