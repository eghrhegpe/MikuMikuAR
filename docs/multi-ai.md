# MikuMikuAR 多 AI 协作手册

> **定位**：多 AI 并发文件互斥规则 + oh-my-opencode 子代理说明。
> 本文件从根 [`AGENTS.md`](../AGENTS.md) §四 / §九 拆出。

---

## 一、文件级互斥

| 文件 | 最多同时修改的 AI 数 | 原因 |
|------|----------------------|------|
| `frontend/src/core/config.ts` | **1** | 共享类型定义，合并冲突极高 |
| `frontend/src/scene/scene.ts` | **1** | 模块级副作用（import 即执行），diff 三向合并必碎 |
| `frontend/src/menus/model-detail.ts` | **1** | 同上 |
| `app.go` | **1** | Wails binding 注册表，同名 binding 覆盖无提示 |
| `frontend/wailsjs/go/` | **0**（不手动改） | Wails 自动生成，谁 build 谁覆盖 |
| 其余 `*.ts` / `*.go` | 不限制 | 函数级新增，冲突概率低 |

## 二、操作纪律

1. **改前 `git pull && git log --oneline -5`** — 确认 HEAD 不是别人的半成品
2. **不改已声明「本会话独占」的文件** — 如果另一个 AI 先占了 config.ts，你去改 scene 需要等它提交
3. **新增类型优先放独立文件** — 避免 config.ts 成为瓶颈
4. **提交前检查 tsc 基线** — 先 `git stash` → `cd frontend && npm run check` 确认基线错误数 → `git stash pop` 后确认未新增
5. **`wails dev / build` 只在一个 AI 上跑** — 自动生成文件会覆盖其他人的 binding
6. **测试文件名带系统前缀** — 如 `outfit.test.ts` ✓，`test-helpers.ts` ✗（冲突）

## 三、冲突时的熔断

```bash
git stash                  # 暂存自己
git pull --rebase          # 变基拉取
git stash pop              # 解暂存
# 如果 pop 失败（文件级冲突）：
git checkout --theirs path # 接受对方版本，重新 apply 自己的改动
```

---

## 四、Oh My OpenAgent 子代理

> 本项目通过 `oh-my-opencode` 插件安装了多 agent 系统。主代理 Sisyphus 负责调度子代理。

### 4.1 子代理速查

| 子代理 | 角色 | 调用方式 |
|--------|------|----------|
| **Oracle** 🧠 | 高难度推理（审架构、复杂调试） | `task(subagent_type="oracle", ...)` |
| **Hephaestus** 🔧 | 自主探索+端到端实现 | `task(subagent_type="hephaestus", ...)` |
| **Hephaestus deep** | 同上，深度研究型 | `task(category="deep", ...)` |
| **Explore** 🔎 | 代码库搜索 | `task(subagent_type="explore", ...)` 或直接用 `grep`（免费） |
| **Librarian** 📚 | 查外部文档/开源代码 | `task(subagent_type="librarian", ...)` |
| **Prometheus** 📋 | 战略规划（Tab 切 Plan 模式触发） | 自动触发 |
| **Metis** 🔍 | 需求预分析 | `task(subagent_type="metis", ...)` |
| **Momus** 🧐 | 方案评审 | `task(subagent_type="momus", ...)` |

### 4.2 使用提示

Sisyphus 可能习惯自己干活而不是调度子代理。复杂任务时加以下用语提醒：

```
用 Oracle 先审一下架构
开 explore 搜一下现有模式
让 Hephaestus 自己探索代码再实现
用 Metis 分析一下这个需求有没有歧义
用 Momus 评审一下方案
```

> **注意**：轻量搜索直接用 `grep`/`glob` 工具，免费且更快，不需要调子代理。

### 4.3 当前模型配置

> 详见 `~/.config/opencode/oh-my-openagent.jsonc`

| Agent | 模型 | 级别 |
|-------|------|------|
| Sisyphus | deepseek-v4-flash | 调度，不碰硬活 |
| Oracle | deepseek-v4-pro | 唯一 Pro，硬推理 |
| Hephaestus | deepseek-v4-flash | 写代码主力，Sisyphus review 兜底 |
| Metis / Momus | deepseek-v4-flash | 分析/评审 |
| Explore / Librarian / Looker / Atlas / Junior | deepseek-v4-flash | 搜索/轻活 |
| Prometheus | 全局默认 flash | 偶尔触发 |

> **只有 Oracle 用 Pro**。所有子代理统一 flash，Sisyphus review 兜底，不浪费 Pro 预算。

### 4.4 Trae 内置 Task 工具（今日验证可用）

> 以上 oh-my-opencode 子代理是插件体系。Trae 自身还提供了 `Task` 工具作为通用子代理调度能力，**今天已验证可用**。

**工具名**：`Task`

**参数**：

| 参数 | 类型 | 说明 |
|------|------|------|
| `description` | string | 短描述（3-5 词），任务标题 |
| `query` | string | 任务详细描述（实际可以更长），包含目标、约束、验收标准 |
| `response_language` | string | 响应语言，如 `"中文"` |
| `subagent_type` | string | 子代理类型，**`"general_purpose_task"`** 是通用代码任务类型 |

**调用示例**：

```
Task(
  description="库列表rAF分片渲染",
  query="实现 Task 10：模型库列表 rAF 分片渲染优化...",
  response_language="中文",
  subagent_type="general_purpose_task"
)
```

**特点**：
- ✅ 支持**并发调用**（同一条消息里放多个 Task 工具调用，子代理并行执行）
- ✅ 子代理有独立的 tool call 能力（读文件、grep、编辑、跑命令）
- ✅ 返回结构化总结，不污染主会话上下文
- ⚠️ `subagent_type="hephaestus"` 等 oh-my-opencode 类型在此工具下**无效**，请用 `"general_purpose_task"`
- ⚠️ 不确定的 subagent_type 先试一次，失败就换回通用型

**踩坑记录（2026-07-01）**：

| 错误尝试 | 原因 | 正确做法 |
|----------|------|----------|
| `subagent_type="hephaestus"` | oh-my-opencode 类型不适用 Task 工具 | 用 `"general_purpose_task"` |
| 工具名 `general_purpose_task` | 工具名不存在，类型名≠工具名 | 工具名是 `Task` |
