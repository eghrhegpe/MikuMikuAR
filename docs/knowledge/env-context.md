---
kind: env_context
name: 环境系统上下文
category: env
scope:
  - frontend/src/scene/env/**
source_files:
  - frontend/src/scene/env/env-context.ts
adr: []
---

## 系统概览
环境子系统的**实现上下文单例**：持有当前 `Scene` 与 `DefaultRenderingPipeline` 引用，供 `env-*` 系列
模块共享，避免各模块各自持有渲染上下文造成的状态分裂。同时提供静态资源路径解析。

## 核心职责
- `env-context.ts` — 环境系统初始化、上下文存取、静态资源解析。

## 对外 API（节选）
- `initEnvImpl(scene, pipeline)` — 注入场景与渲染管线，完成环境子系统初始化。
- `getScene()` — 取当前场景。
- `isInitialized()` — 初始化状态查询。
- `getPipeline()` — 取渲染管线。
- `resolveStaticAsset(path)` — 将相对资源路径解析为可加载 URL。
- `_envSys` — 环境系统内部聚合对象（各 env 子模块的运行时句柄）。

## 与其他子系统关系
- 是 [`env-wetness`](./env-wetness.md) / [`env-reflection`](./env-reflection.md) / 灯光 / 天空 / 水面等 env 模块的共享底座。
- 初始化顺序须在场景与渲染管线就绪后调用，否则 `getScene()` 返回未定义。
