# MikuMikuAR 联邦大统一蓝图

> **日期**: 2026-07-19  
> **代号**: 大展宏图  
> **核心命题**: 易维护 × 大统一  
> **架构师**: Riku（联邦 AI 首席）+ Jieling（联邦人类首席）

---

## 一、现状诊断

### 1.1 已统一（✅ 勿重复造轮子）

| 维度 | 统一方案 | 落地程度 |
|------|---------|---------|
| 菜单系统 | ADR-093 Schema + menu-factory 单渲染器 | ✅ 57 面板全量迁移 |
| 状态写入 | envState 单一 reactive 源 + setter 规约 | ✅ Proxy 拦截 + RAF 去抖 |
| 设置持久化 | uiState 全量持久化（ADR-103 移除 SettingsStore） | ✅ 跨重启一致 |
| 路径归一化 | `isUnderRoot` / `computeLibraryRef` 工厂（ADR-095） | ✅ |
| 通用 Helper | `core/utils.ts` + `core/color-helpers.ts` 单点收敛（ADR-096） | ✅ |
| 保存触发 | `triggerAutoSave` 统一入口（ADR-050） | ✅ |
| 异步生命周期 | ADR-105/106 AbortSignal + 时序审核 | ✅ Phase 1-3 全落地 |
| Go 错误 i18n | 信封方案 + 五语言 bundle + CI 门禁（ADR-117） | ✅ |
| 资源库会话 | LibrarySessionStore 单例（ADR-135 P0.1） | 🔄 实施中 |
| 缩略图取消 | ADR-136 AbortSignal | ✅ 刚完成 |
| 性能降级统一 | qualityProfile（ADR-130 Phase 2.3） | ✅ 刚完成 |

### 1.2 待统一（🔴 大展宏图主战场）

按「杠杆比 = 收益 / 成本」排序：

| # | 主题 | 问题 | 杠杆比 | 依赖 |
|---|------|------|--------|------|
| 0 | 循环依赖 | env-bridge ↔ env-impl ↔ env-water 互相 import | 🔴 最高 | 无 |
| 1 | Observer 生命周期 | 34 处 add / 23 处 remove，句柄塞 metadata，泄漏无保障 | 🔴 最高 | 无 |
| 2 | 滑块输入三处重写 | 拖拽/键盘逻辑复制 3~4 份，语义已漂移 | 🔴 高 | 无 |
| 3 | state.ts 拆分 | 438 行 God Module，20+ export let，混合运行时/库/缓存/UI/播放 | 🔴 P1 | #0 |
| 4 | 亮度统一标量 | 5 套独立旋钮（sky/env/dir/hemi/cloud），昼夜割裂，云层脱离环境 | 🟠 P2 | #3 |
| 5 | WASM/JS 双模式 | `VITE_MMD_RUNTIME` 切换 → gaze-js/gaze-wasm 双份实现 | 🔴 P1 | 无 |
| 6 | 加载状态机样板 | `setStatus→await→setStatus` 31 处重复 | 🟠 中 | 无 |
| 7 | 持久化错误 5 连 | `SetEnvState().catch()` 5 处相同 | 🟡 低 | #0 |
| 8 | 空 catch 70+ | 真实错误被吞，无统一上报 | 🟡 低 | 无 |
| 9 | 孤岛 UI 组件 | 3 处手写 cs-row/toggle-row | 🟡 低 | 无 |
| 10 | 魔法数值 | 滑块步进/阈值硬编码 | 🟡 低 | 无 |
| 11 | function-map.md | 标注"部分过时"，XPBD 残留，main.ts 拆分后入口失准 | 🟠 P2 | 无 |
| 12 | 缩略图缓存 | `thumbnailCache` 无 LRU 淘汰，长期运行 OOM 风险 | 🟡 P3 | 无 |
| 13 | 动作覆盖 boilerplate | ADR-116 遗留 ~105 行重复（P4 计划抽取 module-base.ts 未实施） | 🟡 P3 | 无 |

---

## 二、大统一作战方案

### 阶段 0：破循环（前置条件，无依赖）

