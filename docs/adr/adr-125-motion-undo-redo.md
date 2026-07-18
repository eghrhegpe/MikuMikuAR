# ADR-125: 动作覆盖撤销/重做 — 模块层 `setParam` 历史栈

**日期**: 2026-07-17
> **状态**: 规划中
> **背景**: 模块层 `setParam` 每次调用直接烘焙到引擎，无撤销能力。用户调错参数或想回退到之前的状态时，只能手动恢复，体验差。
> **边界说明**: 本 ADR 是**参数级** `setParam` 历史栈（双向 undo/redo、per-model、上限 50）。另有 ADR-127 已落地**场景级**破坏性操作撤销（Memento 快照 + 单向撤销 toast、上限 5），二者互补、切勿混淆——本 ADR 管"调参回退"，ADR-127 管"破坏性操作兜底"。

---

## 一、问题

### 当前操作路径

```
拖动滑块 → setParam → 烘焙到引擎 → 无法回退
```

### 痛点

| 场景 | 问题 |
|------|------|
| 调错参数 | 滑过头了，不知道原先的值是多少 |
| 对比效果 | 想快速切换 A/B 两组参数看差异 |
| 误操作 | 不小心点了 disable，之前的参数配置丢了 |

---

## 二、方案

### 历史栈数据结构

```ts
interface MotionHistoryEntry {
    /** 时间戳（用于显示） */
    timestamp: number;
    /** 快照：所有模块的 enabled + params */
    snapshot: Record<string, {
        enabled: boolean;
        params: Record<string, ParamValue>;
    }>;
    /** 描述（自动生成，如 "身体姿态.tilt: 5 → 10"） */
    description: string;
}

/** per-model 历史状态：history + cursor（cursor 指向当前已应用的条目） */
interface ModelHistoryState {
    entries: MotionHistoryEntry[];
    /** 当前游标，指向已应用的条目。-1 表示处于初始快照（尚无操作） */
    cursor: number;
}

const _historyMap = new Map<string, ModelHistoryState>();
const MAX_HISTORY = 50;

function _getState(modelId: string): ModelHistoryState {
    let s = _historyMap.get(modelId);
    if (!s) {
        s = { entries: [], cursor: -1 };
        _historyMap.set(modelId, s);
    }
    return s;
}
```

### 拦截点

只在模块层 `setParam` 处记录历史，不拦截引擎级 `setBoneOverride`（高级骨骼覆盖走独立路径）：

```ts
// module-base.ts 中
setParam(name: string, value: ParamValue): void {
    const st = getModuleState(modelId, moduleId);
    const prev = st.params[name] ?? defaults[name];
    if (prev !== value) {
        _pushHistory(modelId, `${moduleId}.${name}: ${prev} → ${value}`);
    }
    setModuleParam(modelId, moduleId, name, value);
    // ...
}
```

### 撤销/重做

```ts
function undo(modelId: string): void {
    const { entries, cursor } = _getState(modelId);
    if (cursor < 0) return;               // 已在初始状态，无可撤销
    const entry = entries[cursor];
    const nextCursor = cursor - 1;
    // 如果退回到初始状态，应用默认值快照（entry[0].snapshot 的反向）
    if (nextCursor < 0) {
        _applyDefaultSnapshot(modelId);
    } else {
        _applySnapshot(modelId, entries[nextCursor].snapshot);
    }
    _getState(modelId).cursor = nextCursor;
}

function redo(modelId: string): void {
    const { entries, cursor } = _getState(modelId);
    if (cursor >= entries.length - 1) return;  // 已在最新，无可重做
    const nextCursor = cursor + 1;
    _applySnapshot(modelId, entries[nextCursor].snapshot);
    _getState(modelId).cursor = nextCursor;
}
```

### 快照应用

```ts
function _applySnapshot(modelId: string, snapshot: Record<string, { enabled: boolean; params: Record<string, ParamValue> }>): void {
    for (const [moduleId, state] of Object.entries(snapshot)) {
        const mod = createModule(moduleId, modelId);
        if (!mod) continue;
        mod.setState({ id: moduleId, ...state });
        if (state.enabled) {
            mod.enable();
        } else {
            mod.disable();
        }
    }
}

/** 恢复到所有模块的默认值（初始状态） */
function _applyDefaultSnapshot(modelId: string): void {
    for (const mod of getRegisteredModules()) {
        const inst = createModule(mod.id, modelId);
        if (!inst) continue;
        inst.setState({ id: mod.id, enabled: false, params: {} });
        inst.disable();
    }
}
```

