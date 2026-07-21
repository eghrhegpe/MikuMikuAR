# ADR-162: 感知层 per-model 实例化 — Phase 1（pinned 模型支持）

> **状态**: 已完成（2026-07-21；per-model 真实隔离由 ADR-166 收口；独立审核 frontend 1821 测试 0 失败）
> **关联**: ADR-071（程序化与感知边界）、ADR-079（感知层扩展）、ADR-147（显式管线调度器）
> **来源**: 2026-07-20 感知层审核 P2 — perceptionState 单例导致多模型场景仅焦点模型有感知
> **日期**: 2026-07-21

---

## 一、问题陈述

### 1.1 现状

感知层采用**单例状态 + 单 observer + 单焦点模型**架构：

| 限制 | 位置 | 后果 |
|------|------|------|
| 单例 perceptionState | [perception.ts:53](file:///c:/Users/zhujieling11/MikuMikuAR/frontend/src/scene/motion/perception.ts#L53) | 全场景只有一份呼吸/眨眼/gaze 配置 |
| 单值 perceptionModelId | [perception.ts:54](file:///c:/Users/zhujieling11/MikuMikuAR/frontend/src/scene/motion/perception.ts#L54) | 仅焦点模型激活感知 |
| 单 observer | [perception.ts:95-177](file:///c:/Users/zhujieling11/MikuMikuAR/frontend/src/scene/motion/perception.ts#L95-L177) | observer 仅对 perceptionModelId 模型应用 |

**用户感知**：多角色场景中，非焦点角色无呼吸/眨眼/视线跟随，呈"木偶"状态。ADR-079 标题"角色永远活着"在多模型场景下不成立。

### 1.2 为什么不直接做全员感知

全员感知（N 模型 × 6 感知项/帧）有 3 个未验证的风险：

| 风险 | 未解问题 |
|------|---------|
| 性能 | 100 模型 × 6 项 = 600 次/帧，未基准测试；对象池容量 [perception-shared.ts:83-85](file:///c:/Users/zhujieling11/MikuMikuAR/frontend/src/scene/motion/perception-shared.ts#L83-L85) 按 28 设计 |
| 冲突面 | 模块层 claimBones 已 per-model，感知层 per-model 后 N×M 冲突可能爆炸 |
| UX | 100 模型各自配置呼吸/眨眼/gaze 不现实，需要"全员默认 + 个别 pin"模式 |

**决策**：本 ADR 仅做 Phase 1（pinned 模型支持，≤5 个），Phase 2（全员感知 + 性能降级）立项为 ADR-164，需先做性能基准。

---

## 二、设计方案

### 2.1 核心概念：PerceptionContext

抽象单例为 per-model 上下文：

```typescript
interface PerceptionContext {
    modelId: string;
    state: PerceptionState;
    isActive: boolean;
    isPinned: boolean;  // 用户手动 pin，不受焦点切换影响
    lastOffsets: {
        breath: number;
        balance: BalanceSwayState;
        emotion: string | null;
    };
}

// 替换原单例
let _contexts = new Map<string, PerceptionContext>();
let _focusedContextId: string | null = null;
```

### 2.2 激活策略

| 模型类型 | 激活行为 |
|---------|---------|
| 焦点模型 | 自动激活，切换焦点时旧焦点 deactivate（除非 pinned） |
| Pinned 模型 | 用户手动 pin，始终激活，≤5 个上限 |
| 普通模型 | 不激活（Phase 1 不支持全员感知） |

### 2.3 API 变更

```typescript
// 既有 API（保留兼容）
export function activatePerception(modelId?: string): void;  // 焦点模型
export function deactivatePerception(): void;                // 注销焦点
export function getPerceptionState(): PerceptionState;       // 焦点 context 状态

// 新增 API
export function pinPerception(modelId: string): void;        // pin 模型（≤5）
export function unpinPerception(modelId: string): void;
export function getPinnedModelIds(): string[];
export function getPerceptionStateFor(modelId: string): PerceptionState;  // 指定模型
export function setPerceptionStateFor(modelId: string, s: Partial<PerceptionState>): void;
```

### 2.4 observer 改造

```typescript
// 原：单 observer 处理单模型
// 新：单 observer 遍历所有激活 context（焦点 + pinned）
perceptionObserver = getMotionPipeline().register({
    id: 'perception',
    stage: 'perception',
    order: 0,
    run: () => {
        const scene = getScene();
        if (!scene || scene.isDisposed) return;
        const time = performance.now() / 1000;
        const dt = scene.getEngine().getDeltaTime() / 1000;

        // 遍历所有激活 context
        for (const ctx of _contexts.values()) {
            if (!ctx.isActive) continue;
            const inst = modelManager.get(ctx.modelId);
            if (!inst?.mmdModel || inst.mmdModel.mesh?.isDisposed()) {
                _deactivateContext(ctx.modelId);
                continue;
            }
            _applyPerceptionForContext(ctx, inst.mmdModel, time, dt);
        }
    },
});
```

### 2.5 序列化

```typescript
// 原：perception: { ...getPerceptionState() }
// 新：perception: {
//   focused: PerceptionState,
//   pinned: Array<{ modelId: string, state: PerceptionState }>,
// }
```

**迁移**：旧存档 `perception: PerceptionState` → `{ focused: oldState, pinned: [] }`

---

## 三、改动范围

| 文件 | 改动 | 风险 |
|------|------|------|
| [perception-shared.ts](file:///c:/Users/zhujieling11/MikuMikuAR/frontend/src/scene/motion/perception-shared.ts) | 新增 PerceptionContext 类型 | 低 |
| [perception.ts](file:///c:/Users/zhujieling11/MikuMikuAR/frontend/src/scene/motion/perception.ts) | 单例 → Map<modelId, Context> | 🔴 高（核心重构） |
| [perception-breathing/balance/expression.ts](file:///c:/Users/zhujieling11/MikuMikuAR/frontend/src/scene/motion) | reset/lastOffset 状态移入 Context | 🟠 中 |
| [scene-serialize.ts](file:///c:/Users/zhujieling11/MikuMikuAR/frontend/src/scene/scene-serialize.ts) | 序列化 schema 变更 | 🟠 中 |
| [scene-migrate.ts](file:///c:/Users/zhujieling11/MikuMikuAR/frontend/src/scene/scene-migrate.ts) | 旧存档迁移 | 🟡 低 |
| [menu-schema.ts](file:///c:/Users/zhujieling11/MikuMikuAR/frontend/src/menus/menu-schema.ts) | `getPerceptionState()[key]` → 指定 modelId | 🟠 中 |
| [motion-gaze-levels.ts](file:///c:/Users/zhujieling11/MikuMikuMikuAR/frontend/src/menus/motion-gaze-levels.ts) | UI 加「pin 当前模型」按钮 | 🟡 低 |
| [ar-scene.ts](file:///c:/Users/zhujieling11/MikuMikuAR/frontend/src/scene/ar/ar-scene.ts) | 读焦点 context 而非单例 | 🟡 低 |
| 测试 | perception.test.ts 大改 | 🟠 中 |

---

## 四、风险评估

| 风险 | 级别 | 缓解措施 |
|------|------|---------|
| 核心重构破坏现有 57 项 perception 测试 | 🔴 高 | 分步迁移：先抽 Context，单例行为不变；再加 pin |
| 序列化 schema 破坏旧存档 | 🟠 中 | 迁移函数兜底：旧格式 → 新格式 |
| UI「当前编辑模型」概念引入 | 🟠 中 | 焦点模型即默认编辑对象，pin 模型在独立面板编辑 |
| 对象池容量不足（5 模型 × 28 = 140 > 32） | 🟠 中 | 池扩容或改 per-context 池 |
| 循环依赖 | 🟡 低 | Context 类型放 perception-shared.ts，无新依赖 |

---

## 五、实施计划

| 阶段 | 内容 | 风险点 |
|------|------|--------|
| **Phase 1** | 抽 `PerceptionContext` 类型；单例包装为 `_contexts.get(focusedId)` | 保持行为不变 |
| **Phase 2** | observer 改遍历；`_applyPerceptionForContext` 抽取 | 现有测试需调整 |
| **Phase 3** | `pinPerception` / `unpinPerception` API；UI 加 pin 按钮 | 新功能 |
| **Phase 4** | 序列化 schema + 迁移；ar-scene 适配 | 旧存档兼容 |
| **Phase 5** | 测试重构 + 新增 pin 测试 | 全量回归 |

---

## 六、验收标准

| 标准 | 验证方法 |
|------|---------|
| 焦点模型感知行为不变 | 加载单模型，呼吸/眨眼/gaze 正常 |
| Pinned 模型在焦点切换时仍激活 | pin 模型 A，切焦点到 B，A 仍呼吸 |
| Pinned 上限已移除（受 ADR-164 tier 控制） | pin 第 6+ 个时正常运作，不 warn 不拒绝 |
| 旧存档加载后使用默认值 | 加载旧场景，无 NaN |
| 57 项 perception 测试全绿 | `npm run test -- perception.test.ts` |
| 新增 pin 相关测试通过 | `npm run test -- perception.test.ts` |

---

## 七、与 ADR-164（Phase 2）的边界

| 项 | Phase 1（本 ADR） | Phase 2（ADR-164） |
|----|------------------|-------------------|
| 激活模型数 | 焦点 + pinned（上限由 ADR-164 tier 控制：high=全员、medium=焦点+pinned+前 10 个、low=仅焦点+pinned） | 全员 |
| 性能降级 | 不需要 | 三档（high/medium/low） |
| UI | pin 按钮 | 全员默认开关 |
| 性能基准 | 不需要 | 必须先做 |

---

## 八、开放问题

1. **Pinned 模型的感知参数是否独立？** 当前设计是独立（per-context state），但 UI 编辑 pinned 模型参数需切换"编辑对象"。可考虑「继承焦点参数 + 个别覆盖」模式。
2. **Pinned 上限 5 是否合适？** 需实测性能后决定。若 5 模型 × 28 = 140 对象池消费无压力，可上调。
3. **AR 模式下 pin 行为？** AR 中通常仅 1 个模型，pin 意义不大，可隐藏 UI。
