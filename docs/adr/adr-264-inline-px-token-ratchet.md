# ADR-264: 内联样式写死 px 收敛：等值换令牌 + 棘轮闸门

> **状态**: 🔄 部分采纳（2026-10-22）
> **日期**: 2026-10-22
> **相关**: ADR-228（ui-rows round 3：内联 style 的既有边界）、ADR-248（热路径禁裸 logWarn 的 `% 60` 帧节流范式）、`frontend/src/app.css`（令牌真相源）

## 背景与问题

### 一、UI 缩放是既定能力，但一半样式接不住

`--ui-scale`（`app.css:41`，默认 1，滑条 0.8~1.3）通过
`document.documentElement.style.setProperty('--ui-scale', v)`（`settings-appearance.ts:37-93`、
`core/init.ts:345`、`menus/settings-shared.ts:145`）驱动全局面板缩放。
`app.css` 的 `:root` 已备齐一整套 `calc(Npx * var(--ui-scale))` 令牌
（`--font-ui`/`--font-ui-sm`/`--font-ui-xs`/`--font-title`/`--btn-*`/`--content-px`/`--slide-item-*`/`--cs-*`/`--lcard-*`…）。

但 TypeScript 侧动态创建元素时大量直接写字面量：`'font-size:11px;...'`、`'padding:6px 14px'`。
这些 px **完全不随 scale 缩放**——用户把滑条拖到 1.3，CSS 里的按钮变大了，菜单里这批节点原地不动。
这不是「不好看」，是**同一屏内两套字号/两套间距并存**的功能性缺陷。

### 二、真实规模：行扫描会低估一半

最初按行 grep 估「392 处内联样式 / 53 处写死 px」。写成 AST 式扫描器后实测
（`scripts/check-inline-px.mjs`）：**318 个内联样式赋值点 / 96 处含写死 px / 222 个 px 值**。
低估的原因是多行反引号模板字符串（`debug-log-panel.ts:85`、`ui-fullscreen-overlay.ts:136/155/212`、
`ui-resource-panel.ts` 5 处、`ui-virtual-grid.ts` 3 处、`toast.ts` 2 处、`composition-guide.ts:93`）
——逐行正则只能看到第一行。

### 三、既有边界：ADR-228 已判定「部分保留 inline 是合理的」

ADR-228 §3 做过一轮「内联 → CSS 类」迁移，并明确保留了 inline：

- `.btn-group` 推广至 motion-override btnGroup：与 titleBar 内 btnGroup 布局冲突，
  **保留 inline style 更安全**（ADR-228:134）；
- `addSimpleBoneSelectPair`：cssText 与 `.setting-select` 差异大，无跨文件重复，不值得抽取（:133）。

**推论**：本 ADR 的目标不是「消灭全部 inline px」（那会推翻 ADR-228 的既有判断），
而是「**凡是 inline 里写死的 px，都要能随 scale 缩放**」——inline 可以留，px 不能留。

## 决策

### 决策 1：tokenize at 现值，不统一到新值

`padding:6px 14px` 这类反复出现的散值，**换成 `var(--row-pad-x)`（定义值 14px）**，
而不是统一到已有的 `--content-px`（12px）。

理由：`.slide-item` 走 12px、卡片内标题栏/列表行走 14px，这 2px 差是 ADR-228 起的既有视觉语言。
改成 12px 会**改变视觉**——那是未经授权的设计决策，不是技术债偿还。
要统一必须两边一起改，且需设计确认。

### 决策 2：新增两个令牌，均以现存高频值为基准

| 令牌 | 定义 | 依据 |
|---|---|---|
| `--font-hint` | `calc(12px * var(--ui-scale))` | 12px 在内联站点 + `.card-title-text`(`app.css:3433`) + `.cs-label-sm`(:3412) 三方共用却无令牌 |
| `--row-pad-x` | `calc(14px * var(--ui-scale))` | 卡片内行级水平内边距；`app.css:3409` 的 `.bone-select-row` 已写死 14px，ADR-228 的 `.card-title-bar` 同基准 |

两处均在定义处写明与相邻令牌的**并存理由**，防止后人「顺手统一」。

### 决策 3：等值替换规则（零视觉变化）

| 原值 | 换成 | 说明 |
|---|---|---|
| `font-size:11px` | `var(--font-ui-sm)` | 11px = 令牌基准 |
| `font-size:12px` | `var(--font-hint)` | 12px = 新令牌基准 |
| `font-size:13px` | `var(--font-ui)` | 13px = 令牌基准 |
| `font-size:14px` | `var(--font-title)` | 14px = 令牌基准 |
| `font-size:10px` | `var(--font-ui-xs)` | 10px = 令牌基准 |
| `font-size:9px` | `var(--font-ui-xs)` | 9px 无令牌，取最接近且已存在的档位（10px）。**唯一非零视觉变化项**：箭头/极小标注在 scale=1 时大 1px，随 scale 等比 |
| 水平 `14px` | `var(--row-pad-x)` | 见决策 1 |
| `gap:12px` | `var(--content-px)` | 12px = 令牌基准 |

所有替换在 `--ui-scale:1` 时**逐值相等**，视觉零变化；scale≠1 时原本不动的节点开始等比缩放。

### 决策 4：棘轮闸门（核心机制）

`scripts/check-inline-px.mjs` 把欠账变成**只减不增的 BUDGET**（初始基线 163）：

