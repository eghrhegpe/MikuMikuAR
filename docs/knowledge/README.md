# 知识卡层（Knowledge Cards）

> 本目录是 MikuMikuAR 的**原子化架构知识层**，借鉴 repowiki 的「知识卡 + `source_files` 机器可校验」范式，
> 但**主权归城邦**：由我们拥有、可重生成、受 `scripts/check-doc-drift.mjs` 守护。
>
> 生成日期基线：2026-07-23（覆盖 ADR-166~175 引入的子系统）

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
category: <rendering|env|motion|ui|core|backend>
scope:
  - <模块目录 glob>
source_files:        # 仓库相对路径，必须真实存在于磁盘
  - frontend/src/scene/render/quality-profile.ts
adr:                 # 关联决策（可选）
  - ADR-174
---

## 系统概览
<2-4 句讲清它是什么、解决什么问题>

## 核心职责
- `file.ts` — <职责>

## 对外 API（节选）
- `symbol()` — <作用>

## 与其他子系统关系
- <被谁引用 / 引用谁>
```

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

## 卡片索引（首批）

| 卡片 | 模块 | 关联 ADR |
|------|------|----------|
| [quality-profile](./quality-profile.md) | `scene/render/quality-profile.ts` | ADR-174 |
| [env-wetness](./env-wetness.md) | `scene/env/env-wetness.ts` | ADR-172 |
| [env-reflection](./env-reflection.md) | `scene/env/env-reflection.ts` | ADR-151/152 |
| [env-context](./env-context.md) | `scene/env/env-context.ts` | — |
| [scene-drag-levels](./scene-drag-levels.md) | `menus/scene-drag-levels.ts` | ADR-171 |
| [bone-override-store](./bone-override-store.md) | `scene/motion/bone-override-store.ts` | ADR-084 |
| [motion-pipeline](./motion-pipeline.md) | `scene/motion/motion-pipeline.ts` | ADR-129 |
| [perception-observer](./perception-observer.md) | `scene/motion/perception-observer.ts` | ADR-162/166 |
