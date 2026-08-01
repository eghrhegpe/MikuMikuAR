# 知识卡层（Knowledge Cards）

> 本目录是 MikuMikuAR 的**原子化架构知识层**，借鉴 repowiki 的「知识卡 + `source_files` 机器可校验」范式，
> 但**主权归城邦**：由我们拥有、可重生成、受 `scripts/check-doc-drift.mjs` 守护。
>
> 生成日期基线：2026-07-23（覆盖 ADR-166~175 引入的子系统）；同日扩展「物理系统（physics）」分组，补录 ADR-081/084/104 的 WASM Bullet 物理子系统（physics-bridge / wind-physics / skirt-analyzer / virtual-skirt / ground-collision）。
> 2026-07-25 扩展：新建 41 张卡片覆盖 motion/env/menus/core 四大集群，修正 16 张符号警告，补录 22 张 ADR 关联。
> 2026-07-25 二次扩展：新建 38 张高价值源文件卡片（含感知层子模块/动作模块基类/广场/设置/工具等），修正 13 张符号警告，补录 22 张 ADR 关联。
> 2026-08-02 新增检索视图：`index.md` 尾部生成「ADR 反查表」（决策 → 关联卡片），并新增机器生成的[知识卡关联图](./graph.md)（`npm run gen:knowgraph`，架构卡按分类分组连到所引用的 ADR）。

## 它解决什么

| 层 | 回答的问题 | 性质 |
|----|-----------|------|
| `docs/adr/` | **为什么**当初这么决定？ | 不可变决策日志 |
| `docs/architecture.md` + `docs/function-map.md` | 系统**整体地图 / 函数大全** | 概要式地图（已自承部分过时） |
| **`docs/knowledge/`（本层）** | 某个子系统**现在长啥样、去哪找**？ | 原子、DRY、带源码直链 |

三者关系：**ADR 是决策真相源；knowledge 是 ADR 结论在代码侧的「现状快照」；architecture/function-map 是更高层的索引。**
知识卡**引用不复制** ADR 的结论，仅记录 `adr:` 关联编号。

## 卡片格式规范

每张卡为独立 `.md` 文件，文件名与对应模块文件名一致（如 `quality-profile.md` ↔ `frontend/src/scene/render/quality-profile.ts`）。

```markdown
---
kind: <snake_case 标识符>
name: <中文短名>
tier: <architecture|leaf>   # 默认 architecture；leaf 表示机器索引对象（见「立卡判据」）
category: <rendering|env|motion|ui|core|backend|physics|scene>
scope:
  - <模块目录 glob>
source_files:        # 仓库相对路径，必须真实存在于磁盘
  - frontend/src/scene/render/quality-profile.ts
adr:                 # 关联决策（可选）
  - ADR-174
# 以下字段用于帮助 AI 通过用户意图、符号和约束快速检索（可选）
symbols:
  - publicFunction
invariants:
  - <必须保持的状态、并发或资源约束>
tests:
  - frontend/src/__tests__/path/to/module.test.ts
use_when:
  - <用户可能描述的功能词>
---

## 系统概览
<2-4 句讲清它是什么、解决什么问题>

## 核心职责
- `file.ts` — <职责>

## 对外 API（节选）
- `symbol()` — <作用>

## 与其他子系统关系
- <被谁引用 / 引用谁>

## UI 入口（architecture 卡必填，leaf 卡可选）
- 菜单路径 / 面板：如「场景菜单 → 水面设置」（schema id `env:water:*`）
- 入口函数：`buildWaterLevel(): PopupLevel`（文件 `menus/env-water-levels.ts`）
- 示例见 [env-water.md](./env-water.md)

## 不变量
- <不能被修改破坏的状态、资源或并发约束>

## 验证入口
- 测试：`frontend/src/__tests__/path/to/module.test.ts`
- 命令：`cd frontend && npm run test -- path/to/module.test.ts`
```

### 立卡判据（ADR-218）

| 情形 | 处置 |
|------|------|
| *v 可独立理解、被 ≥2 子系统引用、修改有风险（状态/资源/并发不变量） | 立 **architecture** 卡（人读主对象） |
| *x 纯工具函数、测试桩、barrel 聚合、单一调用方叶子 | **不立卡**；或立 **leaf** 卡（机器索引对象，README 索引折叠为计数行） |

- `tier` 默认 `architecture`；标 `leaf` 时 README 索引不逐张平铺。
- architecture 卡必须含 `invariants` / `use_when` / `## UI 入口` 小节（由 `check-doc-drift.mjs` 检查 10 兜底，WARN）。


### AI 使用字段

- `symbols`：列出本卡负责的公共函数、类、状态或常量，便于按符号反查。
- `invariants`：记录必须保持的约束；代码修改前后都应核对。
- `tests`：列出最小验证入口，避免每次修改都盲跑全量测试。
- `use_when`：使用者可能说出的自然语言关键词，用于从 `docs/knowledge/routes.md` 继续路由。
- 旧卡片不要求一次性补齐；只要卡片被修改或对应模块发生结构性变化，就按模板逐步补充。

### 何时更新知识卡

必须更新：模块拆分/合并、公共 API 变化、状态写入路径变化、资源释放责任变化、并发策略变化、关键依赖变化、`source_files` 路径变化或已知风险变化。

通常不必更新：内部重构但职责和不变量不变、样式微调、变量重命名、仅补充测试。

### `source_files` 铁律
- 路径**相对仓库根**，且**必须能在磁盘找到**（由 `scripts/check-doc-drift.mjs` 反向校验）。
- 禁止写不存在的路径、禁止写 `node_modules/` 或生成文件（`*.gen.ts`、`wailsjs/`）。
- 若文件被重命名/删除，卡片须同步更新或归档。

## 与 drift 脚本的衔接
`scripts/check-doc-drift.mjs` 已将本层纳入机器守护（2026-07-23）：
- **[ERROR] 知识卡 `source_files` 完整性** —— 扫描 `docs/knowledge/*.md`（排除 `README.md`）的 frontmatter，
  任一 `source_files` 路径在磁盘不存在即报错并退出码 1，防止卡片声称的源码被改名/删除后无人察觉。
- 报告额外输出「知识卡数 / source 覆盖数」，`--json` 模式含 `knowledge: { cards, missingSources, coveredCount }`。

跑法：`node scripts/check-doc-drift.mjs`（或 `--json`）。可接 CI 卡点。
