# ADR-154: 感知层 per-model 实例化 — Phase 2（全员感知 + 性能降级）

> **状态**: 已实现（2026-07-21；全员感知 + 三档自动降级已落地，1821 测试通过）
> **关联**: ADR-071（程序化与感知边界）、ADR-079（感知层扩展）、ADR-147（显式管线调度器）、ADR-152（per-model Phase 1）、ADR-153（冲突可视化）
> **来源**: 2026-07-20 感知层审核 P2 — perceptionState 单例导致多模型场景仅焦点模型有感知
> **日期**: 2026-07-21

---

## 一、问题陈述

### 1.1 背景

ADR-152 Phase 1 已将感知层从单例重构为 `Map<modelId, PerceptionContext>`，支持焦点模型 + pinned 模型（≤5 个）。但**普通模型仍无感知**，多角色场景下大部分角色仍是"木偶"。

### 1.2 为什么 Phase 1 不直接做全员

| 风险 | Phase 1 状态 | Phase 2 需解决 |
|------|-------------|---------------|
| 性能未基准 | ✅ ≤5 模型 × 28 = 140 对象池消费，现有池容量 32 需扩容 | 🔴 100 模型 × 28 = 2800 消费，需评估 |
| 帧时间预算 | ✅ 5 模型可控 | 🔴 100 模型可能突破 16.67ms（60fps） |
| 冲突爆炸 | ✅ 5 模型 × M 模块可控 | 🔴 100 模型 × M 模块，banner 可能显示几十条 |
| UX 复杂度 | ✅ pin 按钮 | 🔴 全员配置不现实，需"全员默认 + 个别覆盖" |

### 1.3 目标

- **全员感知**：所有加载的模型默认激活感知层（呼吸/眨眼/gaze）
- **性能降级**：根据帧率自动切换三档（high/medium/low），保证 60fps 稳定
- **冲突收敛**：感知层冲突 banner 仅显示焦点模型，避免信息爆炸

---

## 二、前置条件（必须先完成）

### 2.1 ADR-152 Phase 1 落地

`PerceptionContext` 抽象、`_contexts: Map<modelId, Context>` 存储、observer 遍历机制已就位。Phase 2 在此基础上：
- 移除"仅焦点 + pinned ≤5"限制
- 所有 `modelManager` 中的模型默认激活

### 2.2 性能基准 ADR（待立项）

**必须先做**独立的性能基准 ADR（暂称 ADR-155），测量：
- 单模型感知层单帧耗时（baseline）
- N 模型（10/50/100）的帧时间曲线
- 各感知项（breath/blink/gaze/balance/expression）的耗时占比
- 对象池 GC 压力

**本 ADR 的降级阈值依赖基准结果**，在基准完成前不实施。

---

## 三、设计方案

### 3.1 核心决策：三档性能降级

| 档位 | 激活模型数 | 感知项 | 适用场景 |
|------|-----------|--------|---------|
| **high** | 全员 | 全部 6 项（breath/blink/gaze/balance/expression/lipsync） | 模型数 ≤ 20，帧率稳定 60fps |
| **medium** | 焦点 + pinned + 前 N 个 | 全部 6 项，但 gaze 降采样（每 2 帧一次） | 模型数 20–50，或帧率 45–60fps |
| **low** | 仅焦点 + pinned | 仅 breath + blink（无 gaze/balance/expression） | 模型数 > 50，或帧率 < 45fps |

### 3.2 自动降级触发

```typescript
interface PerceptionPerfMonitor {
    fps: number;           // 当前帧率
    modelCount: number;    // 加载模型数
    tier: 'high' | 'medium' | 'low';
    
    // 每 N 帧采样一次（非每帧，避免监控本身影响性能）
    update(): void;
    getTier(): 'high' | 'medium' | 'low';
}
```

**触发规则**：
- 连续 60 帧 fps < 45 → 自动降一档
- 连续 120 帧 fps > 55 → 自动升一档（滞后避免抖动）
- 模型数 > 50 → 强制 low 档（不等待 fps 下降）

### 3.3 API 扩展（在 ADR-152 基础上）

