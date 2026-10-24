# Round-77 审核报告 — scripts P3/P4 台账批次 + 5dae3abc 顺带审核

> 日期: 2026-10-25 ｜ round-76c 报告风险表 #2–#20 的 17 项可操作项落实 + 5dae3abc（ADR-276 收口）顺带审核
> 模式: test-files.txt 队列 308/308 清零后转入登记风险台账批次；3 子代理锁文件制 + 主模型 diff 抽检

---

## 执行摘要

| 子代理 | 范围 | 文件数 | 用例变化 | 结论 |
|--------|------|--------|----------|------|
| R1 | #4/#5/#7/#17/#18 | 4 改 | link 9/9, parse 16/16(+2), front 30/30, to-posix 7/7 | ✅ 全绿 |
| R2 | #6/#8/#9/#10/#11/#12 | 6 改 | circular 25/25, diff-cov 23/23(+12), layering 13/13(+5), new-adr 14/14(+8), source-graph 19/19(+3), supersede 73/73(+3) | ✅ 全绿 |
| R3 | #13/#14/#15/#16/#3/#2 | 3 改 + 1 新建 | markdown-links WARNING 102→107(+5 ref 无定义), config-syntax OK, smoke 32/32, knip-fixture 3/3 | ✅ 全绿 |

**5dae3abc 顺带审核**：requireBuildLevel 收口（10 处非空断言消除）✓、browser-adapter strict-null 去双重断言 + 补 frameCapEnabled/prop 影子字段 ✓、断言 ratchet 门禁脚本（AST 计数、fail-closed、只许降）✓。P4 nit：motion-actions.ts:291/311 `_buildLevel!` 为本地函数的冗余断言（2 处计入 nonNull 基线）。

**lighting WIP 审核**：requireLightingScene（lighting-state.ts:104）ADR-276 收口形态一致，lighting-stage.ts 8 处 + lighting-follow.ts 的 `scene!` 已迁至 require*。唯一待消解 = 知识卡 lighting-state.md 符号漂移（pre-commit 钩子在 lighting 提交时自动同步）。

---

## 逐项落实

| # | 文件 | 动作 | 要点 |
|---|------|------|------|
| #2 | scripts/__tests__/check-deadcode-baseline.test.mjs（新建） | 夹具 | knip duplicates 三形（符号对象数组/[name,line]对/{name,line}对象）参数化；沙箱拷真脚本+to-posix、假 knip 入口注入 JSON、全零基线走 REGRESSION 路径断言 dup 行无 [object Object] |
| #3 | scripts/check-cli.smoke.test.mjs | 去稳态硬编码 | boolean 字段总数动态提取 \d+ >0；magic-numbers 读台账「模块文件数」±10% 比较；面板数漂移阈值 [20,60] |
| #4 | scripts/__tests__/link-checker.test.mjs | 断言修复 | notEqual(code,null) 恒真 → ok(code===0\|\|code===1) |
| #5 | 同上 | 回归测试 | dancexr-zh fixture（x.md 触 L214 源排除 + y.md 触 L148-152 目标排除）；注释修正 |
| #6 | scripts/_lib/circular.test.mjs | 去副本 | 4 处 inline DFS/建图（含自查 self-import）改调生产 buildModuleGraph+detectCycles；L115 空断言改具体边集 |
| #7 | scripts/_lib/parse-args.test.mjs | 契约补全 | unknown 数组 deepEqual + --help/-h help:true 且不入 unknown |
| #8 | scripts/__tests__/check-diff-coverage.test.mjs | +12 用例 | --files/--uncommitted/--help/未知 flag/detectRenames/getChangedLines blob-diff 暂存 rename fail-closed |
| #9 | scripts/__tests__/check-layering.test.mjs | +5 用例 | R1 零容忍 + R3 超/入基线 + 相对 import/裸包名 + --update 基线 diff + --update 对 R1 不豁免 |
| #10 | scripts/__tests__/new-adr.test.mjs | +8 用例 | multi-supersedes 逗号混用 + 不存在 ADR exit 1 + 混合坏目标 + 子编号 + 手工格式保护 + --reserve/--related |
| #11 | scripts/_lib/source-graph.test.mjs | +3 用例 | EXCLUDE __tests__/.d.ts + scope DFS 可达集 + localOnly 限制 |
| #12 | scripts/_lib/supersede.test.mjs | +3 用例 | ①+③ 分桶顺序 + 坏日期 error + 五层组合夹具 |
| #13 | tests/test_markdown_links.py | docstring | 退出码语义修正（0=正常，1=读取失败） |
| #14 | 同上 | 功能增强 | ref 定义表校验（CommonMark 文件域、restore_ph 前置、informational-only）；WARNING 102→107 |
| #15 | 同上 | 输出修复 | 断链报告打印 restore_ph 后的 path_part，删死变量 |
| #16 | tests/test_config_syntax.py | 兼容 | read_text(encoding=) + 同源调用点 read_bytes().decode(errors=replace) |
| #17 | scripts/_lib/frontmatter.test.mjs | 断言强化 | 精确块值 assert.equal + 用例名修正 |
| #18 | scripts/_lib/to-posix.test.mjs | oracle 修复 | NATIVE_EXPECTED 平台硬编码替代 split/join 自证 |

