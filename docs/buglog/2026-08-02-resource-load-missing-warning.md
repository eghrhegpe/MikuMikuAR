# 模型/换装/音频加载失败无提示

> **状态**: 🟢 已修复

**日期**: 2026-08-02
**严重程度**: 🟡 P3（可观测性，非渲染错误）
**影响范围**: `frontend/src/core/resource-warning-sink.ts`、`frontend/src/scene/manager/model-loader.ts`、`frontend/src/outfit/outfit.ts`、`frontend/src/outfit/outfit-overlay.ts`、`frontend/src/outfit/audio.ts`
**发现方式**: 开发发现（用户询问「加载模型纹理时能否识别未识别材质并提示」）
**修复提交**: `feat: 统一资源加载失败汇总提示（模型纹理/换装/音频缺失）`（同次提交）

## 问题描述

模型加载时若 PMX 声明了纹理但模型目录中缺失，以及换装贴图、FBX 叠加层、音频文件读取失败时，原实现仅在控制台 `logWarn` 后返回，用户看不到任何提示。用户侧表现为模型材质发灰/发紫、换装/配音无效，却无从得知原因。

## 根因分析

各加载点的失败分支只调用 `logWarn` 后 `return`，没有接入用户反馈通道：
- `model-loader.ts` 纹理扫描：`readTextureWithLRU` 返回 null 时仅 `logWarn` 跳过，且 `collectTextureFiles` 是「目录有什么给什么」，无法识别「PMX 引用了但目录缺失」的纹理。
- `outfit.ts:291` 换装贴图 `readFileBytes` 返回 null：仅 `logWarn`。
- `outfit-overlay.ts:239` FBX 加载后无 mesh：仅 `logWarn`。
- `audio.ts:272` 音频文件读取失败：仅 `logWarn`。

> 注：2025-07-16 `纹理不显示：模型无颜色.md` 已修复「加载器未注册 / 路径容错」导致纹理全白的根因；本次补全的是「失败后告知用户」的可观测性能力，属于其下游补强。

## 修复方案

新增 `resource-warning-sink` 统一汇总机制：
- `reportResourceWarning(message)` 去重累积，debounce 400ms 合并为单条 info toast，避免逐条刷屏；flush 时附带 `logWarn` 诊断日志。
- 模型加载：复用 babylon-mmd `PmxReader` 解析 PMX 纹理清单，与 `collectTextureFiles` 提供的路径集合（含 basename fallback）做规范化差集，缺失项逐条 `reportResourceWarning`。
- `outfit.ts` / `outfit-overlay.ts` / `audio.ts` 三处静默失败点接入同一 sink。

## 教训

1. 加载链路失败不应只 `logWarn` 静默——用户需要被告知「什么资源没加载」。
2. 多处潜在失败用 debounce 汇总比逐条 toast 更友好（天然防刷屏）。
3. 复用已有的 `feedback` / `toast` 基础设施，而非各加载点各写一套提示逻辑。
