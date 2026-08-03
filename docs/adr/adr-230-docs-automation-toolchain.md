# ADR-230: 文档自动化工具链决策 —— 从手写索引到机器守护的完整闭环

> **状态**: 已落地（2026-08-02，十轮抽样迭代后收口）
> **日期**: 2026-08-02
>
> **编号**: 230
>
> **关联**: [ADR-218](adr-218-knowledge-base-governance.md)（知识卡分层治理）、[ADR-191](adr-191-god-barrel-debarreling.md)（神桶去桶化，同一「去重/分层」哲学）、[ADR-225](adr-225-web-pages-path-reallocation.md)（Web 部署路径重分配——分区索引枢纽）、[ADR-229](adr-229-e2e-automation-advancement.md)（E2E 自动化推进）
>
> **来源**: 2026-08-02 十轮文档抽样审查中，新增 7 个文档生成脚本（gen-routes / gen-knowledge-adr / gen-knowledge-tests / gen-guide-gap / gen-knowledge-h1 / gen-knowledge-graph / gen-ui-entry）——这些工具已实际运行于文档维护，但**没有任何决策文件记录「为什么这么设计、坑在哪、守护规则是什么」**，违背 ADR-218「决策真相源」原则。

**决策者**: Riku（联邦首席架构师 AI）、Jieling（人类侧首席架构师）

**创建日期**: 2026-08-02

---

## 1. 背景

`docs/knowledge/` 知识卡层自 ADR-218 治理后，机器可校验字段（kind/name/category/tier/source_files/symbols/adr/invariants/use_when/UI 入口）已由 `check-doc-drift.mjs` 守护。但知识卡只是文档体系的一部分：

- **索引层**（index.md / status.md / function-map.md / menu-map.md / dep-graph.md）早已机器生成；
- **检索层**（routes.md 路由表、graph.md 关联图、guide 缺口扫描）在 2026-08 之前是**手写**或**不存在**；
- 十轮抽样审查把检索层逐步自动化，但**每次自动化都新增一个 gen 脚本，却从未写决策文件**。

同时，自动化脚本本身引入了**新的风险面**：脚本重建 frontmatter 时的正则 bug 曾两次污染机器守护的数据（`source_files:tests:` 粘连 26 张卡、`invariants:` 混入 tests 路径 26 张卡）——「守护数据的工具」自身需要被守护。

## 2. 决策

### 2.1 工具链分层（索引层全自动、内容层手写）

| 层 | 工具 | 生成方式 | 守护 |
|----|------|---------|------|
| 分区索引 | `gen-docs-index.mjs`（5 分区 + ADR 反查表） | 机器 | `check:docsindex` |
| 状态索引 | `gen-status-index.mjs` | 机器 | `check:status` |
| 菜单地图 | `gen-menu-map.mjs` | 机器 | `check:menumap` |
| 函数索引 | `gen-funcmap.mjs` | 机器 | `check:funcmap` |
| 依赖图 | `gen-dep-graph.mjs` | 机器 | —（自查产物） |
| 符号同步 | `gen-knowledge-symbols.mjs` | 机器 | `check:knowledge-symbols` |
| tier 标注 | `gen-tier.mjs` | 机器（人工复核队列） | `check:tier` |
| 卡标题 | `gen-knowledge-h1.mjs` | 机器 | `check:knowledge-h1` |
| UI 入口 | `gen-ui-entry.mjs` | 机器（引用 menu-map） | `check:ui-entry` |
| 意图路由 | `gen-routes.mjs` | 机器（use_when + 共享 ADR） | `check:routes` |
| adr 关联 | `gen-knowledge-adr.mjs` | 机器（[doc:adr-] 显式标记） | `check:adr` |
| tests 登记 | `gen-knowledge-tests.mjs` | 机器（__tests__ 扫描） | `check:knowledge-tests` |
| guide 缺口 | `gen-guide-gap.mjs` | 机器（menu-map 对照） | `gen:guide-gap`（WARN） |
| 统一守护 | `check:docs`（15 环节串行） | — | CI + pre-push 简报 |

