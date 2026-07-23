---
kind: wind_utils
name: 统一风场辅助函数
category: core
scope:
  - frontend/src/core/**
source_files:
  - frontend/src/core/wind-utils.ts
adr: []
---

## 系统概览
提供统一的风矢量查询接口，各子系统（粒子/水面/布料/云）通过此模块获取统一的风场数据，避免各自重复实现 `windDirection × windSpeed` 的读取逻辑。风场数据源自 `envState`（windEnabled / windDirection / windSpeed），由环境 UI 面板调节。`isWindActive()` 提供快捷判空，避免 `Vector3.Zero()` 比较开销。

## 核心职责
- `wind-utils.ts` — 风矢量计算、风速查询、风向生效判断。

## 对外 API（节选）
- `getWindVector()` — 返回当前风矢量（方向 × 速度 × 强度倍率），windEnabled=false 时返回零向量。
- `getWindStrength()` — 返回当前风速标量（windEnabled=false 返回 0）。
- `isWindActive()` — 风向是否生效（快捷判空，避免 Vector3.Zero() 比较开销）。

## 与其他子系统关系
- 依赖 `core/config` 的 `envState` 获取风力配置。
- 被粒子系统（`env-particles`）、水面（`env-water`）、布料模拟、云系统等引用。