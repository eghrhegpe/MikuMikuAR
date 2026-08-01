# 内部文档（仓库可见 · 站点隐藏）

> 以下目录**不发布**到文档站（由 `.vitepress/config.ts` 的 `srcExclude` 排除），
> 属开发过程产物 / 内部参考层——面向开发者与 AI 协作，而非终端用户。
> 需要阅读时请到 **GitHub 仓库 `docs/` 下**直接浏览（或本地仓库）。

## 目录清单

| 目录 | 内容 | 典型读者 | 状态 |
|------|------|----------|------|
| [`audit/`](https://github.com/eghrhegpe/MikuMikuAR/tree/main/docs/audit) | 代码审核报告（按日期命名，覆盖 env / manager / outfit / 感知层等模块） | 开发者、AI 审查员 | 持续产出 |
| [`research/`](https://github.com/eghrhegpe/MikuMikuAR/tree/main/docs/research) | 技术调研（Wails v3 源码分析、babylon-mmd API、竞品分析、格式研究） | 架构师、技术选型 | 按需调研 |
| [`ai-new/`](https://github.com/eghrhegpe/MikuMikuAR/tree/main/docs/ai-new) | AI 能力新闻周记（2026-07 起） | 关注 AI 集成进展者 | 周更 |
| [`upstream/`](https://github.com/eghrhegpe/MikuMikuAR/tree/main/docs/upstream) | 上游依赖兼容性（babylon-mmd 文档镜像、兼容性说明） | 依赖升级时的维护者 | 按需 |
| [`superpowers/`](https://github.com/eghrhegpe/MikuMikuAR/tree/main/docs/superpowers) | 规划草稿（plans） | 规划期讨论 | 草稿态 |
| [`knowledge/.archive/`](https://github.com/eghrhegpe/MikuMikuAR/tree/main/docs/knowledge/.archive) | 知识卡归档（被合并/取代的旧卡，保留供追溯） | 考古排查时 | 归档 |
| [`audit` 关联规范](../AGENTS.md) | 项目根 AGENTS.md 的「审核代码可用性」章节定义了审核流程与输出格式 | 开发者 | — |

## 为什么隐藏

- `audit` / `research` / `ai-new` 是**过程性文档**，多数内容会沉淀为 ADR / 知识卡后才对外；直接发布会让站点信息噪音大于价值。
- `superpowers` / `upstream` 属**草稿与镜像**，不适合作为稳定文档入口。
- 站点保留**结论层**（ADR + 知识卡 + 用户指南），**过程层**留在仓库——两层分工避免"过程文档 + 结论文档"双写漂移。

## 如何把某篇内部文档提升为对外文档

1. 沉淀结论 → 新建/更新 ADR（`npm run new:adr`）或知识卡（`npm run new:knowledge-card`）。
2. 从 `srcExclude` 中移除对应目录（或把文件移到对外目录），重跑 `npm run gen:docsindex`。
3. 运行 `npm run check:docs` 验证无漂移后提交。
