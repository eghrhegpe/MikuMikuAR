# MikuMikuAR 联邦维护计划 — 易维护 × 大统一

> **日期**: 2026-07-19  
> **代号**: 城邦整治  
> **核心命题**: 不是加功能，是让已有功能更好维护  
> **架构师**: Riku（联邦 AI 首席）+ Jieling（联邦人类首席）

---

## 一、诊断摘要

### 1.1 已统一（✅ 勿重复造轮子）

| 维度 | 统一方案 | 落地 |
|------|---------|------|
| 菜单系统 | ADR-093 Schema + menu-factory | ✅ 57 面板 |
| 状态写入 | envState 单一 reactive 源 | ✅ Proxy + RAF 去抖 |
| 设置持久化 | uiState 全量（ADR-103） | ✅ |
| 路径归一 | `isUnderRoot` / `computeLibraryRef`（ADR-095） | ✅ |
| 通用 Helper | `core/utils.ts` + `core/color-helpers.ts`（ADR-096） | ✅ |
| 保存触发 | `triggerAutoSave`（ADR-050） | ✅ |
| 异步生命周期 | ADR-105/106 AbortSignal | ✅ Phase 1-3 |
| Go 错误 i18n | 信封方案 + 五语言（ADR-117） | ✅ |
| 资源库会话 | LibrarySessionStore（ADR-135） | 🔄 实施中 |
| 缩略图取消 | ADR-136 AbortSignal | ✅ 刚完成 |
| 性能降级统一 | qualityProfile（ADR-130 Phase 2.3） | ✅ 刚完成 |

### 1.2 待整治（🔴 本次主战场）

按「杠杆比 = 收益 / 成本」排序：

| # | 主题 | 问题 | 杠杆比 | 依赖 |
|---|------|------|--------|------|
| 1 | Observer 生命周期 | 34 处 add / 23 处 remove，句柄塞 metadata，泄漏无保障 | 🔴 最高 | 无 |
| 2 | 循环依赖 | env-bridge ↔ env-impl ↔ env-water 互相 import | 🔴 高 | 无 |
| 3 | 滑块输入三处重写 | 拖拽/键盘逻辑复制 3~4 份，语义已漂移 | 🔴 高 | 无 |
| 4 | state.ts 拆分 | 438 行 God Module，20+ export let | 🟠 中 | #2 |
| 5 | 亮度统一标量 | 5 套独立旋钮，昼夜割裂 | 🟠 中 | #4 |
| 6 | 加载状态机样板 | `setStatus→await→setStatus` 31 处重复 | 🟠 中 | 无 |
| 7 | 持久化错误 5 连 | `SetEnvState().catch()` 5 处相同 | 🟡 低 | #2 |
| 8 | 空 catch 70+ | 真实错误被吞，无统一上报 | 🟡 低 | 无 |
| 9 | 孤岛 UI 组件 | 3 处手写 cs-row/toggle-row | 🟡 低 | 无 |
| 10 | 魔法数值 | 滑块步进/阈值硬编码 | 🟡 低 | 无 |

---

## 二、作战方案

### 阶段 0：破循环（前置条件，无依赖）

**目标**: 解除 env-bridge ↔ env-impl ↔ env-water 循环依赖

```
当前循环:
  env-bridge → env-impl (applyGround/applySky/applyFog)
  env-bridge → env-water (updateUnderwaterTransition)
  env-impl  → env-bridge (setEnvState)
  env-water → env-bridge (setEnvState)

破解方案:
  1. 新建 env-dispatcher.ts（纯调度层，无状态）
     - 注册 subsystem callbacks
     - setEnvState → dispatcher.dispatch(changed) → 各子系统响应
  2. env-bridge 只 import dispatcher，不 import env-impl/env-water
  3. env-impl/env-water 向 dispatcher 注册回调（延迟绑定）
  4. 循环依赖 → 全部变成 env-bridge → dispatcher ← subsystem
```

