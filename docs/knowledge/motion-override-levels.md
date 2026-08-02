---
tier: leaf
kind: motion_override_levels
name: 动作覆盖 UI 层级（模块化覆盖 + 高级骨骼覆盖）
category: ui
scope:
  - frontend/src/menus/motion-override-levels.ts
source_files:
  - frontend/src/menus/motion-override-levels.ts
adr:
  - ADR-061
  - ADR-116
  - ADR-123
  - ADR-126
  - ADR-145
  - ADR-186
symbols:
  - renderPresetCard
  - renderOverrideCard
  - buildModuleParamLevel
  - buildAdvancedBoneOverrideLevel
  - syncOverrideToInstance
invariants:
  - renderPresetCard / renderOverrideCard 由 motion-detail-ui.ts 消费（原独立覆盖页路由已移除）
  - 表单状态提升到模块级 Map（_overrideFormStates）避免 reRender 时丢失
  - 覆盖语义 absolute=true 仅对叶骨开放（中间层级骨骼视觉跳跃，审计 P2 风险）
  - 所有破坏性操作（清空/重置）走 showConfirm + pushUndoSnapshot + offerSceneUndoAndRefresh
tests:
  - frontend/src/__tests__/scene/bone-override.test.ts   # ADR-116 P1 computeOverride 加法/Slerp/父骨传播语义
  - frontend/src/__tests__/scene/bone-override-store.test.ts  # ADR-147 Phase 2 槽位认领/冲突/所有权守卫
  # 注：以上仅覆盖 bone-override 运行时逻辑，不覆盖本卡的 DOM 渲染入口（见下方「测试缺口」）
use_when:
  - 动作覆盖 UI
  - 模块参数子页
  - 高级骨骼覆盖子页
  - 预设管理
  - 冲突检测展示
  - 帧钩子时序一览（ADR-186）
---

# 动作覆盖 UI 层级（模块化覆盖 + 高级骨骼覆盖）

## 系统概览
**动作覆盖 UI 层级模块**（ADR-116 P3-3 + ADR-145）。提供两类可复用卡片渲染器（`renderPresetCard` / `renderOverrideCard`）供 `motion-detail-ui.ts` 消费，以及两个独立子页入口（`buildModuleParamLevel` / `buildAdvancedBoneOverrideLevel`）。原独立的 `motion:boneOverride` 死路由已移除，UI 入口统一收口到动作详情页。

## 核心职责
- `renderPresetCard(container, modelId)` — 动作预设卡片：标题栏（保存按钮）+ 预设列表 / 空状态（ADR-145）
- `renderOverrideCard(container, modelId)` — 骨骼覆盖卡片：列表项 + 编辑表单（pitch/yaw/roll/weight/absolute）+ 冲突检测展示
- `buildModuleParamLevel(moduleId)` — 模块参数子页：渲染指定模块的 `buildSchema()`，由 motion-popup push 进入
- `buildAdvancedBoneOverrideLevel()` — 高级骨骼覆盖子页（原 ADR-061 UI，下沉为 power user 通道）：批量覆盖编辑 + IK 保护 + 帧钩子时序一览（ADR-186）
- `syncOverrideToInstance(modelId)` — 将 bone-override.ts 运行时状态同步回 `ModelInstance.boneOverrides` 用于持久化

## 与其他子系统关系
- 依赖 `bone-override.ts`（17 个公开 API：setBoneOverride / clearBoneOverride / getAllOverrides / getFrameHooksSnapshot / dumpBoneHierarchy 等）
- 依赖 `motion-modules/registry.ts`（getRegisteredModules / createModule / getAllConflicts）
- 依赖 `motion-modules/motion-history.ts`（undo / redo / jumpToHistory — 撤销重做）
- 依赖 `motion-modules/preset-types.ts`（applyMotionPreset / generatePresetId / modulesToPresetMap）
- 依赖 `motion-popup.ts`（getMotionMenu / renderModuleToggleList）
- 被 `motion-detail-ui.ts` 消费（renderPresetCard / renderOverrideCard）
- 被 `motion-popup.ts` 调用（buildModuleParamLevel / buildAdvancedBoneOverrideLevel — 子页入口）
- 场景级撤销保护：`scene.ts` 的 `pushUndoSnapshot` / `offerSceneUndoAndRefresh`

## 不变量
- `renderPresetCard` / `renderOverrideCard` 由 motion-detail-ui.ts 消费（原独立覆盖页路由已移除，ADR-116 P3-3）
- 表单状态提升到模块级 Map `_overrideFormStates`（per-model），避免 reRender 时丢失
- 覆盖语义 `absolute=true` 仅对叶骨开放（中间层级骨骼会丢弃父骨传播导致视觉跳跃，审计 P2 风险）
- 所有破坏性操作（清空 / 重置 / 应用预设）走 `showConfirm` + `pushUndoSnapshot` + `offerSceneUndoAndRefresh`，提供撤销路径
- 帧钩子时序一览（ADR-186）：从 `getFrameHooksSnapshot()` 取 order + source + hook，按 order 升序展示

## 帧钩子时序一览（ADR-186 UI 卡片）
高级骨骼覆盖子页底部展示当前注册的帧钩子列表，按 order 升序：
- order=0 foot-modules（足部 IK 修复）
- order=5 body-posture（身体姿势）
- order=10 riding-model（骑乘模型）
- order=20 sway-motion（已归档）/ hand-symmetry（手部对称）
- order=30 hand-symmetry（若未在 order=20）

> 此卡片是 ADR-186 时序图的运行时可视化，便于用户理解多模块协作的执行顺序。

## 测试缺口（2026-08-02 核实）

本卡描述的 **DOM 渲染入口**（`renderOverrideCard` / `renderPresetCard` / `buildAdvancedBoneOverrideLevel` / `buildModuleParamLevel`）**当前无任何自动化测试覆盖**：

- `frontend/src` 内无文件直接 import 这四个渲染函数做断言；
- E2E `frontend/e2e/motion-panel-dom.spec.ts:37` 把覆盖卡片渲染的覆盖"推给 wailsPage 模式或单测"，实际未实现；
- `tests:` 列出的两条单测只验证 `bone-override.ts` 运行时逻辑（computeOverride / BoneOverrideStore），**不触碰本卡的 UI 渲染**。

后果：渲染层回归（卡片不显示 / 表单状态丢失 / absolute 开关错位等）会"单测全绿但界面坏掉"，只能靠 manual dev 或补一条 DOM 测试发现。

**建议**：若要为渲染补测试，在 `motion-override-levels` 上加 `jsdom` 环境单测（调用 `renderOverrideCard(container, modelId)` 后断言 `container` 内的行/冲突徽标），或在 `motion-panel-dom.spec.ts` 落实 `@wails` 模式的覆盖卡片断言。
