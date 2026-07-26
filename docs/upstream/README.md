# Babylon-mmd 上游贡献文档区

> 本目录集中承载「向 `noname0310/babylon-mmd` 提交 PR / 贡献」相关的规划、研究与执行跟踪。
> **权威登记册见 [ADR-110](../adr/adr-110-immdmodel-upstream-pr.md)**（跨 ADR / 研究汇总，11 项候选）。
> 本目录与 ADR-110 为「索引 ↔ 详情」关系，**不在本处复制登记册**（遵守 ADR-110「唯一入口」治理规则）。

## 目标

汇总所有建议向 babylon-mmd 提交 PR 的 ADR 与候选，形成唯一可追踪的上游贡献视图，并推进其中已立项的条目落地。

## 仓库映射（双轨）

| 角色 | 仓库 | 关键路径 |
|------|------|----------|
| 规划 / 登记册（联邦侧） | `MikuMikuAR` | `docs/adr/adr-110-*` + 本目录 |
| 执行 / 代码（上游侧） | `babylon-mmd` fork（`eghrhegpe/babylon-mmd`） | 特性分支 `feat/immdmodel-api-completion` |

## 文档索引

- **[ADR-110](../adr/adr-110-immdmodel-upstream-pr.md)** — 上游贡献登记册总入口（条目 1 已立项：`IMmdModel` 接口补全）
- 来源研究：`docs/research/babylon-mmd-api-analysis.md` §3.1 接口缺口 / §五 P0
- 来源研究（已决策不追，登记为条目 11）：`docs/research/wind-affect-wasm-physics.md`（WASM Bullet `setWind` API，本地方案 A+C 已覆盖，fork/PR 仅兜底）
- 关联 ADR：`064` / `098` / `187` / `188` / `056` / `058` / `029` / `083` / `024` / `054` / `016` / `085`

## 执行跟踪

| 条目 | 内容 | 决策 | 状态 | 执行仓库 / 分支 | PR 链接 |
|------|------|------|------|----------------|---------|
| 1 | `IMmdModel` 补全 `setRuntimeAnimation` / `createRuntimeAnimation` / `currentAnimation` | ✅ 已立项 | 📋 待启动（规划完成） | babylon-mmd `feat/immdmodel-api-completion` | — |
| 2–11 | 见 ADR-110 登记册 | 延期 / 否决 / 阻塞（各异） | 按各决策冻结 | — | — |

## 工作流

1. **规划在 MikuMikuAR**（本目录 + ADR-110 登记册）
2. **执行切到 babylon-mmd fork**，开特性分支改代码（前置：`npm install` + `wasm-pack`）
3. 本地验证（类型检查 / build，消除 3 处 cast） → 向 `noname0310/babylon-mmd` 提 PR
4. 上游合并后回 MikuMikuAR 按 ADR-110「步骤四」清理 `core/types.ts` 的 augmentation

---

*本目录由 Riku（联邦首席架构师 AI）于 2026-07-27 建立，作为上游贡献文档的统一安放点。*
