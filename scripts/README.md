# scripts —— 开发实用工具

> 本目录包含 MikuMikuAR 项目的开发辅助脚本，涵盖文档维护、代码检查、构建发布等场景。
> 新人建议从 `check-doc-drift.mjs` 和 `new-adr.mjs` 入手。

## 脚本文件头规范（统一约定）

> 本仓库与 ysm-model-manager 共用同一套 `.mjs` 文档约定，确保跨项目可迁移、可机读。
> 规范由 `scripts/check-script-hygiene.mjs` 校验；决策基线见 [ADR-241](../docs/adr/adr-241-mjs-script-doc-convention.md)；本仓库当前状态见本节省末注记。

每个 `scripts/*.mjs`（不含 `_` 前缀共享层 `_lib/`）必须在文件顶部保留 JSDoc 头，且至少包含以下字段：

1. **文件名 + 一句话描述**：`* <name>.mjs — <功能描述>。`
2. **设计意图**（推荐）：1–2 句说明为什么存在 / 适用场景。
3. **依赖声明**：`零依赖（node:fs / node:path / node:url）` 或列出外部依赖。
4. **用法**：`用法：` 块，含默认行为 + `--json`（如适用）示例，命令统一 `node scripts/<name>.mjs ...`。
5. **退出码**：`退出码：发现 ERROR → 1；否则 0（WARN/INFO 不阻断）。`

硬规则：
- 检查类脚本（`check-*` / `*-check` / `review` / `doctor` / `link-checker` / `type-consistency` / `event-audit` / `binding-check`）必须支持 `--json` 或默认输出 JSON，供 CI / 子代理稳定消费。
- **CLI 健壮性契约（2026-08-06 全面铺开）**：全部脚本必须响应 `--help`/`-h`（退 0 打印用法，绝不执行主流程）；未知 `--flag` 一律报错退 1（绝不静默落入位置参数位 / 被吞为值参数）。实现：`_lib/parse-args.mjs` 内置 `help` / `unknown` 字段 + 各脚本统一守卫；手写解析的脚本（new-adr / fix-* / codemod / check-diff-coverage）各自实现同契约。
- 共享能力（`walk` / `rg` / `ROOT` / `frontmatter` 解析）一律 `import` 自 `scripts/_lib/`，**禁止内联通用样板**；领域专用的文件收集器（带扩展名过滤 / 跳过集合 / 回调，如 `gen-icon-bundle` 的图标 walker）属合法内联，不计入违规。
- 公共函数需写 `/** */` 简述；纯内部小工具可不写。

范例见 `comment-checker.mjs`、`diagnose.mjs`（已按本规范整改）。

> 执行状态：本仓库已落地 `check-script-hygiene.mjs`（与 ysm-model-manager 同款，四口径：退出码失效 / 共享层内联 / `--json` 契约 / 文件头 5 字段）；运行 `node scripts/check-script-hygiene.mjs [--json|--strict]` 即可机检本规范。
>
> ✅ 2026-08-06 收口：文件头首行格式已加严并批量修复 26 个脚本（hygiene 0 警告）；`--help`/未知 flag 契约已覆盖全部 40+ 脚本。

## 快速索引（全量分类）

### 文档维护（gen / fix / new）

