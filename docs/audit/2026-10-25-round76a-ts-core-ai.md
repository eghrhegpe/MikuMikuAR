# Round-76a 功能性审核报告 — TS core / core-ai 测试（17 文件）

> 审核日期：2026-10-25 ｜ 子代理：功能审核（round-76a）
> 范围：frontend/src/core/__tests__/ 7 个测试文件 + frontend/src/core/ai/__tests__/ 10 个测试文件
> 方法：逐文件通读测试 + 交叉核对被测源码（全部源码 <500 行，直接通读）+ 单文件测试 17 次全量执行
> 硬规则遵守：源码/测试零改动；未执行任何 git 命令；未触碰 .githooks / test-files.txt；唯一新建文件为本报告。

---

## 一、总体结论

**有条件通过（PASS with notes）**

- 17/17 测试文件全部通过（共 227 个用例，单文件 vitest v4.1.9，每个 <1.1s）。
- **0 个 P1（真实 bug）**。测试质量整体高：断言多为行为级（消息内容、事件序列、fetch 参数、排序/截断边界），mock 隔离干净，回归背景注释（ADR/fix 标记）完备。
- **1 个 P2**（error-buffer 诊断上下文丢失最新记录的怪癖）、**5 个 P3**（测试卫生污染、chat-store 旧字段未迁移、intent-dispatcher 嵌套 params 静默丢失、i18n key 缺失、env-dispatcher 双注册表零覆盖）、**10 个 P4**（弱断言/未测分支/双份测试）。
- P2/P3 的修复建议见风险表，由主模型统一实施；本代理未动手改任何代码。

## 二、亮点

| # | 亮点 | 位置 |
|---|------|------|
| H1 | HMR 误删回归锁：测试先注册旧 def 再覆盖注册新 def，断言旧 unregister 不误删新注册，与源码 registry.get(id)===def 守卫精确对应 | frontend/src/core/__tests__/action-registry.test.ts:163-188 ↔ frontend/src/core/action-registry.ts:73-79 |
| H2 | SSE 解析全分支守护：含分块传输边界（chunk 边界不在行尾）、tool_calls 多路并行按 index 聚合、reader 异常注入（AbortError/普通 Error 分流）、畸形 JSON 降级、空 data 行 | frontend/src/core/ai/__tests__/sse.test.ts:54-69, 85-124, 195-229 |
| H3 | go-adapter 用 hoisted 事件注册表模拟 Wails 事件驱动，覆盖 text/tool_call/error/abort/预中止/提交失败全流；降级路径可重放 | frontend/src/core/ai/__tests__/go-adapter.test.ts:25-40, 278-398 |
| H4 | chat-store 写失败路径断言 console.warn 文案含函数名（防"保存了却丢了"无声数据丢失） | frontend/src/core/ai/__tests__/chat-store.test.ts:146-171 |
| H5 | markdown 渲染器 XSS 守护：script/img 注入后断言不产生节点且原文本保留（纯 DOM 构建设计验证） | frontend/src/core/ai/__tests__/markdown.test.ts:73-83 |
| H6 | error-buffer（core 侧）24 用例覆盖环形语义、captureError 归一化、install 幂等、dispatch 顺序、maxBytes 边界计算 | frontend/src/core/__tests__/error-buffer.test.ts |
| H7 | 测试文件头注释统一记录回归背景与 ADR 标记（[fix P2] / [doc:adr-xxx]），可追溯性强 | 全目录通用 |

## 三、风险表（P1→P4 分级）