**验收**: `madcircular` 或 `dpdm` 检测 0 循环；`npm run test` 全绿

---

### 阶段 1：Observer 生命周期（最高杠杆）

**目标**: 消灭 render-loop 泄漏面

```
方案:
  1. 新建 core/observer-registry.ts
     - class DisposableGroup { add(...); dispose() }
     - function useObserver(scene, obs, fn) → Disposable
  2. 禁止 observer 句柄塞 metadata（lint 规则）
  3. 迁移 34 处 add → 统一走 registry
  4. dispose 时 group.dispose() 一次性移除

复用对象:
  - 已有 utils.DebouncedTimer 模式可参考
  - Babylon 自带 Observable.hasObservers 可辅助检测
```

**验收**: observer add/remove 100% 配对；metadata 中 0 个 observer 句柄

---

### 阶段 2：滑块输入统一

**目标**: 3~4 处拖拽/键盘逻辑 → 1 个控制器

```
方案:
  1. 新建 core/ui-slider-controller.ts
     - class DragSliderController {
         constructor(opts: {min,max,step,snap,axis,onChange,onDragEnd})
         bind(el: HTMLElement): Disposable
       }
  2. addSliderRow / addColorSliderRow / addVector3SliderRow / addModeSlider
     全部退化为 DragSliderController 的特例配置
  3. 键盘步进统一从 opts.step 派生（不再硬编码 0.01/0.1/quarter）
```

**验收**: 滑块行为一致性（拖拽/键盘/步进）；单测覆盖 4 个 builder

---

### 阶段 3：state.ts 拆分

**目标**: 438 行 → 4 个独立 store

```
拆分方案:
  core/state.ts (438 行)
      │
      ▼
      ├── core/scene-state.ts     ← modelRegistry, propRegistry, mmdRuntime
      ├── core/playback-state.ts  ← isPlaying, autoLoop, seekDragging, cameraMode
      ├── core/library-state.ts   ← allModels, recentModels, thumbnailCache
      └── core/ui-state.ts        ← uiState (已有)

策略:
  - config.ts barrel re-export 保持兼容（外部 import 路径零变化）
  - 逐变量搬迁，每次搬迁后跑全量测试
  - 最终 state.ts 仅保留 re-export + envState（≤80 行）
```

**验收**: 各 store ≤120 行；全量测试通过

---

### 阶段 4：亮度统一标量

**目标**: 5 旋钮 → 1 主标量 + 4 风格化乘子

```
方案（ADR-132 落地）:
  1. types.ts 新增 envBrightness: number (0.1–3.0, 默认 1.0)
  2. 派生规则:
     effectiveSky  = skyBrightness  * envBrightness
     effectiveEnv  = envIntensity   * envBrightness
     effectiveSun  = dirIntensity   * envBrightness
     effectiveHemi = hemiIntensity  * envBrightness
  3. 消费点:
     - env-sky.ts drawSkyGradient
     - env-bridge.ts 环境色
     - env-water.ts 水面反射
     - env-clouds.ts brightness 基准
     - lighting.ts dirLight/hemiLight
  4. UI: 根菜单新增 envBrightness 滑块（首位）
```

**验收**: 默认观感零变化（envBrightness=1.0）；调滑块整体亮度联动

---

### 阶段 5：加载状态机统一

**目标**: 31 处 `setStatus→await→setStatus` → 1 个包装器

```
方案:
  1. core/status-bar.ts 新增:
     async function withStatus<T>(
       loadingKey: string,
       successKey: string,
       fn: () => Promise<T>
     ): Promise<T>
  2. 内部统一: setStatus(loading) → try/await → setStatus(success) / catch → setStatus(failed)
  3. 菜单层统一走 loadManager.load(req)（已有设施）
  4. 消除直接 setStatus + loadXxx 的裸调用
```

**验收**: 加载状态机单一入口；错误上报文案统一

