# Babylon-mmd 上游差异与自治维护文档区

> 本目录集中承载联邦项目与 `noname0310/babylon-mmd` 上游的**差异追踪、本地应对措施与自治维护**记录（上游 PR 路径已于 2026-07-27 关闭，所有差异就地解决）。
> **权威登记册见 [ADR-110](../adr/adr-110-immdmodel-upstream-pr.md)**（跨 ADR / 研究汇总，11 项候选）。
> 本目录与 ADR-110 为「索引 ↔ 详情」关系，**不在本处复制登记册**（遵守 ADR-110「唯一入口」治理规则）。

## 目标

记录联邦项目与 babylon-mmd 上游的所有接口/设计差异、对应的本地应对措施（augmentation / cast / 反射），作为永久自治维护台账。上游贡献路径已关闭，不再向 noname0310/babylon-mmd 提 PR。

## 仓库映射（双轨）

| 角色 | 仓库 | 关键路径 |
|------|------|----------|
| 规划 / 登记册（联邦侧） | `MikuMikuAR` | `docs/adr/adr-110-*` + 本目录 |
| 执行 / 代码（上游侧） | `babylon-mmd` fork（`eghrhegpe/babylon-mmd`） | 特性分支 `feat/immdmodel-api-completion` |

## 文档索引

- **[ADR-110](../adr/adr-110-immdmodel-upstream-pr.md)** — 上游贡献登记册总入口（条目 1 已关闭：AI 代理 + 设计分歧，见兼容性报告）
- **[babylon-mmd 兼容性分析报告](babylon-mmd-compatibility.md)** — 联邦项目全部 23 处 babylon-mmd 限制应对措施的完整清单与风险评估**
- 来源研究：`docs/research/babylon-mmd-api-analysis.md` §3.1 接口缺口 / §五 P0
- 来源研究（已决策不追，登记为条目 11）：`docs/research/wind-affect-wasm-physics.md`
- 关联 ADR：`064` / `098` / `187` / `188` / `056` / `058` / `029` / `083` / `024` / `054` / `016` / `085` / `192`（上游适配层重构 — MmdAdapter）

## 执行跟踪

| 条目 | 内容 | 原决策 | 最终状态 | 说明 |
|------|------|--------|---------|------|
| 1 | `IMmdModel` 补全 | ✅ 已立项 | ❌ 已关闭 | PR #94 被拒（AI 代理 + 设计分歧）。本地 `RuntimeModel` augmentation 保留 |
| 2–11 | 登记册全部条目 | 延期/否决/阻塞 | ❌ 冻结 | 上游 PR 路径已关闭。所有差异改由本地方案解决 |

## 工作流（已废弃）

> ⚠️ 上游 `noname0310/babylon-mmd` 不接受 AI 代理编写的 PR，且设计立场与联邦项目有分歧。
> 以下工作流仅作历史参考，不再执行。

1. ~~规划在 MikuMikuAR（本目录 + ADR-110 登记册）~~
2. ~~执行切到 babylon-mmd fork，开特性分支改代码~~
3. ~~本地验证 → 向上游提 PR~~
4. ~~上游合并后回联邦清 augmentation~~

---

*本目录由 Riku（联邦首席架构师 AI）于 2026-07-27 建立，作为上游贡献文档的统一安放点。*
