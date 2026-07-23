---
kind: dispose_helpers
name: 安全释放工具
category: core
scope:
  - frontend/src/core/**
source_files:
  - frontend/src/core/dispose-helpers.ts
adr:
  - ADR-146
---

## 系统概览
统一「dispose 并置空」的模板函数（ADR-146 主题3），替代项目中大量 `if (x) { x.dispose(); x = null; }` 手写重复（env/render 子系统累计 60-80 处）。与手写模板语义严格等价：`obj?.dispose(...args)` 仅在 obj 非空时调用，始终返回 null。

## 核心职责
- `dispose-helpers.ts` — 安全释放对象并置空。

## 对外 API（节选）
- `safeDispose(obj, ...args)` — 安全释放 Babylon.js 对象并置空，透传 dispose 参数（如 `mesh.dispose(true)` 的 recursive），返回 null。

## 使用注意
- 返回类型为 `null`，调用方应将原引用赋值为返回值以完成置空。
- 若原代码置 `undefined`（如 `pipeline = undefined`），类型不兼容，请勿用本函数。

## 与其他子系统关系
- 被 `env`、`render` 等子系统的 dispose 路径广泛引用。