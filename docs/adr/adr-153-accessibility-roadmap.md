# ADR-153: 无障碍（a11y）支持总体方案

- **状态**: ✅ Phase 1 已实施（2026-07-21）— 焦点环恢复（`:focus-visible`）、toast/状态栏 `aria-live`、`ui-focus-trap.ts` focus trap + restore、canvas ARIA 全部落地；Phase 2/3 待推进
- **日期**: 2026-07-20
- **相关**: ADR-017（Android 适配，A2-02 返回键待实施）、ADR-036（快捷键注册表）、ADR-059（i18n 框架）、ADR-060（E2E 测试策略）、ADR-140（DragSliderController 统一方向键步进）

---

## 背景与问题

用户反馈："无障碍的支持情况如何，刚修好安卓的四区分段，需要看看其他操作的缺失情况。"

项目无 a11y 架构，所有可访问性代码都随业务零散写入。最近修复的 ADR-140 `DragSliderController` 把 4 个 builder 的方向键步进统一到一处，是滑块键盘导航层面的收敛，但更广的 a11y 维度（焦点环、屏幕阅读器、focus trap、3D 场景语义、高对比度）存在系统性缺口。

调研覆盖 10 个维度（详见"现状速览"），核心结论：

- **亮点已有**：菜单四方向导航、滑块/开关完整 ARIA、模态对话框 `role="dialog"`、底部导航按钮 `aria-controls/expanded`、shortcut-registry Arrow 冲突规避、`<html lang>` 同步
- **系统性缺失**：`app.css` 主动 `outline: none` 移除焦点环、无 `aria-live` / `role="status"`、对话框无 focus trap/restore、canvas 无 ARIA、无 `prefers-contrast/reduced-motion/color-scheme` 适配、i18n 无 a11y 命名空间、E2E 无 axe 扫描

本 ADR 给出分批实施路线图，避免一次性大改引入回归风险。

## 现状速览

### 已实现亮点（可作扩展基础）

| 维度 | 实现 | 文件:行号 |
|------|------|-----------|
| 菜单四方向导航 + Enter + ← 返回 | `menu.ts` focusIndex 状态机 | `frontend/src/menus/menu.ts:113-137, 544-594` |
| 滑块完整 ARIA | `role="slider"` + valuemin/max/now/labelledby | `frontend/src/core/ui-rows.ts:199-221`、`ui-advanced-rows.ts:62-66, 221-226, 334-337` |
| 开关 role=switch | `aria-checked` 双向同步 | `frontend/src/core/ui-rows.ts:64-98` |
| 模态对话框 | `role="dialog"` + `aria-modal="true"` + Escape | `frontend/src/core/dialog.ts:42, 124-137` |
| 底部导航按钮 | `aria-label` + `aria-controls` + `aria-expanded` | `frontend/index.html:73-98`、`events.ts:82-84` |
| DragSliderController 统一方向键 | ADR-140 | `frontend/src/core/ui-slider-controller.ts:52-60` |
| shortcut-registry Arrow 规避 | ADR-036 | `frontend/src/core/shortcut-registry.ts:267-269` |
| AR 视频元素隐藏 | `aria-hidden="true"` | `frontend/src/scene/ar/ar-camera.ts:79` |
| `<html lang>` 同步 | i18n a11y 基础 | `frontend/src/core/i18n/locale.ts:59-71` |
| 快捷键 UI 可视化 | Ctrl 按下显示徽标 | `frontend/src/core/events.ts:201-211` |

### 系统性缺口

