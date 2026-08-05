# 第 11 轮审核报告 — Core 后端 / 序列化 / 动作 / 菜单

> **日期**: 2026-08-06
> **范围**: 16 模块（Core 后端双实现、场景序列化、材质、AR、动作意图/历史/重定向、变换、菜单、资源库）
> **方法**: 4 子代理并行，知识卡 → 源码 → 5 维度 + 4 心理模拟；实测 130+ 测试用例全绿
> **结论**: 16 模块中 ✅通过 5 / ⚠️有条件通过 10 / ❌不通过 1

---

## 执行摘要

| 结论 | 模块数 | 模块 |
|------|--------|------|
| ✅ 通过 | 5 | idb.ts、scene-serialize.ts、motion-intent.ts、transform-adapter.ts、library-core.ts |
| ⚠️ 有条件通过 | 10 | browser-adapter、backend index/go-adapter、action-registry、runtime-bridge、material、ar-scene、ar-camera、motion-history、animation-retargeter、transform-gizmo、menu、render-menu、library-actions |
| ❌ 不通过 | 1 | ar-camera.ts（P1 必须修复） |

## 🔴 P1 问题（必须修复）

| # | 模块 | 位置 | 问题 | 影响 |
|---|------|------|------|------|
| 1 | ar-camera | `ar-camera.ts:129-138, 310` | `w.requestCameraPermission!()` 只查 `hasCameraPermission` 未查 `requestCameraPermission`；Go 端未注册该方法时 Promise executor 抛 TypeError → `ensureAndroidCameraPermission` reject → await 在 try 块**之外** → `_starting`（L93 置 true）**永不复位** → AR 功能永久死锁，且 rejection 未处理 | AR 启动死锁，`setARMode` 永久失败 |
| 2 | motion-history | `motion-history.ts:66-72, 100-117` | 合并窗口跨 undo/redo/jump 边界未失效：undo 后 500ms 内同参数重推走合并分支（只更新条目不前进 cursor）→ `canUndo=false`（状态≠初始）但 `canRedo` 为无操作 | 撤销栈语义错乱（拖动滑杆→撤销→立即再拖） |
| 3 | library-actions | `library-actions.ts:435-487` | `replaceMotion` 只检查 `isReplaceLoading()` 不 `setReplaceLoading(true)`，与 `startReplaceModel` 不对称；快速连点动作替换 → 重复 `pushUndoSnapshot` + 重复 toast，撤销栈错乱 | 动作替换并发竞态 |

## 🟠 P2 问题（建议修复）

| # | 模块 | 位置 | 问题 |
|---|------|------|------|
| 1 | browser-adapter | `browser-adapter.ts:1572` | `ExtractZip` 无 zip 炸弹预检（阈值仅用于 `_scanDirIntoIDB`），拖入大 zip 全量解压 OOM |
| 2 | backend index | `index.ts:41-76` | go-adapter 动态 import 失败 → `_resolving` 永久 rejected，后端不可恢复（破坏「resolveBackend 不 reject」不变量） |
| 3 | action-registry | `action-registry.ts:73-75` | unregister 无条件 `registry.delete`，跨覆盖后误删他人注册（HMR teardown） |
| 4 | runtime-bridge | `runtime-bridge.ts:121-128` | init 前订阅静默丢失（历史 AI 流挂起根因症状），no-op fallback 应一次性 console.warn |
| 5 | material | `material.ts:536-546, 605-608` | per-mat 条目 `{...DEFAULT_MAT_PARAMS}` 整体覆盖 category 结果，遮蔽 category 级 alphaMul 等调整 |
| 6 | ar-camera | `ar-camera.ts:296-312` | `ensureAndroidCameraPermission` 无超时，授权框不响应时永久挂起 |
| 7 | animation-retargeter | `animation-retargeter.ts:106-114, 157` | 源 AnimationGroup + 源 Skeleton 泄漏（成功路径只 dispose mesh 不 dispose 其 skeleton/动画组） |
| 8 | transform-gizmo | `transform-gizmo.ts:102-103, 123-127` | 拖拽中 detach/attach 丢失 drag-end 回写，视觉与持久化分叉 |
| 9 | transform-gizmo | `transform-gizmo.ts:41-51, 179-190` | `_gizmoLayer` 跨场景缓存失效；`disposeScene` 未调 `detachGizmo` |
| 10 | menu | `menu.ts:1102` | `this.onClose()` 未 optional 链，外部构造未传 onClose 时点 X 崩溃 |
| 11 | menu | `menu.ts:1039-1056` | dispose 后挂起 buildPanel 完成：`_customDispose` 悬挂赋值 + panel 复活（dispose 无 `_buildSeq++`） |
| 12 | render-menu | `render-menu.ts:332-337` | `buildSchemaLevel.onLangChange` 丢弃 `renderMenu` 返回的 dispose → 语言切换时 observer/virtualGrid 泄漏 |
| 13 | library-actions | `library-actions.ts:254-257` 等 | abort 被当失败弹「加载失败」误报（已被测试固化） |
| 14 | library-actions | `library-actions.ts:463-482` | replaceMotion zip 分支 doLoad 失败误报 `extractFailed` + 快照悬挂 |
| 15 | library-actions | `library-actions.ts:355-391` | `loadModelNormal` 非 zip 分支无 finally 清理 `_loadManagerAbortCtrl` |