| 等级 | 文件 | 位置 | 观察 | 改进建议 |
|------|------|------|------|----------|
| 🟠P2 | frontend/src/core/ai/error-buffer.ts | toDiagnosticContext :319-328 | 若最新单条记录本身超过 maxBytes，循环首轮 candidate 即超限 → result 只剩「…(已截断较早记录)」marker，最新（对诊断最重要）的记录被整体丢弃 | 源码修复建议：首轮（最新记录）超预算时不丢弃，改为将该行自身截断到 maxBytes - marker.length 再纳入；配套把 frontend/src/core/ai/__tests__/error-buffer.test.ts:236-242 的弱断言（仅 ctx.length<=100）升级为「最新记录文本必须出现在 ctx 中」 |
| 🟡P3 | frontend/src/core/__tests__/runtime-bridge.test.ts | beforeEach :28-33 | window.wails = {} 只写不删、无 afterEach 恢复；isolate=false 下同 worker 后置文件若依赖 isWebPlatform()（frontend/src/core/platform.ts:28-33 判 window.wails===undefined）会误判为桌面端——违反 frontend/AGENTS.md §2.3 测试卫生（ADR-219 教训） | 加 afterEach 恢复（delete window.wails，按 ADR-219 写法顶层捕获 realWindow 再删/还原）；并 grep 同 worker 后续文件中对 isWebPlatform/isDesktop 的依赖确认无既有受害者 |
| 🟡P3 | frontend/src/core/ai/chat-store.ts | 头注释 :15-16 + loadSession :73-84 | 注释声称「兼容旧字段 mode，加载时迁移」，但代码无迁移：旧会话 meta 只有 mode 无 dialogueMode 时，loadSession 返回的 dialogueMode 为 undefined（ChatSession 类型声明 boolean），UI 三元判断会把旧会话误判为统一助手模式 | loadSession 内归一化 dialogueMode: meta.dialogueMode === true；或修正注释删掉「加载时迁移」承诺；补一条旧形状（meta 含 mode:'diagnostic' 无 dialogueMode）测试到 frontend/src/core/ai/__tests__/chat-store.test.ts:125-136 旁 |
| 🟡P3 | frontend/src/core/ai/intent-dispatcher.ts | P3 回退正则 :45 | 正则的 lazy 尾部 } 匹配在 params 含嵌套对象时停在第一个 } → JSON 不完整 → 静默返回 null（LLM 意图丢失且无日志）。测试 frontend/src/core/ai/__tests__/intent-dispatcher.test.ts:63-69 已锁定该限制，但其注释误称「见 intent-dispatcher.ts L45 注释」（源码 L44 实际无此说明） | 修复：P3 命中后对片段取到「最后一个 }」（snippet 的 lastIndexOf('}')+1 收尾）再 JSON.parse，嵌套 params 即可解析；同时在 :44 补上已知限制注释使测试注释与源码一致 |
| 🟡P3 | frontend/src/core/i18n/（zh-CN bundle） | — | 运行 action-executor 测试时 console 告警：[i18n] key "ai.actions.control.setPerformance" not found in zh-CN base bundle — possible typo（control 动作标签引用了不存在的翻译键，用户可见缺失翻译） | 在 zh-CN base bundle 补该键（或核对键名拼写）；并在 action-executor 测试中加一条「i18n 无告警」断言防回归 |
| 🟡P3 | frontend/src/scene/env/_bridge/env-dispatcher.ts | :64-81（observer handler 注册表，ADR-269 IoC 新增）、:114-139（dt tick 注册表） | env-dispatcher.test.ts 只覆盖 env callback + sceneTick 两块；两个新注册表零覆盖（重复注册覆盖/warn、miss 回退、dt tick 运行/清理/错误隔离均无） | 补 4-5 用例：registerEnvObserverHandler 双注册覆盖与告警、requestEnvObserver 未注册回退、runEnvDtTickCallbacks 多回调运行 + 单回调异常隔离 + 清理后不再触发 |
| 🟢P4 | frontend/src/core/__tests__/mmar-globals.test.ts | :82-88 | "startSceneSnapshotPolling 幂等"用例断言仅 expect(window.__mmar).toBeDefined()，未验证「第二次 start 不新注册 timer」 | 用 vi.spyOn(globalThis,'setTimeout') 断言注册次数，或经源码暴露的 timer 句柄验证 |
| 🟢P4 | frontend/src/core/__tests__/error-buffer.test.ts + frontend/src/core/ai/__tests__/error-buffer.test.ts | 整文件 | 同一模块 frontend/src/core/ai/error-buffer.ts 两份测试（core 侧 24 用例偏 ring/dispatch，ai 侧 22 用例偏 severity/prompt 场景），维护需双侧同步，存在漂移风险 | 长期归并到 ai/__tests__/（模块在 core/ai/ 下），core 侧删除或留薄壳 |
| 🟢P4 | frontend/src/core/ai/__tests__/browser-adapter.test.ts | relay 分支（对应源码 browser-adapter.ts:79-81/151-156/237-239） | mockConfig.relayUrl 恒为 ''，relay 路径（X-Target-Url 头 + fetch 目标改写）零覆盖；relayTarget 判定虽在 relay.test.ts 独立测过，但「判定→实际转发」集成无测 | 加 1 用例：stubGlobal('window', {}) + mockConfig.relayUrl=relay + 远程 endpoint，断言 fetch 命中 relayUrl 且 headers 含 X-Target-Url |
| 🟢P4 | frontend/src/core/ai/__tests__/sse.test.ts | 对照 sse.ts:56, 70-74 | 文本回退链（choices[0].text / response / message.content）只测了 delta.content；"data:[DONE]"（无空格变体）行为未测（源码 :56 精确匹配 "data: [DONE]"，无空格变体会被当普通 data 行忽略——需锁定） | 补 2-3 用例 |
| 🟢P4 | frontend/src/core/__tests__/action-executor.test.ts | 对照 action-executor.ts:21-24/52/55-59 | unknown id 分支（'不支持的操作'）、readonly data 透传、execute 抛异常→translateGoError catch 分支未测 | 补 3 用例 |
| 🟢P4 | frontend/src/core/__tests__/safe-call.test.ts | 对照 safe-call.ts:51 | safeCallAsync 传入「同步抛错的 fn」会在 fn() 调用处同步抛出（非 promise.catch 语义），未测 | 补 1 用例或源码注释声明 fn 必须返回 Promise |
| 🟢P4 | frontend/src/core/ai/__tests__/go-adapter.test.ts | 对照 go-adapter.ts:225/261-273/370-372 | 看门狗 30s 超时分支不可测（测试已注释说明，只验证 finally 不抛）；abort/提前 break 路径未断言 AiCancelStream 被调；reasoning 字符串 'true'/'false' 解析（:225）未测 | 看门狗超时改可注入（构造参数，默认 30000）后补用例；abort 用例加 AiCancelStream toHaveBeenCalled 断言；补 reasoning:'true' 用例 |
| 🟢P4 | frontend/src/core/ai/__tests__/markdown.test.ts | 对照 markdown.ts:100/155-173/121-148 | 多行段落 <br> 合并、"___" 水平线、列表类型切换（ul↔ol closeList）未测 | 补 2-3 用例 |
| 🟢P4 | frontend/src/core/ai/__tests__/character-bible.test.ts | 对照 character-bible.ts:115-125 | 数组内含非对象元素（如 [1,2]）时 lines 为空 → 落到整段文本兜底（返回 [{line:'[1,2]',emotion:'neutral'}]），行为未锁定 | 补 1 用例 |
| 🟢P4 | frontend/src/core/__tests__/env-dispatcher.test.ts | 文件位置 | 测试放在 core/__tests__ 但被测模块是 scene（frontend/src/scene/env/_bridge/env-dispatcher.ts），目录归属不一致（低优先，保持现状亦无功能风险） | 可选：迁移到 scene 侧测试目录或在文件头注释说明原因 |