```typescript
// ADR-152 已有
export function activatePerception(modelId?: string): void;
export function pinPerception(modelId: string): void;

// ADR-154 新增
export function enableAllPerception(): void;           // 全员激活（受 tier 限制）
export function disableAllPerception(): void;          // 全员关闭（仅焦点保留）
export function getPerceptionPerfTier(): 'high' | 'medium' | 'low';
export function setPerceptionPerfTier(tier: 'high' | 'medium' | 'low' | 'auto'): void;
```

### 3.4 observer 改造（在 ADR-152 基础上）

```typescript
perceptionObserver = getMotionPipeline().register({
    id: 'perception',
    stage: 'perception',
    order: 0,
    run: () => {
        const scene = getScene();
        if (!scene || scene.isDisposed) return;
        const time = performance.now() / 1000;
        const dt = scene.getEngine().getDeltaTime() / 1000;
        
        // 性能监控
        _perfMonitor.update();
        const tier = _perfMonitor.getTier();
        
        // 根据 tier 决定激活范围
        const activeContexts = _getActiveContextsByTier(tier);
        
        for (const ctx of activeContexts) {
            const inst = modelManager.get(ctx.modelId);
            if (!inst?.mmdModel || inst.mmdModel.mesh?.isDisposed()) {
                _deactivateContext(ctx.modelId);
                continue;
            }
            
            // 根据 tier 决定感知项
            _applyPerceptionForContext(ctx, inst.mmdModel, time, dt, tier);
        }
    },
});
```

### 3.5 感知项降级策略

| 感知项 | high | medium | low |
|--------|------|--------|-----|
| breath | ✅ 每帧 | ✅ 每帧 | ✅ 每帧（低成本） |
| blink | ✅ 每帧 | ✅ 每帧 | ✅ 每帧（低成本） |
| gaze | ✅ 每帧 | ⚡ 每 2 帧一次 | ❌ 关闭 |
| balance | ✅ 每帧 | ✅ 每帧 | ❌ 关闭 |
| expression | ✅ 每帧 | ⚡ 每 4 帧一次 | ❌ 关闭 |
| lipsync | ✅ 每帧 | ✅ 每帧 | ❌ 关闭 |

### 3.6 对象池容量调整

```typescript
// perception-shared.ts
// 原：单帧最大消费 28（单模型）
// 新：根据 tier 动态评估
//   high (20 模型): 20 × 28 = 560
//   medium (10 模型): 10 × 28 = 280
//   low (5 模型): 5 × 14 = 70（仅 breath+blink）

// 方案 A：扩容池到 600（覆盖 high 档）
// 方案 B：per-context 独立池（避免大池浪费）
// 推荐方案 B，与 ADR-152 的 per-context 设计一致
```

### 3.7 冲突 banner 收敛

ADR-153 的冲突 banner 在全员感知下会爆炸（100 模型 × M 模块）。收敛策略：
- **默认仅显示焦点模型的冲突**
- pinned 模型的冲突在 pinned 面板独立显示
- 普通模型的冲突不显示（tier=low 时感知层大部分关闭，冲突自然减少）

---

## 四、改动范围（在 ADR-152 基础上）

