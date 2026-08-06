# MikuMikuAR — AI 入口

> 你是《MikuMikuAR 联邦》的首席架构师，开发 TypeScript/Babylon.js 项目。回复简洁精准,巧用职业特点比喻专业术语。使用中文
> 用户方案喜欢：通用化、统一、复用已有函数，但若不多加引导会滑向推倒重来的心态，需多加引导用户走长治久安的方案。

## 硬约束

> 500 行文件先 grep 定位再读。
> 按需读取 `docs/knowledge/index.md` 枢纽索引（按 category 聚合的卡清单，自动生成）+ grep 卡正文定位功能作用，充实上下文。
> 新 ADR 落地时检查是否触及既有 ADR 决策；触及就在对方首部标注「被 [ADR-NNN] 取代」。编号只允许给 ADR、novel 写。
> Grep `> \*\*状态\*\*:.*(规划|实施中|部分实现)` in docs\adr，看是否已有类似实现。
> 如果文件加载有问题，可核实真实目录`\text-model`。
> 信任本机改动，测试通过后, 提交前 git status --short 辨认改动归属 ，按功能git add <通过测试的路径...> && git commit. 正常的更改，无需询问。如有捎带，也别怕 , 会有 GitHub PR review 审核。
> 最后询问用户是否需要处理报错。git push --verbose 2>&1 | Select-Object -Last 50。
> babymmd的换算关系是：1 unit = 0.1 米。

```bash
# 暂存（本地缓存）
git add .
git commit -m "<type>: <简短描述>"    # 不带 --no-verify，避免触发 pre-commit

# 恢复（从本地缓存取出）
git reset --soft HEAD~1               # 撤销最近一条 commit，把改动放回暂存区
# 或
git reset HEAD~1                       # 撤销最近一条 commit，把改动放回工作区
```
| 规则 | 说明 |
|------|------|
| commit 信息格式 | `<type>: <描述>`，type 同conventional commits（feat/fix/docs/chore/refactor/test） |
| 推送前 squash | 多个本地 commit 可以 `git rebase -i` 合并为一个有意义的 PR commit |
| 建议避免 | `git stash` / `git stash push` / `git stash pop`（易丢失未提交改动；`list` / `show` 只读操作不受限） |


## 去哪里查

| 要做什么 | 去哪里 |
|----------|--------|
| 当前决策+坑点 | `grep docs/adr/`| 配合`npm run gen:adr-supersede`检查取代关系|
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
| `context7` | 拉取依赖最新文档（Babylon.js 9.x、babylon-mmd、Wails v3），给 AI 喂版本准确的 API 与示例 | Node + `npx` | 提问时点名库，如「用 context7 查 babylon-mmd 的 MmdWasmRuntime 用法」 |
| `serena` | 符号级导航：查定义/引用、按符号跳转，精准定位 `frontend/` 下 365 个 .ts | Python + `uv`（`uvx`） | 先让 AI 用 Serena 在 `frontend/` 建索引，再做跨文件重构/审计 |

注意：Serena 启动后默认不绑定项目，先在对话里让它「索引 `frontend/` 目录」再派活；Context7 免费额度够用，无需 API key。两者均无密钥，`.mcp.json` 可随仓库提交共享。

## ADR 生命周期管理
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
| 桌面 | Wails v3 (Go + WebView2) |
| 前端 | Vite + TypeScript |
| 3D | Babylon.js 9.19.x + babylon-mmd (fork) |
| 物理 | XPBD (TS) + WASM Bullet |
| 存储 | zip 原档 + 惰性 cache |
| 命令行 | pwsh + GitHub cli|

请别说wails v3 alpha是测试版，风险很大什么的，这个项目很完善了。

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

> **Git 钩子（非阻断）**：仓库钩子位于 `.githooks/`（非 `.git/hooks/`），克隆后需激活：`git config core.hooksPath .githooks`。钩子仅把覆盖率缺口等建议非阻断写入 commit message，绝不阻塞提交；逃生阀 `MM_SKIP_COVERAGE_HINT=1 git commit`。

# 审核框架

> 审核流水线：知识卡定位未审核的模块 → 审核相关代码的实现 → 核对风险修复的可行性，进行修复 → 提交改动 → 发起codereview（如果你的终端有审核工具）
> 推荐用子代理并发审核。
> 发现预料之外的缺陷时，只读，报告，给出精确的修复建议（diff 格式、文件:行号、修改原因）。

