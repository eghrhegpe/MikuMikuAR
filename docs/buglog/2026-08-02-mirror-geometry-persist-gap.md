# 镜面几何参数持久化缺失（config.json 链路断在 Go 端）

> **状态**: 🟢 已修复

**日期**: 2026-08-02
**严重程度**: 🟠 P2
**影响范围**: `internal/app/app.go`（EnvState 结构体）、`frontend/src/core/init.ts`（restoreEnvState 兜底）
**发现方式**: 开发发现
**修复提交**: 待提交（见 git log）

---

## 问题描述

调整镜面道具的尺寸/位置/旋转后重启应用，几何参数回退默认值（18×21 @ [0,1.5,8]）。仅当 last_scene.json 恰好兜住时才能恢复，config.json 这条权威恢复源永远存不下几何参数。

## 复现步骤

1. 场景菜单 → 镜面，打开镜面并调整宽度/高度/位置/旋转
2. 关闭应用重开
3. 观察到镜面几何回默认值（若 last_scene 存在则偶发正常，掩盖问题）

## 根因分析

镜面几何参数（`mirrorWidth/mirrorHeight/mirrorPosition/mirrorRotationY`）在前端已迁入 envState 并随 `serializeScene` 全量落盘（`env-state-schema.ts` 注释明示），前端链路完整。但 **Go 端 `EnvState` 结构体（`internal/app/app.go`）只声明了 `MirrorEnabled`，缺失 4 个几何字段**：

- `setEnvState` → `persistEnvState` → `SetEnvState` → `mergeEnvState` 走 **JSON round-trip**（`config.go:286`）
- Go 结构体没有的字段在 `json.Unmarshal` 时被**静默丢弃**，config.json 里永远只存得下 `mirrorEnabled`
- 启动 `restoreEnvState`（`init.ts`，注释标注为 authoritative 恢复源）读回 `cfg.env`，几何参数落到 schema 默认值

场景文件路径（serializeScene/deserializeScene）不经 Go 全量透传所以正常，掩盖了 config 链路的断点。

## 修复方案

1. **Go 端**（`internal/app/app.go`）：`EnvState` 补齐 `MirrorWidth`/`MirrorHeight`/`MirrorRotationY`（值类型，合法最小 0.5 > 0，零值即缺省无歧义）+ `MirrorPosition`（`*[3]float64` + `omitempty`，区分「旧配置未设置」与「用户真在原点 [0,0,0]」）。`mergeEnvState` 与自定义 `UnmarshalJSON`（alias 透传）均无需改动。
2. **前端**（`frontend/src/core/init.ts`）：`restoreEnvState` 复用既有"旧配置缺字段补默认"模式（与 `groundSize`/`reflectionQuality` 同款），为修复前旧 config.json 补默认值。
3. **测试**（`internal/app/app_test.go`）：新增 `TestMergeEnvStateMirrorGeometryFields`（round-trip 保留 4 字段 + 旧配置部分合并不覆盖）+ `TestEnvStateMirrorPositionOmitEmpty`（omitempty 省略 vs 显式 [0,0,0] 不混淆）。

## 教训

1. Go 端 `EnvState` 结构体是 config.json 持久化的**唯一承载面**，TS schema 新增字段时须同步核对 Go 结构体（ADR-137「Go 字段补齐」当年漏了 mirror 几何组）。
2. JSON round-trip merge 会静默丢弃结构体外的字段——前端「全量落盘」在跨语言边界上不成立，应以 Go 结构体为准验证持久化完整性。
3. 数组零值 `[0,0,0]` 与「未设置」不可区分，跨语言默认值兜底时用指针 + omitempty 显式区分。
