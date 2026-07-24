---
kind: plaza_creators
name: 模型广场创作者列表
category: ui
scope:
  - frontend/src/menus/**
source_files:
  - frontend/src/menus/plaza-creators.ts
adr:
  - ADR-087
---

## 系统概览
模型广场的创作者（创作者/社团）声明清单。定义 `PlazaCreator` 接口（name / desc / tag / tier / site），当前为空列表（`PLAZA_CREATORS: []`），预留供后续填充。

## 核心职责
- `plaza-creators.ts` — 创作者接口定义与清单声明。

## 对外 API（节选）
- `PlazaCreator` — 创作者接口（name / desc / tag: 'official'|'creator'|'vup'|'oc' / tier?: 'gold'|'silver' / site）。
- `PLAZA_CREATORS` — 创作者清单（当前为空数组）。

## 与其他子系统关系
- 被 `plaza-browser` 等广场 UI 模块引用。