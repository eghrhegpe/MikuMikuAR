---
kind: reactivity
name: 轻量响应式刷新系统
category: core
scope:
  - frontend/src/core/reactivity.ts
source_files:
  - frontend/src/core/reactivity.ts
---

## 系统概览
轻量响应式系统：`Proxy` 拦截 set → `requestAnimationFrame` 去抖 → 通知所有订阅者（通常是 `SlideMenu.updateControls()`）。替代手动在状态变更处逐一调用刷新，是 UI 与全局状态解耦的刷新总线。

## 核心职责
- `scheduleRefresh()` — RAF 去抖，同帧多次调用只触发一次刷新
- `subscribe(fn)` — 注册刷新订阅者，返回取消订阅函数
- `unsubscribeAll()` — 清空全部订阅者（供 `initScene` 重入时调用，ADR-106 D3 HMR 清理入口）
- `reactive(obj)` — 用 Proxy 包裹对象，属性赋值自动触发 `scheduleRefresh()`；深度代理嵌套普通对象（`WeakMap` 缓存保证引用稳定），不代理数组/Map/Set

## 关键约定（数组 / 引用类型）
- Proxy 不代理数组/Map/Set，故 `envState.skyColorTop[0] = 0.5` **不会**触发刷新
- 写入数组/tuple3 必须整体替换：`envState.skyColorTop = [0.5, 0.6, 0.7]` 或经 `setEnvState({...})` 内部 `Object.assign` 整体赋值
- set 拦截做同值短路（`Object.is`），避免无意义刷新（P3 防御）

## 与其他子系统关系
- `state.ts` 的 `setEnvState` 经 Proxy 整体赋值触发刷新
- `observer-handle.ts` 的 `subscribe` 订阅者通常是菜单的 `updateControls()`
- `render-loop.ts` 的 `applyScaling` 等状态变更经此处去抖刷新 UI
