# scripts —— 开发实用工具

> 本目录包含 MikuMikuAR 项目的开发辅助脚本，涵盖文档维护、代码检查、构建发布等场景。
> 新人建议从 `check-doc-drift.mjs` 和 `new-adr.mjs` 入手。

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

自动获取下一个编号，生成标准格式模板。

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

版本化钩子位于 `.githooks/pre-push`，推送前秒级跑 `check:status` + `check:funcmap`，把文档漂移拦在本地而非 CI。
选用 **pre-push 而非 pre-commit**：commit 是本地高频操作，拦 commit 有中断心流、丢失进行中改动的风险；push 是对外发布的边界，在此把关既不打扰本地迭代，又能确保推上去的内容文档同步。

```bash
# 一次性启用（每个 clone 都需执行）
git config core.hooksPath .githooks
```

钩子失败时按提示运行 `npm run gen:status` / `npm run gen:funcmap` 并 `git add` 生成文件即可；紧急放行用 `git push --no-verify`（不推荐）。

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
