// [doc:adr-229] 渲染层 DOM 契约单源（§9 契约统一）
// 零依赖叶子模块，禁止 import 任何其他模块。
// 三处同读一份，消除「测试猜渲染」漂移：
//   1. 渲染函数（ui-rows / ui-advanced-rows / ui-collapsible）产出 role/class 时引用
//   2. schema-snapshot.test.ts 生成快照时写入 nodes[].dom 字段（元测试断言一致性）
//   3. e2e schema-driven.spec.ts 从快照读取断言选择器（不再手写 KIND_SELECTOR_MAP）
// 若渲染层改 role/class 而未同步本文件 → CI「快照重生成 + git diff」门禁直接红。

/** MenuKind → 交互控件选择器（e2e 断言用；folder/custom/action 等无标准交互控件） */
export const KIND_CONTROL_SELECTOR: Record<string, string> = {
    slider: '[role="slider"]',
    colorSlider: '[role="slider"]',
    toggle: '[role="switch"], input[type="checkbox"]',
    modeSlider: '[role="listbox"]',
};

/** 渲染层 role 常量——产出 role 属性时引用，勿手写字符串（ADR-229 §9） */
export const ROLE = {
    slider: 'slider',
    switch: 'switch',
    listbox: 'listbox',
    button: 'button',
    dialog: 'dialog',
    status: 'status',
    alert: 'alert',
} as const;

/** aria 属性名常量（ARIA_ATTR.valuemin 等） */
export const ARIA_ATTR = {
    valuemin: 'aria-valuemin',
    valuemax: 'aria-valuemax',
    valuenow: 'aria-valuenow',
    checked: 'aria-checked',
    label: 'aria-label',
    labelledby: 'aria-labelledby',
    live: 'aria-live',
    atomic: 'aria-atomic',
} as const;

/** collapsible（folder）组件契约（ui-collapsible.ts 与 e2e 展开逻辑共用） */
export const COLLAPSIBLE = {
    wrapperClass: 'collapsible-wrapper',
    headerClass: 'collapsible-header',
    panelClass: 'collapsible-panel',
    openClass: 'open',
} as const;

/** 滑动条本体 class（slider / colorSlider / modeSlider 共用 .cs-bar） */
export const SLIDER_BAR_CLASS = 'cs-bar';
