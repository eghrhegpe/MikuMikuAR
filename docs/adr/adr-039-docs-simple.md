# ADR-039: 文档体系精简

> **状态**: 已完成（2026-07-05 执行）

## 背景

docs/ 从核心文档膨胀到 18 份根文件 + 30+ ADR + research/ 调研归档。AI 会话读取 `AGENTS.md` 后仍需额外判断「哪些值得读、哪些已过时、哪些重复」。

审计发现：

| 问题 | 根因 |
|------|------|
| `requirements.md` 静态需求被 `status.md` 动态快照完爆 | AI 不需要考古，需要知道「现在是什么」 |
| `roadmap.md` 规划文本被 ADR 决策记录完爆 | ADR 有「做了什么 + 为什么 + 坑点」，roadmap 只写给人类 |
| `menu-architecture.md` / `design.md` 名称学术脱节 | AI 读概念 → 找代码，两步不如一步 |
| `reusables.md` 复用索引被 `function-map.md` + grep 覆盖 | 写新函数前 grep 就够了，不需要独立清单 |
| `fix-cycle.md` / `multi-ai.md` / `workflow.md` 无人读 | 流程模板和 AI 并发是 IDE/终端问题，不是文档能管的 |
| `foundation.md` 硬约束名存实亡 | 硬约束已浓缩进 AGENTS.md 4 条，地基冗余 |
| `glossary.md` / `design-archive.md` | 术语表 AI 不查，否决方案 AI 读了反而污染 |
| 三份索引（根 AGENTS / frontend AGENTS / docs/README） | AI 不知道该信哪个 |
| 文档中的 P0-P2 优先级标记 | AI 花时间理解排序逻辑而不是直接干活 |

## 决策

### 1. 删除 10 份冗余文档

| 文档 | 理由 |
|------|------|
| `foundation.md` | 硬约束已被 AGENTS.md 4 条浓缩 |
| `requirements.md` | 静态需求 → `status.md` 动态快照覆盖 |
| `roadmap.md` | 规划文本 → ADR 已覆盖决策+坑点 |
| `reusables.md` | grep + function-map + ADR 覆盖 |
| `fix-cycle.md` | 流程模板，AI 不读 |
| `multi-ai.md` | 终端/IDE 并发控制比文档靠谱 |
| `workflow.md` | AGENTS.md 硬约束 + 通用 AI 常识足够 |
| `glossary.md` | 术语表对 AI 无实际用途 |
| `design-archive.md` | 已否决方案，AI 读了反而污染上下文 |
| `release.md` | 发版指南，无维护价值 |

### 2. 重命名 + 瘦身

| 文件 | 变更 |
|------|------|
| `menu-architecture.md` → **`menu-how-to.md`** | 砍概念描述/ASCII 结构图，只留入口位置、代码模板、路由规则、跨域归属 |
| `design.md` | 砍§一文档地图 + §二设计原则，只留组件函数签名 + 用法示例 + 命名约定 |
| `status.md` | Phase 序号列移除（已完成功能平铺），roadmap 引用清除 |
| `docs/README.md` | 改为纯人类入口，移除 AI 指令和文档宪法标记 |
| `frontend/AGENTS.md` | 删除§四配套文档速查表，更新 multi-ai 引用 |
| `troubleshooting.md` | 移除 5 处 P0/P1 优先级标记 |
| `terminology.md` | 移除 glossary.md 引用 |
| `competitive-analysis.md` | 移除 roadmap.md 引用 |

### 3. ADR 保留编号

ADR 文件名继续使用 `adr-xxx.md` 编号前缀。编号制在 AI 自主迭代中提供稳定引用锚点（ADR 之间相互引用时依赖编号），且维护成本极低（+1 递增即可）。取消编号节省的时间远小于引用编号带来的便利。

### 4. 路由表唯一化

- `docs/README.md` → 纯人类入口，不包含 AI 指令
- `frontend/AGENTS.md` → 不再维护「配套文档速查」，AI 跨模块信息查询直接走根 `AGENTS.md`
- 根 `AGENTS.md` → 维护**唯一一份**模式路由表

### 5. 优先级标记保留原则

- ADR 内部：保留（决策上下文的一部分）
- 非 ADR 文档：全部移除（P0-P2 是临时排序，不应用作永久标记）

## 最终文档结构

```
docs/
├── README.md              # 纯人类入口
├── status.md              # 只读快照
├── architecture.md        # 技术实现细节
├── design.md              # UI 组件规范（唯一来源）
├── menu-how-to.md         # 菜单操作指南
├── function-map.md        # 函数定位（grep 用）
├── troubleshooting.md     # 历史坑点（无优先级标记）
├── terminology.md         # 代码级命名规范
├── competitive-analysis.md # 竞品分析
├── outfits-spec.md        # 换装系统规格
├── ui-duplication-audit.md # UI 重复审计
├── adr/                   # 决策记录（编号制）
└── research/              # 调研归档（默认不读）
```

删除 10 份，保留 11 份 + 2 子目录。

## 教训

1. **文档厚度与 AI 犯错概率正相关** — 文档越多 AI 越不读，越读越犹豫。
2. **规划文本是给人类看的** — AI 需要的是决策记录，不是愿景。
3. **一份路由表 + 一份架构 + 一份 UI 规范 = AI 能干活的最小集**。其他都是噪音。
4. **优先级标记从决策记录中移出** — P0/P1/P2 是临时工作排序，不应用作文档永久属性。
5. **三份索引等于没有索引** — 坚持单一路由表原则。

