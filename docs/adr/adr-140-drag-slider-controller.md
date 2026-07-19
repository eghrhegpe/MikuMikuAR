# ADR-140: DragSliderController 统一滑块输入

- **状态**: 完成（已实施）
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

- **阶段 0（本 ADR）**: 立项 ✅
- **阶段 1**: 新建 `core/ui-slider-controller.ts`，完成基础功能 + 基础单元测试 ✅
- **阶段 2**: 迁移 `addSliderRow` + `addColorSliderRow` 到 DragSliderController ✅（builders 保留为稳定公共 API，未标记 `@deprecated`；详见「决策修正」）
- **阶段 3**: 迁移 `addVector3SliderRow` + `addModeSlider` 到 DragSliderController ✅
- **阶段 4**: 全量回归测试（`npm run test` 全绿 + `tsc --noEmit` 通过）+ 行为变更目检 ✅

## 验收标准

- 4 个 builder 行为一致（拖拽/键盘/步进）
- 单测覆盖 4 个 builder
- `npm run test` 全绿

## 行为变更记录（实施于 2026-07-19）

> 4 个 builder 现均为 `DragSliderController` 的薄封装，拖拽 / 键盘 / 游标点击逻辑完全统一。
> 以下为与原实现的可见行为差异，属风险表「🟡 中」项，需人工目检确认。

| Builder | 变更 | 影响 |
|---------|------|------|
| `addSliderRow` | 移除独有的 `row` 四分位 click 步进（点击 label / 空白区不再微调）；现由控制器驱动，获得 bar 拖拽能力 | 点击行非 bar 区域不再生效（其他 builder 本无此行为，故属归一） |
| `addModeSlider` | 键盘 `shift` 由「四分位跳 `floor(total/4)`」改为「`step*10` = 跳 10 个索引」；纯点击（mousedown→mouseup 无移动）由「循环微移」改为「绝对跳转到点击位置」；内部以 `value=currentIndex, min=0, max=total-1, step=1` 映射 | 多选项模式下 shift / 点击语义更规整，但与旧版不同，需目检 |
| `addColorSliderRow` / `addVector3SliderRow` | 行为基本一致（step 派生、拖拽 / 键盘 / 点击统一）；控制器新增 `ctrl` 步进（×100）作为增强 | 无破坏，仅新增能力 |
| 全部 builder | 初始化不再触发用户 `onChange`（与原实现一致，避免误触发） | 无 |

## 决策修正（关于「标记 @deprecated」）

原阶段 2 / 3 写「旧函数标记 `@deprecated`」。实施中修正为：**4 个 builder 是稳定公共 UI API（被约 20 个菜单文件调用），应保留并作为 `DragSliderController` 的薄封装，而非废弃**。真正消除的是各 builder 内部重复的拖拽 / 键盘 / 吸附逻辑——已通过迁移到统一控制器完成。因此不对 builder 标记 `@deprecated`，只在其 doc 注释中标注「由 DragSliderController 驱动」。
