# 第③轮审核 — env-impl + env-terrain 修复记录

**日期**: 2026-07-11
**发现方式**: 代码审核（第③轮）

---

## 修复 1: _edgeFadeTexCache 未释放（env-impl.ts）

**严重程度**: P3 — 纹理泄漏

`_edgeFadeTexCache` 按 fade 量化值缓存 Texture，但 `disposeEnvUpdateObserver()` 中未清理。多次切换地面淡出值后，缓存中的 Texture 不会被释放。

**修复**: 在 `disposeEnvUpdateObserver()` 中遍历 cache 调用 `tex.dispose()` + `cache.clear()`。

## 修复 2: canvas.getContext('2d')! × 2（env-impl.ts）

**严重程度**: P3 — 非浏览器环境崩溃

`applyProceduralGround` 和 `getGroundEdgeFadeTexture` 中各有一处 `canvas.getContext('2d')!` 非空断言。与 env-particles.ts 相同问题，阻止测试添加。

**修复**: 两处均替换为 null guard + early return。

## 修复 3: applyElevationColoring 除零（env-terrain.ts）

**严重程度**: P4 — 边界条件

`range = maxH - minH` 当 `groundTerrainHeight` 接近 0 时 range < 0.01，`(y - minH) / range` 产生极大值。

**修复**: 添加 `if (range < 0.01) return` guard。

## 修复 4: canvas.getContext('2d')!（env-terrain.ts）

**严重程度**: P3 — 非浏览器环境崩溃

`generateTerrainHeightmapURL` 中 `canvas.getContext('2d')!` 同样阻塞测试。

**修复**: 替换为 null guard + early return 空字符串。