## 🟡 P3 关注项（持续改进）

| 模块 | 问题 |
|------|------|
| scene-serialize | `getActiveFormation()!` 双调用（L551）；`force` 死参数（L1365）；SaveLastScene 无超时（L1403）；deserializeModels 无重入守卫（L607） |
| material | 只读查询 `_ensureState` 有写入副作用（L712-717）；getMatState 每字段 JSON.stringify 热路径开销（L964） |
| ar-scene | `_prevGazeState` 重复进入无条件覆盖（L180-183）；`sky.skyMesh` 无 null 守卫（L176-178）；无代数令牌依赖 ar-camera `_arGen` 间接保护（L161-236） |
| motion-intent | getSceneMotions 返回内部可变引用（L40-42）；addSceneMotion 不校验重复 id（L130-133） |
| transform-gizmo | drag-end 回调抛异常致 `_isDragging` 永久 true（L122-127） |
| library-core | `resourceViewMode` 初始硬编码 'list' 不从 uiState 读回（L45，重启丢失用户选择） |
| menu | transitioning 期间快速连点静默丢弃（L329,391，设计取舍已文档化） |

## 测试覆盖两极分化

- **覆盖充分**：scene-serialize（1883 行测试）、material（5 文件 1322 行）、library-core（8 测试文件）、motion-history（19 用例）、backend（14 文件 117 用例）
- **零覆盖**：ar-scene、ar-camera（588 LOC，恰是最需验证 `_arGen`/`_starting` 竞态与状态对称性的模块）、animation-retargeter、transform-gizmo（`computeSnapDistance` 纯函数已抽出却未写测试）、transform-adapter

## 知识卡偏差（已发现待修）

1. **menu.md tests 字段误导**：列出的 11 个 menu-schema.* 测试 import 的是 menu-schema/render-menu，**非 SlideMenu 引擎**测试；SlideMenu 核心（push/pop 动画、transitioning、dispose 竞态）实际无直接测试
2. **render-menu.md `tests: []` 不准确**：renderMenu 实际已被 menu-schema.* 多文件覆盖

## 改进优先级建议

### ⚡ 立即修复（P1，3 项）
1. `ar-camera.ts` — `requestCameraPermission` 加 `typeof === 'function'` 检查 + 移入 try + `_starting` 复位走 finally
2. `motion-history.ts` — undo/redo/jump 内重置 merge 状态（或 `_shouldMerge` 校验 cursor）
3. `library-actions.ts` — `replaceMotion.doLoad` 开始 `setReplaceLoading(true)`，finally 置 false + 补并发测试

### 📋 短期改进（P2，15 项）
优先资源生命周期类：menu dispose 竞态、render-menu onLangChange 泄漏、retargeter 资源泄漏、gizmo 回写丢失；其次健壮性：zip 炸弹预检、backend reject 恢复、abort 误报、unregister 误删。

### 🔧 持续改进（P3）
补 AR 双模块 + retargeter + gizmo 测试；修正 menu.md / render-menu.md 知识卡 tests 字段。