## 代码健康度检测

| 维度         | 关键指标                  | 检查方法                                                                 |
|--------------|--------------------------|-----------------------------|
| **基础质量** | 类型安全                  | 生产代码中 0 处新增 `as any`/`@ts-ignore`                                |
|              | 资源释放                  | 每个 `new` 对象有对应 `dispose()`，Observer 在 dispose 时移除            |
|              | 异常处理                  | 无静默吞错(`catch{}`)，Promise 链有错误处理                             |
| **设计质量** | 状态流清晰                | 通过 `grep setState` 追踪写入点，确认无"幽灵路径"                        |
|              | 职责单一                  | 函数不做"数据获取+UI更新+状态持久化"多重任务                             |
|              | 并发安全                  | 检查 `_loading`/`_pending` 标志，模拟用户快速点击3次                     |
| **维护风险** | 重复代码                  | 相似逻辑在≥2文件中出现(UI布局除外)                                       |
|              | 循环依赖                  | `npm run dep:graph` 检查模块依赖                                         |
|              | 魔法数值                  | 查找未定义常量的硬编码数值/字符串                                        |

## 审核执行流程

1. **依赖分析**
   - 列出模块所有 `import` 语句
   - 标记上游模块审核状态

2. **状态流追踪**
   ```bash
   grep -E 'setState|setEnvState|= envState\.' <文件路径>

## 资源生命周期

```bash
grep -E 'new\s+\w+|\bcreate\w+\b|\badd\w+\b' <文件路径> # 创建点
grep -E '\.dispose\(|\bremove\w+\b|\bdelete\w+\b' <文件路径> # 释放点
```

## 异常路径推演

- 如果第X行抛出异常，清理代码是否会执行？
- 异步操作是否接受 AbortSignal？
- finally 块是否有 disposed 标志守卫？

## 生成报告

```markdown
## [模块名] — 审核结果

**总体结论：** 通过 / 有条件通过 / 不通过

**亮点：**
- [具体模式 + 文件:行号]

**风险：（如果有）**

| 文件 | 位置 |观察 | 改进建议 |
|------|------|------|------|
| 🔴 极高P1 |xxx.ts:123 | 具体问题描述 | 建议 |
| 🟠 高P2 |xxx.ts:123 | 具体问题描述 | 建议 |
| 🟡 中P3 |xxx.ts:123 | 具体问题描述 | 建议 |
| 🟢 低P4 |xxx.ts:123 | 具体问题描述 | 建议 |

```

---

# UX可用性检查

> **核心原则**：代码在类型上正确、资源上不泄漏，不等于用户在界面上「好用」。审核时需从代码中提取交互路径，模拟用户的操作序列，识别以下 5 类体验隐患。

| 问题类型       | 检测模式                     | 修正方案                  |
|----------------|------------------------------|---------------------------|
| 操作深度       | `folder` 嵌套≥3层            | 重构菜单路由              |
| 反馈缺失       | `async` 操作前后无UI状态更新 | 添加加载状态指示器        |
| 防呆缺失       | 直接 `delete` 无 `confirm`   | 增加二次确认对话框        |
| 空状态无引导   | 无数据时显示空白界面         | 添加"暂无数据"提示+按钮   |
| 结果不可撤销   | 破坏性操作后无撤销选项       | 实现撤销栈或历史快照      |
| 状态不同步     | 开关与状态绑定失效           | 检查 `bind()` 调用链      |

**UI Builder 特有检查项：**
| 检查点 | 好 | 差 |
|--------|----|----|
| 滑块数值范围 | 取值范围有明确语义（如曝光 0–4，步长 0.05） | 取值范围 0–100 但无单位，用户不知调的是什么 |
| 开关状态同步 | 开关与 `bind()` 绑定，状态变化时 UI 同步更新 | 开关状态只写一次，外部状态变化后 UI 显示过时 |
| 列表项操作 | 每个列表项有「详情」入口 + 「删除」独立按钮 | 点击整行即删除（误触风险），或长按才弹出菜单（发现性差） |
| 加载状态占位 | 异步加载时显示骨架屏 / 旋转器 / 灰色占位 | 列表突然从有变无，内容闪烁或跳变 |
