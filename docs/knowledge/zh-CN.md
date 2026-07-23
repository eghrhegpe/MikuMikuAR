---
kind: zh_CN
name: 简体中文语言包
category: core
scope:
  - frontend/src/core/i18n/locales/**
source_files:
  - frontend/src/core/i18n/locales/zh-CN.ts
adr:
  - ADR-059
---

## 系统概览
基准语言包（zh-CN），包含项目全部 i18n 键值对。与现有中文文案保持一致，覆盖设置、模型详情、动作、材质、环境、道具、快捷键、错误提示等所有 UI 区域。

## 核心职责
- `zh-CN.ts` — 简体中文语言键值映射（`Record<string, string>`）。

## 导出
- `zhCN` — 包含约 1800 个键值对的简体中文语言对象。

## 覆盖范围
- 设置页面（外观/性能/路径/软件/截图/音频/快捷键/关于）
- 模型详情（信息/材质/骨骼/表情/标签/预设）
- 动作（播放/绑定/图层/重定向/布料/脚部调整/手势）
- 环境（天空/地面/水面/反射/风/云/粒子/雾/阴影）
- 道具加载/移除
- 全局状态通知（toast / setStatus）
- Go 端错误翻译

## 与其他子系统关系
- 被 `t.ts` 导入，根据当前语言加载对应包。