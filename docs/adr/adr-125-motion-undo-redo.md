# ADR-125: 动作覆盖撤销/重做 — 模块层 `setParam` 历史栈

**日期**: 2026-07-17
> **状态**: 规划中
> **背景**: 模块层 `setParam` 每次调用直接烘焙到引擎，无撤销能力。用户调错参数或想回退到之前的状态时，只能手动恢复，体验差。

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

const _history: MotionHistoryEntry[] = [];
let _historyIndex = -1; // -1 = 初始状态
const MAX_HISTORY = 50;
```

### 拦截点

只在模块层 `setParam` 处记录历史，不拦截引擎级 `setBoneOverride`（高级骨骼覆盖走独立路径）：

```ts
// module-base.ts 中
setParam(name: string, value: ParamValue): void {
    // 记录当前快照到历史栈（仅在值变化时）
    const prev = getModuleState(modelId, moduleId).params[name];
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
    if (_historyIndex < 0) return;
    const entry = _history[_historyIndex];
    _historyIndex--;
    _applySnapshot(modelId, entry.snapshot);
}

function redo(modelId: string): void {
    if (_historyIndex >= _history.length - 1) return;
    _historyIndex++;
    const entry = _history[_historyIndex];
    _applySnapshot(modelId, entry.snapshot);
}
```

### 快照应用

```ts
function _applySnapshot(modelId: string, snapshot: Record<string, {...}>): void {
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
| **P1** | 定义 `MotionHistoryEntry` + `_history` 栈 + `_pushHistory` | tsc 通过 |
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
| 多模型切换时历史栈混乱 | 历史栈按 `modelId` 隔离（`Map<modelId, MotionHistoryEntry[]>`） |