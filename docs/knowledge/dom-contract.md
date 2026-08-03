---
kind: dom_contract
name: 渲染层 DOM 契约单源
tier: architecture
category: ui
scope:
  - frontend/src/core/dom-contract.ts
source_files:
  - frontend/src/core/dom-contract.ts
adr:
  - ADR-229
symbols:
  - TOGGLE_INPUT_SELECTOR
  - KIND_CONTROL_SELECTOR
  - ROLE
  - ARIA_ATTR
  - COLLAPSIBLE
  - SLIDER_BAR_CLASS
invariants:
  - 零依赖叶子模块，禁止 import 任何其他模块
  - 渲染层产出 role/class 时引用本文件常量，禁止手写字符串
  - 若渲染层改 role/class 而未同步本文件 → CI「快照重生成 + git diff」门禁直接红
tests:
  - frontend/src/__tests__/schema-snapshot.test.ts
use_when:
  - DOM 契约
  - role 属性
  - aria 属性
  - 选择器
  - e2e 断言
  - collapsible class
---

# 渲染层 DOM 契约单源

## 系统概览
渲染层 DOM 契约的单一事实源（ADR-229 §9 契约统一）。三处同读一份，消除「测试猜渲染」漂移：
渲染函数产出 role/class 时引用、schema 快照测试写入 `nodes[].dom` 字段、e2e 从快照读取断言选择器（不再手写 `KIND_SELECTOR_MAP`）。

## 核心职责
- `dom-contract.ts` — 定义 `ROLE` / `ARIA_ATTR` / `KIND_CONTROL_SELECTOR` / `COLLAPSIBLE` / `SLIDER_BAR_CLASS` / `TOGGLE_INPUT_SELECTOR` 契约常量

## 对外 API（节选）
- `ROLE` — 渲染层 role 属性常量（slider / switch / listbox / button / dialog / status / alert）
- `ARIA_ATTR` — aria 属性名常量（valuemin / checked / label / live 等）
- `KIND_CONTROL_SELECTOR` — MenuKind → 交互控件选择器（e2e 断言用）
- `COLLAPSIBLE` — collapsible（folder）组件 class 契约（ui-collapsible.ts 与 e2e 展开逻辑共用）
- `SLIDER_BAR_CLASS` — 滑动条本体 class（slider / colorSlider / modeSlider 共用 `.cs-bar`）
- `TOGGLE_INPUT_SELECTOR` — toggle 的原生输入元素选择器（e2e 需点击/读 checked）

## 与其他子系统关系
- 被 `ui-rows.ts` / `ui-advanced-rows.ts` / `ui-collapsible.ts` / `ui-slide-row.ts` 产出 role/class 时引用
- 被 `menus/menu.ts` / `menus/resource-detail-helpers.ts` 消费选择器
- 被 schema-snapshot 测试与 e2e `schema-driven.spec.ts` 读取断言

## UI 入口
- 菜单渲染层（ui-rows / ui-advanced-rows / ui-collapsible）产出 role/class 时引用；e2e 快照断言从 `KIND_CONTROL_SELECTOR` 读取选择器

## 不变量
- 零依赖叶子模块，禁止 import 任何其他模块
- 渲染层改 role/class 必须同步本文件，否则 CI 快照门禁直接红

## 验证入口
- 测试：`frontend/src/__tests__/schema-snapshot.test.ts`（元测试断言一致性）
- 命令：`cd frontend && npm run test -- schema-snapshot.test.ts`
