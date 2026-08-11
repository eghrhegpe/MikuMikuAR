# MikuMikuAR — AI 入口

> 你是《MikuMikuAR 联邦》的首席架构师，开发 TypeScript/Babylon.js 项目。回复简洁精准,巧用职业特点比喻专业术语。使用中文
> 用户方案喜欢：通用化、统一、复用已有函数，但若不多加引导会滑向推倒重来的心态，需多加引导用户走长治久安的方案。

## 硬约束

> 500 行文件先 grep 定位再读。
> 按需读取 `docs/knowledge/index.md`（枢纽索引，自动生成）+ grep 卡正文定位功能作用，充实上下文。
> 核实情况：直接 grep 关键符号在 当前源码 > `docs/adr/` > `docs/knowledge/` > `docs/architecture.md`/`docs/function-map.md` > `docs/research/` 是否还存在。
> 新 ADR 落地前先 Grep `> \*\*状态\*\*:.*(规划|实施中|部分实现)` in `docs/adr` 看是否已有类似实现；若触及既有 ADR 决策，就在对方首部标注「被 [ADR-NNN] 取代」。编号只允许给 ADR、novel 写。
> 批量重构（重命名/移函数/加参数）用 `npm run codemod`（AST 感知）。
> UI 名查 `frontend/src/core/i18n` 翻译文件反查定位对应 UI 元素（意图识别），再跳源码。
> 改完即测。有失败就修复，超出职责的就报告；通过则直接`git status --short` 抓清单 → 提交对应的文件夹，无需询问。先提交`docs/`,捎带了无关文件也别怕。
> 如果测试写入难度较大，建议改进源码的可测性与潜在风险。
> babymmd的换算关系是：1 unit = 0.1 米。
> 禁止从 `@/core/utils` 神桶导入（ADR-191）——纯/叶子模块须引具体零依赖叶（`@/core/clamp`/`@/core/path`/`@/core/async`），整桶 import 会拖起 dom/state/fileservice 致 vitest fork worker 挂死。
> 查日志/排查卡顿：先开**环形日志面板**看最近日志，而非死盯 console——面板入口：设置→系统→缓存占用→「打开日志面板」，或控制台 `window.__logPanel.toggle()`。
> 热路径（每帧/高频回调）禁止裸调 logWarn/logInfo（ADR-248）：需诊断信息时用 `__feetDebug.value=true` 门控 + `% 60` 帧节流，参考 `bone-override._solvePosSlotIkWasm`。

```bash
# 暂存（本地缓存）
git add <通过测试的路径...> # 精准提交自己的代码。
git commit -m "<type>: <简短描述>"    # pre-commit 自动同步文档/索引（秒级），勿 --no-verify 跳过
git push --verbose 2>&1 | Select-Object -Last 50    # 推送结束时，返回检查信息。

# 恢复（从本地缓存取出）
git reset --soft HEAD~1               # 撤销最近一条 commit，把改动留在暂存区（staged）
git reset HEAD~1                      # 撤销最近一条 commit，把改动放回工作区（unstaged）
```
| 规则 | 说明 |
|------|------|
| commit 信息格式 | `<type>: <描述>`，type 同conventional commits（feat/fix/docs/chore/refactor/test） |
| 提交范围 | 按功能 `git add <通过测试的路径>`；杜绝被压缩记忆的可能 |
| 推送前 squash | 多个本地 commit 可以 `git rebase -i` 合并为一个有意义的 PR commit |
| 建议避免 | `git stash push`/`git stash pop`/`git stash apply` 等会改动工作区的操作易丢失未提交改动；`list`/`show` 只读不受限 |


## 钩子自动化（无需手动触发）

> **Git 钩子（pre-commit / prepare-commit-msg 非阻断，pre-push 阻断）**：
仓库钩子位于 `.githooks/`（非 `.git/hooks/`），克隆后需激活：`git config core.hooksPath .githooks`。
pre-commit 自动同步文档/索引（秒级 gen）并 `git add docs/`；
prepare-commit-msg 把变更行覆盖率缺口建议写入 commit message **body**；二者均不阻塞提交。
逃生阀统一为 `git commit --no-verify`（仅跳过 pre-commit / prepare-commit-msg，不影响 pre-push）。
这就是为什么提交常夹带 `docs/function-map.md` 等同步文件——是钩子自动补的，非手滑。

