---
tier: architecture
adr:
  - ADR-116
  - ADR-129
  - ADR-166
kind: motion_modules_registry
name: 动作模块注册表
category: motion
scope:
  - frontend/src/scene/motion/motion-modules/registry.ts
source_files:
  - frontend/src/scene/motion/motion-modules/registry.ts
symbols:
  - BoneConflict
  - PROC_ACTION_PREFIX
  - applyMotionModulesToModel
  - applyProcMotionModulesToModel
  - claimBones
  - clearAllModulesForModel
  - createModule
  - getAllConflicts
  - getBuiltinModuleDefs
  - getConflictCount
  - getModuleConflicts
  - getModuleDefaultParam
  - getModuleState
  - getOwnedBones
  - getRegisteredModules
  - initMotionModules
  - registerModule
  - releaseOwnedBones
  - setModuleEnabled
  - setModuleParam
  - setTargetModel
  - unregisterModule
invariants:
  - 模块注册后按 priority 排序执行
  - 每个模块有唯一 name 标识
tests:
  - frontend/src/__tests__/scene/motion-modules-registry.conflict.test.ts
  - frontend/src/__tests__/scene/motion-modules-registry.create.test.ts
  - frontend/src/__tests__/scene/motion-modules-registry.disable.test.ts
  - frontend/src/__tests__/scene/motion-modules-registry.ik.test.ts
  - frontend/src/__tests__/scene/motion-modules-registry.init.test.ts
  - frontend/src/__tests__/scene/motion-modules-registry.param.test.ts
  - frontend/src/__tests__/scene/motion-modules-registry.snapshot.test.ts
use_when:
  - 动作模块
  - 模块注册
  - 动作扩展
  - 动作管线扩展
---

# 动作模块注册表

## 系统概览
**动作模块注册表**。管理动作管线的可插拔模块（如脚部调整、手指姿态、身体姿势、摇摆等），
按优先级排序执行，支持动态注册/注销。是动作管线的扩展点。

## 核心职责
- `registry.ts` — 动作模块注册、排序、生命周期管理（纯函数式 API，无 class）。

## 对外 API（节选）
- `interface MotionModule` / `MotionOverrideModule` — 动作模块接口（name、priority、apply/execute）。
- `registerModule(id, meta, priority)` — 注册动作模块。
- `unregisterModule(id)` — 注销动作模块。
- `getRegisteredModules()` — 取已注册模块列表（按优先级排序）。
- `createModule(id, modelId, actionId?)` — 为模型创建模块实例。
- `getModuleState(modelId, moduleId, actionId?)` — 取模块运行时状态。`actionId` 指定「写入哪个动作」：UI 查看动作 A 时传 A 的 id，使覆盖参数落在被查看的动作而非激活动作；缺省回退激活动作（运行时路径不变）。
- `setModuleParam(modelId, moduleId, key, value)` / `setModuleEnabled(modelId, moduleId, enabled)` — 模块参数/启停写入。
- 骨骼仲裁：`claimBones` / `getOwnedBones` / `getModuleConflicts` / `releaseOwnedBones` — 多模块骨骼归属与冲突检测。
- `initMotionModules()` / `getBuiltinModuleDefs()` — 内置模块注册。

## per-proc 持久化（程序化动作覆盖）
程序化动作（idle/autodance 等）无 VMD `SceneMotionIntent`，其动作覆盖模块配置过去回落扁平内存 `_fallbackModuleStates`，重启/菜单重载即丢失，且跨模型/跨模式串扰。修复为 per-model + per-procRole 持久化：
- `PROC_ACTION_PREFIX = 'proc:'` — actionId 前缀标识程序化动作作用域（`proc:${procRole}`），导出供 UI（motion-detail-ui / motion-root-ui）复用，避免消费方硬编码失配。
- `getModuleState` 对 `proc:${role}` 前缀 actionId 读 `ModelInstance.procMotionModules[role]` 持久化存储（`_getOrCreateProcModuleState` 惰性创建 + 种入 defaults）。
- `applyProcMotionModulesToModel(modelId, procRole)` — 把持久化模块状态落到运行时（激活/场景恢复/重生成时调用），与 `applyMotionModulesToModel`（VMD 路径）对称，单模块异常不阻断其余。
- 存储随 `ModelInstance.procMotionModules` 走场景序列化（scene-serialize structuredClone 防污染 + 反序列化清洗降级）。

## 与其他子系统关系
- 被 `motion-pipeline.ts` 调用，逐帧执行各模块。
- 下游模块：`body-posture`、`hand-modules`、`foot-modules`、`riding-model` 等。

## 不变量
- 模块按 priority 升序执行，相同 priority 按注册顺序。
- 模块 name 必须唯一，重复注册 console.warn 告警并覆盖（不静默覆盖；为兼容 vite HMR 热重载不 throw）。
