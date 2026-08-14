# [logger] — 审核结果（round18-logger）

## 审核范围

- **测试文件**：`frontend/src/core/__tests__/logger.test.ts`（48 行，6 用例）
- **被测源码**：`frontend/src/core/logger.ts`（109 行）
  - `LogEntry` 接口：9-14
  - `LogBuffer` 环形缓冲类：17-49
  - `setConsoleOutput`：58-60 / `getLogBuffer`：63-65 / `clearLogs`：68-70
  - `logInfo`：73-83 / `logWarn`：86-96 / `logError`：99-109
- **关联模块**：`frontend/src/core/debug-log-panel.ts`（getLogBuffer 唯一消费者，184 行）、`docs/knowledge/logger.md`、`docs/adr/adr-248-derived-cache-reference-key.md`
- **验证**：`cd frontend && npm run test -- src/core/__tests__/logger.test.ts` → 6/6 通过（39ms）；`debug-log-panel.test.ts` → 33/33 通过。`npm run check`（tsc 全量）未执行，超出单文件审核范围，按任务说明跳过并在此注明。

## 总体结论

⚠️ **有条件通过**

生产代码本身健康度良好：零依赖叶模块、环形缓冲职责清晰、热路径门控约束（feetDebug + %60 帧节流）在调用方全面落实、测试 6/6 与面板 33/33 全绿、无类型逃生。但有 1 项 P2（**ADR-248 文档编号错位**：日志环形缓冲/调试面板决策被标注为 ADR-248，而官方 ADR-248 主题是「派生缓存依赖引用键」，日志决策无正式 ADR 记录）+ 2 项 P3 需跟进，处理上述项后即可视为通过。

## 亮点

- **零依赖叶模块设计**：`logger.ts:1-7` 声明并实际贯彻「无依赖、不引入循环依赖」，经 ADR-141 从 `utils.ts` 剥离切断 `state ↔ utils` 循环；全仓 97 处消费者统一从本文件导入（`grep "from .*logger"`），标签格式单一出口。
- **记录与展示解耦的环形缓冲**：`logger.ts:16-49` `LogBuffer` 定容（默认 200 条）、`subscribe` 返回可逆的 unsubscribe 闭包（43-48）；`debug-log-panel.ts:150-161` `disposeLogPanel` 完整清理 DOM + 订阅 + 模块级过滤状态，无资源泄漏路径。
- **热路径日志准则落地成体系**：ADR-248 约束在调用方逐一落实——`render-loop.ts:70-73`（DEV-only + 帧节流采样）、`bone-override.ts:667`/`feet-adjustment.ts:213`/`perception-shared.ts:346-351`/`hand-modules.ts:174`/`playback.ts:192` 均为 `feetDebug.value` 门控 + `% 60` 帧节流；知识卡 `docs/knowledge/logger.md:68-76` 将教训沉淀为「热路径日志准则」供全仓复用，形成「约束→实现→文档」闭环。
- **console 输出独立开关**：`logger.ts:55-60` `_consoleOutput` 与缓冲解耦，面板可切 OFF 规避 source map 展开卡顿，`debug-log-panel.ts:118-124` 正确绑定。
- **测试断言精确**：`logger.test.ts:9/16/23/30/38/45` 用 `toHaveBeenCalledWith` 精确匹配参数序列，非弱断言。

