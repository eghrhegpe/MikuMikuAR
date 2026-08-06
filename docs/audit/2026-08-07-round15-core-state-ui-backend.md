# 第 15 轮审核报告 — core 状态/UI 组件 / 动作定义 / 后端聚合

> **日期**: 2026-08-07
> **范围**: 20 模块（状态/UI 层 15 + 动作定义 7 + 后端聚合 3）
> **方法**: 知识卡 → 源码 → 5 维度 + 4 心理模拟；逐行核对源码
> **结论**: ✅通过 12 / ⚠️有条件通过 7 / ❌不通过 1（P1×1）

## 执行摘要

| 结论 | 模块数 | 模块 |
|------|--------|------|
| ✅ 通过 | 12 | scene-state, sw-register, scene-action-bridge, ui-action-bridge, ui-card, ui-collapsible, ui-fullscreen-overlay, ui-loading, ui-virtual-grid, ui-types, backend/types, backend/idb |
| ⚠️ 有条件通过 | 7 | status-bar, status-helpers, ui-advanced-rows, ui-resource-panel, ui-slide-row, diagnostic-actions, backend/index |
| ❌ 不通过 | 1 | action-defs/motion-actions（P1） |

## 🔴 P1 问题（必须修复）

| # | 模块 | 位置 | 问题 | 影响 |
|---|------|------|------|------|
| 1 | motion-actions | motion-actions.ts:52 | `getSceneAction('getLipSyncState')?.().enabled`：`getSceneAction` 未注册时返回 `undefined`，`?.()` 返回 `undefined`，随后 `.enabled` 访问抛 `TypeError: Cannot read properties of undefined`。`execute` 异常被 action-executor catch 转为 `ActionResult`，但用户看到的是"执行失败"而非"功能未就绪"，且该动作无 fallback。 | 唇形同步开关在场景未初始化时直接崩溃，用户无法使用 |

**修复建议**：
```diff
- getSceneAction('setLipSyncEnabled')?.(!getSceneAction('getLipSyncState')?.().enabled);
+ const state = getSceneAction('getLipSyncState')?.();
+ if (!state) return;
+ getSceneAction('setLipSyncEnabled')?.(!state.enabled);
```

## 🟠 P2 问题（建议修复）

| # | 模块 | 位置 | 问题 |
|---|------|------|------|
| 1 | motion-actions | motion-actions.ts:240 | `loadManager.load({ kind: 'audio', path: p.path as string })` 未 `await`，fire-and-forget；随后立即 `showInfoToast` 显示 `getAudioName()`，但音频尚未加载完成，名称可能为空或过时 |
| 2 | motion-actions | motion-actions.ts:290,310 | `_buildLevel!` 非空断言：`getUiAction('buildBrowseLevel')` 未注册时返回 `undefined`，`!` 断言后调用抛 `TypeError`。两处（browse-music / browse-scene-motions）均受影响 |
| 3 | status-helpers | status-helpers.ts:54 | `withLoadingStatus` 调用 `setStatus(t(loadingKey), false)`，`hold` 默认 `false` → 2 秒后自动淡出。若异步操作耗时 >2s，用户失去加载反馈，状态栏空白 |
| 4 | diagnostic-actions | diagnostic-actions.ts:70-71 | `getBackendLogs` 将 `p.level` 直接 `as string` 透传给 Go 后端，未校验是否在 enum 范围内。`adaptParam` 已做 enum 校验，但 `as string` 语义上仍是类型逃逸 |
| 5 | ui-resource-panel | ui-resource-panel.ts:104,119,319,438 | `cache.get(path)!` / `liveThumbnailCache.get(path)!` 非空断言：虽前有 `has(path)` 守卫，但 Map 在并发场景下可能变化；建议用 `const v = cache.get(path); if (v) ...` 模式 |
| 6 | backend/index | backend/index.ts:123-124 | `ALL_TRUE_CAPS` 中 `installApk: false` 与 `installLocal: true` 兜底默认值：网页端 `installLocal` 为 `true` 但网页端无本地安装器路径，可能导致网页端误显示本地安装入口（"幽灵入口"） |
| 7 | ui-virtual-grid | ui-virtual-grid.ts:127-136 | `wrapper.addEventListener('scroll', ...)` 在 `dispose()` 中未显式移除；虽 `wrapper.remove()` 后 DOM 节点 GC 会连带 listener，但若 dispose 后 wrapper 被外部持有则泄漏 |

## 🟡 P3 关注项

