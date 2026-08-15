# round-37 — menu-schema 渲染主测试（7 文件合并）审核报告

> 审核日期：2026-08-15
> 审核员：子代理 round37-menu-schema（第 37 轮第 3 个测试）

## 审核范围

| 项 | 内容 |
|----|------|
| 测试文件 | `frontend/src/__tests__/menu-schema.test.ts`（850 行，32 用例）— menu-schema 系列合并：controlspec / dispose / guards / header-toggle / i18n / kinds / statepath 7 文件 → 1 |
| 被测源码 | `frontend/src/menus/render-menu.ts`（375 行，schema→DOM 单渲染器）、`frontend/src/menus/menu-schema.ts`（130 行，StatePath 解析器）、`frontend/src/scene/shared/menu-node-types.ts`（81 行，类型契约）、联动 `core/ui-rows.ts` / `core/ui-advanced-rows.ts` / `core/ui-collapsible.ts` / `core/ui-header-toggle.ts` / `core/render-context.ts` / `menus/menu.ts`（registerControl 生命周期） |
| 运行验证 | `npm run test -- src/__tests__/menu-schema.test.ts` → **32/32 通过**（294ms，环境 happy-dom，isolate=true） |

## 与既往轮次的关系（round-12/15 遗留核实）

- 任务所称「round-12/15 审过 menu-schema」经 grep 核实：round-12（`2026-08-06-round12-env-motion-core-ai.md`）与 round-15（`2026-08-07-round15-*.md`）报告正文**均未直接覆盖 menu-schema**；实际渲染层审核在 **round-13**（`2026-08-06-round13-scene-render-core-ui.md:92`），唯一发现是「render-menu colorSlider/modeSlider/modeRow 未应用 ControlSpec get/set 衍生转换」。
- **该 round-13 P3 已修复**：`render-menu.ts:195-227 / 269-295 / 305-315` 三处均带 `[audit:round13 P3]` 注释应用 `ctrl.get/set`，且本合并测试的 controlspec describe 已将其纳入回归（`menu-schema.test.ts:501-572`，set 逆向转换真实交互断言）。
- 测试文件自身的 round-6 遗留：`menu-schema.test.ts:487-490` 注释记录 onChange 用例曾在 round-6 审计中从「名实不符（只断言容器非空）」改为真实键盘交互——本次确认已兑现。
- 文件生命周期：953 行单体 → 9faec36a 拆 10 文件 → 378d16ad 合回 7 文件（850 行），与 `virtual-skirt` 同批。冲突/保留 4 文件的原因在文件头注释（L1-6）如实记录，与事实一致（modelid 为 `@vitest-environment node`、conflict/motion-module 依赖 `vi.resetModules` 文件级隔离、integrity 为独立 mock 元测试）。

## 总体结论

**✅ 通过**（测试质量优、生产代码健康；0 个 P1 / 0 个 P2，4 个 P3 均为测试断言强度与潜在一致性问题，无功能缺陷）

## 亮点

