# Round-76c — 测试脚本与 Python 契约测试审核结果

> 审核对象：`scripts/*.test.mjs` 12 个 + `tests/*.py` 2 个（零依赖 Node 工具链测试 + Python 契约脚本）
> 审核日期：2026-10-25 ｜ 审核方：功能性审核子代理（只读源码/测试，仅本文件可写）
> 方法：逐文件通读测试 + 交叉核对被测源码（>500 行先 grep 定位）；单文件执行验证（node 逐文件 / python 直跑），未跑全量套件。

## 总体结论

**有条件通过**（14 文件中 12 PASS、4 有缺陷；执行层面 1 个失败，归因仓库现状而非测试逻辑错误）

- **P1（测试内真实 bug）：0**。
- **P2（高风险缺口）：0**。
- **P3（中风险）：13 条**（风险表 #2–#14） — 集中于①历史 P1/P2 修复缺回归测试（link-checker SKIP_DIRS 目标跳过无锁）②测试内部一致性缺陷（自证断言、注释失实、inline 副本违背去副本政策、help/unknown 契约未测）③被测源码显示层 bug（knip 格式漂移 → [object Object]）。
- **P4（卫生）：6 条**（风险表 #15–#20）— 弱断言、未测边缘、文档细节。
- **执行结果**：12 个 .mjs 单文件执行 11 PASS / 1 FAIL（check-cli.smoke：check-deadcode-baseline 判 REGRESSION——perception-shared.ts 新增重复导出未入基线，门禁行为正确）；2 个 .py 直跑均 exit 0（test_markdown_links 打印 102 条断链为信息性输出，设计如此）。

## 亮点

- **P1 回归锁扎实**：`scripts/_lib/circular.test.mjs:244-256` 锁定钻石结构全量枚举（detectCycles 必须同时给出 a→c→b→a 与 a→b→a），对应 `check-circular.mjs:115-119` 的 P1 2026-08-06 修复；cycleSetKey/representativeCycles 同源不变式（L378-406）锁死 ADR-268 的 234 条假漂移机制。
- **fixture 化程度高**：`scripts/_lib/source-graph.test.mjs` 全 14 用例走真实 scanSourceGraph + mkdtemp（try/finally 清理），无 inline 副本；type-only 口径反转（2026-10-23）三形态全锁（L314-342）。
- **fail-closed 契约测试**：`scripts/__tests__/check-diff-coverage.test.mjs` 用 `--base __NO_SUCH_REF_9x__` + 空 coverage 测 git 失败时 blocking 退 2 / suggest 退 0；`scripts/__tests__/check-layering.test.mjs` 锁基线缺失 fail-closed 退 1。
- **同源自锁**：`scripts/_lib/supersede.test.mjs` 严格按 `supersede-regex.mjs:5-6` 政策 import 真身正则；globalOf 无状态语义测试（L458-465）；全部历史回归（08-06 粗体/全角括号、10-23 反事实语气）均有对应用例。
- **不变式断言强**：`scripts/check-cli.smoke.test.mjs:250-270` dep-metrics 段断言 cyclesBacked+cyclesArtifact===cycles、realModuleSccMax<=moduleSccMax、cyclesNew===0。
- **防御性回归**：link-checker 非 UTF-8 no-crash；`tests/test_markdown_links.py:139-148` null-byte 兜底（resolve_target try/except + \x00 短路）。

## 风险表

