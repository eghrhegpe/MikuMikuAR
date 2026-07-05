# ADR-027: 菜单响应式系统 — 控件自更新 + Proxy 自动触发

> **状态**: 已实现 — Proxy 拦截 envState + 控件自更新机制 + scheduleRefresh 去抖
> **日期**: 2026-07-05
> **关联**: ADR-007(场景菜单设计)、ADR-022(预设治理)

---

## 0. 问题陈述

菜单控件数量增长到 120+ 后，原有的「状态 + 手动 reRender + reRenderCustom」模式暴露出严重的维护成本问题：

| 症状 | 具体表现 |
|------|---------|
| **改一个控件要改 3 处** | `renderCustom` 里创建控件 → 回调里调 `reRender()` → `reRenderCustom` 里用 querySelector 更新 DOM |
| **reRenderCustom 脆弱** | `container.querySelector('.cs-row:first-child')` 依赖 DOM 结构，改个 class 名就静默失效 |
| **全量重建代价高** | `reRender()` 重建整个面板 DOM，导致输入框焦点丢失、拖拽状态中断 |
| **显示不同步 bug 频发** | 忘了写 `reRenderCustom` 或 querySelector 选错元素，UI 显示与实际状态不一致 |

核心矛盾：**SlideMenu 是无状态的**（只管渲染和导航），状态全部放在外面（`envState`、`renderState` 等），状态变了菜单不会自动知道。

---

## 1. 决策：三层渐进式响应式

不搞一步到位的完整响应式框架（Vue/Svelte 式的依赖收集 + Proxy 自动 trigger），而是分三层渐进实施，每层独立可用、收益明确。

```
┌─────────────────────────────────────────────────────┐
│  L3 · Proxy 自动触发（已实现）                        │
│  状态变更 → Proxy拦截 → scheduleRefresh → updateControls │
│  覆盖: envState(reactive) + renderState/lightState(手动)  │
├─────────────────────────────────────────────────────┤
│  L2 · 标准控件 bind 自动更新（已实现）                 │
│  控件声明 bind() → updateControls 时自动拉值 → 更新 DOM  │
│  覆盖: addSliderRow / addToggleRow / addModeSlider /     │
│        addColorSliderRow / addPresetChip / headerToggle   │
├─────────────────────────────────────────────────────┤
│  L1 · 控件自更新机制（已实现）                        │
│  控件注册 update() → 菜单 updateControls() 统一调用      │
│  非标控件走 onUpdate 手写更新逻辑                        │
└─────────────────────────────────────────────────────┘
```

### 为什么不直接上完整响应式？

| 维度 | 完整响应式（Vue/Svelte 式） | 本方案（三层渐进） |
|------|--------------------------|------------------|
| 实施成本 | 高（Proxy + 依赖收集 + 触发链路） | 中（分三层，每层独立交付） |
| 调试透明性 | ⭐⭐ 隐式触发，需翻订阅列表 | ⭐⭐⭐⭐ 半显式，updateControls 可断点 |
| 收益/成本比 | 中（一次性投入大） | 高（L1+L2 已解决 80% 痛点） |

---

## 2. L1：控件自更新机制

### 核心思路

每个控件自带 `update()` 方法，注册到所属 SlideMenu 的控件注册表。状态变更时调 `updateControls()` 增量刷新，不重建 DOM。

### 实现