**原则**：
- 一切「能从磁盘扫描得出」的信息（索引/计数/链接/符号/状态/依赖/菜单/路由/关联）100% 机器生成，禁手改；
- 一切「需要人类判断」的内容（知识卡正文、guide 操作步骤、ADR 论述、tier 边界）保留手写，机器只做校验与缺口提示；
- 每个生成物必须有 `--check` 模式并接入 `check:docs` 守护链，防「机器产物与源码漂移无人察觉」。

### 2.2 frontmatter 字段语义校验（ADR-230 新增，防脚本污染）

**规则**：知识卡 frontmatter 中，路径类值（`frontend/...`）**只允许出现在 `source_files` / `tests` / `scope` 三个字段内**；其余字段（`invariants` / `use_when` / `symbols` 等）出现路径行即判 ERROR。

**动机**（两次真实事故）：
1. `gen-knowledge-tests` writeTests 正则 `\s*$` 在 m 模式下匹配任意行尾，导致 source_files 块截断成 `source_files:tests:` 粘连（26 张卡）；
2. 修复脚本 v2 重建 frontmatter 时把 tests 路径残留在 `invariants:` 块内（26 张卡）。

两次事故都表现为「脚本在错误字段注入路径」，且**check-doc-drift 原有校验全部通过**（source_files 磁盘存在性、category/tier 枚举都正常）——因为路径存在于磁盘，字段语义却没有被检查。本规则补上「字段×内容类型」维度，从根上防住此类污染。

**实现**：`checkKnowledgeMeta()` 内按 frontmatter 行扫描，跟踪当前顶层字段，非 PATH_FIELDS 字段下出现 `- frontend/*.ts` 行即 ERROR（已在 check-doc-drift.mjs 落地）。

### 2.3 内容层缺口扫描（WARN 不阻断）

`gen-guide-gap.mjs` 扫描菜单面板 vs guide 页面覆盖，输出缺口（WARN，`--strict` 可 CI 阻断）。与 gen-routes 的 use_when 冲突检测同一模式：**机器扫描缺口、人工写正文**，声明式菜单新增面板后指南不会静默漏页。

## 3. 方案对比

| 方案 | 内容 | 结论 |
|------|------|------|
| A. 全手动维护 | routes/guide/tests 登记全手写 | ❌ 已证伪：75 条路由映射易遗漏、tests 登记断链 |
| B. 全自动生成内容 | 用 LLM 从代码生成 guide 正文 / ADR 论述 | ❌ 违背分层哲学，正文质量不可机器校验 |
| C. **机器生成可校验部分 + 人工写内容层 + 全链守护**（采纳） | 见 2.1-2.3 | ✅ 自动化 13 个生成物、15 环节守护、字段语义校验防脚本污染 |

## 4. 验证

- `npm run check:docs`（15 环节）全绿：`check:status → check-doc-drift → check-schema-groups → i18n-check → gen-knowledge-symbols → gen-tier → gen-docsindex → check:knowgraph → check:ui-entry → check:knowledge-h1 → check:routes → check:adr → check:knowledge-tests → check:menumap → check:funcmap → check:md-links`
- 负向测试：向 markdown.md 的 `invariants:` 注入 `frontend/` 路径行 → check-doc-drift 以 ERROR 拒绝（exit 1）✅
- 全量复扫：`source_files:tests` 粘连 0、`invariants` 混入 0、tests 重复 0、architecture 卡缺 adr/invariants 0

## 5. 后续（可选）

- `gen-guide-gap --strict` 接入 `check:docs`（当前 WARN 不阻断，等 guide 缺口清零后升级）；
- 把「字段×内容类型」校验扩展到 `use_when` 冲突检测的机器消歧（当前仍是人工）；
- buglog 七轮审核标记的 P1「零测试覆盖」模块（env-clouds / bone-override / vmd-layers 等）是下一个内容层山头，不属于本 ADR 范围。
