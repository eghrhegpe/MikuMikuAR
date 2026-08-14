# debug-log-panel — 审核结果（round18-2/3）

## 审核范围

- **测试文件**：`frontend/src/__tests__/debug-log-panel.test.ts`（436 行，33 用例）
- **被测源码**：
  - `frontend/src/core/debug-log-panel.ts:1-184`（showLogPanel / hideLogPanel / toggleLogPanel / disposeLogPanel / renderPanel / formatTime / window.__logPanel 注册）
  - `frontend/src/core/logger.ts:9-109`（LogEntry / LogBuffer 环形缓冲 / getLogBuffer / setConsoleOutput / clearLogs / logInfo|Warn|Error）
- **依赖相关代码**：
  - 消费者 `frontend/src/menus/settings-system.ts:51,392-394`（设置→系统→缓存占用→「打开日志面板」→ toggleLogPanel）
  - 副作用挂载 `frontend/src/core/main.ts:15-16`（`import './debug-log-panel'` 注册 `window.__logPanel`）
  - 同类环形缓冲 `frontend/src/core/ai/error-buffer.ts:40`（ErrorRingBuffer，ADR-196）
  - 决策文档核对：`docs/adr/adr-248-derived-cache-reference-key.md`（ADR-248 实际主题为派生缓存引用键，与日志面板无关）

## 总体结论

⚠️ **有条件通过**

- 生产代码 184+109 行，类型安全达标（0 处 `as any`/`@ts-ignore`，唯一域断言 `as LogEntry['level']` 受 select options 约束），资源释放链路完整（subscribe → dispose 摘除、DOM → dispose 移除），无循环依赖（logger 零 import，debug-log-panel 仅依赖 logger）。
- 单测 33/33 通过（Vitest 387ms，happy-dom），mock 卫生合规（`vi.hoisted` 用法符合 frontend/AGENTS.md 铁律），无跳过用例。
- 存在 **2 项 P2 风险**：① 渲染层 `innerHTML` 未转义消息文本（潜在注入面）；② Console 按钮初始文案与实际输出状态脱节（状态不同步，且被测试固化为预期行为）。修复后即可转正。

## 亮点

- **订阅生命周期成对且可重入**：`showLogPanel` 首次创建时 `_unsubscribe = getLogBuffer().subscribe(renderPanel)`（debug-log-panel.ts:132），`disposeLogPanel` 先摘订阅再删 DOM 并复位过滤状态（debug-log-panel.ts:150-161）；`showLogPanel` 对已存在面板短路 return（:61-65），杜绝重复订阅/重复挂载——测试 107-114（单实例）、376-382（dispose 后订阅置空）、369-374（dispose 后重建）恰好锁死这三条不变量。
- **滚动位置保真**：`isNearBottom = scrollHeight - scrollTop - clientHeight < 50`（debug-log-panel.ts:40）配合「仅底部才 `scrollTop = scrollHeight`」（:55-57），用户中途阅读时不被新日志拽走；测试 271-305 用 `Object.defineProperty` 双场景（近底滚、非近底不滚）精确验证。
- **Console 判定用正则收尾而非子串**：`/:\s*ON$/i.test(textContent)`（debug-log-panel.ts:120）规避 `.includes('ON')` 在 "OFF (disabled)" 等含 ON 子串文案下的误判；测试 389-409 以两条「回归防护」用例显式锚定该约定，知识卡 invariant（debug-log-panel.md:15）同步记录——防回归闭环完整。
- **空状态与过滤降级有引导**：空缓冲/无匹配过滤均渲染居中「暂无日志」占位（debug-log-panel.ts:52），测试 165-168、242-251 覆盖；level 过滤（warn/error 两档）与 tag 大小写不敏感过滤各有独立用例（195-240），且断言内联色值（262-264）规避 happy-dom `getComputedStyle` 不转 rgb 的差异——测试实现细节考究。
- **logger 环形缓冲简洁无依赖**：`LogBuffer`（logger.ts:17-49）单文件零 import，`push` 超限 `shift()` 丢弃最旧、`subscribe` 返回解绑函数，console 输出经 `_consoleOutput` 独立门控（:76-83）——与「记录/展示解耦」的 ADR 意图一致。
- **测试 mock 最小且语义对齐**：`vi.hoisted` 共享状态 + 内联 mock 仅实现面板用到的 5 个 API（getAll/subscribe/push/clear/clearLogs/setConsoleOutput），且 `push`/`clear` 触发 `subscribeFn` 复刻真实「写后通知」语义（test:24-37），非过度 mock。