- 超出 → `--strict` 下 exit 1，并打印 4 条修复路径（换令牌 / 补令牌 / 抽 CSS 类 / 加豁免并注明理由）；
- 偿还一处 → 计数下降 → **同批 commit 里把 BUDGET 往下调**；
- 已挂进 `frontend/package.json` 的 `check:lint` 链（`check:inline-px`），`npm run check` 即过闸。

**豁免与防误判**（均写进脚本头注释）：

- `ANIMATION_PROPS`（`transform`/`translate`/`scale`/`rotate`/`perspective`/`transform-origin*`）豁免——
  `menu.ts` 的 `translateX(±8px)` 绑过渡动画位移，与布局尺寸无关；
- `.style.setProperty(...)` 豁免——写 CSS 变量本身，px 由变量定义处负责；
- `stripScaledSpans` **括号感知**挖掉 `var(...)`/`calc(...)` 整段——否则 `calc(14px * var(--ui-scale))`
  剥掉内层 var 后残留的 14px 被误判成欠账；
- `stripInterpolations` 把 `${...}` 换成可读的 `${…}` 占位——`${14 + depth * 16}px` 这类运行时缩进
  **仍计入欠账**（它同样不随 scale 缩放），但输出显示成 `padding:2px var(--row-pad-x) 2px ${…}px`，
  一眼能看出是计算值而非拼写错误；
- **自校验**：`scannedAssignments === 0` → 报「疑似源码结构变更」exit 1，防假绿（学 `check-boolean-naming.mjs:120`）。

## 实证与验证

| 项 | 结果 |
|---|---|
| 棘轮正测（+1 px） | `写死 px 合计: 164（BUDGET=163，余量 -1）` → `STRICT_EXIT=1` ✅ |
| 棘轮恢复 | 还原后 `STRICT_EXIT=0` ✅ |
| 豁免（transform px / setProperty px） | 不计数，`EXIT=0` ✅ |
| `npx tsc --noEmit` | EXIT 0 |
| `npm run check`（含新闸门 + i18n 5 语言包 1879 键对齐） | EXIT 0 |
| 相关单测 10 文件 | **196 passed** |
| 单文件 spot check | `library-core.test.ts` 119 passed |

**改动文件**：`scripts/check-inline-px.mjs`（新增）、`frontend/package.json`（挂 `check:inline-px`）、
`frontend/src/app.css`（+2 令牌）、24 个样式站点文件（等值替换）。

## 剩余欠账（163 处，分类处置）

1. **fixed 定位浮层**（`debug-log-panel` 8 / `toast` 12 / `ui-fullscreen-overlay` 7 / `ui-resource-panel` 9 / `status-bar` 3）
   ——viewport 语义（`position:fixed; bottom:20px; width:600px`），缩放会顶出屏幕。
   **建议**：显式豁免并注明理由，而不是硬换令牌。
2. **装饰性定尺**：`settings-appearance.ts:114` 色板 `width:16px;height:16px;border-radius:50%`、
   `model-detail.ts:1450` 折叠箭头 `width:14px`、`model-material.ts:329` 缩进 `paddingLeft:28px`、
   `motion-override-levels.ts:909` `flex:0 0 36px`。
   **建议**：逐个判断是否该随 scale；不需要的进豁免。
3. **4/6/8px 散间距**（`ui-rows.ts:335`、`env-preset-levels.ts:56/59/336`、`env-sky-levels.ts:83`、
   `render-menu.ts:191`、`scene-stage-lights.ts:71/119` 等）——无对应令牌。
   **建议**：若确有跨文件重复，补令牌；否则抽 CSS 类。
4. **`settings-about.ts:41` `font-size:15px`**——无令牌（`--cs-label-font-size:15` 是滑条标签专用，语义不可复用）。
   **建议**：问设计，是否归 `--font-title`(14) 或 `--font-title-lg`(16)。

## 影响

- **改动文件**：见上。
- **不改变任何行为**：全部为 `值 → var(同值令牌)`；scale=1 时逐值相等。
- **风险**：
  - `font-size:9px → var(--font-ui-xs)` 是唯一非等值项（+1px），已在决策 3 标注；
  - `--row-pad-x` 与 `--content-px` 并存是**有意**的，定义处已写明，禁止单向「顺手统一」；
  - 棘轮 BUDGET 是硬编码常量，须随偿还同步下调——已在脚本注释里写明「每批 commit 同步往下调」。
- **待办（后续 ADR）**：
  1. fixed 定位浮层类显式豁免（决策 4 之外补 `VIEWPORT_PROPS`/固定定位判定）；
  2. 装饰性定尺逐个定去留；
  3. 4/6/8px 散间距补令牌或抽类；
  4. `docs/design.md` 通篇未提 `--ui-scale`/令牌体系（其 :377 还在示范 `font-size: 11px` 写死值）
     ——规范文档本身与真相源脱节，需补一节「内联样式必须接令牌」。

## 相关文档

- `frontend/src/app.css:41-203` — 令牌真相源（`:root`）
- `frontend/src/menus/settings-appearance.ts:37-93` — `--ui-scale` 写入链
- `docs/adr/adr-228-ui-rows-round3.md` — inline style 的既有边界
- `scripts/check-inline-px.mjs` — 棘轮闸门本体
- `scripts/check-boolean-naming.mjs` — 自校验/严格模式范式来源