| # | 文件 | 位置 | 等级 | 观察 | 改进建议 |
|---|------|------|------|------|----------|
| 1 | scripts/check-cli.smoke.test.mjs | L328-331 | 🔴 执行失败（仓库现状） | check-deadcode-baseline 退 1（REGRESSION）：knip 发现 `src/scene/motion/perception-shared.ts:218 isWasmRuntime` 与 `:222 _isWasmRuntime` 重复导出未入基线；门禁行为正确，测试断言无误 | 主模型二选一：清理该死导出，或按脚本提示跑 `cd frontend && node ../scripts/check-deadcode-baseline.mjs --update` 更新基线；超出子代理只读权限 |
| 2 | scripts/check-cli.smoke.test.mjs | 被测源 `check-deadcode-baseline.mjs:183-186` | 🟡 P3 | knip JSON 格式漂移：现装 knip 的 duplicates 元素为「符号对」`[[{name,line,col,pos},{...}]`（2026-10-25 实证），08-08 P2 修复按旧形 `[name, line]` 写 → 报告行打印 `dup [object Object] :[object Object]`，人读信息全丢（门禁计数 L81 按外层计，不受影响） | 改两级兼容：`const [a, b] = Array.isArray(d) ? d : [d]; const an = a && a.name; const al = a && a.line;` 打印 `dup an:al ↔ b`；补 knip 双形态夹具测试 |
| 3 | scripts/check-cli.smoke.test.mjs | L11 vs L208/L300/L314 | 🟡 P3 | 头注释声称「刻意不硬编码行号/环数」，但 L300 `scannedFiles>=300`、L314 `/菜单 folder 面板: 34 个/`、L208 `/boolean 字段总数: 25/` 均稳态硬编码——良性漂移即全红；L208 的 \\| 或正则命中标题行即通过，断言弱 | L208 改 `/boolean 字段总数:/` + JSON 数值比较；L300/L314 读台账现值或设漂移阈值 |
| 4 | scripts/__tests__/link-checker.test.mjs | L139 | 🟡 P3 | `assert.notEqual(r.code, null)` 恒真（spawn 的 code 恒为 number）——注释自述「exit 0 或 1 均可」却未断言集合，断言退化为空操作 | 改 `assert.ok(r.code === 0 || r.code === 1)` |
| 5 | scripts/__tests__/link-checker.test.mjs | L147-148 | 🟡 P3 | 注释声称 dancexr-zh 跳过「已由 CLI fixture 覆盖」——实际 fixture 未创建任何 dancexr-zh 目录，`link-checker.mjs:214` main() 跳过逻辑零覆盖；P1 2026-10-23 修复（`link-checker.mjs:148-152` SKIP_DIRS 目标跳过）亦无回归测试 | fixture 增 `docs/research/dancexr-zh/x.md`（含指向 SKIP_DIRS 目标的链接），断言 strict 下该断链被跳过（exit 0）；修正 L147 注释 |
| 6 | scripts/_lib/circular.test.mjs | L115、L145-196、L303-328 | 🟡 P3 | 三处 module-graph 用例仍用 inline DFS/inline 建图（与生产 buildModuleGraph/detectCycles 不同源），与文件头 P2 2026-08-06「去副本直测」政策自相矛盾——副本与生产同缺陷时给假绿；L115 仅断 `moduleGraph.size>0` 近乎空断言 | 三处改调生产 buildModuleGraph + detectCycles（L244-256 已有范例）；L115 改断言具体边集合 |
| 7 | scripts/_lib/parse-args.test.mjs | L75-99（缺失） | 🟡 P3 | 源码 L19/L34-37 的 `--help`/`-h` → `help:true`（不入 unknown）与 L21/L53-55 的 `unknown` 数组契约（调用方据此退 1）零测试：L75-81 只断 `strict` 与 `_`，从未检查 `args.unknown` | 补 help:true 用例（--help 与 -h 各一）；L75 加 `assert.deepEqual(args.unknown, ['--unknown'])` |
| 8 | scripts/__tests__/check-diff-coverage.test.mjs | 全文件（179 行） | 🟡 P3 | getChangedFiles（check-diff-coverage.mjs:84-119）、detectRenames（:161-179）、getChangedLines（:182-219，含暂存 rename blob-diff fail-closed :190-199）、isSourceFile（:222-232）、matchCoverageKey（:235-245）、--files/--uncommitted/未知 flag 均未测 | 补 git 夹具：一次暂存区 rename 走 blob-diff 路径；--files 显式清单 |
| 9 | scripts/__tests__/check-layering.test.mjs | 全文件（189 行） | 🟡 P3 | R1（algo→menus）与 R3（algo→scene）规则（check-layering.mjs:116-118）零用例；相对 import 解析（:82-85）、裸包名跳过（:87）、--update 重写基线（:136-145）未测 | fixture 增 2 个违规文件触 R1/R3；--update 后基线 diff 断言 |
| 10 | scripts/__tests__/new-adr.test.mjs | 全文件（149 行） | 🟡 P3 | --reserve、--related、多值 --supersedes（new-adr.mjs:79 按 `[，,]` split）、子编号 ADR-061.1、手工格式保护（:334-338）、validateSupersedes 失败路径（:262-289）未测 | 补 multi-supersedes 中英文逗号混用 + validateSupersedes 指向不存在 ADR 的 exit 1 用例 |
| 11 | scripts/_lib/source-graph.test.mjs | 全文件（386 行） | 🟡 P3 | scanSourceGraph 的 scope/localOnly 分支（source-graph.mjs:109-146 可达集展开）零测试；EXCLUDE_DIRS/EXCLUDE_FILES（:7-8：__tests__、node_modules 跳过，.d.ts/.test.ts 排除）未测 | 夹具加 __tests__/ 与 .d.ts 干扰文件断言不入图；scope + localOnly 两态断言节点集 |
| 12 | scripts/_lib/supersede.test.mjs | 全文件（529 行） | 🟡 P3 | 正则全部锁真身（亮点），但 gen-adr-supersede.mjs 五层**优先级组合**行为（①/②/③ 分桶与豁免互斥；L516-523 只锁了 ④ 不豁免）无组合用例；parseAdrHeader 日期格式错误路径（frontmatter.mjs:169）未测 | 补组合场景（①+③ 同状态行分桶顺序）与坏日期 error 用例 |
| 13 | tests/test_markdown_links.py | L13-15 vs L211-220 | 🟡 P3 | docstring 声明「退出码 1 = 存在断裂链接」，实现却是断链只打印 WARNING + informational 提示，exit 1 仅限文档读取失败（L219-220）——文档与行为矛盾 | docstring 改为「0 = 正常（断链仅告警）；1 = 文档读取失败」，与 L215 Tip 对齐 |
| 14 | tests/test_markdown_links.py | L98-103 + L177-179 | 🟡 P3 | 引用式链接 `[text][ref]` 与 `[ref]: url` 被提取（策略 §2 自称匹配引用式）但主循环对 ref: label 一律 skip → 断掉的引用式链接永不报错，静默盲区 | 实现 ref 定义目标校验（L102-103 已提取 url），或 docstring/Tip 明示「引用式链接不校验」 |
| 15 | tests/test_markdown_links.py | L199 | 🟢 P4 | 断链报告打印含占位符（\x00CODE{n}\x00）的原始 url（终端显为「PMX 加载失败： CODE43 .md」类伪码），而非 L192 还原后的 path_part——人读定位困难 | L199 改打印 restore_ph(url, placeholders) |
| 16 | tests/test_config_syntax.py | L46 | 🟢 P4 | `Path.read_text("utf-8", errors="replace")` 的 errors 形参需 Python ≥3.13（本机 3.14.5 通过）；低版本环境 TypeError 崩脚本 | 改 `fp.read_text(encoding="utf-8")` 兼容 3.8+ |
| 17 | scripts/_lib/frontmatter.test.mjs | L26-33 | 🟢 P4 | 用例名「ignores trailing spaces」实际只 `assert.ok`，且 frontmatter.mjs:20 捕获组本就把行尾空格带进块内（并未 ignore）——名实不符 + 弱断言 | 改断精确块值并在用例名注明「行尾空格保留在块内」 |
| 18 | scripts/_lib/to-posix.test.mjs | L31-37 | 🟢 P4 | toNative 两用例期望值用 split/join 现算（与 to-posix.mjs:23 的 replace 同逻辑）——自证 oracle，只验证可执行不验证行为 | 写死平台相关期望（按 path.sep 分支） |
| 19 | scripts/__tests__/codemod.test.mjs | 全文件（256 行） | 🟢 P4 | ensureImport 多源合并（codemod.mjs:311-322）、namespace 人工告警（:492-495）、grep 字符串提示（:344-363）未测；全文件依赖 frontend/node_modules 的 ts-morph（环境敏感） | 补同名多源合并用例；文件头注明 ts-morph 环境依赖 |
| 20 | scripts/check-cli.smoke.test.mjs | L49 | 🟢 P4 | FootLandEvent / feet-event.ts 符号硬编码（ADR-238 台账值），符号重命名即全红 | 改从 check-consumers --json 的 definitions 动态取首个 symbol |

