# ADR-241: .mjs 脚本文档统一约定（跨仓库硬约束）

> **状态**: ✅ 已实施（2026-08-05 完成；两端 README 同款节 + 四口径检查器 `check-script-hygiene.mjs` 落地并自执行）
> **日期**: 2026-08-05
>
> **编号**: 241
>
> **关联**: [ADR-230](adr-230-docs-automation-toolchain.md)（文档自动化工具链 — 本 ADR 为其 scripts 治理子集）、[ADR-232](adr-232-adr-meta-governance.md)（ADR 元治理 — 同款「脚本口径统一」思路延伸到 ADR 登记表）、[ADR-234](adr-234-env-state-parity-guard.md)（parity 防线范式 — 检查脚本终结漂移）
>
> **来源**: 2026-08-05 两仓库 `scripts/*.mjs` 同步对账分析（同源 fork 后独立演进，内容一致性极低）。

**决策者**: Riku（联邦首席架构师 AI）、Jieling（人类侧首席架构师）

**创建日期**: 2026-08-05

---

## 1. 背景：同源 fork 已严重分叉，文档约定失准

`MikuMikuAR/scripts/` 与 `ysm-model-manager/scripts/` 源于同一 fork，约 45 个 `.mjs` 大量同名，但各自独立演进，文档约定分叉。2026-08-05 同步对账实测：

| 维度 | MikuMikuAR (A) | ysm-model-manager (B) |
|------|---------------|----------------------|
| 同名 `.mjs` | 25 个，其中 24 个内容分叉，仅 `_lib/to-posix.mjs` 字节一致 | 同左 |
| 用户态工具零一致 | ✅ 0 个字节一致 | ✅ 0 个字节一致 |
| 文件头 5 字段合规 | 🟢 4 / 🟡 25 / 🔴 14（达标率 9.3%） | 🟢 10 / 🟡 20 / 🔴 12（达标率 23.8%） |
| `--json` 契约缺口（检查类） | 8 个（机检实校 7） | 1 个（机检实校 0） |
| 零头部脚本（无 JSDoc） | 10 个 | 10 个 |
| 执行机制 | ❌ 无自执行卡点 | ✅ `check-script-hygiene.mjs` 三口径 |

**根因**：fork 后无统一文档基线 + 无跨仓库 enforcement，导致同名脚本「同名异实」（如 `check-doc-drift` 行数差 +492、`check-circular` +283）、头部字段参差、检查类脚本缺 `--json` 使 CI/子代理无法稳定消费。

## 2. 决策

确立**单一权威文档约定**，同时约束两个仓库的 `scripts/*.mjs`（不含 `_` 前缀共享层 `_lib/`）：

1. **统一文件头 5 字段**：所有用户态 `.mjs` 顶部 JSDoc 必含 ① 文件名+描述 ② 设计意图（推荐）③ 依赖声明 ④ 用法 ⑤ 退出码。
2. **检查类脚本 `--json` 硬规则**：`check-*` / `*-check` / `review` / `doctor` / `link-checker` / `type-consistency` / `event-audit` / `binding-check` 必须支持 `--json` 或默认 JSON 输出，供 CI / 子代理稳定消费。
3. **共享能力内聚 `_lib/`**：`walk` / `rg` / `ROOT` / `frontmatter` 解析一律 `import` 自 `scripts/_lib/`，禁止内联样板。
4. **规范自执行**：将 `check-script-hygiene.mjs` 作为**字节一致**的同款文件落两端，扩展为**四口径**（退出码失效 / 共享层内联 / `--json` 契约 / 文件头 5 字段），使规范可机检、可卡点（`--strict` 有 WARN → 退出码 1）。
5. **双 README 同款节**：两端 `scripts/README.md` 各嵌「脚本文件头规范（统一约定）」节，内容一致、各自维护，互不漂移。

## 3. 规范正文（权威源）

每个 `scripts/*.mjs`（不含 `_` 前缀共享层 `_lib/`）必须在文件顶部保留 JSDoc 头，且至少包含以下字段：