| 脚本 | 用途 |
|------|------|
| `new-adr.mjs` | 新 ADR 脚手架（占号→模板→取代标注→索引对账，见下方专节） |
| `new-knowledge-card.mjs` | 生成知识卡模板（frontmatter + 章节骨架） |
| `gen-status-index.mjs` | 从 ADR 首部生成 `docs/status.md` 状态索引 |
| `gen-docs-index.mjs` | 生成文档站分区枢纽索引（adr/buglog/knowledge/novel 等） |
| `gen-funcmap.mjs` | 生成函数大全 `docs/function-map.md`（符号带文件:行号） |
| `gen-novel-index.mjs` | 生成小说章节索引 `docs/novel/index.md` |
| `gen-menu-map.mjs` | 生成菜单地图 `docs/knowledge/menu-map.md` |
| `gen-knowledge-graph.mjs` | 生成知识卡关联图 `docs/knowledge/graph.md` |
| `gen-knowledge-h1.mjs` | 知识卡 H1 标题同步 |
| `gen-knowledge-symbols.mjs` | 知识卡 `symbols:` 字段同步（源码导出符号） |
| `gen-knowledge-adr.mjs` | 知识卡 `adr:` 关联同步 |
| `gen-knowledge-tests.mjs` | 知识卡 `tests:` 字段同步 |
| `gen-tier.mjs` | 知识卡 tier 分层标注（ADR-218 P3） |
| `gen-routes.mjs` | 知识卡检索路由 `docs/knowledge/routes.md` |
| `gen-ui-entry.mjs` | 知识卡 UI 入口同步 |
| `gen-adr-supersede.mjs` | 取代关系审计（五层证据，登记/漏标/废弃/可疑/弱宣称） |
| `gen-dep-graph.mjs` | 模块依赖图生成 |
| `gen-guide-gap.mjs` | 用户指南缺口分析 |
| `fix-adr-format.mjs` | 批量修复 ADR 首部格式（冒号/前缀对齐解析契约） |
| `fix-adr-dates.mjs` | 为缺日期行的 ADR 补 `> **日期**: yyyy-mm-dd` |

### 检查（check / lint / doctor）

| 脚本 | 用途 |
|------|------|
| `check-doc-drift.mjs` | 文档漂移检查（ADR/知识卡/架构树，CI 卡点） |
| `check-adr-health.mjs` | ADR 健康综合检查（状态/债务/格式/关联/连续性） |
| `check-adr-status.mjs` | ADR 状态检查（精简版） |
| `check-adr-technical-debt.mjs` | ADR 技术债务检查（精简版） |
| `check-boolean-naming.mjs` | env-state-schema boolean 字段命名规范 |
| `check-circular.mjs` | 前端循环依赖检查 |
| `check-consumers.mjs` | 符号消费者查询（重构前影响面分析） |
| `check-deadcode-baseline.mjs` | knip/jscpd 死代码与重复代码基线治理 |
| `check-diff-coverage.mjs` | P8-A diff-coverage 门禁 |
| `check-env-parity.mjs` | EnvState 字段 parity（TS schema ↔ Go bindings） |
| `check-layering.mjs` | 前端分层依赖方向守护（ADR-242） |
| `check-schema-groups.mjs` | env-state-schema group 完整性 |
| `check-script-hygiene.mjs` | scripts/ 工具脚本卫生检查（四口径） |
| `comment-checker.mjs` | 注释质量检查（AI 废话/空 JSDoc/TODO 无编号/调试残留） |
| `goerr-lint.mjs` | Go 错误处理 lint（ADR-117 信封规范） |
| `i18n-check.mjs` | i18n 五语言包 key parity/占位符/漏译/清单漂移 |
| `link-checker.mjs` | Markdown 链接检查（内部链接目标存在性） |
| `diagnose.mjs` | 全量项目诊断编排（多检查聚合） |

### 构建 / 发布

| 脚本 | 用途 |
|------|------|
| `build-windows.ps1` / `build-darwin.sh` / `build-linux.sh` | 桌面三平台构建 |
| `build-android.ps1` / `build-android-so.ps1` | Android 构建（含 native .so） |
| `build-ios.sh` | iOS 构建 |
| `release.ps1` | Wails 发布（含 release-notes-gen 联动） |
| `setup-github-secrets.ps1` | GitHub Actions secrets 配置 |
| `verify-sab.js` | SharedArrayBuffer 可用性验证 |

### 重构 / 工具

| 脚本 | 用途 |
|------|------|
| `codemod.mjs` | AST 感知批量重构（rename/move/add-param，ts-morph） |
| `generate-locale-json.mjs` | i18n 语言包 .ts → JSON（esbuild） |
| `release-notes-gen.mjs` | 收集 git 数据供子智能体写发版说明 |
| `doc-check-next-steps.mjs` | 文档检查后续步骤建议 |
| `poc-mmd-bone-attachment.mjs` | POC：babylon-mmd mesh.attachToBone 验证 |
| `gen-textures.py` / `gen-textures-stdlib.py` / `gen_appicon.py` / `_pmxtex.py` / `_zipcmp.py` / `_probe_tier.mjs` | 纹理/图标生成与内部探测工具 |