## 风险

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|--------|------|------|------|----------|
| 🟠 P2 | debug-log-panel.ts | 42-50 | `e.message` 未经转义直接拼入 `innerHTML`。日志消息可能携带用户可控文本（如 `planar-reflection.ts:208` 的 `this.cfg.name`、文件名等），在 WebView2 上下文中构成 HTML/脚本注入面 | 对 `e.message` 套 `escapeHtml()`（`core/escape-html.ts:5` 已存在、settings-system 同模式），渲染侧统一转义后再拼模板 |
| 🟠 P2 | debug-log-panel.ts | 96, 119-124 | Console 按钮初始文案硬编码 `Console: OFF`，但 `logger.ts:55` 实际 `_consoleOutput = true`（ON）。logger 未导出状态 getter，面板无法读取真实状态 → 打开面板即「标签 OFF、实际 ON」，首次点击只是把标签翻成 ON（`setConsoleOutput(true)` 为空操作）。测试 333-340 已将该错误初始态固化为预期 | logger 增加 `getConsoleOutput(): boolean` 导出；面板创建时按真实状态初始化文案与底色，并补一条「初始标签 == 实际状态」的用例 |
| 🟡 P3 | debug-log-panel.ts | 132 + 28-58 | `hideLogPanel` 不摘订阅，隐藏期间每次日志 push 仍触发 `renderPanel` 全量重建 innerHTML（最多 200 条），属隐藏面板的无谓渲染 | 隐藏态跳过渲染：订阅回调内 `if (_panel?.style.display === 'none') return;`（或 hide 时临时摘订阅、show 时恢复） |
| 🟡 P3 | logger.ts | 74, 87, 100 | `const prefix = message ? \`[\${tag}] \${message}\` : \`[\${tag}]\`` 在 logInfo/logWarn/logError 三处逐字重复 | 提取私有 `buildPrefix(tag, message)` 单点维护（低风险纯重构，可顺带补前缀格式测试） |
| 🟡 P3 | debug-log-panel.ts / logger.ts / docs/ | 文件头注释 :1、logger.ts:6,52、docs/knowledge/logger.md:59,85、debug-log-panel.md:3 | 日志面板/环形缓冲多处标注「ADR-248」，但 `docs/adr/adr-248-*.md`（权威源，AGENTS.md 核实顺序 docs/adr/ 优先）主题是「派生缓存引用键」，与日志无关——ADR 号被占用，该决策实际无 ADR 记录，溯源断裂 | 为日志面板+环形缓冲补立新 ADR 号（`node scripts/new-adr.mjs`），同步修正代码注释与知识卡引用 |
| 🟡 P3 | logger.ts:17-49 vs ai/error-buffer.ts:40 | LogBuffer 与 ErrorRingBuffer | 「定容环形缓冲」概念在两文件重复实现（前者 array+shift+通知，后者 head/tail 无通知），语义不同未互引 | 不强求合并（用途不同），但在两处注释互相指引（如「同类实现见 error-buffer.ts」），避免未来第三份环形缓冲 |
| 🟢 P4 | logger.ts | 22, 52 | 环形上限 `200` 既作构造默认值又作显式实参，双份魔法数 | 提取命名常量 `LOG_RING_CAPACITY = 200` 单点声明 |
| 🟢 P4 | debug-log-panel.ts | 40, 79, 96, 123 | 滚动阈值 `< 50`（有注释）、`z-index: 10000`、Console 双态底色 `#2980b9/#27ae60` 均为散落魔法值（z-index 与测试断言 98-99 耦合） | 阈值/色值提为模块常量；z-index 优先复用 `core/ui-constants` 既有档位 |
| 🟢 P4 | logger.ts | 34-36 | `getAll()` 直接返回内部 `_buffer` 数组引用，调用方可绕过 push 改写缓冲且不触发通知 | 返回 `[...this.buffer]` 拷贝（面板侧 200 条拷贝开销可忽略），或注释声明只读契约 |

## 测试质量评价

**整体良好：33/33 通过（387ms），与生产代码文档承诺逐条对应，卫生合规，但存在 2 处值得注意的缺口。**

- **断言有效性**：状态断言（display block/none、panel 单实例、DOM 移除）用 `toBe`/`toBeNull`，行为断言（过滤条数、颜色、scrollTop、调用序列）用 `toEqual`/`toContain`，均落在真实副作用上而非 mock 内省；自动滚动用例用 `Object.defineProperty` 精确控制 scrollHeight/clientHeight/scrollTop，断言 `scrollTop === 500`（近底）与 `=== 100`（非近底）——有效。
- **mock 卫生（符合 frontend/AGENTS.md 铁律）**：`vi.mock` 工厂只引用 `vi.hoisted()` 绑定（test:9-42），无 hoist TDZ 风险；未触碰 `window` 全局（happy-dom 环境自带）；logger 不在共享工厂清单（idb/scene/state）内，内联 mock 形状与真实 LogBuffer API 对齐，可接受。
- **边界覆盖**：空缓冲、无匹配过滤、level 两档、tag 大小写、near-bottom/非 near-bottom、dispose 后重建、dispose 后订阅摘除、面板不存在时 hide/dispose 不抛错、`window.__logPanel` 五方法暴露——覆盖充分。
- **缺口**：
  1. **logger.ts 无任何直测文件**（`__tests__/` 下无 *logger* 匹配，知识卡 `tests: []`）——环形上限 200、超限丢最旧、`subscribe` 解绑、`_consoleOutput` 门控、prefix 格式、warn/error 的 `err===undefined` 不传参等生产语义全靠 mock 绕过，属真实回归风险；
  2. **mock 未复刻 200 条上限**（test:18-32 无 eviction），「大量条目（满缓冲）渲染」路径未测；
  3. **Console 初始态断言把缺陷当规范**（test:336 断言初始 `Console: OFF`、:338 断言首击 `setConsoleOutput(true)`），与上文 P2 状态不同步同源——修生产代码时须同步改这两条；
  4. `afterEach` 的 `resetFilterState` 用「直接改 textContent/手写 mockState.consoleOutput=false」（test:63-69）绕开事件处理器，是对状态脱线的补偿性 workaround，实现修复后应可删繁就简；
  5. 未覆盖组合过滤（tag+level 同时生效）、formatTime 午夜边界（测试用正则形状断言、时区无关，属正确取舍）、`disposeLogPanel` 后过滤状态复位（:159-160 未断言）。
- **无跳过**：通读全文无 `it.skip`/`it.todo`/`.only`。
- **验证结果**：`npm run test -- src/__tests__/debug-log-panel.test.ts` → 33/33 通过（Vitest 4.24s 含环境启动）。`npm run check`（tsc 全量）耗时较长未单独执行——测试运行 + 源码通读未见类型疑点，且生产文件本轮未改动，基线风险低。

---

审核日期：2026-08-15
审核员：子代理 round18-debug-log-panel
