# ADR-140: DragSliderController 统一滑块输入

- **状态**: 立项
- **日期**: 2026-07-19
- **相关**: ADR-093（菜单声明式 Schema）、ADR-096（通用 Helper 收敛）

## 背景与问题

滑块「游标拖拽 + 键盘 + mousedown 拖拽」逻辑在 3~4 个文件中重复实现，语义已漂移：

| 文件 | 函数 | 键盘步进 | 拖拽逻辑 | shift/ctrl 支持 |
|------|------|---------|---------|---------------|
| `core/ui-advanced-rows.ts:78-167` | `addColorSliderRow` | `delta=0.01/0.1`（**忽略 step**，硬编码） | `setValueFromClientX` | **不支持** shift/ctrl |
| `core/ui-advanced-rows.ts:266-432` | `addVector3SliderRow` | 同上 | 同上 | 同上 |
| `core/ui-advanced-rows.ts:551-657` | `addModeSlider` | `quarter/1`（四分位，硬编码） | 复制 addSliderRow | 支持 shift（切四分位） |

问题：
1. 键盘步进不统一（有的忽略 step，有的硬编码 0.01/0.1/四分位）
2. shift/ctrl 倍数支持不一致（`addSliderRow` 支持，其他不支持）
3. 拖拽逻辑复制，行为不一致（didDrag/dragRect/moveDisp/endDisp 各自实现；方法名有 `setIndexFromClientX` 和 `setValueFromClientX` 两种语义）
4. 无法一处审核竞态/一致性

## 决策

抽取 `DragSliderController` 类，参数化 min/max/step/snap/axis/onChange/onDragEnd，四个 builder 退化为此控制器的特例配置。

```typescript
interface DragSliderOptions {
    value: number;
    min: number;
    max: number;
    step: number;
    /** 吸附步数；若设 snap=0.05，则值域对齐到 0.05 的整数倍（Math.round(v/snap)*snap） */
    snap?: number;
    axis?: 'x' | 'y';
    onChange?: (value: number) => void;
    onDragEnd?: (value: number) => void;
}

class DragSliderController {
    constructor(opts: DragSliderOptions) {}
    /** 绑定 DOM 并注册事件，返回 Disposable */
    bind(el: HTMLElement): Disposable { ... }
    /** 动态更新当前值（builder 重建或外部重置时调用） */
    setValue(v: number): void { ... }
    // 内部统一处理：mousedown→mousemove→mouseup / 键盘方向键 / 游标点击
}
```

## 方案设计

### 1. ui-slider-controller.ts（新建）

```typescript
export class DragSliderController {
    private dragging = false;
    private startX = 0;
    private startValue = 0;

    constructor(private opts: DragSliderOptions) {}

    /** 动态更新当前值（builder 重建或外部重置时调用） */
    setValue(v: number): void {
        this.opts.value = v;
    }

    bind(el: HTMLElement): Disposable {
        const onMouseDown = (e: MouseEvent) => { ... };
        const onKeyDown = (e: KeyboardEvent) => { ... };
        el.addEventListener('mousedown', onMouseDown);
        el.addEventListener('keydown', onKeyDown);
        return {
            dispose: () => {
                el.removeEventListener('mousedown', onMouseDown);
                el.removeEventListener('keydown', onKeyDown);
            }
        };
    }

    /** 统一拖拽计算：基于 el.getBoundingClientRect() 将 clientX 映射为 value */
    private setValueFromClientX(clientX: number, el: HTMLElement): void { ... }
    private handleKeyDown(e: KeyboardEvent): void { ... }
}
```

> **Disposable 来源**：`@babylonjs/core` 的 `IDisposable` 接口，等价于 `{ dispose(): void }`。

### 2. 迁移策略

- `addSliderRow` → `new DragSliderController({ value, min, max, step, onChange })`
- `addColorSliderRow` → 同上（step 从 opts 读取，不再硬编码 0.01/0.1）
- `addVector3SliderRow` → 同上（每轴一个 controller 实例）
- `addModeSlider` → 同上（step/snap 从 opts 读取，不再硬编码 quarter/1）

### 3. 统一行为

- 键盘步进：`step`（默认）/ `step * 10`（shift）/ `step * 100`（ctrl）
- 拖拽：统一基于 `el.getBoundingClientRect()` 的 `setValueFromClientX` 计算（不再区分 index/value 两条路径）
- 步进：统一从 `opts.step` 派生，不再硬编码

## 影响面

- **代码**: `core/ui-rows.ts`、`core/ui-advanced-rows.ts`
- **行为**: 滑块行为统一（拖拽/键盘/步进）
- **测试**: 4 个 builder 单测覆盖

## 风险与缓解

| 风险 | 等级 | 缓解 |
|------|------|------|
| 行为漂移导致用户感知变化 | 🟡 中 | 对比测试 + 目检 |
| 迁移遗漏导致旧逻辑残留 | 🟢 低 | 删除旧代码，统一走 controller |

## 分阶段实施

- **阶段 0（本 ADR）**: 立项
- **阶段 1**: 新建 `core/ui-slider-controller.ts`，完成基础功能 + 基础单元测试
- **阶段 2**: 迁移 `addSliderRow` + `addColorSliderRow`，旧函数标记 `@deprecated`（保留兼容，输出 console.warn 引导迁移）
- **阶段 3**: 迁移 `addVector3SliderRow` + `addModeSlider`，旧函数标记 `@deprecated`
- **阶段 4**: 删除旧实现代码，全量回归测试（`npm run test` + 人工目检）

## 验收标准

- 4 个 builder 行为一致（拖拽/键盘/步进）
- 单测覆盖 4 个 builder
- `npm run test` 全绿
