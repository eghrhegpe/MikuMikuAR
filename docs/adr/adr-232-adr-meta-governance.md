# ADR-232: ADR 元治理 —— 取代关系判别与脚本口径统一

> **状态**: 已落地（2026-08-02，多轮迭代后收口）
> **日期**: 2026-08-02
>
> **编号**: 232
>
> **关联**: [ADR-218](adr-218-knowledge-base-governance.md)（知识卡分层治理，同一「机器守护」哲学）、[ADR-230](adr-230-docs-automation-toolchain.md)（文档自动化工具链，本 ADR 是其 ADR 域延伸）、[ADR-225](adr-225-docs-partition-indexes.md)（分区索引枢纽）、[ADR-191](adr-191-god-barrel-debarreling.md)（神桶去桶化，同一「单一事实源」哲学）
>
> **来源**: ADR 已落地 200+ 篇后，难以判断哪些被后来的 ADR 取代；五个脚本（gen-status-index / gen-docs-index / check-adr-status / check-adr-health / gen-adr-supersede）对同一批 ADR 的分类口径分岐（223 vs 225 篇、12 vs 16 词表、归档桶误归 6 篇），且无任何决策文件记录「如何判别取代、坑在哪、守护规则是什么」。

---

## 一、背景与问题

ADR 文档增长到 227 篇后暴露四类问题：

### 1.1 取代关系不可判别

- 已落地 ADR 中，哪些被后来的 ADR 推翻/取代，索引看不出来；
- 「被取代」与「功能演进」混淆：单纯加参数、加效果算补充，不算取代；
- 取代信号只写在旧 ADR 首部状态行，索引层不带——「已归档」桶混入被取代/调研/搁置/放弃四类语义。

### 1.2 脚本分类口径分岐

五个脚本各维护一份状态/债务词表，对同一批 ADR 分类结论不同：

| 脚本 | 曾出现的问题 |
|------|------------|
| gen-docs-index | 归档桶正则过宽，6 篇「已完成+局部搁置」ADR 被误归已归档 |
| check-adr-status | 8 篇 ❓ 未知本可归类（缺归档语义词） |
| check-adr-health | 技术债词表 12 项 vs check-adr-technical-debt 16 项分岐 |
| gen-status-index / gen-adr-supersede | filter 不含子编号，223/225 篇报告分岐 |

### 1.3 编号唯一性被破坏

- ADR-061.1 子编号（`adr-061.1-*.md`）被多数脚本的 `\d+` 正则排除；
- ADR-230 撞号：两条工作线同时自取 230 号，索引出现两行 ADR-230。

### 1.4 守护工具自身需要守护

- supersede 五层判别的正则被测试「复制粘贴」而非 import 真身——真身改动后测试仍绿（假绿）；
- `--check` 把「废弃未指明」（合法放弃/搁置登记）当失败，挂入 CI 后恒红。

---

## 二、决策

### 2.1 取代关系五层判别（gen-adr-supersede）

新增 `scripts/gen-adr-supersede.mjs`，按证据强度分五层扫描全部 ADR：

| 层 | 信号 | 判定 |
|----|------|------|
| ① 已登记取代 | 旧 ADR 首部状态行明确「被 [ADR-NNN] 取代/推翻」 | 实锤，直接归档 |
| ② 漏标告警 | 某 ADR 正文宣称「取代/废弃了 ADR-NNN」，但被取代方首部未回标 | 实锤但漏标，需补标（**--check 唯一拦截项**） |
| ③ 废弃未指明 | 状态行含 ⚠️/🗑️ 废弃/放弃，但未指明被谁取代 | 可能只是放弃/搁置，**降级为提示不拦截** |
| ④ 可疑信号 | 正文提及「推翻/已过时」+ 其他 ADR 编号，对方未标记 | 措辞不规整，人工确认（已处理勘误的交叉引用自动过滤） |
| ⑤ 表格弱宣称 | 表格行首列为 ADR-NNN、其他列含「本 ADR…(完全)替代」 | 跨列自指关系，目标已回标则不再提示 |

**核心判定标准**：被取代 ≠ 功能演进。被取代要看**决策与理由是否被推翻**（如 ADR-012 连否决理由都被 ADR-113 推翻），而非「功能还在不在」。