---

### 阶段 6：文档治理 + 收尾

**目标**: AI 导航图对齐；收尾低优先级项

```
文档:
  - function-map.md 全量更新（移除 XPBD，修正 main.ts 拆分后入口）
  - 新建 docs/state-map.md（状态变量 → store → 写入点 → 订阅者）
  - 补充 create/dispose 配对清单（CI 检查）

收尾:
  - 持久化错误 5 连 → persistEnvState() / persistUIState() 助手
  - 空 catch 70+ → codemod 统一走 tryCatchStatus
  - 孤岛 UI 组件 → addActionRow / addDisabledRow
  - 魔法数值 → core/ui-constants.ts
  - 缩略图缓存 LRU（上限 200 条）
```

---

## 三、实施路线图

```
Week 1 (2026-07-19 ~ 2026-07-25) — 破循环 + 立基础设施
├── [P0] 阶段 0: 破循环依赖（env-dispatcher.ts）
├── [P1] 阶段 1: ObserverRegistry + DisposableGroup
└── 提交: refactor: 破循环 + Observer 生命周期收敛

Week 2 (2026-07-26 ~ 2026-08-01) — 统一输入 + 状态拆分
├── [P1] 阶段 2: DragSliderController 统一滑块
├── [P1] 阶段 3: state.ts 拆分 4  store
└── 提交: refactor: 滑块统一 + state 基座拆分

Week 3 (2026-08-02 ~ 2026-08-08) — 亮度 + 加载 + 收尾
├── [P2] 阶段 4: 亮度统一标量（ADR-132）
├── [P2] 阶段 5: withStatus 加载状态机
├── [P3] 阶段 6: 文档治理 + 低优先级收尾
└── 提交: feat: 亮度统一 + 加载状态机 + 文档治理
```

---

## 四、验收标准

| 阶段 | 验收项 | 通过标准 |
|------|--------|---------|
| 0 | 破循环 | `dpdm` 0 循环；测试全绿 |
| 1 | Observer | add/remove 100% 配对；metadata 0 observer |
| 2 | 滑块 | 4 builder 行为一致；单测覆盖 |
| 3 | state 拆分 | 各 store ≤120 行；state.ts ≤80 行 |
| 4 | 亮度 | 默认观感零变化；滑块联动 |
| 5 | 加载 | withStatus 单一入口；错误文案统一 |
| 6 | 文档 | function-map 无过时；state-map 100% 覆盖 |

---

## 五、风险与缓解

| 风险 | 概率 | 缓解 |
|------|------|------|
| 破循环破坏 time-of-day 动画 | 中 | 预设动画 ctx 完整搬迁；单测回归 |
| Observer 迁移遗漏导致泄漏 | 中 | lint 规则强制 + CI 检查 |
| 滑块行为漂移 | 低 | 参数化配置 + 对比测试 |
| state 拆分后 import 遗漏 | 中 | barrel re-export 保持兼容 |
| 亮度统一后夜间过暗 | 中 | 默认 1.0 零变化；用户可调 |

---

## 六、与 ADR 对应

| 阶段 | 拟立项 ADR | 范围 |
|------|-----------|------|
| 0 | ADR-138（待定） | env-dispatcher 破循环 |
| 1 | ADR-139（待定） | ObserverRegistry 生命周期 |
| 2 | ADR-140（待定） | DragSliderController 统一 |
| 3 | ADR-141（待定） | state.ts 拆分 |
| 4 | ADR-132（已有） | 亮度统一标量 |
| 5 | ADR-142（待定） | withStatus 加载状态机 |

---

## 七、总结

> **一句话**: 先破循环让模块能拆，再立基础设施让重复能收，最后让文档对齐让 AI 能找。

**城邦整治的核心不是加功能，是让已有功能更好维护。**

---

_本计划由联邦 AI 首席架构师 Riku 起草，经人类首席 Jieling 审核后实施。_