## 逐文件结论

| 文件 | 结论 | 用例覆盖度 | 断言强度 | 备注 |
|------|------|-----------|---------|------|
| scripts/__tests__/check-diff-coverage.test.mjs | PASS | 中（核心 4 函数 + 2 CLI fail-closed；git 正常路径全缺） | 强 | 风险表 #8；执行 PASS |
| scripts/__tests__/check-layering.test.mjs | PASS | 中（R2 三形态 + 基线三态；R1/R3 缺） | 强 | 风险表 #9；执行 PASS |
| scripts/__tests__/codemod.test.mjs | PASS | 高（rename/move 6 守卫 + add-param 双路径 + tsc 门禁） | 强 | 风险表 #19；执行 PASS（依赖 ts-morph 实仓） |
| scripts/__tests__/link-checker.test.mjs | 有缺陷 | 中高（extract/resolve/walk 直测 + CLI 三态） | 中（L139 空断言、L147 注释失实） | 风险表 #4/#5；执行 PASS |
| scripts/__tests__/new-adr.test.mjs | PASS | 中高（标注幂等/锁竞争/CRLF/dry-run；参数面缺） | 强 | 风险表 #10；执行 PASS |
| scripts/_lib/circular.test.mjs | 有缺陷 | 高（P1 钻石/同源 key/代表环全锁） | 中（3 处 inline 副本违背政策） | 风险表 #6；执行 PASS |
| scripts/_lib/frontmatter.test.mjs | PASS | 高（4 函数全形态含 CRLF/围栏/混合空白） | 中高 | 风险表 #17；执行 PASS；parseAdrHeader 由 supersede.test 覆盖 |
| scripts/_lib/parse-args.test.mjs | 有缺陷 | 中（bool/string/default/-- 分隔全；help 与 unknown 契约缺） | 中 | 风险表 #7；执行 PASS |
| scripts/_lib/source-graph.test.mjs | PASS | 高（14 fixture 全走生产；type-only 三口径） | 强 | 风险表 #11；执行 PASS |
| scripts/_lib/supersede.test.mjs | PASS | 高（全正则真身 + 全部历史回归 + globalOf 语义） | 强 | 风险表 #12（组合层）；执行 PASS |
| scripts/_lib/to-posix.test.mjs | 有缺陷（仅卫生级） | 低-中（源仅 24 行，用例 7 个） | 弱（toNative 自证 oracle） | 风险表 #18；执行 PASS |
| scripts/check-cli.smoke.test.mjs | 有缺陷（执行 FAIL，归因仓库现状） | 高（19 个 CLI 冒烟 + 不变式断言） | 中（稳态硬编码 3 处） | 风险表 #1/#2/#3；执行 FAIL（L328-331） |
| tests/test_config_syntax.py | PASS | 低（活仓契约：wails.json/Taskfile + go.mod 三段校验） | 中 | 风险表 #16；python 3.14.5 直跑 exit 0「OK」 |
| tests/test_markdown_links.py | PASS（设计 print-only） | 中（1175 文件 2756 链接，102 断链告警） | 中 | 风险表 #13/#14/#15；python 直跑 exit 0（断链不阻断，但 docstring 自相矛盾） |

