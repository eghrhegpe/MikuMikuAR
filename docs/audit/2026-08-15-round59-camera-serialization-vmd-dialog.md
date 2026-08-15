# Round 59 审核报告 — camera.adr100.serialization / camera.vmd-state / dialog

> 日期：2026-08-15
> 模式：继续队列第三批，3 个子代理并行审计 + 主模型统一验证提交。
> 范围：`frontend/src/__tests__/camera.adr100.serialization.test.ts`、`frontend/src/__tests__/camera.vmd-state.test.ts`、`frontend/src/__tests__/dialog.test.ts` 及其直接关联源码。

## 摘要

- 子代理：3 个，分别审计 1 个测试文件。
- 发现总数：21（P0×0 / P1×3 / P2×11 / P3×6 / P4×1）。
- 实际修复文件：3 个测试 + 3 个源码。
- 验证：`npm run check` ✅；全量前端 Vitest 253 文件 / 5817 用例 ✅；`git diff --check` ✅。

## 一、camera.adr100.serialization.test.ts

### 修复
1. **P2 测试覆盖严重不足** — 原 7 条弱断言扩充为 20 条，覆盖 ArcRotate/Universal/null camera、非法 mode、旧 concert→surround、FOV 钳位、全字段 roundtrip、auto unsub、非 orbit 矛盾存档。
2. **P2 测试污染** — beforeEach/afterEach 清理 `_currentCamera` / `_scene` / `_focusCenterY`。
3. **P3 陈旧 mock** — 移除对被测 SUT 自身无效的 `vi.mock('../scene/camera/camera')`。
4. **P2 源码：headless 下 `setCameraState` 不提交 `_cameraMode`** — 在 `switchCameraMode` 之后显式 `setCameraMode(finalMode)`，顺序不可提前以免命中同模式守卫。
5. **P2 源码：非 beatcut 分支只清 flag 未退订** — 改为 `setAutoCameraEnabled(false)`，释放 beat 订阅与 transition observer。
6. **P2 源码：非 orbit 控制 + beatcut 矛盾存档** — 强制非 orbit 行为为 `none`，与 `setCameraControl`/`setCameraBehavior` 约束一致。
7. **P3 源码：beatcut 恢复未复位节拍计数/预设索引** — 显式清零；同时删除未使用导入。
8. **P3 源码：`CameraState.preset` 类型标必填但实现按可选处理** — 改为 `preset?`。

### 未收口
- 可选：`setCameraState` 对非法 `control`/`behavior` 无显式告警，可后续增加守卫。

## 二、camera.vmd-state.test.ts

### 修复
1. **P2 源码：vmd→orbit 后对已 dispose 的 MmdCamera 二次 remove/dispose** — 在手动释放分支增加 `! _mmdCamera.isDisposed()` 守卫。
2. **P2 测试弱断言** — 补动画句柄创建/绑定、资源释放、分支互斥、已 dispose 不重复释放、`animateCameraVmd` 仅 vmd 模式驱动等断言。
3. **P2 测试 afterEach 缺失** — 补 `setAutoCameraEnabled(false)` 与 `mockUiState.autoCameraEnabled=false`。
4. **P3 测试双轴未复位** — VMD describe 增加 `setCameraMode('orbit') + setCameraControl('orbit') + setCameraBehavior('none') + setScriptedSubMode('loop')`。

### 未收口
- **共享 mock `MockMmdCam` 缺 `isDisposed()`**：当前在测试内局部补齐；建议后续在 `camera-adr100-mocks.ts` 统一补充并跟踪 dispose 状态。

## 三、dialog.test.ts

### 修复
1. **P1 源码：showDialog 初始焦点缺失/过早** — 改为 overlay 可见且自身 `inert` 移除后聚焦；confirm 模式聚焦当前可见确认按钮；prompt 关闭后焦点恢复到触发元素。
2. **P1 源码：cleanup 非幂等** — `_showDialogInner` / `_showPrompt2Inner` 增加 `settled` 守卫，避免双击/双路径二次 unfreeze 外层对话框。
3. **P1 测试：未覆盖 showPrompt2 / 并发队列 / a11y / inert / 资源清理** — 新增 9 个用例，测试数 11 → 20。
4. **P2 源码：showPrompt2 在移除自身 inert 前聚焦首字段** — 调整顺序。
5. **P2 源码：`disposeOverlay2` 打开中调用不 resolve 当前 Promise** — 先触发取消关闭走正常 cleanup，再移除 DOM。
6. **P2 测试：afterEach 清理不足** — 循环关闭所有可见弹窗并 flush 队列，清理 inert/class。
7. **P3 测试：边界与关闭副作用断言缺失** — 补空 cancelLabel、关闭后 overlay 重新 inert 等。

### 未收口
- **`menu-overlay.ts:32-37` `closeAllOverlays()` 直接移除可见 dialog 但不 resolve 当前 Promise**（锁外文件）——建议 dialog 暴露统一关闭/取消入口，或由 menu-overlay 调用。
- **showDialog 缺少类似 `disposeOverlay2` 的 HMR/强制清理 API**（可选）。

## 验证记录

| 检查 | 命令 | 结果 |
|---|---|---|
| 前端静态检查 | `cd frontend && npm run check` | ✅ |
| 全量前端单测 | `cd frontend && npx vitest run --no-color --reporter=dot` | ✅ 253 files / 5817 tests |
| 空白错误 | `git diff --check` | ✅ |

## 未收口 / 需主模型决策汇总

1. `menu-overlay.ts` 关闭菜单时未 resolve 当前 dialog Promise（锁外文件）。
2. showDialog 是否补 HMR/强制清理 API。
3. 共享 `MockMmdCam` 补 `isDisposed()`。
4. `setCameraState` 是否增加严格反序列化守卫（可选）。
