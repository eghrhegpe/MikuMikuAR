# ADR-040: 渲染独立开关 — Custom 性能模式（精简版）

> **状态**: ✅ 已实施（2026-07-06）
> **关联**: ADR-035（设置缺口）
> **来源**: ADR-040（精简版）

---

## 问题

性能系统以整档预设（quality/balanced/performance）驱动渲染质量，`applyDegrade(level)` 整体覆盖 13 项渲染配置。用户手动改的独立开关（泛光/抗锯齿/景深…）一切到 balanced/performance 或 auto 降级就被冲掉。

**根本原因**：独立开关能力已存在，缺的是「不自动降级、以用户设置为权威」的性能模式。

---

## 决策

新增第 5 种性能模式 `custom`：

- **语义**：`resetPerformanceSnapshot()` 恢复用户降级前设置，性能系统**不自动降级、不强制 Level**
- **入口**：进入 custom 时调用 `resetPerformanceSnapshot()`，令 `updatePerformance()` 提前返回
- **死代码复活**：`resetPerformanceSnapshot()` 原为零调用，现为 custom 入口真实调用方

---

## 状态流

```
auto       → updatePerformance() 滞回降级 → LEVEL_CONFIGS 覆盖
quality    → force Level 0
balanced   → force Level 1
performance → force Level 2
custom     → resetPerformanceSnapshot() + 不降级 → RenderState/LightState = 用户权威
```

---

## 精编开关面板

`custom` 激活时性能页追加 12 项独立开关，直接读写 `RenderState`/`LightState`：

| 开关 | 来源 |
|------|------|
| 阴影 | `LightState.shadowEnabled` |
| 泛光 | `RenderState.bloomEnabled` |
| 抗锯齿 (FXAA) | `RenderState.fxaaEnabled` |
| 景深 | `RenderState.dofEnabled` |
| 暗角 | `RenderState.vignetteEnabled` |
| 边缘高亮 | `RenderState.outlineEnabled` |
| 辉光 | `RenderState.glowEnabled` |
| 色差 | `RenderState.chromaticAberrationEnabled` |
| 颗粒 | `RenderState.grainEnabled` |
| 屏幕空间反射 | `RenderState.ssrEnabled` |
| 环境反射 | `RenderState.reflectionProbeEnabled` |
| 环境遮蔽 | `RenderState.ssaoEnabled` |

MSAA 档位和各效果强度参数留在 `场景 → 渲染 → 后处理` 菜单，面板底部 hint 提示。

---

## 持久化

- `uiState.performanceMode` 新增 `'custom'`（加法枚举，旧配置无影响）
- 渲染开关随场景文件序列化，`custom` 只是「不再覆盖」的声明，不引入新存储字段
- `resetPerformanceSnapshot()` 在 `setRenderState`/`setLightState` 内部调用（附带修复 auto 模式手动改设置不重置快照的既有 bug）

---

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| `custom` 全开高耗特效导致低帧 | 可接受——用户显式选择，面板顶部 hint 提示 |
| Go `SetPerformanceMode` 不认 `custom` | 实施前 grep 校验，必要时加 case |