> ⚠️ 必须先于其他阶段执行。循环依赖不解除，后续拆分都会遇到编译障碍。

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

**验收**: `dpdm` 检测 0 循环；`npm run test` 全绿

---

### 阶段 1：Observer 生命周期收敛（最高杠杆）

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

### 阶段 3：状态基座重构（core/state.ts 拆分）

**目标**: 438 行 → 4 个独立 store，每个 ≤120 行

```
core/state.ts (438 行)
    │
    ▼ 拆分
    ├── core/scene-state.ts     ← modelRegistry, propRegistry, mmdRuntime, focusedModelId
    ├── core/playback-state.ts  ← isPlaying, autoLoop, seekDragging, cameraMode
    ├── core/library-state.ts   ← allModels, recentModels, thumbnailCache, expandedFolders
    └── core/ui-state.ts        ← uiState (已有), activeTimeOfDayPreset
```

**迁移策略**:
1. 新建 4 文件，逐变量搬迁（保留 setter 签名不变）
2. `config.ts` barrel re-export 保持兼容
3. 外部 import 路径零变化（`from '@/core/config'` → 仍指向 barrel）
4. 后续 ADR 直接操作对应 store，不再膨胀 state.ts

**预期收益**:
- 状态归属清晰：scene 模块只 import scene-state
- 消除"幽灵路径"：每个 store 职责边界明确
- 测试可分片：每个 store 独立单测

---

### 阶段 4：消灭 WASM/JS 双模式

**目标**: 删除 `perception-gaze-js.ts` + `perception-gaze-wasm.ts` → 单一 `perception-gaze.ts`

**根因**:
- WASM 双缓冲覆盖写入 → gaze 无法直接修改 `linkedBone`
- 实际解：`wasm-layers-blender` 已在 WASM 模式下调度 gaze，**无需切 JS**

**执行**:
1. 确认 `wasm-layers-blender` 在 WASM 模式下 gaze 行为完整
2. 删除 `perception-gaze-js.ts`（JS 专用实现）
3. `perception-gaze-wasm.ts` → 重命名为 `perception-gaze.ts`（唯一实现）
4. 移除 `VITE_MMD_RUNTIME=js` 相关分支（保留 `wasm` 作为默认）
5. 清理 `scene.ts` 中 `getMmdRuntimeType()` 切换逻辑

**预期收益**:
- 维护成本减半
- gaze 行为一致性保证
- 删除 ~300 行条件分支代码

---

### 阶段 5：env-bridge.ts 瘦身

**目标**: 771 行 → 拆分为 3 个 ≤250 行的专注模块

```
env-bridge.ts (771 行)
    │
    ▼ 拆分
    ├── env-time-of-day.ts   ← startTimeOfDay / stopTimeOfDay / preset 动画
    ├── env-persist.ts       ← SetEnvState 防抖持久化 + 启动恢复
    └── env-lighting-link.ts ← deriveLighting + applyLightingPresetFromEnv
```

**关键解耦**:
- env-impl ↔ env-water 循环依赖：将 `updateUnderwaterTransition` 提升到 scene.ts 编排层
- `_edgeFadeTexCache` 无 dispose → 纳入 env-ground.ts 的 dispose 链路

---

### 阶段 6：亮度统一标量（ADR-132 落地）

**目标**: 5 旋钮 → 1 主标量 + 4 风格化乘子

```typescript
// 派生规则
const EB = envState.envBrightness;           // 主标量，默认 1.0
const effectiveSky   = skyBrightness * EB;    // 天空
const effectiveEnv   = envIntensity  * EB;    // IBL / 环境
const effectiveSun   = dirIntensity   * EB;    // 方向光 + 云
const effectiveHemi  = hemiIntensity  * EB;    // 半球补光
```

**消费点**:
- `env-sky.ts:96` drawSkyGradient
- `env-bridge.ts:248` 环境色
- `env-water.ts:453` 水面反射
- `env-clouds.ts` brightness 基准
- `lighting.ts` dirLight / hemiLight intensity