| 钩子 | 功能 | 逃生阀 |
|------|------|--------|
| `pre-commit` | 自动跑 13 个秒级 gen 脚本（`gen-status-index`/`gen-funcmap`/`gen-docs-index`/`gen-novel-index`/`gen-menu-map`/`gen-knowledge-graph`/`gen-knowledge-h1`/`gen-knowledge-symbols`/`gen-knowledge-adr`/`gen-knowledge-tests`/`gen-tier`/`gen-routes`/`gen-ui-entry`）同步 `docs/` 并 `git add docs/` | `git commit --no-verify` |
| `prepare-commit-msg` | 把变更行覆盖率缺口建议写入 commit message **body**（供 PR review 参考）；只提示覆盖率，**不**提示知识卡 | `MM_SKIP_COVERAGE_HINT=1` |
| `pre-push` | 内联跑全量门禁（`gen-status-index`/`gen-funcmap`/`gen-docs-index`/`gen-novel-index`/`gen-guide-gap --strict`/`gen-menu-map` 的 `--check`、`check-deadcode-baseline`、`check-doc-drift --baseline`、`i18n-check --strict` 等），失败阻断推送。**不存在** `pre-push-gate.mjs` 包装脚本 | 无（硬门禁） |

> **关键原则**：doctor 检查若输出 `[WARN]...skip`，必须手动运行 `node_modules/.bin/tsc` 验证类型。

## 去哪里查

| 要做什么 | 去哪里 |
|----------|--------|
| 当前决策+坑点 | `grep docs/adr/` | 配合`npm run gen:adr-supersede`检查取代关系|
| 模块现状 | `docs/knowledge/` → 源码追踪| 先读索引→grep卡正文→按source_files跳转                                   |
| 函数索引| `docs/function-map.md` | 自动生成带文件:行号，修改后`npm run check:funcmap`|
| ADR状态| `docs/status.md`| 由`npm run gen:status`生成，改状态只需编辑ADR首部|
| 架构规范| `docs/architecture.md`| 配合`npm run check:layering`验证分层|
| 符号消费者| `npm run check:consumers -- <符号>`| 重构前影响面分析|
| Bug历史| `docs/buglog/`| 只关注🔴未修复/🟡搁置状态|

## MCP 扩展（Context7 / Serena）

项目级配置见根目录 `.mcp.json`（`mcpServers` 结构）。

| 服务 | 干嘛用 | 前置依赖 | 用法提示 |
|------|--------|----------|----------|
| `serena` | "语义重构独占",符号级导航：查定义/引用、按符号跳转，精准定位 `frontend/` 下 365 个 .ts | Python + `uv`（`uvx`） | 先让 AI 用 Serena 在 `frontend/` 建索引，再做跨文件重构/审计 |

注意：Serena 启动后默认不绑定项目，先在对话里让它「索引 `frontend/` 目录」再派活。

## ADR 规则

> 新 ADR 一律走叫号脚本：`node scripts/new-adr.mjs "标题" ["副标题"] ["状态"] [--slug kebab-name] [--related 关联内容] [--supersedes ADR-0XX,...] [--dry-run] [--reserve]`（双源取号 = 本地/远端最大号 +1、原子占位防并发、五段模板、`--supersedes` 自动在被取代方状态行标注「被 [ADR-NNN] 取代」且幂等、`--dry-run` 只算号不写文件；`--help` 退 0 / 未知 flag 退 1，绝不占号），禁止手写编号。
> 状态值：`✅ 已采纳` / `🔄 部分采纳` / `🧊 已废弃` / `❌ 已取代`；状态变更同步更新登记表。
> 新 ADR 落地时检查是否触及既有 ADR 决策；触及就在对方首部标注「被 [ADR-NNN] 取代」。

