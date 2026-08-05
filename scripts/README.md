# scripts —— 开发实用工具

> 本目录包含 MikuMikuAR 项目的开发辅助脚本，涵盖文档维护、代码检查、构建发布等场景。
> 新人建议从 `check-doc-drift.mjs` 和 `new-adr.mjs` 入手。

## 脚本文件头规范（统一约定）

> 本仓库与 ysm-model-manager 共用同一套 `.mjs` 文档约定，确保跨项目可迁移、可机读。
> 规范由 `scripts/check-script-hygiene.mjs` 校验；决策基线见 [ADR-241](../adr/adr-241-mjs-script-doc-convention.md)；本仓库当前状态见本节省末注记。

每个 `scripts/*.mjs`（不含 `_` 前缀共享层 `_lib/`）必须在文件顶部保留 JSDoc 头，且至少包含以下字段：

1. **文件名 + 一句话描述**：`* <name>.mjs — <功能描述>。`
2. **设计意图**（推荐）：1–2 句说明为什么存在 / 适用场景。
3. **依赖声明**：`零依赖（node:fs / node:path / node:url）` 或列出外部依赖。
4. **用法**：`用法：` 块，含默认行为 + `--json`（如适用）示例，命令统一 `node scripts/<name>.mjs ...`。
5. **退出码**：`退出码：发现 ERROR → 1；否则 0（WARN/INFO 不阻断）。`

硬规则：
- 检查类脚本（`check-*` / `*-check` / `review` / `doctor` / `link-checker` / `type-consistency` / `event-audit` / `binding-check`）必须支持 `--json` 或默认输出 JSON，供 CI / 子代理稳定消费。
- 共享能力（`walk` / `rg` / `ROOT` / `frontmatter` 解析）一律 `import` 自 `scripts/_lib/`，**禁止内联通用样板**；领域专用的文件收集器（带扩展名过滤 / 跳过集合 / 回调，如 `gen-icon-bundle` 的图标 walker）属合法内联，不计入违规。
- 公共函数需写 `/** */` 简述；纯内部小工具可不写。

范例见 `comment-checker.mjs`、`diagnose.mjs`（已按本规范整改）。

> 执行状态：本仓库已落地 `check-script-hygiene.mjs`（与 ysm-model-manager 同款，四口径：退出码失效 / 共享层内联 / `--json` 契约 / 文件头 5 字段）；运行 `node scripts/check-script-hygiene.mjs [--json|--strict]` 即可机检本规范。

## 快速索引

| 脚本 | 用途 | 新人友好 |
|------|------|---------|
| `check-doc-drift.mjs` | 文档漂移检查（ADR/知识卡/架构树） | ✅ |
| `new-adr.mjs` | 生成新 ADR 文件模板 | ✅ |
| `new-knowledge-card.mjs` | 生成知识卡模板 | ✅ |
| `fix-adr-format.mjs` | 批量修复 ADR 首部格式 | 🟡 |
| `gen-status-index.mjs` | 从 ADR 自动生成状态索引表 | 🟡 |
| `i18n-check.mjs` | i18n 语言包键值奇偶校验 | 🛠 |
| `goerr-lint.mjs` | Go 错误信封静态检查 | 🛠 |
| `gen-icon-bundle.mjs` | 图标 Bundle 生成 | 🛠 |
| `verify-sab.js` | SharedArrayBuffer 可用性验证 | 🛠 |

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

### `new-adr.mjs` — 新建 ADR 模板

自动获取下一个编号，生成标准格式模板；创建后自动同步 `docs/status.md` 的 ADR 索引（仅重写标记区，无需手动 `npm run gen:status`）。

```bash
node scripts/new-adr.mjs "标题" ["副标题"] ["状态"]
# 示例:
node scripts/new-adr.mjs "灯光系统统一" "Phase 2 增强" "进行中"
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