| 文件 | 改动 | 风险 |
|------|------|------|
| [perception.ts](file:///c:/Users/zhujieling11/MikuMikuAR/frontend/src/scene/motion/perception.ts) | observer 加 tier 逻辑；新增 enableAll/disableAll | 🟠 中 |
| perception-shared.ts | 新增 PerceptionPerfMonitor；对象池改 per-context | 🟠 中 |
| perception-gaze/balance/expression.ts | 加 tier 守卫（low 档跳过） | 🟡 低 |
| [motion-gaze-levels.ts](file:///c:/Users/zhujieling11/MikuMikuAR/frontend/src/menus/motion-gaze-levels.ts) | UI 加「全员感知」开关 + tier 显示 | 🟡 低 |
| [scene.ts](file:///c:/Users/zhujieling11/MikuMikuAR/frontend/src/scene/scene.ts) | 模型加载/移除时自动激活/注销感知 | 🟡 低 |
| [scene-serialize.ts](file:///c:/Users/zhujieling11/MikuMikuAR/frontend/src/scene/scene-serialize.ts) | 序列化 tier 设置 | 🟢 低 |

---

## 五、风险评估

| 风险 | 级别 | 缓解措施 |
|------|------|---------|
| 100 模型感知导致掉帧 | 🔴 高 | 性能基准 ADR-155 必须先做；自动降级触发 |
| 对象池扩容导致内存增长 | 🟠 中 | 改 per-context 池，按需分配 |
| 全员感知时模型加载/移除频繁触发 claimBones | 🟠 中 | claimBones 仅在 activate 时调一次，非每帧 |
| 冲突 banner 信息爆炸 | 🟡 低 | 仅显示焦点模型冲突 |
| 自动降级抖动（频繁切换档位） | 🟡 低 | 滞后规则（60 帧降 / 120 帧升） |
| 用户对自动降级感知不明 | 🟡 低 | UI 显示当前 tier + 手动覆盖选项 |

---

## 六、实施计划

| 阶段 | 内容 | 前置条件 |
|------|------|---------|
| **Phase 0** | 性能基准 ADR-155 立项与实施 | 无 |
| **Phase 1** | PerceptionPerfMonitor 实现；tier 触发逻辑 | Phase 0 完成 |
| **Phase 2** | observer 加 tier 守卫；感知项降级 | Phase 1 完成 |
| **Phase 3** | enableAll/disableAll API；scene.ts 自动激活 | ADR-152 落地 |
| **Phase 4** | UI 加全员开关 + tier 显示 | Phase 3 完成 |
| **Phase 5** | 对象池 per-context 改造 | Phase 1 完成（容量评估后） |
| **Phase 6** | 测试 + 性能验证 | 全部完成 |

---

## 七、验收标准

| 标准 | 验证方法 |
|------|---------|
| 100 模型场景下帧率 ≥ 45fps | 实测 + 性能基准 |
| 自动降级在帧率下降时触发 | 模拟掉帧，验证 tier 切换 |
| 全员感知开启后所有模型有呼吸/眨眼 | 实测 |
| low 档下 gaze/balance/expression 关闭 | 实测 |
| 手动设置 tier=high 覆盖自动降级 | UI 测试 |
| 冲突 banner 仅显示焦点模型 | UI 检查 |
| ADR-152 的 pin 功能不受影响 | 回归测试 |

---

## 八、与 ADR-152 的边界

| 项 | Phase 1（ADR-152） | Phase 2（本 ADR） |
|----|-------------------|------------------|
| 激活模型数 | 焦点 + pinned ≤5 | 全员（受 tier 限制） |
| 性能降级 | 不需要 | 三档自动 + 手动覆盖 |
| UI | pin 按钮 | 全员开关 + tier 显示 |
| 对象池 | 全局扩容 | per-context 独立池 |
| 冲突 banner | 全部显示 | 仅焦点模型 |

---

## 九、开放问题

1. **tier 切换时的视觉跳变**：low → high 切换时，原本无 gaze 的模型突然开始 gaze 跟随，可能突兀。建议加 0.5s 过渡淡入。
2. **用户手动 tier=auto 与手动档的冲突**：若用户手动设为 high 但帧率持续下降，是否强制降级？当前设计不强制，仅 warn。
3. **AR 模式下的全员感知**：AR 中通常仅 1 个模型，全员感知意义不大，建议 AR 模式下强制 tier=high 且仅焦点激活。
4. **模型移除时的 context 清理**：需确保 `modelManager.remove` 时同步调用 `_deactivateContext`，避免内存泄漏。
5. **性能基准 ADR-155 的测量维度**：建议至少测量 1/10/50/100 模型的帧时间、GC 频率、各感知项耗时占比。

---

## 十、与 ADR-150/152/153 的整体闭环

| ADR | 层次 | 闭环目标 |
|-----|------|---------|
| ADR-150 | 物理层 | delta 叠加避免 gaze 覆写 VMD |
| ADR-151 | UI 层 | balanceSway 参数可调 |
| ADR-152 | 状态层 | per-model context（pinned ≤5） |
| ADR-153 | 可见性层 | 感知层冲突 banner |
| **ADR-154** | **性能层** | **全员感知 + 自动降级** |

五份 ADR 共同构成感知层「左右脑互博」的完整闭环：从物理根因（delta）到状态架构（per-model）到用户可见性（冲突 banner）到性能保障（全员降级）。