**未落地（P4 登记）**：#19 codemod 多源合并（依赖 ts-morph 实仓，环境敏感）、#20 smoke FootLandEvent 硬编码（待改从 --json 动态取 symbol）。

---

## P4 登记项

| # | 文件 | 观察 | 建议 |
|---|------|------|------|
| P4-1 | scripts/_lib/supersede.test.mjs #12 | gen-adr-supersede.mjs 的 scan-files.mjs getRoot() 固定仓库根、无 ADR_DIR env 钩子 → 组合用例按生产 L110-218 逐行复刻判定式 + 锁真身正则（非去副本直测） | 给 scan-files.mjs 加 env 钩子（如 ASSERTION_SRC 同模式），让组合用例走生产 |
| P4-2 | scripts/__tests__/check-diff-coverage.test.mjs #8 | getChangedLines blob-diff 用例用 HEAD:README.md 两点 diff（依赖仓库内容，文件重命名即断） | 或 accept（fixture 模式受限：生产 git() 钉死 REPO_ROOT 无法注入 tmpdir） |
| P4-3 | frontend/src/core/action-defs/motion-actions.ts:291,311 | `_buildLevel!` 为本地函数（L73）的冗余非空断言（2 处，计入 nonNull 基线） | 删 `!` → ratchet 133→131（或当前基线值-2），可 `--update` 收紧 |
| P4-4 | #19/#20 | codemod 多源合并未测 + smoke FootLandEvent 硬编码 | 排后续轮次 |

---

## 验证

| 项 | 结果 |
|---|---|
| 11 scripts test 文件 node 单跑 | 全 PASS |
| python ×2 直跑 | exit 0（config-syntax OK；markdown-links 1178/2759/107WARNING） |
| cd frontend && npm run check | exit 0 |
| node scripts/check-deadcode-baseline.mjs | exit 0（requireLightingScene 已被消费 → 未使用导出回 38） |
| node scripts/check-cli.smoke.test.mjs | exit 1（唯一红 = gen-knowledge-symbols: lighting-state.md 符号漂移 +[requireLightingScene]，属用户 lighting WIP 未提交态） |

---

## 状态

- 本轮 17/19 项落地（#19/#20 P4 登记）；3 子代理报告 + 主模型 diff 抽检 + 独立复跑验证全过。
- 5dae3abc（ADR-276 收口）已提交本地（ahead 1），含 requireBuildLevel 收口、browser-adapter strict-null、断言 ratchet 门禁。
- lighting WIP（requireLightingScene 3 文件）仍在工作区未提交——pre-push check:docs 会因知识卡漂移阻断推送，用户提交 lighting 时 pre-commit 钩子自动同步卡即可消解。
- round-77 提交待落（scripts 11 文件 + 本报告）。