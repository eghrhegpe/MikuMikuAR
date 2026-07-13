# grid 切换后地面变纯色，重启才恢复

**日期**: 2026-07-12
**严重程度**: P1（渲染错误，用户可见）
**影响范围**: `env-impl.ts`（地面网格样式）
**发现方式**: 用户测试

---

## 问题描述

切换到 `grid` 地面样式时，地面第一次渲染变成纯色。重启应用后才恢复网格。

`GridMaterial` 是 Babylon.js 的独立 shader。第一次使用时需要编译 WebGL shader。编译期间，地面用 fallback 纯色渲染。

但编译完成后，网格没有正确刷新——需要重启应用才能看到网格。

## 根因分析

`GridMaterial` 的 shader 编译是异步的。编译完成时，地面纹理已经被缓存了——缓存的是 fallback 纯色，不是编译后的网格。

`StandardMaterial.diffuseTexture` 的路径没有这个问题——`canvas → toDataURL → Texture`，canvas 是同步的，纹理也是同步生成的。

`GridMaterial` 的编译延迟是一个已知特性。但"切换后不刷新"是联邦的 bug——它假设了"编译完成后会自动刷新"，但实际没有。

## 为什么没有暴露

`groundStyle: 'solid'` 是默认值。大多数人从开始就没用过 grid 样式。所以这个 bug 在很长一段时间里只存在于代码里，没有出现在用户面前。

直到有人试了 grid，发现了问题。

## 修复方案

ADR-091：地面纹理统一。

删除 `GridMaterial` 依赖（`@babylonjs/materials` 包）。所有 flat 样式统一用 `canvas → StandardMaterial.diffuseTexture` 单一路径。

`_generateGroundTexture` 函数：512×512 canvas 绘制——solid 是纯色，grid 是底色加网格线，checker 是按 pattern 绘制棋盘格。

不再需要 shader 编译。不再需要等待。不再有 fallback。

## 教训

1. **默认配置会掩盖边缘路径的 bug** — grid 不是默认值，所以没人注意它的渲染问题
2. **依赖独立 shader 的渲染路径，编译延迟是已知的风险** — 用 canvas 可以规避
