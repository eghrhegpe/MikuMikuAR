/**
 * UI 动效总开关（设置 → 动效 →「滑动动画」）。
 *
 * 单一写入口：同时写 CSS 变量 `--ui-animations`（供 `calc(... * var(--ui-animations))` 形式的规则消费）
 * 与根节点属性 `data-ui-animations`（供 app.css 里的全局降级规则命中）。
 *
 * 为什么关动画时用 0.01ms 而不是 0s / none：
 * 零时长不会生成过渡，`transitionend` 永不触发；SlideMenu 的 `transitioning` 锁依赖它释放，
 * 只剩 150/200ms 兜底定时器可走 —— 关动画反而更卡，且历史上有过卡死成 P0 的记录。
 * 与 app.css 的 `prefers-reduced-motion` 块同法（ADR-153 Phase 2）。
 */

/** 应用动效开关：`on === false` 时全站动画/过渡降为 0.01ms。 */
export function applyUiMotionDom(on: boolean): void {
    const root = document.documentElement;
    const enabled = on !== false;
    root.style.setProperty('--ui-animations', enabled ? '1' : '0');
    root.dataset.uiAnimations = enabled ? '1' : '0';
}
