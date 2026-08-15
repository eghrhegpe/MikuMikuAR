# 多子代理审计 P3 观察项（2026-08-16 批次，未修复）

> **状态**: 🟡 搁置（P3 观察级：触发窗口极窄或无历史证据，不阻塞，留待下一轮审计）

**日期**: 2026-08-16
**严重程度**: 🟡 P3
**影响范围**: `frontend/src/scene/render/lighting.ts`、`frontend/src/scene/env/env-lighting.ts`、`frontend/src/core/ui-fullscreen-overlay.ts`
**发现方式**: 测试发现（4 渠道子代理只读审查 + 主模型交叉验证）
**修复提交**: 未修复（P3 观察级，本轮只修 P1/P2）

---

## 问题描述

本轮 4 个渠道子代理对最近提交（`7b578ecd`/`ceb99f84`/`0d066552`/`53a433ef`）做缺陷推测时，筛出 3 个 P3 观察项。均不构成当前可复现缺陷，但值得留档供下一轮审计或功能扩展时参考。

## 观察项清单

### 1. `transitionLighting` 提前返回路径漏调 `_clearGuardWarn()`

**位置**: `frontend/src/scene/render/lighting.ts:453-463`

灯光就绪但 `duration` 非正/非有限（0/NaN/负数）时走提前返回分支，正确清理了 `activeTransitionObs`、应用目标值、回调 `onComplete`，但**未调用 `_clearGuardWarn()`**（正常路径在 L464 调用）。若此前同一未就绪组合命中过 `_warnGuardBlocked` 并在 `_guardWarnedKeys` 留了条目，本次提前返回不清空，下次灯光再变未就绪时首次告警会被去重吞掉。

**评估**: 实际影响极低——提前返回意味着灯光已就绪，就绪态下 `_guardWarnedKeys` 通常已空（`setLightState` 就绪时会清空）。留档供对齐语义。

### 2. `skyColorTop.length === 3` 拒绝带 alpha 的 4 元组旧存档

**位置**: `frontend/src/scene/env/env-lighting.ts:391-392`

`importCategorizedEnvPreset` 的 version 2 兼容分支新增 `raw.skyColorTop.length === 3 && raw.skyColorBot.length === 3` 严格校验。若存在手写 4 元组 `[r,g,b,a]` 旧存档，整个分支不匹配、返回 null、存档无法导入（静默失败，不崩溃）。

**评估**: 全库检索无 4 元组格式历史证据（schema 为 `tuple3`，消费端 `col3FromTriple` 只取前 3 元素）。触发概率极低；若未来兼容外部 JSON 可放宽为 `>= 3` + `slice(0,3)`。

### 3. `setCurrentState('CLOSED')` 强复位不清冻结菜单/overlay

**位置**: `frontend/src/core/ui-fullscreen-overlay.ts:104-106`

`setCurrentState` 裸改 `currentState`，不触发 unfreeze、不移除 overlay、不清 `_cleanupMap`。测试代码（`fullscreen-overlay.test.ts`）用它强复位状态；若某测试以 `setCurrentState('CLOSED')` 收尾而菜单仍处于冻结态，`closeFullscreen` 因 `currentState !== 'FULLSCREEN'` 早返回，冻结菜单不会解冻——但 next test 的 `beforeEach` 会先调 `closeFullscreen` 再 `setCurrentState`，实际测试间未暴露问题。

**评估**: 目前仅测试用。若未来作为公共 API 暴露，建议目标为 CLOSED 时执行 unfreeze + overlay 移除。

## 根因分析

三项均非「当前可复现 bug」，而是**防御性缺口**：告警去重状态未收敛、存档校验过严、状态强复位不清理副作用。属于「边界未闭合」类观察项，不满足 P2 的触发概率门槛。

## 处置方案

1. 本轮不修（P3 观察级，避免为极窄窗口引入改动噪声）。
2. 留档记录触发条件与证据行号，下一轮审计或相关功能扩展时一并处理。
3. 若 `setCurrentState` 未来转公共 API，先补 unfreeze/overlay 清理。

## 教训

1. **修复时顺手对齐相邻语义**：`transitionLighting` 提前返回与正常路径都应收敛告警状态——「返回前把状态机关干净」应成为提前返回分支的默认检查项。
2. **严格校验要考虑兼容面**：`=== 3` 这类精确校验对「历史上从未出现但外部可能手写」的格式是硬拒绝，宽容解析（`>= 3` + 截断）通常无副作用。
3. **测试辅助 API 的副作用边界**：强复位函数（`setCurrentState`）不清理副作用，短期测试可用，长期暴露会积累悬挂状态——公共化前补清理。