- **status-bar.ts:132-141** `initHints()` 使用 `document.querySelectorAll('[data-hint]')` 静态快照，动态添加的 `[data-hint]` 元素不会被绑定。建议改用 MutationObserver 或委托事件。
- **ui-advanced-rows.ts:227** `bar.setAttribute(ARIA_ATTR.valuenow, ...)` 重复设置（第 224 行已设），冗余无害。
- **ui-fullscreen-overlay.ts:105-117** `freezeSlideMenu()` 遍历所有 `.slide-menu-container`，但 `frozenSlideMenuElement` 只保存最后一个，`unfreezeSlideMenu()` 只恢复一个。若有多个 slide menu 容器，其余保持隐藏。
- **ui-fullscreen-overlay.ts:269-280** 模块顶层 `document.head.appendChild(style)` 注入全局 keyframes，多次 import 会重复注入（无去重守卫）。
- **ui-collapsible.ts:234** `getCurrentRenderingContext()?.registerControl(update)` 注册的控制更新回调无 dispose 机制，若 collapsible 被移除 DOM 但 render context 仍存活，回调持续执行。
- **ui-slide-row.ts:164-169,249-254** 两处 `click` handler 用 `window.getSelection()?.toString()` 防误触，但 `getSelection()` 在部分 WebView 下行为不一致。
- **ui-advanced-rows.ts:35,191** `Math.random().toString(36).slice(2, 11)` 生成 DOM id，非稳定标识，e2e 测试无法依赖。
- **backend/idb.ts:148-163** `saveModel` 先写 `file:` 再写 `entry:`，若第二步失败则 `file:` 字节成为孤儿数据（无元数据引用）。建议用单事务 `idbBatchSet`。
- **backend/idb.ts:123-128** `closeIDB()` 中 `dbPromise = null` 在 `db.close()` 完成前执行，并发调用者会拿到新 Promise 而非等待关闭，存在短暂竞态。
- **scene-state.ts:26,34** `localStorage.getItem/setItem` 在隐私模式下可能抛 `QuotaExceededError`，当前无 try/catch。虽注释标注"Fail-Fast"，但异常会冒泡到调用方。
- **action-executor.ts:40** `(result as { ok: false; error: string }).error` 类型断言绕过 discriminated union，建议用类型守卫或 `result.error` 直接访问（若类型定义允许）。
- **ui-types.ts** 文件仅 13 行，单一 interface，可考虑合并到 `ui-rows.ts` 或 `ui-types` 桶（但 ADR-191 禁止神桶，当前独立文件合理）。

## 知识卡偏差汇总

| 知识卡 | 偏差 |
|--------|------|
| ui-state.md | 卡称"持久化回调由 env-bridge 注册"，实际 `ui-state.ts:19` 注释为"由 env-bridge.ts 注册"，但 `source_files` 指向 `ui-state.ts` 而非 `env-dispatcher.ts`。轻微不一致，不影响功能。 |
| action-registry.md | 卡称"executeActionById 先经 adaptParam 校验/转换所有参数，缺参（非 boolean/toggle）即失败短路"，源码 `action-executor.ts:28-36` 完全对齐。无偏差。 |
| action-registry.md | 卡称"destructive 动作的确认 UI 由调用方自行处理，注册表本身不弹 showConfirm"，但 `motion-actions.ts:64` 在 `motion:clear-all` 的 `execute` 内直接调用 `showConfirm`，违反该不变量。 |
| core-backend.md | 卡称"IndexedDB 操作异步非阻塞"，源码 `idb.ts` 全部返回 Promise，对齐。无偏差。 |
| core-backend.md | 卡称"测试桩共享实例跨用例复用，用例结束须 resetIdb()/resetMem() 防状态泄漏"，`idb.ts` 本身无 `resetIdb`（由 `backend-mocks.ts` 提供），卡描述准确。 |
| diagnostic-actions.md | 卡称"所有诊断动作均为 readonly"，源码 `diagnostic-actions.ts` 全部 `readonly: true`，对齐。无偏差。 |
| status-bar.md | 卡称"新状态到来时取消旧的隐藏与淡出定时器"，源码 `status-bar.ts:51-58` 同时清除 `_statusTimer` 和 `_statusFadeTimer`，对齐。无偏差。 |

## 逐模块结论

### 状态/UI 层

