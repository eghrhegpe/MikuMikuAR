# ADR-158: 动作系统三连修 + 全项目审核快修

> **状态**: 已实施
> **日期**: 2026-07-21
> **关联**: ADR-021（程序化动作）、ADR-051（VMD 图层）、ADR-138（env-dispatcher 破循环依赖）

## 背景

动作系统锐评发现三个层级的问题：

1. `playback.ts:165` 渲染循环里 `throw`——初始化时序偏差会炸掉整帧渲染
2. `proc-motion-bridge.ts` 有 8 个模块级 `let`——幽灵状态，dispose 无法一键清零
3. `motion-popup.ts` 1335 行巨兽——动作绑定 + 音乐控制 + 播放控制 + 图层管理 + 入口注册全塞一个文件

## 决策

### P1: playback.ts throw → warn + return

`updatePlaybackUI` 被 `onAnimationTickObservable` 每帧调用，`mmdRuntime` / `seekBar` 为 null 时降级为 `console.warn` + 跳过本帧，不再 throw。

### P2: proc-motion-bridge 状态收口

8 个模块级 `let` 收进 `ProcMotionController` 类私有字段，懒单例 + 导出委托函数（外部 6 个调用方零改动）。`disposeProcMotion()` 一键清零 + 销毁单例。

### P3: motion-popup.ts 拆分

| 文件 | 行数 | 职责 |
|------|------|------|
| `motion-popup.ts` | ~240 | barrel + 路由 + `registerPopupMenu` 入口 |
| `motion-binding-ui.ts` | ~426 | 动作意图/广播 + per-model 绑定面板 + `handleModelAction` |
| `motion-detail-ui.ts` | ~401 | 动作详情页 + 图层管理 + 播放速度 |
| `motion-root-ui.ts` | ~293 | 根菜单构建 + retarget + 外部动作导入 |

barrel re-export 保持 API 兼容，外部调用方零改动。子文件通过 `import { getMotionMenu } from './motion-popup'` 访问菜单（函数级引用，不在模块求值期访问，循环依赖安全）。

## 验证

- tsc 零新增错误
- 1767/1768 单测通过（1 个既有 ui-helpers 失败）
- playback.test.ts 31/31 通过（3 个 `toThrow` 断言改为验证 `console.warn` + DOM 未修改）

---

## Phase 2：全项目审核快修

动作系统修复后，对全项目做七维审核（幽灵状态 / 渲染循环安全 / 类型安全 / 资源管理 / 测试覆盖 / 错误处理 / 代码重复），发现并修复：

### P1-1: `runSceneTickCallbacks` 每帧 tick 无保护

`env-dispatcher.ts` 的 `dispatchEnvChange` 有 try/catch，但同文件的 `runSceneTickCallbacks`（每帧由 scene observer 调用）没有——一个回调炸掉同帧所有回调。已补齐 try/catch + `console.warn`，并新增单测验证“单个回调抛错不阻断其他回调”。

### P1-2: `disposeGround` 状态残留

dispose 只清了 3 个变量，遗漏 7 个：`_onTerrainReady` / `_onGroundChanged`（回调引用泄漏）、`_texGroundImg` / `_texGroundImgUrl` / `_texGroundGeneration`（纹理缓存 + generation 计数器——重建后异步竞态守卫可能误判）、`_prevGroundHeight/Pitch/Roll`（脏哨兵值）。已补全重置，复用已有 `clearGroundTexCache()`。

### P2-6: `scene.ts` dispose 路径静默吞错

`import('./motion/proc-motion-bridge').then(...).catch(() => {})` 改为 `.catch((e) => logWarn('scene', 'disposeProcMotion failed:', e))`。

### P2-3: lighting.ts 状态收口

- `export let hemiLight` / `export let dirLight` 导出可变绑定 → 私有 `_hemiLight` / `_dirLight` + `getHemiLight()` / `getDirLight()` getter。调用方 env-bridge.ts / renderer.ts / env-bridge.test.ts 同步更新（共 3 处，均为函数体内只读访问）。
- `disposeLighting()` 补全 6 个遗漏重置：`_shadowEnabled` / `_shadowType` / `_shadowCascades` / `_shadowResolution` / `_shadowBias` / `_skipLightAutoSave`。

### P2-4: env-water.ts 水下状态收口

- 4 个 `export let`（`_underwaterActive` / `_underwaterSavedFog` / `_underwaterTransitionProgress` / `_underwaterTarget`）转为私有，仅导出 `isUnderwaterActive()` getter。
- env-impl.ts 的 4 个死 re-export 替换为 `isUnderwaterActive`；env-water.test.ts 断言同步改用 getter。

### P3: 撤销回调去重

motion-* 5 文件 ×9 处撤销调用点的 `onRestored` 尾巴完全一致（`reRender()` + `setStatus(t('motion.undoApplied'), true)`）。新增 `offerSceneUndoAndRefresh(message, snap, reRender)`（scene-serialize.ts）收敛该尾巴，调用点只传各自的 reRender 闭包（`getMotionMenu()?.reRender()` / `refreshCameraLevel()` / `menu?.reRender()`）。model-detail.ts（异步 import 恢复）与 scene-menu / scene-render-levels（全局撤销按钮走 pop/restore）语义不同，保留原样。

### P3: scene-serialize 撤销 UX 层补测

scene-serialize.ts（1293 行）原零直接测试。新增 `scene-serialize-undo.test.ts`（6 例）覆盖撤销 UX 层：`offerSceneUndo` / `offerSceneUndoAndRefresh` 的 null-snap 守卫、toast 接线形状（含「撤销」动作 + 8s）、以及恢复失败（版本不支持）时 onRestored/reRender 不触发。序列化/反序列化主体依赖重（~30 collaborators），本次不展开。

### 审核发现待办（未修）

| 优先级 | 问题 | 文件 |
|--------|------|------|
| P3 | scene-serialize.ts 序列化/反序列化主体仍零测试（需重 mock scaffold） | `scene/scene-serialize.ts` |