- **合并质量高**：用例守恒经 git 逐文件核验（kinds 11 + guards 4 + header-toggle 2 + controlspec 4 + dispose 6 + i18n 2 + statepath 3 = 32 = 合并后 32，零丢失零新增）；各 describe 的 container/beforeEach/afterEach 原样保留互不干扰；i18n 语言包预填收敛为模块级 `beforeAll`（L29-32）；mock 全部复用共享工厂 `menu-schema-mocks.ts`（mockScene 扩展自 `sceneMockSuperset`，符合 AGENTS.md「同模块 mock 形状保持超集一致」铁律，规避了 round-20 schema-snapshot 内联 mock 的同类问题）。
- **dispose 级联测试是全文件最佳部分**：6 用例覆盖收集执行（L590-603）、folder 子节点级联（L605-620）、folder 自身 renderCustom（L622-636）、多 custom 按序执行（L638-654）、void 返回不报错（L656-668）、visibleWhen=false 不渲染不收集（L670-688）——与 `render-menu.ts:26-39,72-75,114-129` 的收集/级联实现逐点对应。
- **守卫测试真实验证**：返回 false 零渲染（L251-263）、动态 envState 条件双向（L279-303，try/finally 还原状态）、folder 子节点独立求值（L305-334，断言恰好 1 行）。
- **真实交互而非 DOM 存在性**：modeRow 点击→`setEnvState({skyMode:'texture'})`（L212-232）、slider ArrowRight→set 逆向写回 `{skyRotationSpeed:0.4}`（L506-538）、headerToggle 点击→枚举写回 `{groundType:'terrain'}`（L540-571）、modeSlider ArrowRight→onChange 触发（L469-498）、statepath 断言 `.cs-value` 显示 '90'（L800-801）——均验证了 schema→DOM→状态写回闭环。
- **StatePath set 链路按前缀分流验证**：light./perception./ui. 三个前缀的 set 各走各的 state setter（L815-848），与 `menu-schema.ts:79-116` 的 switch 对应。
- 生产代码 0 处新增 `as any` / `@ts-ignore`（`menu-schema.ts` 用 `as unknown as Record` 属可接受的窄化断言）；`renderMenu` dispose 契约（只收 custom/folder 资源，行控件由 SlideMenu `registerControl` 生命周期管理，`menu.ts:1055,1143` 清空 `_controls`）设计边界清晰。

