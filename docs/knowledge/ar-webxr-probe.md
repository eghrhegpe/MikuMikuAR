---
kind: ar_webxr_probe
name: WebXR 能力探测
category: rendering
scope:
  - frontend/src/scene/ar/**
source_files:
  - frontend/src/scene/ar/ar-webxr-probe.ts
adr:
  - ADR-072
---

## 系统概览
WebXR 能力探测模块：检测当前设备/浏览器是否支持 WebXR、支持哪些特性（local-floor / hit-test / plane-detection / mesh-detection 等）。支持结果缓存（`resetProbeCache` 可重置），提供格式化报告输出。

## 核心职责
- `ar-webxr-probe.ts` — WebXR 支持探测、特性检测、平台鉴别、报告格式化。

## 对外 API（节选）
- `WebXRProbeResult` — 探测结果接口（isSupported / features / platform / error 等）。
- `probeWebXR()` — 完整 WebXR 探测：平台检测 → session 支持检查 → 特性探测（含缓存，同参数复用）。
- `probeWebXRFeatures()` — 仅特性探测（跳过平台检测，供已确认支持的场景调用）。
- `resetProbeCache()` — 重置探测结果缓存。
- `formatProbeReport(r)` — 将探测结果格式化为可读字符串。

## 内部协作
- `probeAndroidWebView()` — Android WebView 特定探测。
- `checkSessionSupported(mode)` — 检查 XRSessionMode 是否支持。
- `probeFeaturesBySession(mode)` — 通过创建临时 session 探测可用特性。
- `detectPlatform()` — 平台检测（Android / iOS / 桌面）。

## 与其他子系统关系
- 被 `ar-scene.ts` 引用，在 AR 模式初始化前调用。
- 依赖 [`logger`](./logger.md) 记录探测日志。