**缺陷计数：P1=0，P2=1，P3=5，P4=10**

## 四、逐文件结论

### core/__tests__/（7）

| 文件（完整路径） | 用例数 | 结论 | 要点 |
|---|---|---|---|
| frontend/src/core/__tests__/action-executor.test.ts | 6 | ✅ PASS（有 P4 缺口 + 触发 P3 i18n 告警） | 双重加载回归（loadModel/loadMotion 单次加载、entity 未找到→失败且不调加载器）、参数校验（缺参/枚举非法/synonym）；mock 面大但注册表与 8 个 control 动作为真实代码，回归价值高 |
| frontend/src/core/__tests__/action-registry.test.ts | 15 | ✅ PASS（亮点） | register/dup-warn/strict throw/batch/unregister/HMR 误删回归锁，与源码守卫一一对应 |
| frontend/src/core/__tests__/env-dispatcher.test.ts | 9 | ✅ PASS（有 P3 覆盖缺口） | env callback + sceneTick 覆盖完整（含错误隔离断言 console.warn）；observer handler 与 dt tick 两个新注册表零覆盖；测试位置与模块目录不一致（P4） |
| frontend/src/core/__tests__/error-buffer.test.ts | 24 | ✅ PASS（亮点，P4 双份） | ring 语义/captureError/install 幂等/dispatch 顺序/maxBytes 边界全测；与 ai 侧同模块测试并存需同步维护 |
| frontend/src/core/__tests__/mmar-globals.test.ts | 6 | ✅ PASS（P4 弱断言） | __mmar 初始化/状态写入/快照填充/gpu 缺失降级完整；polling 幂等用例断言过弱（仅 toBeDefined）；refreshSceneSnapshot 各静默 catch 分支未测 |
| frontend/src/core/__tests__/runtime-bridge.test.ts | 2 | ✅ PASS（P3 卫生问题） | 两条用例精确锁定「init 后 events.on 命中真 Events.On / 未 init 回落 no-op」的回归场景；beforeEach 裸写 window.wails 无恢复，违反 §2.3 |
| frontend/src/core/__tests__/safe-call.test.ts | 5 | ✅ PASS（P4 边界） | 三函数成功/吞错路径 + logWarn 前缀格式断言准确 |