---

## 文档维护

### `check-doc-drift.mjs` — 文档漂移检查

守护 ADR、知识卡、架构树三者的一致性。**CI 卡点，提交前建议跑一遍。**

```bash
node scripts/check-doc-drift.mjs
# 或 JSON 输出（供 CI 解析）
node scripts/check-doc-drift.mjs --json
```

检查项：
- **ERROR** 架构目录树引用完整性 —— 架构树声明的文件在磁盘不存在
- **ERROR** status.md 是否涵盖最新 ADR
- **ERROR** status.md 的 ADR 生成区是否与 ADR 源文件一致
- **ERROR** 知识卡 `source_files` 完整性 —— 卡片声称的源码路径不存在
- **INFO** 符号 0% 未文档化模块 —— 源码导出符号未出现在架构/函数文档中

### `gen-status-index.mjs` — 状态索引自动生成

扫描 `docs/adr/adr-*.md` 首部，提取编号/标题/状态/日期，替换 `docs/status.md` 中标记区域。

```bash
node scripts/gen-status-index.mjs
# 只检查 status.md 是否由 ADR 源同步生成
node scripts/gen-status-index.mjs --check
```

**前置条件：** `docs/status.md` 包含 `<!-- GEN:ADR_INDEX start -->` 和 `<!-- GEN:ADR_INDEX end -->` 标记。
生成区禁止手工修改；状态必须先写入 `docs/adr/adr-*.md` 首部，再运行脚本同步。

### `fix-adr-format.mjs` — ADR 格式批量修复

修复 ADR 文件首部格式偏差，对齐 `gen-status-index.mjs` 的解析契约。

```bash
# 修复全部
node scripts/fix-adr-format.mjs

# 修复指定文件（支持 glob）
node scripts/fix-adr-format.mjs adr-131-*
```

修复的偏差：
- 标题中文冒号 → ASCII 冒号（`# ADR-NNN：标题` → `# ADR-NNN: 标题`）
- 标题缺冒号/用破折号 → 补冒号（`# ADR-131 标题` → `# ADR-131: 标题`）
- 状态/日期行缺 `> ` 前缀或中文冒号

### `new-adr.mjs` — 新建 ADR 脚手架

双源取号（本地 + origin/main 最大号 +1）、wx 原子占位防并发、自动同步 `docs/status.md`；创建后自动跑 `gen-adr-supersede` 取代关系审计。**禁止手写编号。**

```bash
node scripts/new-adr.mjs "标题" ["副标题"] ["状态"]
# 显式文件名 slug（默认从标题自动提取，支持中文）
node scripts/new-adr.mjs "标题" --slug kebab-name
# 预填「相关文档」段
node scripts/new-adr.mjs "标题" --related "ADR-113 / scene/env-water.ts"
# 自动在被取代方状态行标注「被 [ADR-NNN] 取代」（幂等，多目标逗号分隔）
node scripts/new-adr.mjs "标题" --supersedes ADR-012,ADR-019
# 只算号不写文件（并行任务先确认最新编号）
node scripts/new-adr.mjs "标题" --dry-run
# 占号模式（状态=规划，立空壳待并行 AI 补正文）
node scripts/new-adr.mjs --reserve "标题"
# 用法帮助（退 0 不占号）
node scripts/new-adr.mjs --help
```

示例：
```bash
node scripts/new-adr.mjs "灯光系统统一" "Phase 2 增强" "进行中" --supersedes ADR-074
```

### `new-knowledge-card.mjs` — 新建知识卡模板

按 `docs/knowledge/README.md` 规范生成 frontmatter + 章节骨架。

```bash
node scripts/new-knowledge-card.mjs <kind> <name> <category> <source_file> [adr]
# 示例:
node scripts/new-knowledge-card.mjs lighting_foo "灯光系统 Foo" rendering \
  frontend/src/scene/render/lighting-foo.ts ADR-174
```

