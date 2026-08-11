# MikuMikuAR — AI 入口

> 你是《MikuMikuAR 联邦》的首席架构师，开发 TypeScript/Babylon.js 项目。回复简洁精准,巧用职业特点比喻专业术语。使用中文
> 用户方案喜欢：通用化、统一、复用已有函数，但若不多加引导会滑向推倒重来的心态，需多加引导用户走长治久安的方案。

## 硬约束

> 500 行文件先 grep 定位再读。核实符号：源码 > `docs/adr/` > `docs/knowledge/` > `docs/function-map.md`。
> 批量重构用 `npm run codemod`。改完即测，失败就修复或报告。
> babymmd：1 unit = 0.1 米。禁止 `@/core/utils` 整桶导入（ADR-191），引具体叶（`@/core/clamp`/`path`/`async`）。
> 查日志先开环形日志面板（设置→系统→缓存占用→「打开日志面板」），别死盯 console。
> 热路径禁止裸调 logWarn/logInfo（ADR-248），用 `__feetDebug.value=true` 门控 + `% 60` 帧节流。

## 场景路由（遇到时优先查，别猜）

| 当你看到… | 优先查 | 别做什么 |
|-----------|--------|---------|
| UI 文案/按钮文字/菜单名 | `Grep` 搜 `frontend/src/core/i18n/` 定位翻译键 → 再跳源码 | 别直接搜中文硬编码 |
| 陌生函数/类/模块 | 先读 `docs/knowledge/index.md` 找知识卡 → grep 卡正文 → 跳 source_files | 别看代码猜用途 |
| 3D 渲染/物理/动画/MMD | 知识卡 + 源码；babylon-mmd 是 fork | 别按标准 Babylon.js 文档猜 |
| Wails Go↔TS 绑定 | `npm run generate:bindings`（必须 `-ts`）自动生成 | 别手写绑定代码 |
| 改任何模块前 | 先读该模块知识卡了解设计意图 | 别直接看代码猜意图 |
| 写新 ADR 前 | `grep docs/adr/` 检查是否取代既有决策 | 别跳过取代检查 |

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


## 钩子自动化

> `.githooks/`（需 `git config core.hooksPath .githooks` 激活）。
> `pre-commit` 自动同步 docs/ 索引（提交常夹带 docs/ 是钩子行为，非手滑）。`pre-push` 全量门禁，失败阻断推送，无逃生阀。
> `--no-verify` 跳过 pre-commit/prepare-commit-msg，不影响 pre-push。doctor 输出 `[WARN]...skip` 时须手动 `tsc` 验证。

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

## MCP 扩展

`serena`：符号级导航（查定义/引用/跳转），语义重构独占。需 Python + `uv`。启动后先索引 `frontend/` 再派活。

## ADR 规则

> 新 ADR 走 `node scripts/new-adr.mjs` 取号，禁止手写编号。状态值：`✅ 已采纳` / `🔄 部分采纳` / `🧊 已废弃` / `❌ 已取代`。
> 新 ADR 落地时检查是否取代既有决策；取代判别细则见 `docs/adr/supersede-rules.md`。

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