| 优先级 | 缺口 | 证据 | 影响 |
|--------|------|------|------|
| 🔴 P1 | `app.css` 全局 `outline: none` 移除焦点环且无替代 | `app.css:257, 1105, 1189, 2422-2423, 2765, 3094` | 键盘用户看不到焦点位置 |
| 🔴 P1 | 无 `aria-live` / `role="status"` / `role="alert"` | 全仓 0 匹配 | toast / 状态栏 / 加载完成屏幕阅读器无感知 |
| 🔴 P1 | 对话框/全屏覆盖层无 focus trap | `dialog.ts:42-154`、`ui-fullscreen-overlay.ts:43-86` | Tab 跳到背后菜单 |
| 🔴 P1 | 关闭弹窗无 focus restore | `dialog.ts:105-110`、`menu.ts` 无 restore | 焦点丢到 `<body>` |
| 🟠 P2 | `canvas#renderCanvas` 无 ARIA | `index.html:64` | 3D 场景对屏幕阅读器完全不可见 |
| 🟠 P2 | 无 `prefers-contrast` / `prefers-reduced-motion` / `prefers-color-scheme` | `app.css` 0 匹配 | 不跟随系统 a11y 设置 |
| 🟠 P2 | Android 返回键与 MenuStack 冲突 | `adr-017-android-adaptation.md:138`（A2-02 待实施） | 关闭面板时直接退出 App |
| 🟠 P2 | 3D 模型无 alt / `aria-description` | `model-detail.ts` 0 ARIA | 屏幕阅读器无法描述模型 |
| 🟡 P3 | i18n 无 `a11y.*` 命名空间 | `i18n/locales/*.ts` 0 a11y key | 无法对控件做 `aria-describedby` 国际化 |
| 🟡 P3 | E2E 无 axe-core 扫描 | `frontend/e2e/` 0 axe 引用 | a11y 回归无自动化保障 |
| 🟡 P3 | 快捷键无 `aria-keyshortcuts` | `shortcut-registry.ts` 无此属性 | 屏幕阅读器不播报快捷键 |
| 🟢 P4 | 三处方向键导航逻辑互相独立 | `menu.ts` / `ui-fullscreen-overlay.ts` / `ui-advanced-rows.ts` | 维护成本漂移 |
| 🟢 P4 | Wails Go 端无系统主题/高对比度桥接 | `internal/` 0 a11y 配置 | 桌面端不跟随系统 a11y |
| 🟢 P4 | Space 键激活未明确支持 | 仅依赖原生 button | Space 在某些自定义控件可能不触发 |

## 决策

### 核心原则