参数校验：
- `kind` 必须为 `snake_case`
- `category` 必须是 `rendering|env|motion|ui|core|backend`
- `source_file` 会在磁盘上检查存在性

---

## 代码质量

### `i18n-check.mjs` — i18n 键值校验

检查五语言包（zh-CN/zh-TW/en/ja/ko）的键值一致性，防止新增 key 漏翻译。

```bash
node scripts/i18n-check.mjs
```

### `goerr-lint.mjs` — Go 错误格式检查

ADR-117 静态检查：Go 端 `i18nerr.New()` 调用是否遵循信封规范。

```bash
node scripts/goerr-lint.mjs
```

---

## 构建与发布

### `gen-icon-bundle.mjs` — 图标 Bundle 生成

从 lucide 图标源生成前端可用的图标 Bundle。

```bash
node scripts/gen-icon-bundle.mjs
```

### 平台构建脚本

| 平台 | 脚本 |
|------|------|
| Windows | `build-windows.ps1` |
| macOS | `build-darwin.sh` |
| Linux | `build-linux.sh` |
| Android | `build-android.ps1` + `build-android-so.ps1` |
| iOS | `build-ios.sh` |
| Wails 专用 | `scripts/wails/build.ps1` / `release.ps1` |

---

## pre-push 钩子（推送前校验）

版本化钩子位于 `.githooks/pre-push`，推送前秒级跑 `check:status` + `check:funcmap` + `check:docs`（架构树/知识卡 source_files/ADR 索引三向漂移），把文档漂移拦在本地而非 CI。
选用 **pre-push 而非 pre-commit**：commit 是本地高频操作，拦 commit 有中断心流、丢失进行中改动的风险；push 是对外发布的边界，在此把关既不打扰本地迭代，又能确保推上去的内容文档同步。

```bash
# 一次性启用（每个 clone 都需执行）
git config core.hooksPath .githooks
```

钩子失败时按提示运行 `npm run gen:status` / `npm run gen:funcmap` / `npm run check:docs` 并 `git add` 生成文件即可；紧急放行用 `git push --no-verify`（不推荐）。

### `codemod.mjs` — AST 感知的批量重构

基于 ts-morph（TypeScript 编译器 API 封装）进行代码批量改写，精确到 AST 节点级别，**不会误伤字符串/注释里同名符号**。

```bash
# 重命名导出函数（自动更新所有引用）
node scripts/codemod.mjs rename-function oldFoo newFoo

# 将函数移到另一个文件
node scripts/codemod.mjs move-function parseName src/core/utils.ts

# 给函数加参数（无默认值时自动补 undefined）
node scripts/codemod.mjs add-param buildTree 'opts: Options' '{}'

# 显示帮助
node scripts/codemod.mjs help
```

> 改完后必须跑 `npm run check && npm run test` 验证。对结果有疑虑用 `git diff` 逐块审查。

---

## 代码修改规范（AI 与人类通用）

| 场景 | 正确工具 | 错误做法 |
|------|---------|---------|
| 改函数签名/重命名 | `codemod.mjs`（AST） | Python re.sub / sed |
| 跨文件改引用 | `codemod.mjs rename-function` | 全局字符串替换 |
| 一段逻辑移出去 | `codemod.mjs move-function` | 手动 copy-paste |
| 批量加参数 | `codemod.mjs add-param` | 手动逐个改 |
| 简单行内替换 | `SearchReplace` 工具 | Python 脚本 |
| 统计/分析代码 | ✅ Python grep 增强版 | — |

**永远不要在 Python 脚本中做 `file.write(re.sub(...))` 改写代码**。AST 工具或 SearchReplace 在 diff 审查下更安全。

## 新人上手建议

```bash
# 1. 先跑文档漂移检查，了解项目文档体系
node scripts/check-doc-drift.mjs

# 2. 生成状态索引，看全部 ADR 一览
node scripts/gen-status-index.mjs

# 3. 想写新决策？用模板
node scripts/new-adr.mjs "我的决策"

# 4. 想写知识卡？用模板
node scripts/new-knowledge-card.mjs my_kind "我的模块" core frontend/src/core/my-module.ts
```
