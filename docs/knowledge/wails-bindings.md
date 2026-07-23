---
kind: wails_bindings
name: 后端绑定聚合层（backend 代理化）
category: core
scope:
  - frontend/src/core/wails-bindings.ts
source_files:
  - frontend/src/core/wails-bindings.ts
adr:
  - ADR-176
---

## 系统概览
Wails 生成绑定的手维护聚合层（ADR-176 Phase 2：backend 代理化）。本文件是业务层**唯一后端入口**（43 个消费文件），106 个真实业务调用经 `resolveBackend()` 路由的显式代理导出——桌面/安卓走 `go-adapter`，浏览器走 `browser-adapter`（IndexedDB/FSA/显式降级），业务代码零改动完成切换。

## 核心职责
- 第一行星号透传 `@bindings/.../app` 兜底 ④ 组 33 个零业务调用函数（契约测试 139 全量不受扰动）
- 本地具名导出（如 `BundleScene`、`CheckForUpdate`）以 ESM 优先级覆盖星号透传的同名符号
- 每个代理 `_p(name)` 先 `await resolveBackend()`（惰性单例，首次含桥接注入等待）再转发，绑定函数本身全部返回 Promise，包装透明
- `readFileBytes(path)` — 读文件为 `Uint8Array`（go：自动解码 Wails v3 base64；browser：IndexedDB/FSA 直读）

## 对外 API（节选）
- `resolveBackend()` — 惰性单例 backend 选型（业务侧不直接调用，仅供 `_p`）
- 106 个业务代理导出：`AddCustomSoftware` / `BundleScene` / `CheckForUpdate` / `DeleteEnvPreset` / `ClearAllCaches` 等
- `Events` — 从 `runtime-bridge` 透传的运行时事件接口

## 架构约束
- ❌ 禁止在此新增绕过 `resolveBackend` 的直连导出（Android 冷启动竞态，ADR-176）
- `go-adapter` 直连 `@bindings`（不经本文件），无循环依赖
- 本地具名导出优先于 `export *`（ESM 规则）

## 与其他子系统关系
- 依赖 `runtime-bridge.ts`（`Events` 透传）
- 依赖 `./backend`（adapter 接口 `BackendService`）
- 所有场景/菜单/管理器模块的后端 IO 经此处，实现桌面/浏览器双端统一