## 风险

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|--------|------|------|------|----------|
| 🟠 P2 | `frontend/src/core/logger.ts` | 6-7 | 头注释标注 `[ADR-248] 日志缓冲区`，但官方 `docs/adr/adr-248-derived-cache-reference-key.md` 主题是「派生缓存依赖引用键」（2026-08-06，ADR 索引/状态均为该主题）；「日志环形缓冲+调试面板+热路径门控」这一决策在 `docs/adr/` 无正式 ADR 记录（grep 全量 ADR 未见，ADR-196 为 AI 错误缓冲、ADR-205 为 Go LogRing，均非本模块），却同时被 `debug-log-panel.ts:1`、`docs/knowledge/logger.md:25/60/68`、`docs/knowledge/debug-log-panel.md:3/20`、`docs/knowledge/bone-override.md:117`、`bone-override.ts:657`、git commit `ce02492d`（2026-08-11）引用为 ADR-248——编号与官方 ADR 冲突，决策溯源断裂（`docs/knowledge/index.md:339` 甚至把 ADR-248 关联到 logger 知识卡）。 | 新建正式 ADR（如 ADR-255/256）记录「日志环形缓冲 + 热路径 feetDebug 门控 + 帧节流」决策并给出编号，然后统一更正 logger.ts/debug-log-panel.ts/bone-override.ts 注释与 logger.md/debug-log-panel.md/bone-override.md/index.md 知识卡中的 ADR-248 引用；或明确将「ADR-248 教训」降格为非 ADR 的事件复盘（2026-08-12 bone-override 修复），杜绝与官方 ADR-248 主题冲突。 |
| 🟡 P3 | `frontend/src/core/logger.ts` | 73-109 | `logInfo/logWarn/logError` 无异常隔离：① `_logBuffer.push`（75/88/101）同步调用 `_listeners.forEach`，任一订阅者抛错会沿日志函数向上传播，污染调用方业务路径；② `console.*` 调用未 try/catch，极异常环境（console 被替换/缺失）下日志函数自身抛错。日志函数应「永不失败」。 | push 内 listener 通知包 try/catch（或收集错误异步上报）；console 输出段用 `safeCallVoid`（项目已有 `core/safe-call.ts`）包裹，保证日志函数不抛。 |
| 🟡 P3 | `frontend/src/core/__tests__/logger.test.ts` | 7-10 等 6 处 | `spy.mockRestore()` 依赖断言成功执行：若 `expect` 先行抛错，restore 不会运行，spy 泄漏至后续用例（vitest 默认 isolate 下通常自愈，但 isolate=false 或并发时可能污染）。 | 改为顶层 `afterEach(() => vi.restoreAllMocks())`，或 `try/finally` 包裹断言，消除「断言失败→spy 泄漏」路径。 |
| 🟢 P4 | `frontend/src/core/logger.ts` | 34-36 | `getAll()` 返回内部数组**共享引用**，外部调用方 `push` 可污染环形缓冲（破坏 FIFO 语义与 200 上限）。当前唯一消费者 `debug-log-panel.ts:30` 仅 `.filter()` 只读，风险暂未触发。 | 返回浅拷贝 `[...this.buffer]`（或文档注明只读约定）；面板 50 条/帧渲染场景下拷贝成本可忽略。 |
| 🟢 P4 | `frontend/src/core/logger.ts` | 22, 52 | 魔法数值：`maxSize = 200` 默认值与 `new LogBuffer(200)` 字面量重复，无常量定义；帧节流 `% 60` 散落各调用方（调用方文件，非本文件）。 | 提取 `const LOG_BUFFER_MAX = 200` 模块常量；调用方节流周期可统一收口为 logger 提供常量或 `logThrottled` 辅助（可选）。 |
| 🟢 P4 | `frontend/src/core/logger.ts` | 73-109 | 三函数结构高度重复（prefix 计算 + push + console 输出三段式），仅 level 与 console 方法不同。 | 提取内部 `emit(level, tag, message, err?, args?)` 私有函数，三公开函数降为一行委托；属可选重构，无行为变更。 |

## 测试质量评价

- **有效性**：6 用例断言全部有效（`toHaveBeenCalledWith` 精确匹配参数序列），无空断言/恒真断言；`@vitest-environment node` 环境声明正确（logger 零 DOM 依赖，规避 jsdom 开销）。
- **边界覆盖（已覆盖）**：基础格式（info/warn/error 各 1）、空 message 退化 `[tag]`（test 2）、多参数透传（test 3）、warn+err 对象透传（test 5）。
- **边界覆盖（缺口）**：① `logError` 带 err 的用例缺失（仅 logWarn 覆盖）；② `setConsoleOutput(false)` 时 console 静默、缓冲仍记录的行为未测；③ 环形缓冲行为（200 上限淘汰最旧、`clearLogs`、`subscribe/unsubscribe`）未测——`debug-log-panel.test.ts` 33 用例走 mock 的 `getLogBuffer`，未触达真实 `LogBuffer`；④ undefined tag / 特殊字符 / 超长 message 未测。
- **spy 卫生**：每用例内 `mockImplementation` + 末尾 `mockRestore`，思路正确，但存在「断言失败→restore 不执行」的健壮性缺口（见 P3）。
- **无跳过/only**：grep 确认无 `it.skip`/`it.only`。
- **与生产代码一致性**：测试断言严格匹配实现语义（`message ? prefix : [tag]`、`err !== undefined` 才传第二参），无「测试迁就实现」迹象。

## 审核日期与审核员

- 审核日期：2026-08-15
- 审核员：子代理 round18-logger