1. **文件名 + 一句话描述**：`* <name>.mjs — <功能描述>。`
2. **设计意图**（推荐）：1–2 句说明为什么存在 / 适用场景。
3. **依赖声明**：`零依赖（node:fs / node:path / node:url）` 或列出外部依赖。
4. **用法**：`用法：` 块，含默认行为 + `--json`（如适用）示例，命令统一 `node scripts/<name>.mjs ...`。
5. **退出码**：`退出码：发现 ERROR → 1；否则 0（WARN/INFO 不阻断）。`

**硬规则**：

- 检查类脚本（`check-*` / `*-check` / `review` / `doctor` / `link-checker` / `type-consistency` / `event-audit` / `binding-check`）必须支持 `--json` 或默认输出 JSON，供 CI / 子代理稳定消费。
- 共享能力（`walk` / `rg` / `ROOT` / `frontmatter` 解析）一律 `import` 自 `scripts/_lib/`，**禁止内联样板**。
- 公共函数需写 `/** */` 简述；纯内部小工具可不写。

**推荐文件头模板**：

```js
#!/usr/bin/env node
/**
 * <name>.mjs — <一句话功能描述>。
 *
 * <1–2 句设计意图 / 适用场景>。
 *
 * 依赖：零依赖（node:fs / node:path / node:url）   // 或：依赖 xxx
 *
 * 用法：
 *   node scripts/<name>.mjs                 # <默认行为>
 *   node scripts/<name>.mjs --json          # JSON 输出（CI/子代理消费）
 *
 * 退出码：发现 ERROR → 1；否则 0（WARN/INFO 不阻断）。
 */
```

## 4. 风险与对策

| 级别 | 风险 | 对策 |
|------|------|------|
| 🟡 | 两仓库后续仍可能漂移（无强制同步机制） | `check-script-hygiene.mjs` 同款字节落两端；任一仓库改约定须同步另一端 README 同款节 |
| 🟡 | 9 个「大差」同名文件（行数差 >30）可能同名异实 | 见 §5 实施步骤 Phase 2；先裁决统一/保留再动，禁盲目合并 |
| 🟢 | 检查器自身头部不合格（狗粮自洽） | 检查器自身头部已补齐 `依赖`/`设计意图`，复跑零 WARN |
| 🟢 | 规范与既有脚本风格冲突 | 以「机检通过」为准；文本用法块保留各脚本既有命令形态 |

## 5. 实施步骤

**Phase 1 — 规范基线 + 自执行（✅ 已完成）**

1. 两端 `scripts/README.md` 各嵌「脚本文件头规范（统一约定）」同款节。
2. 代表脚本范例整改（每端 2 个）：`comment-checker.mjs`、`diagnose.mjs`（A）；`comment-checker.mjs`、`adr-check.mjs`（B）。
3. `check-script-hygiene.mjs` 字节一致落两端，扩展为四口径。
4. **A-收尾 9 处修复**：B 端 `gen-knowledge-index.mjs`/`gen-routes.mjs` 退出码恒 0 bug（`main()` → `process.exit(main())`）；A 端 7 个检查脚本补 `--json`（`check-adr-status` / `check-adr-technical-debt` / `check-boolean-naming` / `check-diff-coverage` / `check-env-parity` / `check-schema-groups` / `i18n-check`）。

**Phase 2 — 全量整改（⏳ 待批准）**

1. 9 个「大差」同名文件裁决（统一 / 保留 / 单向回灌）。
2. 两端剩余脚本文件头 5 字段补齐（A 42/43、B 41/42 缺字段）。
3. 共享层内联样板抽离（A 5 处、B 13 处 `walk`/`rg`/`ROOT`/`frontmatter` 内联）。

**验证（Phase 1 实测）**：

- 两端 `node scripts/check-script-hygiene.mjs --json`：`--json` 契约 = 0、`退出码失效` = 0（A 105→98、B 120→118 WARN）。
- 9 处修复逐文件 `node --check` 语法通过；`--json` 实跑均吐合法 JSON（`i18n-check` 末段纯 JSON + 正确退码）。
- 附带暴露：B 端 `gen-routes.mjs` 修复后正确报 `routes.md` 滞后（exit=1），此前被 bug 掩盖为 0。

**同步**：本 ADR 为跨仓库硬约束；联邦仓库（MikuMikuAR）为权威源，ysm-model-manager `scripts/README.md` 文本引用。索引由 `npm run gen:docsindex` 重算。