1. **零业务侵入**：a11y 增强通过 CSS 全局规则、UI builder 增强、i18n key 扩展三种方式落地，禁止改写业务函数签名
2. **复用现有 ARIA 模式**：滑块/开关的 ARIA 模式已成熟，新控件沿用同套范式
3. **不引入重型框架**：不引入 `@axe-core/playwright` 之外的 a11y 运行时库（如 `aria-live-poller`），保持零运行时依赖
4. **分批推进**：按 P1 止血 → P2 关键缺口 → P3 长期建设 三阶段，每阶段独立可交付、可回退
5. **不降级现有交互**：恢复焦点环不破坏现有视觉，仅在 `:focus-visible` 触发；高对比度模式独立 CSS 块，不污染默认主题
6. **不重复造 accessible name**：WCAG 的 [Accessible Name and Description](https://www.w3.org/TR/accname-1.1/) 计算规则会自动取按钮可见文字、`aria-labelledby`、`aria-label`、`title` 依次回退。**只在「无可见文字控件」（图标按钮、canvas 等）才补 aria-label**，文字按钮复用现有 label 即可，避免「同一控件两个 accessible name」语义冲突
7. **i18n 沿用现有 key**：不新建 `a11y.*` 命名空间。toast / 状态栏的播报文本就是现有 i18n 文本，加 `role="status"` + `aria-live` 让屏幕阅读器读取即可；关闭/删除等图标按钮的 aria-label 复用现有 `common.close` / `common.delete` 类 key，缺失时再就近补

### Phase 1：P1 止血（一次性提交）

**目标**：恢复键盘用户基础感知能力。改动面最小、收益最大。

#### 1.1 恢复焦点视觉指示

[app.css](../../frontend/src/app.css) 现有 6 处 `outline: none` 替换为：

```css
:focus { outline: none; }
:focus-visible {
    outline: calc(2px * var(--ui-scale)) solid var(--accent);
    outline-offset: calc(1px * var(--ui-scale));
}
```

`outline: none` 仅在 `:focus`（鼠标点击）时生效，`:focus-visible`（键盘聚焦）显示焦点环。复用现有 `--accent` 与 `--ui-scale` CSS 变量，与 `.slide-focused` 视觉一致。

#### 1.2 toast / 状态栏接入 aria-live

- [toast.ts](../../frontend/src/core/toast.ts) 容器加 `role="status"` + `aria-live="polite"` + `aria-atomic="true"`
- [status-bar.ts](../../frontend/src/core/status-bar.ts) 主文本节点加 `role="status"` + `aria-live="polite"`
- 加载完成、错误提示等急切消息用 `role="alert"` + `aria-live="assertive"`（仅在错误 toast 路径）

#### 1.3 对话框 focus trap + restore

[dialog.ts](../../frontend/src/core/dialog.ts) 扩展：

```typescript
// 打开时记录触发元素
let previousFocus: HTMLElement | null = null;
function openDialog(...) {
    previousFocus = document.activeElement as HTMLElement;
    // ... 现有逻辑
    // trap: Tab 在 dialog 内循环
    container.addEventListener('keydown', trapFocus);
}
function closeDialog() {
    container.removeEventListener('keydown', trapFocus);
    previousFocus?.focus();
    previousFocus = null;
}
function trapFocus(e: KeyboardEvent) {
    if (e.key !== 'Tab') return;
    const focusable = container.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
    }
}
```

[ui-fullscreen-overlay.ts](../../frontend/src/core/ui-fullscreen-overlay.ts) 同样接入（复用同套 trapFocus helper）。

抽出 `core/ui-focus-trap.ts`（≤80 行）避免 dialog/overlay 重复实现。

#### 1.4 canvas 基础 ARIA

[index.html:64](../../frontend/index.html) 给 `renderCanvas` 加 `role="img"` + `tabindex="0"`，`aria-label` 在场景模块加载/卸载模型时动态更新（拼接模型名，模型名本身已是业务数据，不需要 i18n key 包裹）。初始态沿用现有 `menu.canvasLabel` 类 key（若不存在，按核心原则 7 就近补一个，不引入 `a11y.*` 命名空间）：

```typescript
// 加载模型时
renderCanvas.setAttribute('aria-label', `${t('menu.canvasLabel')}：${model.name}`);
// 卸载时
renderCanvas.setAttribute('aria-label', t('menu.canvasLabel'));
```

`tabindex="0"` 允许键盘用户聚焦画布触发 freefly 快捷键。

#### Phase 1 验收标准

- [ ] Tab 在对话框内循环不跳出
- [ ] 关闭对话框后焦点回到触发按钮
- [ ] toast 出现时 NVDA / Narrator 能朗读
- [ ] 键盘 Tab 到任意按钮可见 2px accent 焦点环
- [ ] canvas 可被 Tab 聚焦，aria-label 描述当前场景
- [ ] `tsc --noEmit` 0 错误
- [ ] `frontend && npm run test` 全绿
- [ ] 现有 E2E 不回归

### Phase 2：P2 关键缺口

#### 2.1 系统偏好媒体查询

[app.css](../../frontend/src/app.css) 末尾追加三个媒体块：

```css
@media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
        animation-duration: 0.01ms !important;
        transition-duration: 0.01ms !important;
    }
    /* 关闭 Babylon.js 之外的 CSS 动画（slide-in / fade） */
}

@media (prefers-contrast: more) {
    :root {
        --accent: #ffff00;
        --bg-panel: #000000;
        --text-primary: #ffffff;
    }
    .slide-item { border: 1px solid var(--text-primary); }
}

@media (prefers-color-scheme: dark) {
    /* 仅在用户未自定义主题时生效（通过 :root[data-theme="auto"] 守卫） */
}
```

`prefers-color-scheme` 仅做兜底，主题系统（`settings-appearance.ts`）扩展一个 "auto" 选项，落盘到 `settings.theme = 'auto' | 'light' | 'dark' | custom`。

#### 2.2 Android 返回键拦截

实施 ADR-017 A2-02：在 `events.ts` 注册 `popstate` / `backbutton` 监听，按 MenuStack 深度逐层关闭，最外层才退出 App。Wails Go 端通过 `runtime.OnBackPress`（Android）转 JS 事件。

#### 2.3 3D 场景键盘轨道控制

[events.ts](../../frontend/src/core/events.ts) 扩展：canvas 聚焦时启用 Arrow 键轨道控制（与 freefly WASD 并存）：

| 键 | 行为 |
|----|------|
| ←/→ | 相机 yaw ±5° |
| ↑/↓ | 相机 pitch ±5° |
| + / - | 缩放 ±10% |
| Shift+方向键 | 步长 ×3 |

shortcut-registry 增加守卫：canvas 聚焦时 Arrow 不触发全局快捷键。

#### 2.4 模型 alt text

[model-detail.ts](../../frontend/src/menus/model-detail.ts) 在加载模型时设置 `renderCanvas.setAttribute('aria-label', t('a11y.canvasWithModel', { name: model.name }))`；卸载模型时回退到 `t('a11y.canvasEmpty')`。

#### Phase 2 验收标准

- [ ] 系统开启"减少动态效果"后 CSS 过渡近乎瞬时
- [ ] 系统开启高对比度后界面文字清晰可读
- [ ] Android 按返回键先关闭面板，不直接退出
- [ ] canvas 聚焦后方向键可旋转相机
- [ ] 加载模型后 aria-label 包含模型名
- [ ] `tsc --noEmit` 0 错误，E2E 全绿

### Phase 3：P3 长期建设

#### 3.1 图标按钮 accessible name 补全（不新建 a11y.* 命名空间）

项目里实际缺 accessible name 的控件**仅 3 处纯图标 `✕` 按钮**，复用现有 i18n key 即可，不引入 `a11y.*` 命名空间：

| 文件:行号 | 现状 | 复用 key（若已有）或就近补 |
|-----------|------|---------------------------|
| `core/toast.ts:150` | `closeBtn.textContent = '✕'` 无 aria-label | `common.close`（若缺则在该 key 同分组补 5 语种） |
| `core/ui-fullscreen-overlay.ts:184` | `closeBtn.textContent = '✕'` 无 aria-label | 同上 `common.close` |
| `menus/preset-list-viewer.ts:112` | `delBtn.textContent = '✕'` 无 aria-label | `common.delete`（若缺则同上补） |

**禁止给以下控件加 aria-label**（已有 accessible name，重复设置会语义冲突）：
- 滑块 `bar` — 已有 `aria-label` + `aria-labelledby`（`ui-rows.ts:201` / `ui-advanced-rows.ts:62,221,334`）
- 开关 `toggle` — 已有 `aria-label` + `aria-labelledby`（`ui-rows.ts:65,67`）
- 底部导航按钮 — 已有 `aria-label`（`index.html:73-98`）
- dialog 取消/确认按钮 — 有可见文字填充（`dialog.ts:47-48`，文字来自现有 i18n）
- 所有菜单 `.slide-item` — 有可见 label 文字，屏幕阅读器自动读
- toast / 状态栏文本本身 — 加 `role="status"` + `aria-live` 让屏幕阅读器读现有 i18n 文本即可，**不需要**「toastError」「toastInfo」这类包裹 key

**唯一需要就近补的 i18n key**（最多 2 个：`common.close` / `common.delete`），按 ADR-059 i18n 框架的 5 语种同步规范补充。

#### 3.2 快捷键 aria-keyshortcuts

[shortcut-registry.ts](../../frontend/src/core/shortcut-registry.ts) 注册时同步设置元素 `aria-keyshortcuts`：

```typescript
button.setAttribute('aria-keyshortcuts', 'Control+1');
```

5 语种 `shortcuts.label.*` 已有，复用即可。

#### 3.3 E2E a11y 扫描

[frontend/e2e/](../../frontend/e2e) 引入 `@axe-core/playwright`：

```typescript
import AxeBuilder from '@axe-core/playwright';
// smoke.spec.ts 末尾
const results = await new AxeBuilder({ page }).analyze();
expect(results.violations).toEqual([]);
```

首批只扫描 `critical` / `serious` 级别，避免历史警告阻塞 CI。

#### 3.4 三处方向键导航抽公共工具

`core/ui-keyboard-nav.ts` 提供 `createArrowNavigator(opts)`，menu / fullscreen-overlay / mode-slider 三处改为调用同套实现。

#### 3.5 Wails Go 端系统主题桥接

`internal/app/` 新增 `system_a11y.go`（Windows: 监听 `WM_SETTINGCHANGE` 的高对比度消息；macOS/Linux 后续）：通过 `runtime.EventsEmit` 推送 `system:a11y-change` 事件，前端订阅后切换 CSS 媒体查询手动模式。

#### Phase 3 验收标准

- [ ] `npm run test:e2e` 包含 a11y 扫描，无 critical 违规
- [ ] 所有快捷键按钮有 `aria-keyshortcuts`
- [ ] 3 处 `✕` 按钮有 `aria-label`（复用 `common.close` / `common.delete`）
- [ ] 三处方向键导航共用同一工具
- [ ] Windows 高对比度切换时应用主题跟随

## 风险与回退

| 风险 | 缓解 |
|------|------|
| `:focus-visible` 在 WebView2 旧版本支持不全 | WebView2 已基于 Chromium 90+，`:focus-visible` 自 Chromium 80 起原生支持，无风险 |
| focus trap 误拦截非 Tab 操作 | 仅监听 Tab/Shift+Tab，其他键透传 |
| `prefers-reduced-motion` 关闭 CSS 动画影响视觉一致性 | 仅影响过渡时长，不影响布局；用户主动开启此选项即预期降级 |
| Android 返回键拦截误吞系统返回 | 仅在 MenuStack 非空时拦截，最外层透传 |
| axe-core 扫描结果包含历史违规阻塞 CI | Phase 3.3 首批仅扫描 critical/serious，warning/caution 不阻塞 |
| 主题 `auto` 模式与用户自定义冲突 | `auto` 仅在用户未显式选择主题时生效；显式选择后写盘 `theme: custom` |

## 实施路径

| 阶段 | 范围 | 估测提交数 | 验收 |
|------|------|-----------|------|
| Phase 1 | P1 止血：焦点环 + aria-live + focus trap/restore + canvas ARIA | 1 次提交 | 键盘导航完整、屏幕阅读器感知动态信息 |
| Phase 2 | P2 关键：prefers-* 媒体查询 + Android 返回键 + 3D 键盘控制 + 模型 alt | 2~3 次提交 | 系统偏好跟随、Android 退出可预期 |
| Phase 3 | P3 长期：图标按钮 aria-label 补全 + aria-keyshortcuts + axe E2E + 方向键工具抽离 + Go 桥接 | 多次分散提交 | a11y 回归有自动化保障 |

每阶段独立可交付、可回退（git revert 单阶段不影响其他阶段）。

## 修订记录

| 日期 | 修订 |
|------|------|
| 2026-07-20 | 初版，三阶段路线图 |
| 2026-07-20 | 修订：核心原则补「不重复造 accessible name」「i18n 沿用现有 key」两条；Phase 3.1 从「新建 `a11y.*` 命名空间 + 10 个 key」精简为「3 处 `✕` 按钮复用 `common.close`/`common.delete`」；Phase 1.4 canvas aria-label 改为拼接现有 key + 模型名，不硬编码描述文字 |
