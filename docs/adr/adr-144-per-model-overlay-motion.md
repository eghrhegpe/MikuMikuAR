# ADR-144: Per-model Overlay Motion（动作2 叠加层）

> **状态**: 实施中
> **日期**: 2026-07-19
> **依赖**: ADR-121（全局动作意图）、ADR-056（WASM Motion Layers）、ADR-129（场景级动作 UI）

## 背景与问题

`ModelMotionSlots.overlay`（`types.ts:126`）已在类型系统中定义，但从未实现 UI 和运行时逻辑。当前每个模型只能有一个基础动作（primary slot），无法实现：

1. **角色独舞叠加**：主模型跳全局动作，特定角色叠加额外动作层（如手势、表情强化）
2. **程序化情绪叠加**：程序化 idle/autodance 作为独立层叠加在已加载动作之上，而非替换
3. **动作混合预设**：「演唱会包」= 全局舞蹈 + 特定角色独舞叠加

### 用户场景

| 场景 | 当前行为 | 期望行为 |
|------|---------|---------|
| 全局跳舞 + 某角色加手势 | 不可能，只能 pin 独立动作替换 | overlay 层叠加手势 VMD |
| 已加载动作 + 程序化微动 | 程序化替换基础动作 | overlay 层叠加 idle 呼吸 |
| 多动作混合 | 需手动编辑 vmdLayers | overlay UI 一键管理 |

---

## 决策

### 数据模型扩展

```ts
// MotionSlotConfig 已有 overlay 字段，无需改类型
// 运行时 overlay 注入到 inst.vmdLayers，与 scene-level vmdLayers 共存

interface MotionSlotConfig {
    source: SlotSource;
    pinned?: SceneMotionIntent;
    procRole?: 'idle' | 'autodance' | 'gesture' | 'expression';
    status: 'compatible' | 'incompatible' | 'idle' | 'overridden';
    // overlay VMD 数据（运行时，不持久化到 pinned 快照）
    overlayData?: ArrayBuffer;
    overlayName?: string;
}
```

### 运行时注入

overlay 内容注入到 `inst.vmdLayers`，走已有的 VMD 图层混合管线（ADR-056）：

1. primary slot → `inst.vmdData`（基础动作）
2. overlay slot → `inst.vmdLayers` 中追加一个 weight=1.0 的图层
3. 程序化 overlay → 生成程序化 VMD 作为 overlay 图层

### UI 设计

模型详情页「动作」section 新增「叠加层」行：

```
已加载动作
  ├─ [基础动作名]                    → 点击切回
  ├─ [叠加层] [无/动作名] [权重]     → 点击管理
程序化动作
  ├─ 待机呼吸 / 自动舞蹈
```

叠加层子页：
- 选择叠加动作（浏览 VMD 库）
- 程序化叠加（idle/autodance 作为叠加层）
- 权重滑块
- 清除叠加

---

## 实施计划

### Phase 1：overlay slot 运行时注入
- `_ensureOverlayLayer(id, inst)` — 注入/更新 overlay 到 vmdLayers
- `_clearOverlayLayer(id, inst)` — 移除 overlay 图层

### Phase 2：模型详情页 overlay UI
- 新增「叠加层」行（section title + slideRow）
- overlay 子页：选择动作 / 程序化叠加 / 权重

### Phase 3：程序化 overlay 注入
- 程序化 idle/autodance 可选择作为 overlay 而非替换
- `_setProcOverlay(id, inst, role)` — 程序化 VMD 注入 overlay slot

---

## 验收标准

- [ ] overlay slot 有 UI 入口（模型详情页）
- [ ] overlay VMD 正确注入 vmdLayers 并参与混合
- [ ] overlay 权重可调
- [ ] 程序化 idle/autodance 可作为 overlay
- [ ] 清除 overlay 后 vmdLayers 恢复
- [ ] 场景序列化正确保存/恢复 overlay 状态