**UI**: 新增 `envBrightness` 滑块挂 env 根菜单首位（0.1–3.0，步长 0.05）

---

### 阶段 7：加载状态机统一

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

### 阶段 8：文档治理 + 收尾

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
├── [P1] 阶段 3: state.ts 拆分 4 store
├── [P1] 阶段 4: 消灭 WASM/JS 双模式
└── 提交: refactor: 滑块统一 + state 基座拆分 + 消灭双模式

Week 3 (2026-08-02 ~ 2026-08-08) — 环境系统 + 加载 + 收尾
├── [P1] 阶段 5: env-bridge 拆分（time-of-day / persist / lighting-link）
├── [P2] 阶段 6: 亮度统一标量（ADR-132）
├── [P2] 阶段 7: withStatus 加载状态机
├── [P3] 阶段 8: 文档治理 + 低优先级收尾
└── 提交: feat: env-bridge 拆分 + 亮度统一 + 加载状态机 + 文档治理
```

---

## 四、验收标准

| 阶段 | 验收项 | 通过标准 |
|------|--------|---------|
| 0 | 破循环 | `dpdm` 0 循环；测试全绿 |
| 1 | Observer | add/remove 100% 配对；metadata 0 observer |
| 2 | 滑块 | 4 builder 行为一致；单测覆盖 |
| 3 | state.ts 拆分 | `core/state.ts` ≤ 80 行；4 个新 store 文件各 ≤ 120 行 |
| 4 | 消灭双模式 | `perception-gaze-js.ts` 不存在；`VITE_MMD_RUNTIME=js` 分支全删；gaze 单测全绿 |
| 5 | env-bridge 瘦身 | `env-bridge.ts` ≤ 250 行；3 个新文件各 ≤ 250 行；循环依赖解除 |
| 6 | 亮度统一 | 5 个消费点统一乘 `EB`；UI 主滑块生效；默认观感零变化 |
| 7 | 加载 | withStatus 单一入口；错误文案统一 |
| 8 | 文档 | function-map 无过时；state-map 100% 覆盖 |

---

## 五、风险与缓解

| 风险 | 概率 | 缓解 |
|------|------|------|
| 破循环破坏 time-of-day 动画 | 中 | 预设动画 ctx 完整搬迁；单测回归 |
| Observer 迁移遗漏导致泄漏 | 中 | lint 规则强制 + CI 检查 |
| 滑块行为漂移 | 低 | 参数化配置 + 对比测试 |
| state.ts 拆分后 import 路径遗漏 | 中 | barrel re-export 保持兼容，IDE 全局搜索验证 |
| 删除 JS gaze 后 WASM gaze 行为不完整 | 低 | 已有 wasm-layers-blender 调度，单测覆盖 + 真机验证 |
| env-bridge 拆分破坏 time-of-day 动画 | 中 | 预设动画 ctx 完整搬迁，单测回归 |
| 亮度统一后夜间场景过暗/过亮 | 中 | 默认 `envBrightness=1.0` 保持既有观感，用户可调 |

---

## 六、与 ADR 对应

| 阶段 | 拟立项 ADR | 范围 |
|------|-----------|------|
| 0 | ADR-138 | env-dispatcher 破循环 |
| 1 | ADR-139 | ObserverRegistry 生命周期 |
| 2 | ADR-140 | DragSliderController 统一 |
| 3 | ADR-141 | state.ts 拆分 |
| 4 | （无需新增） | gaze 双模式收敛 |
| 5 | ADR-143 | env-bridge 拆分 |
| 6 | ADR-132 | 亮度统一标量 |
| 7 | ADR-142 | withStatus 加载状态机 |

---

## 七、总结

> **一句话**: 把"什么都能写"的 state.ts 拆成"只能写自己"的 store，把"两份实现"的 gaze 合成"一份真理"，把"五旋钮乱调"的亮度系成"一根主轴"。

**大展宏图的核心不是加功能，是让已有功能更好维护。**

---

_本蓝图由联邦 AI 首席架构师 Riku 起草，经人类首席 Jieling 审核后实施。_