## 风险表

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|--------|------|------|------|----------|
| 🟡 P3 | render-menu.ts | 109 / 160-161 / 218 / 252 / 288 + menu-schema.ts:120-122 | **getBindFn 丢弃 modelId/actionId**：初值读取均传 `node.modelId/actionId`（如 L97、L140），但自更新 bind 闭包经 `getBindFn(bind)()` 读取时不传（getBindFn 签名只有 path）→ 含 modelId/actionId 的 motionModule 控件在 updateControls() 自刷新时按焦点模型读数，显示值与初值/生效值脱节。当前无生产 schema 在控件上设 modelId/actionId（仅 parser 级测试），属潜伏不一致，未覆盖 | 给 `getBindFn` 增加可选 `modelId?/actionId?` 参数，render-* 各 bind 闭包透传 `node.modelId/node.actionId`；补一个含 modelId 的 renderMenu 级自更新用例锁死 |
| 🟡 P3 | menu-schema.test.ts | 437-467 | **windDirection get/set 用例名实不符（round-6 同类遗留）**：测试名声称「get 从向量计算角度」，但仅断言 `container.children.length > 0`，从未读取 DOM 中派生显示值，get(→角度) 与 set(角度→向量) 的换算正确性实际未被验证 | 断言 `.cs-value` 文本为 '0'（[0,0,1]→0°），并触发一次方向键写回断言 `setEnvState` 收到 `[sin,0,cos]` 还原值 |
| 🟡 P3 | menu-schema.test.ts | 65-110 | **toggle/colorSlider/modeSlider 三个 kind 用例断言过弱**：仅 `children.length > 0`，即使渲染成错误控件类型（或控件行缺关键子元素）也会通过，与 slider（`.cs-row`）/folder（`.collapsible-wrapper`）的断言强度不一致 | toggle 断言 `.toggle-row` + checkbox；colorSlider 断言 `.cs-row` + `.cs-color-*`（按 addColorSliderRow 实际 class）；modeSlider 断言 `.cs-row` + options 数 |
| 🟡 P3 | menu-schema.test.ts | 全文（kinds 清单） | **`action` kind（renderAction→addActionRow）与 `render.` 前缀零覆盖**：MenuKind 10 种 kind 中仅 action 无任何 renderMenu 级用例（menu/*.test.ts 的 `kind:'action'` 是旧 SlideMenu PopupRow，非本 schema）；statepath 仅测 env/ui/light/perception 四前缀，render. 无覆盖 | 补 1 用例：`kind:'action'` + `action:(ctx)=>...` 断言点击后 ctx.toast/setStatus 可用；补 render. 前缀 get/set（`getRenderState` 链）1 用例 |
| 🟢 P4 | render-menu.ts | 45-76 | `renderNode` switch 无 default 分支，非法 kind 静默不渲染不报错（MenuKind 闭合联合下仅 JSON 化 schema 或手误可触发） | 加 default 分支 `console.warn` 或抛错，快速暴露 schema 定义错误 |
| 🟢 P4 | render-menu.ts | 26-39 | `renderMenu` 循环中若某节点 renderCustom/visibleWhen 抛异常，已收集的 disposes 丢失（返回函数未产生即泄漏） | 用 try/catch 包裹循环，异常时先执行已收集 disposes 再抛出（或 wrap 到返回的 dispose 中兜底） |
| 🟢 P4 | menu-schema.test.ts | 71 / 785 | i18n 警告噪音：`env.groundVisibleEnabled` 在 zh-CN 包不存在（疑似 key 拼写）、statepath 用例直接用字面量 `'截图质量'` 作 label 触发 t() 未命中告警 | 换真实 key（如 `env.groundVisible` 实际键名）或对字面量 label 用例显式绕过 t() |
| 🟢 P4 | menu-schema.test.ts | 469-498（注释 490 行 L519-523） | ① modeSlider onChange 用例隐式依赖 `envState.skyMode` 默认值 ='color'（index 0），若 schema 默认改 'texture' 则 ArrowRight 在末位不触发 onChange、用例误红；② 注释中「L519-523」行号指向合并前布局，已漂移 | ① 测试内显式 `envState.skyMode='color'` + try/finally 还原；② 行号注释改为描述性文字或更新为当前行号 |
| 🟢 P4 | 生成物 | `unused-vars.txt:14`、`frontend/test-statistics-report.md:41-43,131-133`、`test-results*.json` | 仍引用已删除的 7 个独立测试文件名（均为生成/统计产物，非源码引用；知识卡 menu-schema.md / render-menu.md 已正确指向合并文件） | 下次重新生成时自然刷新，无需手改 |

## 测试质量评价（含合并质量）

**合并质量：优秀。** ① 用例守恒经 git diff 逐文件核验 32=32 零丢失；② 共享 `menu-schema-mocks.ts` 工厂（4 条 vi.mock 行），符合测试卫生铁律，未重蹈 round-20 schema-snapshot 内联 mock 覆辙；③ 各 describe 隔离样板保留，无跨 describe 状态污染（i18n describe 的 afterEach 还原语言、guards/controlspec/statepath 的 try/finally 还原 envState/uiState）；④ 文件头注释如实说明 4 文件保留独立的原因，与代码事实一致；⑤ 无 `it.skip/.only/.todo`、无 `@ts-ignore/as any`、无 fake timers 依赖。

**断言有效性：中上，有 3 处强度不足。** 强项是 dispose 级联（6 用例全部真实执行语义）、守卫（真/假/动态/嵌套四态）、set 逆向链路（键盘/点击真实交互后断言 setter 参数）、statepath（显示值 + 前缀分流）。弱点集中在 kinds describe：toggle/colorSlider/modeSlider 三个「生成 DOM」用例只断言容器非空，windDirection get/set 用例名实不符（round-6 已修同类，此例残留）。action kind 与 render. 前缀为覆盖盲区。

**边界覆盖：** 无跳过；空 folder（无 children 无 custom 无 headerToggle 静默跳过，render-menu.ts:83）未测、folder 全子节点隐藏时空壳未测、renderMenu 中途抛异常的资源释放未测（见 P4）。**总体：作为 7 文件合并后的渲染主测试，覆盖与断言质量足以支撑「schema→DOM→状态闭环」的回归基线，残余项均为 P3 级测试强化建议，不阻塞通过。**

## 审核结论

- 总体结论：✅ 通过
- P1 数量：0 ｜ P2 数量：0 ｜ P3 数量：4（getBindFn modelId/actionId 丢弃、windDirection 用例名实不符、3 个 kind 断言过弱、action/render. 覆盖盲区）
- 生产代码健康度：类型安全 ✅、资源释放 ✅（dispose 契约清晰且被 6 用例锁死）、状态流 ✅（StatePath 解析单一入口 + 前缀分流）、职责单一 ✅（渲染器只做分发，无幽灵路径）
