---
kind: scene_orchestrator
name: 场景核心编排器（纯组装器）
category: scene
scope:
  - frontend/src/scene/**
source_files:
  - frontend/src/scene/scene.ts
adr: []
---

## 系统概览
3D 场景核心模块，纯组装器（[doc:architecture]）。导入所有子系统并按正确顺序装配，对外提供唯一 `initScene()` 入口。具体逻辑已拆分到各子模块（env / motion / camera / physics / render），本文件仅负责组合与启动期副作用挂载：MMD 原生描边补丁、`SdefInjector` 球面变形改写 `engine.createEffect`、WASM 物理运行时（SPR 单线程，MPR 多线程仅在 `VITE_MMD_WASM_MT` 定义时动态拉入）、风力/地面碰撞注入。

## 核心职责
- `scene.ts` — 子系统装配、MMD loader/运行时初始化、渲染循环与物理 tick 编排

## 对外 API（节选）
- `initScene()` — 唯一初始化入口（启动期顺序装配各子系统）
- 协调 `initEnvFacade` / `applyEnvState` / `initWindPhysics` / `applyGroundCollision` 等
- 对外暴露 `mmdRuntime` / `_envSys` 等供其他模块引用

## 与其他子系统关系
- 依赖几乎全部 scene 子模块，是 scene 层的总装配点
- `scene-bundle` / `scene-serialize` / `scene-migrate` 负责场景持久化，由本模块在加载/保存时调用