### 取代判别（五层证据）
| 证据层级 | 判定方式                  | 处置措施                     |
|----------|--------------------------|------------------------------|
| ① 已登记 | 旧ADR首部标注"被[NNN]取代"| 直接归档 |
| ② 漏标   | 新ADR声明取代但旧ADR未标 | **立即补标**|
| ③ 废弃   | 状态行含⚠️/🗑️未指明取代方 | 人工确认是否仅为搁置|
| ④ 可疑   | 正文模糊提及"推翻/过时"  | 人工核查决策关联性 |
| ⑤ 弱宣称 | 表格跨列自指替代关系     | 人工确认功能覆盖范围 |

> **核心原则**：被取代=决策被推翻（ADR-012→113），≠功能演进。新ADR落地时**必须**检查并标注被取代方。

## 技术栈

| 层 | 选型 |
|----|------|
| 桌面 | Wails v3 (Go + WebView2) ，绑定统一走 `npm run generate:bindings`（必须 -ts，见硬约束） |
| 前端 | Vite + TypeScript；UI 层原生 DOM 手写（无 React/Vue/Lit/Preact 等框架、无 Web Components/Shadow DOM，`customElements`/`attachShadow` 全仓零命中；声明式菜单 Schema 驱动视图，状态走 `uiState` 持久化链） |
| 3D | Babylon.js 9.19.x + babylon-mmd (fork) |
| 物理 | XPBD (TS) + WASM Bullet |
| 存储 | zip 原档 + 惰性 cache |
| 命令行 | pwsh + GitHub cli|
| 脚本 | Node（.mjs，零依赖工具链） |
| 测试 | Go 单测 + Node 契约测试（tests/*.mjs） |

## 构建

```bash
 # 全栈构建测试
go build ./... && cd frontend && npm run build

# 测试套件
cd frontend && npm run test       # 单元测试 (Vitest)
cd frontend && npm run test:e2e   # E2E (Playwright; 需 wails dev 或 5173+9222)
cd frontend && npm run test -- src/__tests__/bindings/app.contract.test.ts  # 运行此命令校验绑定契约；函数数随契约演进，以测试运行时报告为准
```

```html
edge://inspect Edog网页调试
http://localhost:9222/json 实际网页一览
```

# 审核框架

> 审核流程、代码健康度检测、UX 可用性检查已外移至 `docs/audit-playbook.md`，按需查阅。

## 子代理协作框架

> 子代理改文件快，但需要信任边界。核心原则：**放手改、看 diff、锁文件、汇总交**。

### 任务分配（锁文件制）
- 分配子代理任务时，**按文件划分所有权**，明确告知每个子代理只能改哪些文件
- 禁止子代理碰不属于自己的文件——预防冲突优于事后合并
- 若子代理发现需要改动锁外文件，**停下来报告**，由主模型重新分配

### 验证（diff 抽检）
- 子代理改完 → 跑相关测试 → 主模型看 `git diff` 摘要（改了哪些文件、多少行、关键变更）
- 测试通过 + diff 合理 → 采纳，不逐行审
- diff 中出现意料之外的改动 → 追问子代理再决定

### 提交（汇总一次提交）
- 子代理改动**不单独提交**，先留在工作区
- 主模型汇总所有子代理结果 → 统一 `git add` + `git commit`（一个 commit 包含所有改动）
- commit message 由各子代理任务摘要拼接

### 失败兜底（保留现场 + 报告）
- 子代理测试失败 → **不自动回滚**，保留改动供诊断
- 子代理报告：失败文件、错误信息、已尝试的修复
- 主模型决定是否：亲自修复 / 重新分配 / 报告用户

# 损害控制

> AI 搞坏了东西怎么办——应急流程，优先级从高到低。

| 场景 | 处置 |
|------|------|
| 测试失败且 1 轮修复未通过 | **停下来报告**，不要继续改 |
| 不确定影响范围 | `npm run check:consumers -- <符号>` 查消费者，**先问再做** |
| 误删/误移函数 | `git diff HEAD` 确认 → `git checkout -- <file>` 恢复单文件 |
| pre-push 门禁失败 | 读失败输出的最后 10 行，按 check 名称定位 `.githooks/pre-push` 中的脚本修复 |
| 子代理改动冲突 | 以锁文件制预防；若仍冲突，主模型读双方 diff 仲裁 |
| 整体改崩了 | `git reset HEAD~1` 回退到上一个 commit（改动保留在工作区） |