### 历史写入

```ts
function _pushHistory(modelId: string, description: string): void {
    const state = _getState(modelId);
    // 构建当前全量快照
    const snapshot: MotionHistoryEntry['snapshot'] = {};
    for (const mod of getRegisteredModules()) {
        const ms = getModuleState(modelId, mod.id);
        snapshot[mod.id] = { enabled: ms.enabled, params: { ...ms.params } };
    }
    // 截断 redo 分支：cursor 之后的条目作废
    state.entries = state.entries.slice(0, state.cursor + 1);
    state.entries.push({ timestamp: Date.now(), snapshot, description });
    // 上限裁剪
    if (state.entries.length > MAX_HISTORY) {
        state.entries.splice(0, state.entries.length - MAX_HISTORY);
    }
    state.cursor = state.entries.length - 1;
}
```

### 合并策略

连续滑块拖动会产生大量历史条目（每帧 `onChange`）。合并策略：

| 策略 | 说明 |
|------|------|
| **时间窗口** | 500ms 内的连续 `setParam` 合并为一条 |
| **同参数** | 同一参数的连续变更只保留最终值 |
| **手动提交** | 滑块松开（`onPointerUp`）时才记录 |

推荐策略：**时间窗口 + 同参数合并**，兼顾细粒度与简洁性。

---

## 三、UI 设计

### 按钮位置

在 `motion-override-levels.ts` 的模块列表标题栏右侧：

```
┌─────────────────────────────────┐
│  动作覆盖              ↩ ↪  ⋮  │
├─────────────────────────────────┤
│  身体姿态               ˄  ⋮   │
│  骑行模型               ˄  ⋮   │
│  ...                           │
└─────────────────────────────────┘
```

| 按钮 | 快捷键 | 行为 |
|------|--------|------|
| ↩ (撤销) | Ctrl+Z | `undo(focusedModelId)` |
| ↪ (重做) | Ctrl+Shift+Z | `redo(focusedModelId)` |

### 禁用状态

- 无可撤销记录时 ↩ 灰色禁用
- 无可重做记录时 ↪ 灰色禁用

### 历史列表

长按撤销按钮展开历史列表，显示最近 10 条操作描述：

```
┌─────────────────────────┐
│  body-posture.tilt: 5→10│
│  riding-model.saddle..  │
│  position-offset.vert.. │
│  ...                    │
└─────────────────────────┘
```

点击条目直接跳转到该历史位置。

---

## 四、实施分期

| 阶段 | 内容 | 验收 |
|------|------|------|
| **P1** | 定义 `MotionHistoryEntry` + `ModelHistoryState` + `_historyMap` + `_pushHistory` | tsc 通过 + 单元测试覆盖 push→undo→redo 循环 |
| **P1** | `module-base.ts` `setParam` 中接入历史记录 | 滑块拖动产生历史条目 |
| **P1** | `undo()`/`redo()` 函数 + `_applySnapshot` | 撤销/重做正确恢复模块状态 |
| **P2** | UI 撤销/重做按钮 + 禁用状态 | 交互可用 |
| **P2** | 快捷键 Ctrl+Z / Ctrl+Shift+Z | 键盘操作 |
| **P3** | 历史列表弹窗 + 跳转 | 精细回退 |

---

## 五、风险与缓解

| 风险 | 缓解 |
|------|------|
| 历史栈内存爆炸（快速拖动滑块） | 时间窗口合并 + 上限 50 条 |
| 撤销后手动调参导致历史分叉 | 新操作清除 redo 栈（标准做法） |
| 快照中模块状态与引擎状态不一致 | 应用快照时全量烘焙，不尝试增量同步 |
| 多模型切换时历史栈混乱 | 历史栈按 `modelId` 隔离（`Map<modelId, ModelHistoryState>`） |