### 2.2 词表单一事实源（adr-status-categories）

新增 `scripts/_lib/adr-status-categories.mjs`，统一导出：

- `STATUS_CATEGORIES`：completed / inProgress / deprecated 三表，语义与 gen-docs-index 的 ADR_BUCKETS 对齐；
- `TECHNICAL_DEBT_KEYWORDS`：技术债标记词表。

**规则**：各脚本禁止各自维护词表——check-adr-status / check-adr-health / check-adr-technical-debt 一律 import 共享模块（历史教训：16 vs 12 项分岐）。

### 2.3 子编号全链路兼容

`ADR-061.1` 这类子编号（ADR-061 的子项）在四个链路统一支持：

- 标题正则 `(\d+)` → `([\d.]+)` + `parseFloat`（61.1 与 61 不冲突）：frontmatter.mjs parseAdrHeader、gen-status-index、gen-docs-index、check-adr-health；
- filter 正则 `adr-\d+-` → `adr-[\d.]+-`：gen-status-index、gen-docs-index、fix-adr-format、fix-adr-dates；
- gen-adr-supersede：adrs Map（num 为 key）改 `adrList` 数组 + `adrNums` Set，避免两篇 061.1 同 num 互相覆盖。

### 2.4 编号唯一性守护

- 扫描脚本对编号重复（同 num 多文件）输出提示；
- 撞号消解流程：后创建者改号（如 ADR-230 ground-visual → ADR-231），`git mv` 保留历史。

### 2.5 正则共享与测试锁真身（supersede-regex）

- 五层判别正则抽到 `scripts/_lib/supersede-regex.mjs`，gen-adr-supersede 与测试共用；
- **禁止在测试里复制粘贴正则**——单测必须 import 真身，否则真身改正则后测试仍绿（假绿）；
- 测试用例覆盖：五层正则正反例、parseAdrHeader 四格式、子编号 ADR-061.1、表格弱宣称、否定语境过滤。

---

## 三、备选方案

| 方案 | 取舍 |
|------|------|
| NLP 语义分析判别取代 | 100% 召回自由措辞需 NLP，收益不成比例；正则五层已覆盖结构化句式与表格 |
| 各脚本继续各自维护词表 | 历史教训证明必分岐（16 vs 12），拒绝 |
| 061.1 保持特殊例外不进索引 | 223/225 报告分岐持续，三链路口径无法统一 |
| --check 拦截所有非零项 | 合法放弃/搁置登记导致 CI 恒红，拒绝 |

---

## 四、影响

| 文件 | 改动 |
|------|------|
| `scripts/gen-adr-supersede.mjs` | 新增：五层取代关系扫描 + --check（仅 ② 拦截） |
| `scripts/_lib/supersede-regex.mjs` | 新增：五层判别正则共享模块 |
| `scripts/_lib/adr-status-categories.mjs` | 新增：状态分类 + 技术债词表共享 |
| `scripts/_lib/frontmatter.mjs` | parseAdrHeader 支持子编号（`[\d.]+` + parseFloat） |
| `scripts/gen-status-index.mjs` / `gen-docs-index.mjs` | filter + 标题正则支持子编号 |
| `scripts/check-adr-status.mjs` / `check-adr-health.mjs` / `check-adr-technical-debt.mjs` | 词表改 import 共享模块 |
| `scripts/fix-adr-format.mjs` / `fix-adr-dates.mjs` | filter 支持子编号；67 篇 ADR 补日期行 |
| `docs/adr/*` | ADR-162/192/194/019 补取代回标；ADR-230 撞号消解为 231 |
| `scripts/_lib/*.test.mjs` | supersede/frontmatter 等测试锁真身 |

**验证**：`npm run test:scripts` 124 例全绿；`npm run check:docs` exit 0；supersede 五层收敛（①6/②0/③3 提示/④0/⑤0）。

---

## 五、相关文档

- [AGENTS.md](../AGENTS.md)「ADR 取代判别方法」小节（五层证据表 + 核心判定标准 + 规矩化流程）
- `docs/knowledge/` 知识卡（ADR 关联 0 漂移）
