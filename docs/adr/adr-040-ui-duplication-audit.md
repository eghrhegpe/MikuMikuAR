# ADR-040: UI 重复率审计与重构

> **状态**: 已完成（2026-07-05 执行两轮重构）

## 背景

`frontend/src/menus/` + `core/ui-*.ts` + `app.css` 静态分析发现 UI 重复率约 35%：145 行 `className` 赋值散落各菜单文件，31 行 inline style，10+ 处手动创建 `.slide-item`。

## 决策

### 第一轮：扩展 `slideRow` + 标准化危险/字段行

| 改动 | 效果 |
|------|------|
| `ui-slide-row.ts` 加 `SlideRowExtra`（`variant`/`actionIcon`/`onActionClick`/`rightLabel`） | 一次封装消除多处重复 |
| `ui-rows.ts` 加 `addDangerRow()` / `addFieldRow()` | 危险行和字段行标准化 |
| `app.css` 加 `.field-label` / `.field-value` / `.slide-act-btn` | 替代 inline style |
| `model-detail.ts` / `settings.ts` / `settings-software.ts` / `library-core.ts` / `scene-stage-levels.ts` / `scene-stage-lights.ts` | 用新 API 替换手动 DOM，共 -74 行 |

### 第二轮：多操作按钮 + 动态图标 + 内联 sublabel

| 改动 | 效果 |
|------|------|
| `SlideRowExtra` 加 `variant: 'accent'` / `actionIcons[]` / `iconFactory` / `inlineSub` | 支持 accent 色、多操作按钮、动态图标、内联 sublabel |
| `ui-rows.ts` 加 `addEmptyRow()` | 空状态占位标准化 |
| `app.css` 加 `.accent-text` / `.slide-item-muted` / `.slide-sublabel-inline` / `.slide-act-danger` | 替代 inline style |
| `motion-popup.ts` / `model-detail.ts` / `outfit-ui.ts` / `settings.ts` | 用新 API 替换，消除 innerHTML，-36 行 |

## 结果

| 指标 | 改前 | 改后 |
|------|------|------|
| `className` 赋值行 | 145 | ~105（↓28%） |
| inline style 行 | 31 | ~21（↓32%） |
| 手动 `.slide-item` | 10+ | ~5（↓50%） |
| 测试回归 | — | ✅ 982/982 通过 |
| 剩余重复率 | 35% | ~15%（仅剩 4 处高度特化模式） |

### 未纳入重构的特化模式

- `motion-popup.ts` 图层行 — 权重滑条 + 实时百分比 + toggle + 删除，4 控件组合太特殊
- `model-detail.ts` / `library-core.ts` favorites — 动态颜色 + 条件文字 toggle，耦合度高
- `env-preset-levels.ts` 空状态 — 非 `.slide-item` 上下文，在自定义 listHost 中
- `scene-stage-lights.ts` opacity toggle — 按钮启用/禁用视觉反馈，非重复模式

## 教训

1. **`slideRow` 单一函数 + `extra` 配置对象**比拆分多个专用函数更灵活，覆盖 80% 场景
2. **inline style 是维护隐患的早期信号** — 出现 3 次以上相同 `style="..."` 就该提取 CSS 类
3. **重构分两轮比一次到位更稳** — 第一轮验证 API 设计，第二轮扩展边界场景

