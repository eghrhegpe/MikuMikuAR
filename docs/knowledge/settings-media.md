---
kind: settings_media
name: 设置 — 媒体页面
category: ui
scope:
  - frontend/src/menus/**
source_files:
  - frontend/src/menus/settings-media.ts
adr:
  - ADR-157
---

## 系统概览
设置页面中的「媒体」页（ADR-157）。管理音频核心设置（默认音量、音频偏移、BPM 量化、伴音自动加载、循环模式）、音效设置（总开关、音量、脚步声）、截图设置（格式、质量、缩略图分辨率、保存目录）。

## 核心职责
- `settings-media.ts` — 音频、音效、截图设置的 Schema 构建与弹窗层级。

## 对外 API（节选）
- `buildSettingsMediaLevel(getSettingsMenu)` — 构建媒体页面的 PopupLevel。

## 内部协作
- `buildAudioCoreSchema(getSettingsMenu)` — 构建音频核心 Schema（音量、偏移、BPM 量化、伴音自动加载、循环模式）。
- `buildSfxSchema(getSettingsMenu)` — 构建音效 Schema（总开关、音量、脚步声）。
- `buildScreenshotSchema(getSettingsMenu)` — 构建截图 Schema（格式、质量、缩略图分辨率、保存目录选择）。
- `buildMediaSchema(getSettingsMenu)` — 组装媒体页面 Schema。

## 与其他子系统关系
- 依赖 `outfit/audio` 的音频控制函数。
- 依赖 `wails-bindings` 的目录选择与后端操作。
- 依赖 `scene/motion/proc-motion-bridge` 的 BPM 量化设置。