### core/ai/__tests__/（10）

| 文件（完整路径） | 用例数 | 结论 | 要点 |
|---|---|---|---|
| frontend/src/core/ai/__tests__/browser-adapter.test.ts | 35 | ✅ PASS（P4 relay 缺口） | 585 行强覆盖：capabilities corsRisk 三档/streamChat 全分支（含 timeout 接线、finally abort、外部 signal 清理）/testConnection/fetchModels 候选端点+缓存；relay 转发路径零覆盖 |
| frontend/src/core/ai/__tests__/character-bible.test.ts | 16 | ✅ PASS（P4 小边界） | 数据完整性/getBible 兜底/prompt 组装（含 7 情绪全断言）/parseDialogueLines 全降级链 |
| frontend/src/core/ai/__tests__/chat-store.test.ts | 14 | ✅ PASS（P3 迁移缺失） | 内存 Map 分桶 mock 干净；CRUD/倒序/损坏降级/写失败 warn 全测；旧字段 mode→dialogueMode 迁移注释承诺但代码未实现 |
| frontend/src/core/ai/__tests__/error-buffer.test.ts | 22 | ✅ PASS（P2 弱断言关联） | inferSeverity 判定矩阵、prompt 注入场景、installLoggingPatch 幂等；maxBytes 截断断言弱（<=100），接不住源码丢弃最新记录的怪癖 |
| frontend/src/core/ai/__tests__/go-adapter.test.ts | 29 | ✅ PASS（P4 看门狗不可测） | 事件驱动流全分支 + capabilities 缓存/降级 + testConnection kind 归一；30s 看门狗与 AiCancelStream 调用断言缺失 |
| frontend/src/core/ai/__tests__/intent-dispatcher.test.ts | 9 | ✅ PASS（P3 已知限制） | 三级容错解析优先级测全；嵌套 params 静默失败已锁定但属功能缺口，且测试注释引用的源码行号/注释不存在 |
| frontend/src/core/ai/__tests__/markdown.test.ts | 12 | ✅ PASS（P4 小缺口） | 解析正确性 + XSS 守护强；段落 <br> 合并、列表切换、"___" 水平线未测 |
| frontend/src/core/ai/__tests__/relay.test.ts | 8 | ✅ PASS（完整） | 判定逻辑六分支全测，与 browser-adapter 共用判定的回归说明清晰 |
| frontend/src/core/ai/__tests__/scene-snapshot.test.ts | 10 | ✅ PASS（完整） | 格式化全变体（KTX2 三态）/bridge 注入/未初始化降级/NFR-3 2048 字符预算断言 |
| frontend/src/core/ai/__tests__/sse.test.ts | 15 | ✅ PASS（P4 小缺口） | 全分支守护（含分块边界与 reader 异常注入）；回退链与 [DONE] 无空格变体未测 |

## 五、验证记录

1. **单文件测试 17/17 通过**（vitest v4.1.9，命令 cd C:Userszhujieling11MikuMikuARrontend && npm run test -- <src 相对路径>，2026-10-25 执行；路径均去掉 frontend/ 前缀）：
   - core 侧：action-executor 6 ｜ action-registry 15 ｜ env-dispatcher 9 ｜ error-buffer(core) 24 ｜ mmar-globals 6 ｜ runtime-bridge 2 ｜ safe-call 5
   - ai 侧：browser-adapter 35 ｜ character-bible 16 ｜ chat-store 14 ｜ error-buffer(ai) 22 ｜ go-adapter 29 ｜ intent-dispatcher 9 ｜ markdown 12 ｜ relay 8 ｜ scene-snapshot 10 ｜ sse 15
   - 合计 227 用例全过；0 失败、0 跳过；单文件耗时 0.3-1.1s。
2. **运行期观察**：action-executor 测试执行时 i18n 模块打印告警 [i18n] key "ai.actions.control.setPerformance" not found in zh-CN base bundle（已列入风险表 P3）；env-dispatcher 测试输出中的 @vitest/expect 栈帧为 console 噪音，非失败。
3. **合规确认**：未运行 git 命令；未修改 .githooks、test-files.txt 或任何源码/测试文件；本次唯一创建文件为本报告 docs/audit/2026-10-25-round76a-ts-core-ai.md。