**SlideMenu 新增（[menu.ts](file:///c:/Users/zhujieling11/MikuMikuAR/frontend/src/menus/menu.ts)）：**

```typescript
// 渲染上下文栈 — 控件创建时自动注册到当前菜单
const _renderingStack: SlideMenu[] = [];
export function getCurrentRenderingMenu(): SlideMenu | null {
    return _renderingStack[_renderingStack.length - 1] ?? null;
}

class SlideMenu {
    private _controls: Array<{ update: () => void }> = [];

    registerControl(update: () => void): void {
        this._controls.push({ update });
    }

    updateControls(): void {
        for (const c of this._controls) c.update();
    }

    // buildPanel 调用 renderCustom 时压栈
    private async buildPanel(level: PopupLevel): Promise<void> {
        // ...
        _renderingStack.push(this);
        try {
            await level.renderCustom(list);
        } finally {
            _renderingStack.pop();
        }
    }
}
```

**控件函数新增 `opts` 参数（[ui-helpers.ts](file:///c:/Users/zhujieling11/MikuMikuAR/frontend/src/core/ui-helpers.ts)）：**

```typescript
interface ControlOptions<T = number | boolean | string> {
    bind?: () => T;              // L2: 声明取值方式，自动更新
    onUpdate?: (el: HTMLElement) => void;  // L1: 手写更新逻辑
}
```

### 非标控件的用法

当控件显示逻辑超出标准模式（如灯光列表需根据启用状态改透明度），走 `onUpdate`：

```typescript
addPresetChip(group, light.name, false, onClick, {
    onUpdate: (btn) => {
        btn.classList.toggle('active', currentRes === value);
        btn.style.opacity = light.enabled ? '1' : '0.5';
    }
});
```

---

## 3. L2：标准控件 bind 自动更新

### 核心思路

标准控件（toggle/slider/modeSlider/colorSlider/presetChip/headerToggle）的显示模式固定，只需声明「值从哪来」，控件内部自动处理取值 → 比较 → 更新 DOM。

### 实现

每个控件内部维护缓存值，`update()` 时重新调用 `bind()` 取最新值，有变化才更新 DOM：

```typescript
// addSliderRow 内部
if (opts?.bind) {
    let cachedValue = value;
    const update = (): void => {
        const newVal = Number(opts.bind!());
        if (newVal === cachedValue) return;  // 值未变化，跳过
        cachedValue = newVal;
        updateDisplay(newVal);  // 更新文本、fill、thumb
    };
    getCurrentRenderingMenu()?.registerControl(update);
}
```

### 支持 bind 的控件清单

| 控件 | bind 返回类型 | 自动更新的 DOM |
|------|-------------|--------------|
| `addSliderRow` | `number` | cs-value 文本 + cs-fill 宽度 + cs-thumb 位置 |
| `addToggleRow` | `boolean` | checkbox.checked + aria-checked |
| `addModeSlider` | `T` | cs-value 文本 + cs-fill/thumb 位置 |
| `addColorSliderRow` | `[r,g,b]` | 3 通道的 value/fill/thumb + swatch 背景色 |
| `addPresetChip` | — | 仅支持 onUpdate（active 状态由调用方控制） |
| `addCollapsible.headerToggle` | `boolean` | checkbox.checked |
| `slideRow.headerToggle` | `boolean` | checkbox.checked |

### 标准 vs 非标的分界

| 控件类型 | 占比 | 更新方式 |
|----------|------|---------|
| 标准控件（开/关、滑条、模式、颜色） | 80% | `bind` 自动 |
| 复合控件（灯光列表、预设芯片组、自定义布局） | 20% | `onUpdate` 手写 |

---

## 4. L3：Proxy 自动触发

### 核心思路

用 Proxy 拦截状态对象的 set 操作，任何属性赋值自动触发 `scheduleRefresh()`，通过 RAF 去抖通知所有打开的菜单调 `updateControls()`。

### 实现

**响应式核心（[reactivity.ts](file:///c:/Users/zhujieling11/MikuMikuAR/frontend/src/core/reactivity.ts)）：**

```typescript
// RAF 去抖 — 同帧内多次赋值只触发一次刷新
export function scheduleRefresh(): void {
    if (_refreshScheduled) return;
    _refreshScheduled = true;
    requestAnimationFrame(() => {
        _refreshScheduled = false;
        for (const fn of _subscribers) fn();
    });
}

// Proxy 包裹 — 拦截 set，深度代理嵌套对象
export function reactive<T extends object>(obj: T): T {
    return new Proxy(obj, {
        get(target, key, receiver) {
            const val = Reflect.get(target, key, receiver);
            if (val && typeof val === 'object' && !Array.isArray(val)
                && !(val instanceof Map) && !(val instanceof Set)) {
                return reactive(val);
            }
            return val;
        },
        set(target, key, value, receiver) {
            Reflect.set(target, key, value, receiver);
            scheduleRefresh();
            return true;
        },
    });
}
```

**SlideMenu 自动订阅（[menu.ts](file:///c:/Users/zhujieling11/MikuMikuAR/frontend/src/menus/menu.ts)）：**

```typescript
constructor(opts) {
    // ...
    this._unsubscribe = subscribe(() => this.updateControls());
}

dispose(): void {
    this._unsubscribe?.();
    // ...
}
```

### 响应式覆盖范围

```
envState.xxx = yyy        → Proxy set → scheduleRefresh → updateControls ✅
setEnvState({...})        → Object.assign(envState) → Proxy set → 同上 ✅
setRenderState({...})     → 手动 scheduleRefresh → updateControls ✅
setLightState({...})      → 手动 scheduleRefresh → updateControls ✅
其他状态（uiState 等）     → 不触发，需手动 updateControls
```

### 为什么 renderState/lightState 不用 Proxy？

`renderState` 不是直接导出的对象，而是通过 `getRenderState()` 从 Babylon.js pipeline 实时读取。`lightState` 同理，存储在模块私有变量中。对它们包 Proxy 需要重构整个读写链路，ROI 不划算。在 `setRenderState`/`setLightState` 入口手动调 `scheduleRefresh()` 即可。

---

## 5. 保留 reRender 的场景

`reRender()`（全量重建 DOM）并未被废弃，以下场景仍然需要：

| 场景 | 例子 |
|------|------|
| **DOM 结构变化** | 天空模式切换（procedural→color 改变子控件集合） |
| **增删行** | 灯光列表添加/删除、材质映射增删、外部库增删 |
| **条件渲染** | `if (state.shadowEnabled)` 分支切换 |
| **跨层级影响** | `refreshMotionRoot()`（根级 items 重建） |

**判断规则**：如果状态变化导致 DOM 结构增减 → `reRender()`；如果只是值变化 → `updateControls()`。

---

## 6. 迁移成果

### 代码删除

| 删除项 | 数量 |
|--------|------|
| `reRenderCustom` 业务代码 | ~300 行 |
| 手动 `updateControls()` 调用 | 46 处 |
| **合计** | **~346 行** |

### 新增控件维护点对比

| 指标 | 改造前 | 改造后 |
|------|--------|--------|
| 新增控件需改几处 | 3 处（创建 + 回调 reRender + reRenderCustom） | 1 处（创建时加 bind） |
| 显示不同步 bug 风险 | 高（querySelector 脆弱） | 低（控件自管） |
| 响应式状态赋值后需手动调 | 是 | 否（Proxy 自动） |

### 构建验证

`vite build` 460 modules, 1.48s — 零错误。

---

## 7. 设计决策记录

### D1: 为什么用渲染上下文栈而不是传参？

**考虑过**：给每个控件函数加 `menu` 参数。
**否决原因**：调用方啰嗦（每处都要传 `menu`），且 `renderCustom` 内拿不到 menu 实例（得通过闭包从外面传）。
**最终方案**：全局栈，`buildPanel` 调 `renderCustom` 前 push，结束后 pop。调用方完全不用改。

### D2: 为什么 updateControls 用遍历而不是事件总线？

**考虑过**：控件订阅特定状态路径（如 `envState.skyMode`），只有对应路径变化才更新。
**否决原因**：需要依赖收集系统，实现成本高，且调试时难以追踪「谁订阅了这个状态」。
**最终方案**：`updateControls()` 遍历所有控件，每个控件内部用缓存值比较决定是否更新。120 个控件的遍历成本可忽略（< 1ms）。

### D3: 为什么 envState 用 Proxy 而其他状态不用？

见 §4 末尾。envState 是直接导出的对象，包 Proxy 零成本。renderState/lightState 是函数式读写，包 Proxy 需重构链路。

### D4: 为什么保留 reRender 而不全部用 updateControls？

`updateControls()` 只更新已注册控件的显示值，不能增删 DOM 元素。结构变化（如模式切换导致子控件集合改变）必须全量重建。

---

## 8. 后续扩展

| 方向 | 做法 | 优先级 |
|------|------|--------|
| uiState 响应式 | `uiState` 也用 `reactive()` 包裹 | 中（settings 菜单仍有 10 处手动 updateControls） |
| procMotionState/lipSyncState 响应式 | 改为 reactive 对象 | 低（仅 4 处手动调用） |
| modelManager 响应式 | 在 `setModelVisibility` 等函数中调 `scheduleRefresh()` | 低（仅 1 处手动调用） |
| bind 支持数组/对象深比较 | 用于 Map 等复杂状态 | 低（当前无需求） |
