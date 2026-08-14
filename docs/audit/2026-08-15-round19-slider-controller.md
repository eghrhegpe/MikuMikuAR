# Round19-1: DragSliderController 滑块控制器 — 审核结果

## 审核范围

| 项 | 内容 |
|----|------|
| 测试文件 | `frontend/src/core/__tests__/slider-controller.test.ts`（369 行，17 用例） |
| 被测源码 | `frontend/src/core/ui-slider-controller.ts`（178 行，DragSliderController 全类） |
| 参考 | ADR-140（统一滑块输入，行为变更记录 2026-07-19/07-28）、ADR-153（键盘 ↑↓ 让位菜单导航）、ADR-101（Disposable 监听模式） |
| 依赖分析 | `./dom`（`addDisposableListener`/`Disposable`，dom.ts:67-87）、`@/core/clamp`（`clamp01`，clamp.ts:14-16）——两者均为叶子/近叶子模块，无循环依赖 |
| 验证 | `cd frontend && npm run test -- src/core/__tests__/slider-controller.test.ts` → **17/17 通过**，无跳过（`it.skip/only/todo` 零命中）；`npm run check`（tsc 全量）耗时较长未单独跑，测试 + 源码审读已足够支撑本结论 |

**总体结论：⚠️ 有条件通过**

条件：① 修复 mousedown 重复进入时旧 document 监听未先 dispose 的泄漏/串扰缺陷（P2）；② 补 mousemove 拖拽主路径与 click 事件路径测试（P2）。其余为可后续消化的 P3/P4。

---

## 亮点

- **拖拽状态机清晰且自洽**：`mousedown(43-50) → mousemove(86-94) → mouseup(96-109)` 三态流转，`dragging` 标志区分「拖拽」与「单击跳转」（102-105），`dragRect` 快照在 mousedown 时固化，位移计算全程基于同一快照，避免布局抖动。`ui-slider-controller.ts:43-109`
- **dispose 双通道释放完整**：`bind()` 返回 Disposable 同时移除 el 级监听（64-66）与 document 级 `moveDisp/endDisp`（67-70），且 `onDragEnd` 在每次 mouseup 时主动 dispose document 监听（97-100）——正常路径无泄漏；类字段箭头函数保证 `removeEventListener` 引用匹配（76-77 注释）。`ui-slider-controller.ts:62-72, 96-109`
- **吸附/步进数学有守卫**：`snapToStep` 对 `snap` 与 `step` 均做 `Number.isFinite` + 正值守卫（167, 171），无效值直接透传原值；`setValueFromClientX` 先 `clamp01` 归一化再 clamp（120-122），键盘路径 clamp 到 `min/max`（140, 144）。`ui-slider-controller.ts:118-127, 165-177`
- **键盘行为与 ADR-140/153 严格对齐**：倍数优先级 `ctrl>shift>default`（131），`Home/End` 直达边界（146-153），值不变时不触发 `onChange/onDragEnd`（158-162），↑↓ 明确不 preventDefault 让位菜单遍历（135-136, 154-155）——决策落点与 ADR 行为变更记录逐条对应。
- **测试隔离卫生良好**：`mockRect` 集中封装 `getBoundingClientRect`（17-30），`afterEach vi.restoreAllMocks()`（39-41）每用例还原；无 `window` 替换（符合 ADR-219 教训）；dispose 对称性测试用 add/remove 计数配对断言（194-217），是泄漏检测的好范式。

---

