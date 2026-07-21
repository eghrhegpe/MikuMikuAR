# 切后台回来渲染器冻结：visibilitychange 误 disposeScene

**日期**: 2026-07-21
**严重程度**: 🟠 P2（用户可见，需重启应用恢复，不崩溃不丢数据）
**影响范围**: `frontend/src/scene/scene-serialize.ts`（`cleanupAndFlushSave`）
**发现方式**: 用户反馈（最小化/切窗口回来后 3D 视口冻结，菜单仍可操作）

---

## 问题描述

离开窗口一小会（最小化、Alt+Tab、切到另一显示器），回来后渲染器完全冻结：菜单（纯 DOM）正常响应，但 3D 视口一动不动，只能重启应用。

## 根因分析

`scene-serialize.ts` 的自动存档模块注册了 `visibilitychange` 监听：

```typescript
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
        cleanupAndFlushSave();  // ← 内部调用了 disposeScene()
    }
});
```

`cleanupAndFlushSave()` 里的 `disposeScene()` 会把 Scene + Engine + WebGL context 全部销毁。但**没有** `visible` 状态的恢复逻辑——切回来时渲染循环已死，无人重建。

### 这行代码的来历

`git blame` 追踪到提交 `bfcacc35b`（2026-07-17）：

> refactor: ADR-106 场景生命周期 — HMR disposeScene 级联释放 + 各子系统 isDisposed 防御（防 WebGL context 泄漏）

该提交的本意是修复 **HMR 热更新** 时旧 Engine 不释放导致 WebGL context 泄漏（浏览器上限约 16 个）。但顺手把 `disposeScene()` 塞进了 `cleanupAndFlushSave()`，误以为 `visibilitychange → hidden` 等于"应用退出"。

实际上在桌面端，`hidden` 在最小化、Alt+Tab、甚至点开另一显示器的窗口时都会触发，远不等于退出。HMR 路径本身有 `initScene()` 重入清理兜底，不需要靠 visibilitychange 来 dispose。

**一句话：HMR 防泄漏的药，下错了药引子。**

## 为什么之前没暴露

- `visibilitychange` 监听本身 6 月 30 日就存在（`0033de170`），但当时只做刷盘存档，不 dispose
- `disposeScene()` 是 7 月 17 日才加入的，此后"切后台冻结"成为必现行为
- 开发态 HMR 频繁，开发者习惯随时重载，不易注意到；普通用户"离开一会再回来"才触发

## 修复方案

提交 `36b529b0`：拆职责。

- `visibilitychange → hidden`：只刷盘（`flushEnvState` + `flushUIState` + `saveSceneImmediate`），不 dispose
- `beforeunload`（应用真正退出）：刷盘 + `disposeScene()` 释放 WebGL context

切回来时渲染循环从未中断，零成本恢复。

## 教训

1. `visibilitychange → hidden` 在桌面端 ≠ 应用退出，不能在上面挂销毁逻辑
2. 销毁（dispose）与存档（flush）是两个独立职责，不应混在同一个函数里被同一个事件触发
3. WebGL context 释放只应出现在真正的生命周期终点（`beforeunload` / Wails shutdown 回调）