| 模块 | 结论 | 要点 |
|------|------|------|
| scene-state.ts | ✅ | 单一写入点规约清晰；localStorage Fail-Fast 设计合理（P3：隐私模式异常） |
| status-bar.ts | ⚠️ | timer 清理完整；`initHints` 静态快照（P3）；`setLoadingStatus` 调用链正确 |
| status-helpers.ts | ⚠️ | `withLoadingStatus` 2s 自动淡出与长操作冲突（P2）；`withLoadingStatusTargeted` 用 `feedbackStatus` 无此问题 |
| sw-register.ts | ✅ | 守卫完整（enabled / navigator / serviceWorker）；reload 防重复；register 在 load 后 |
| scene-action-bridge.ts | ✅ | 基于 fn 引用的注销 token 设计优秀；缺失一次性告警；零依赖纯叶子 |
| ui-action-bridge.ts | ✅ | 与 scene-action-bridge 对称；`getUiActions` 仅检查必需键后 cast，合理 |
| ui-advanced-rows.ts | ⚠️ | 重复 ARIA 设置（P3）；Math.random id（P3）；整体结构清晰 |
| ui-card.ts | ✅ | 极简，19 行，无副作用 |
| ui-collapsible.ts | ✅ | inert 属性防键盘聚焦；requestAnimationFrame 初始化；registerControl 无 dispose（P3） |
| ui-fullscreen-overlay.ts | ✅ | 状态机 CLOSED↔FULLSCREEN 清晰；focus trap + keyboard nav；多容器 freeze 只恢复一个（P3）；全局 style 无去重（P3） |
| ui-loading.ts | ✅ | finally 块保证隐藏；异常处理委托给 fn，职责清晰 |
| ui-resource-panel.ts | ⚠️ | Map `.get()!` 非空断言（P2）；Observer 在 dispose 时正确 disconnect；MutationObserver 跨 render 复用设计好 |
| ui-slide-row.ts | ✅ | trailing/leading 互斥设计防误渲染；getSelection 防误触（P3 WebView 兼容性） |
| ui-virtual-grid.ts | ⚠️ | scroll listener 未显式 dispose（P2）；RAF 节流正确；ResizeObserver 正确 disconnect |
| ui-types.ts | ✅ | 单一 interface，零依赖 |

### 动作定义

| 模块 | 结论 | 要点 |
|------|------|------|
| diagnostic-actions.ts | ⚠️ | 全部 readonly 对齐知识卡；`as string` 类型逃逸（P2）；懒加载 @bindings 合理 |
| env-actions.ts | ✅ | 经 scene-action-bridge 调用，零反向依赖；3 个动作结构一致 |
| library-actions-def.ts | ✅ | 经桥调用；`allModels` 过滤 vmd 合理；formation 反馈正确 |
| motion-actions.ts | ❌ | P1：唇形同步 `.enabled` 访问未注册时崩溃；P2：`_buildLevel!` 断言、audio load 未 await；`showConfirm` 在 execute 内违反知识卡不变量 |
| scene-actions.ts | ✅ | 经桥调用；undo 无快照时反馈正确；list-models 有 fallback |
| settings-actions.ts | ✅ | 缓存清理 + CustomEvent 通知；路径选择经 ui-action-bridge；setLang 直接调用 |
| action-executor.ts | ✅ | 参数校验 → execute → 异常捕获转 ActionResult 流程清晰；discriminated union 断言（P3） |

### 后端聚合

| 模块 | 结论 | 要点 |
|------|------|------|
| backend/index.ts | ⚠️ | 三层判定 + 惰性单例 + try/catch 降级设计优秀；`ALL_TRUE_CAPS.installLocal: true` 网页端幽灵入口（P2） |
| backend/types.ts | ✅ | 接口契约清晰；`ExcludedFromBackend` 用 Extract 确保键存在；`NotSupportedError` 设计好 |
| backend/idb.ts | ✅ | onabort 处理器完整（QuotaExceededError 场景）；单事务 `idbBatchSet`；`saveModel` 两步写孤儿风险（P3）；`closeIDB` 竞态（P3） |

## 心理模拟

1. **motion-actions:52 抛异常**：`getLipSyncState` 未注册 → `TypeError` → action-executor catch → 返回 `{ success: false, message: "执行失败: ..." }`。清理代码无副作用（无资源分配），但用户体验差。**P1**。
2. **用户快速点击唇形同步 3 次**：每次调用 `getLipSyncState` 读取当前状态再取反，无竞态（同步操作），行为正确。
3. **withLoadingStatus 操作耗时 10s**：2s 后状态栏淡出空白，用户以为卡死。**P2**。
4. **closeFullscreen 时 cleanup 抛异常**：`_trapRestore?.()` 或 `cleanup()` 抛异常 → `element.remove()` 不执行 → overlay 残留 DOM。**建议**：cleanup 用 try/catch 包裹。
5. **idbSet 触发 QuotaExceededError**：`tx.onabort` 处理器存在（idb.ts:80），Promise 正确 reject，不会永久 pending。✅

## 验证

- [x] 已检查所有 20 个文件
- [x] 已核对 7 张知识卡（ui-state, status-bar, action-registry, core-backend, diagnostic-actions, ui-types, ui-virtual-grid）
- [x] 已 grep 确认无 `@/core/utils` 神桶导入（ADR-191 合规）
- [x] 已 grep 确认无 `catch{}` 静默吞错
- [x] 已 grep 确认无新增 `as any` / `@ts-ignore`（仅测试文件有 `@ts-expect-error`）