## 风险表

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|--------|------|------|------|----------|
| 🔴 P1 | — | — | 无 | 无 |
| 🟠 P2 | `frontend/src/core/ui-slider-controller.ts` | 48-49 | `onMouseDown` 直接覆盖 `this.moveDisp/endDisp` 引用，未先 dispose 旧监听。若 mouseup 丢失（窗口外释放、Alt+Tab、右键菜单打断），document 级 mousemove/mouseup 监听永久滞留；下次 mousedown（尤其发生在**另一滑块**上）时，滞留监听仍挂在 document 上，会以旧 `dragRect` 触发旧控制器 `onDragMove/onDragEnd` → 跨滑块幽灵调值 + 监听累积泄漏 | mousedown 入口先 `this.moveDisp?.dispose(); this.endDisp?.dispose();` 再重建；或改为单一 document 级监听 + dragging 标志位，天然幂等 |
| 🟠 P2 | `frontend/src/core/__tests__/slider-controller.test.ts` | 240-280（及全文件） | **核心交互「拖拽」路径完全未测**：现有拖拽用例仅覆盖 mousedown→mouseup 单击分支（onDragEnd 内 click-jump），`mousemove`（dragging 标志置位、拖拽中连续 onChange、拖/点区分）与 `click` 事件（`onElClick` 跳转，79-84 行）零覆盖。头部注释（5-11）称 jsdom 无法测 mousemove，但 `dispatchMouse` 助手 236 行已把 mousemove/mouseup 路由到 `el.ownerDocument`，document 监听完全可触发——理由不成立 | 补 mousedown→mousemove→mouseup 序列：断言拖拽中连续 onChange、mouseup 后 onDragEnd 仅一次、`dragging` 语义（先 move 后 up 不触发 click-jump）；再补真实 `click` 事件分发断言 onElClick 跳转 |
| 🟡 P3 | `frontend/src/core/ui-slider-controller.ts` | 119 | `rect.width = 0`（元素隐藏/未布局）时 `(clientX-left)/0` → NaN，`clamp01(NaN)=NaN`，而 `clamped !== value` 恒真 → `onChange(NaN)` 污染状态（jsdom 默认宽度即 0，全靠测试 mock 掩盖） | `setValueFromClientX` 入口守卫 `if (!(rect.width > 0)) return;` |
| 🟡 P3 | `frontend/src/core/ui-slider-controller.ts` | 82 | `e.currentTarget as HTMLElement` 跳过 null 检查；监听器本就绑定在闭包 `el` 上，currentTarget 恒等于 el，断言不必要 | 直接使用闭包 `el`，或 `instanceof HTMLElement` 守卫 |
| 🟡 P3 | `frontend/src/core/__tests__/slider-controller.test.ts` | 328-350 | snap 测试注释与断言矛盾：341 行注释写「→ 无变化，不触发 onChange」，344 行却断言 `onChange` 被调且值为 0.25；347-349 第二场景仅注释无任何断言（死代码），用例名「吸附到 0.5」与实际期望 0.25 不符 | 修正注释/用例名；第二场景补 `not.toHaveBeenCalled()` 断言「值未变不触发」 |
| 🟡 P3 | `frontend/src/core/__tests__/slider-controller.test.ts` | 52-56 | `'setValue 可重复调用'` 无任何 `expect`，空跑用例，测不出 setValue 语义 | 断言 setValue 后键盘/拖拽结果反映新值，或删除该用例 |
| 🟡 P3 | `frontend/src/core/__tests__/slider-controller.test.ts` | 全文件 | ADR-153 关键回归点未锁定：无用例断言 ↑↓ **不**调值（冒泡给菜单）；ctrl 倍数在 step≥1 场景未测（仅测 step<1 的 ctrl 与 step≥1 的默认/shift）；mousedown 无 mouseup 泄漏路径无测试（与 P2 源码风险对应） | 补 ↑↓ no-op 用例（锁定 ADR-153 让位决策）、step≥1 × ctrl 用例、泄漏回归用例 |
| 🟢 P4 | `frontend/src/core/ui-slider-controller.ts` | 131 | 键盘倍数 100/10/1 魔法数值（ADR-140 已文档化，可接受） | 提取命名常量 `STEP_MULT_CTRL/SHIFT/DEFAULT` |
| 🟢 P4 | `frontend/src/core/ui-rows.ts:242`、`ui-advanced-rows.ts:106/279` | bind 调用点 | 消费者全部丢弃 `bind()` 返回的 Disposable，模块的 dispose 契约在生产链路从未执行（仅靠 GC + onDragEnd 自清理兜底） | 消费者持有 Disposable 并入行级 dispose 链；或控制器增加自动清理兜底 |
| 🟢 P4 | `frontend/src/core/__tests__/slider-controller.test.ts` | 3 | 运行命令 `npm run test -- -- src/...` 多一个 `--`，照抄会多传一个参数给 vitest | 改为 `npm run test -- src/...` |
| 🟢 P4 | `frontend/src/core/ui-slider-controller.ts` | 137-156 | PageUp/PageDown 大步进（WAI-ARIA 建议 10×step）未实现；如产品无此需求可忽略 | 按需补充或 ADR 注明排除 |

---

## 测试质量评价

**优点**：17 用例全绿、零跳过；断言大多指向**行为结果**（onChange/onDragEnd 的具体值）而非实现细节；dispose 对称性用例（194-217）是稀缺的高价值资源释放测试；边界 clamp（286-322）、Home/End 直达（86-102）、shift/ctrl 倍率（104-146）、防御性「达边界不触发」（148-161）覆盖扎实；`mockRect` 封装 + `afterEach` 还原使 jsdom 环境隔离干净，未触碰全局 `window`。

**主要缺口**：被测组件的**主交互**（mousemove 拖拽、click 跳转）零覆盖——测试实际只验证了「单击回退分支」而非「拖拽」本身，头部注释对 jsdom 能力的判断不准确（mousemove 路由到 document 即可触发）；一处注释与断言矛盾、一处空跑用例、ADR-153 让位决策无回归锁。总体：**基础设施与边界测试优秀，主路径覆盖不足，需补拖拽序列用例后达标**。

---

审核日期：2026-08-15
审核员：round19-slider-controller