**有缺陷文件 4 个**：link-checker.test.mjs（P3×2）、circular.test.mjs（P3×1 政策违背）、parse-args.test.mjs（P3×1 契约缺口）、check-cli.smoke.test.mjs（执行失败 + P3×2 + P4×1）；to-posix.test.mjs 仅 P4，结论列记「有缺陷（仅卫生级）」。

## 验证记录

| 验证 | 命令（项目根目录） | 结果 |
|------|-------------------|------|
| node 单文件 ×11 | `node <file>` 逐个执行（node:test 直接 import 即跑） | 11/11 PASS（check-diff-coverage / check-layering / codemod / link-checker / new-adr / circular / frontmatter / parse-args / source-graph / supersede / to-posix） |
| node 冒烟 ×1 | `node scripts/check-cli.smoke.test.mjs` | **FAIL**：L330 `assert.equal(r.code, 0)` 实际 1 !== 0，失败用例「check-deadcode-baseline: 正常路径跑通」；复跑 `node scripts/check-deadcode-baseline.mjs` 确认 REGRESSION：perception-shared.ts 重复导出 isWasmRuntime:218 / _isWasmRuntime:222 未入基线，末行提示 `--update` |
| knip 格式实证 | `node node_modules/knip/bin/knip.js --reporter json`（frontend 目录） | duplicates 元素为 `[[{name,line,col,pos},{name,line,col,pos}]` → 坐实风险表 #2 格式漂移 |
| python 直跑 | `python tests/test_config_syntax.py`（Python 3.14.5） | exit 0「OK: wails.json + go.mod syntax checks passed」 |
| python 直跑 | `python tests/test_markdown_links.py` | exit 0；Files 1175 / Links 2756（ext 117, ref 5, anchor 12）；WARNING 102 断链（buglog/index.md 相对链接与 upstream 绝对路径为主）——信息性，设计不阻断 |
| 源码交叉核对 | check-circular.mjs / codemod.mjs / new-adr.mjs / link-checker.mjs 等（>500 行均先 grep 定位再读） | 见「风险表」各行行号引用 |

## 处置建议（供主模型）

1. **先处置 #1**（唯一执行红）：清理 perception-shared.ts 的重复导出（isWasmRuntime/_isWasmRuntime 二选一）或 `--update` 基线——超出本子代理只读权限。
2. **#2 源码修复**：`check-deadcode-baseline.mjs:183-186` 两级兼容 knip 新形态（建议改动已给），并补夹具测试。
3. #4-#12 为测试强化项，可批量排入下轮；#13-#18 文档/报告微修。
4. 102 条断链（buglog 相对链接、upstream 绝对路径 /docs/...）建议单独建 docs 卫生任务，不属本轮 14 文件。