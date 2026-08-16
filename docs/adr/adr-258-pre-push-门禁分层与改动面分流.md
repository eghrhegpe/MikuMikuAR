# ADR-258: pre-push 门禁分层与改动面分流

> **状态**: 🔄 部分采纳（2026-08-16）
> **日期**: 2026-08-16
> **编号**: 258
>
> **关联**: [ADR-230](adr-230-docs-automation-toolchain.md)（文档自动化工具链）、[ADR-206](adr-206-test-infra-consolidation-and-assertion-quality.md)（测试基础设施收敛）、[ADR-254](adr-254-p4-backlog-registry.md)（历轮审核 P4 遗留项）
> **来源**: 多轮「优化 push 门禁」的正反方争论：减门禁派主张「CI 兜底即可，本地 push 不应被覆盖率/死代码拖慢」；守门禁派主张「push 前本地抓出问题，避免推错代码污染远端」

---

## 背景与问题陈述

### 现状清点

当前 `.githooks/pre-push` 共 15 个检查项，按实际执行策略汇总如下：

| # | 检查项 | 当前状态 | 触发条件 | 阻断？ | 耗时（估） |
|---|--------|---------|---------|--------|-----------|
| 1 | `check:status` | ✅ 通过 + 自动修复 | 无条件 | ❌ 否（amend 静默） | ~1s |
| 2 | `check:funcmap` | ✅ 通过 + 自动修复 | 无条件 | ❌ 否（amend 静默） | ~1s |
| 3 | `check:docsindex` | ✅ 通过 + 自动修复 | 无条件 | ❌ 否（amend 静默） | ~1s |
| 4 | `check:novelindex` | ✅ 通过 + 自动修复 | 无条件 | ❌ 否（amend 静默） | ~1s |
| 5 | `check:menumap` | ✅ 通过 + 自动修复 | 无条件 | ❌ 否（amend 静默） | ~1s |
| 6 | `check:guide-gap` | ⚠️ 缺口即阻断 | 无条件 | ✅ 是 | ~1s |
| 7 | `check:docs` | ERROR 阻断 / INFO 自动修复 | 非纯文档变更 | ✅ 是（仅 ERROR） | ~3s |
| 8 | `check:md-links` | 脚本崩溃阻断 / broken 链接 INFO | 无条件（python 存在时） | ✅ 是（仅脚本崩溃） | ~2s |
| 9 | `link:check` | 断链阻断 | npm 可用 | ✅ 是 | ~3s |
| 10 | `i18n` | strict 缺失 key 阻断 | npm 可用 | ✅ 是 | ~1s |
| 11 | `bindings` | Go 绑定不同步阻断 | Go 变更 | ✅ 是 | ~2s |
| 12 | `tsc`（含于 `check`） | 类型错误阻断 | 通过 CI + `npm run check` 间接守护 | ✅ 是（CI 侧） | — |
| 13 | `vitest --changed` | 测试失败阻断 | TS 变更 + npm 可用 | ✅ 是 | ~15-25s |
| 14 | `diff-coverage` | ⚠️ 低于 60% 仅建议 | TS 变更 + npm 可用 | ❌ 否（已降级为建议） | ~5s |
| 15 | `lint:changed` | error 阻断 / warning 不阻断 | TS 变更 + npm 可用 | ✅ 是（仅 error） | ~2-3s |
| 16 | `deadcode` | ⏭️ 跳过 | 无条件（已永久移除） | ❌ 否 | 0s |
| 17 | `test:coverage`（全量） | ⏭️ 跳过 | 无条件（已移除） | ❌ 否 | 0s |

**实测耗时**：TS 变更场景下，pre-push 总耗时约 **30-40s**（其中 vitest ~15-25s、lint ~2-3s、其余 ~5s）。

### 核心矛盾

| 正方（减门禁） | 反方（守门禁） |
|---|---|
| CI 已跑全量测试 + 覆盖率 + 死代码 + lint，push 前本地再跑一次冗余 | CI 是事后验证，推错代码污染远端分支历史，revert 成本高 |
| 全量 test:coverage（~66s）→ 改成 vitest --changed（~15-25s）已大幅优化 | diff-coverage 已降级为建议，新代码覆盖率 60% 门槛形同虚设 |
| deadcode 与用户使用无关，仅消耗算力 | deadcode 是技术债可视化窗口，CI 定期跑可防止回退 |
| 全量 lint 慢（~16s），增量扫描（~2-3s）已够用 | 增量只查变更文件，新增文件的 lint 错误漏网 |
| pre-push 是 AI 协作高频路径，每次多等 30s 积少成多 | 30s 换来的是 push 即稳定，值得 |

### 仲裁立场

**门禁的本质不是「越多越好」，而是「该拦的拦，不该拦的放过」**。

当前 pre-push 的"优化"已过度——把真正有价值的门（diff-coverage 阻断、全量 coverage 基线）一并撤掉，而保留的是噪音最小的项（自动生成物同步检查）。这不是优化，是**门禁空心化**。

---

## 决策

### 一、分层门禁设计

将检查项按**价值密度**和**可修复性**分为三层：

| 层级 | 语义 | pre-push 行为 | CI 行为 |
|------|------|--------------|---------|
| **P0 阻断层** | push 必须通过，否则污染远端 | ✅ 阻断 | ✅ 阻断 |
| **P1 建议层** | push 提示但不阻断，由提交期护栏补充 | ⚠️ 不阻断（写入 commit hint） | ⚠️ 非阻断（产物归档） |
| **P2 参考层** | 仅 CI 定期运行，供技术债清算参考 | ⏭️ 跳过 | ✅ 阻断（超基线则 fail） |

### 二、检查项分层矩阵

| 检查项 | 当前状态 | 建议状态 | 理由 |
|--------|---------|---------|------|
| `check:status` | 自动修复 + amend | **P0 自动修复** | 零成本，保证索引同步，不改逻辑 |
| `check:funcmap` | 自动修复 + amend | **P0 自动修复** | 同上 |
| `check:docsindex` | 自动修复 + amend | **P0 自动修复** | 同上 |
| `check:novelindex` | 自动修复 + amend | **P0 自动修复** | 同上 |
| `check:menumap` | 自动修复 + amend | **P0 自动修复** | 同上 |
| `check:guide-gap` | 缺口即阻断 | **P0 阻断** | 用户找不到入口 = UX 硬伤 |
| `check:docs` | ERROR 阻断 | **P0 阻断** | 架构树失效 = 全局信任崩塌 |
| `link:check` | 断链阻断 | **P0 阻断** | 外部读者可见硬伤 |
| `check:md-links` | 脚本崩溃阻断 | **P0 阻断** | 维持现有（仅脚本崩溃才阻断） |
| `i18n` | strict 缺失 key 阻断 | **P0 阻断** | 多语言用户可见硬伤 |
| `bindings` | Go 绑定不同步阻断 | **P0 阻断** | Wails 绑定一致性硬约束 |
| `tsc` | CI 侧阻断 | **P0 阻断（引入 pre-push）** | TS 类型安全是项目底线，pre-push 不检查是重大缺口 |
| `lint:changed` | error 阻断 | **P0 阻断** | 维持现状 |
| `vitest --changed` | 测试失败阻断 | **P0 阻断** | 维持现状 |
| `diff-coverage` | ⚠️ 仅建议 | **P1 建议（恢复阻断在 prepare-commit-msg）** | 新代码必须 ≥60% 覆盖率，但阻断点放在 commit 期而非 push 期——避免 push 时因未 commit 测试而误报 |
| `deadcode` | ⏭️ 跳过 | **P2 参考（CI 定期跑）** | 技术债可视化，不阻塞 push；基线超量时 CI 阻断 |
| `test:coverage`（全量） | ⏭️ 跳过 | **P2 参考（schedule CI 跑）** | 已有 schedule job 兜底，pre-push 不需要重复跑 |
| `check:layering` | — | **P2 参考（CI 定期跑）** | 架构分层违规是技术债，非紧急问题 |

### 三、关键决策说明

#### 3.1 diff-coverage：从 push 期降级 → commit 期升级

**问题**：当前 diff-coverage 在 pre-push 中已降级为"仅建议"，原因是 vitest --changed 跑完后的 coverage 产物可能因未 commit 测试文件而缺失，导致误报。

**解决方案**：将 diff-coverage 的阻断点前移至 `prepare-commit-msg` hook（已在 `.githooks/prepare-commit-msg` 中以 `--suggest --staged` 模式实现）。pre-push 阶段：
- 有 commit 产物 → 直接通过（不重复跑）
- 无 commit 产物（新文件未 commit）→ 跳过，不阻断
- 用户 commit 时 → `prepare-commit-msg` 给出覆盖率缺口建议，写入 commit message 区块

**价值**：既保留了新代码覆盖率保护（≥60%），又避免了 push 期的误报困扰。

#### 3.2 tsc：从 CI 独享 → pre-push 引入

**问题**：当前 tsc 仅在 CI 侧运行，pre-push 不检查类型错误。这意味着 AI 可能推一个 tsc 报错的 commit 到远端，本地毫无察觉。

**解决方案**：在 pre-push 中加入 `tsc --noEmit` 检查（仅当 TS 文件有变更时触发）。耗时 <2s，收益极高。

**注意**：tsc 错误需人工修复，不可自动修复，因此属于**硬性阻断**。

#### 3.3 deadcode：从 pre-push 移除 → CI P2 定期跑

**现状**：deadcode 已从 pre-push 移除（注释行 395-398），CI 的 `deadcode-baseline` job 仍运行。

**决策**：维持现状。deadcode 检查是技术债可视化，不应阻塞开发流程；CI 每日 schedule 或 PR 时运行即可，超基线才阻断。

---

## 改动面分流方案（Phase 2 待实施）

### 当前分流粒度

pre-push 已支持按变更域分流（`GO_CHANGED` / `TS_CHANGED` / `DOCS_ONLY` / `INFRA_ONLY`），但粒度较粗：
- 纯 docs 变更 → 跳过 lint/test，但仍跑全部文档生成物同步检查
- 纯 Go 变更 → 跳过 TS lint/test
- 混合变更 → 全量检查

### 待设计的细粒度分流

参考 YSM 项目实践，未来可设计更精细的**按子目录分流**：

| 变更范围 | 仅触发检查 |
|---------|-----------|
| 仅 `docs/` 或 `*.md` | status / funcmap / docsindex / novelindex / menumap / guide-gap / md-links |
| 仅 `frontend/src/` | tsc / lint:changed / vitest --changed / diff-coverage (commit 期) |
| 仅 `*.go` | bindings |
| 仅 `.github/` 或 `*.yml` | 仅 link:check（验证 CI 配置内部链接） |
| 混合变更 | 全量 |

**实施前提**：需要定义「文件 → 领域」的映射规则表（`scripts/domain-map.mjs`），并在 pre-push 中扩展 `CHANGED_*` 布尔变量。

---

## 实施计划

### Phase 1：立即可做（已同意，本 ADR 生效后执行）

| # | 行动 | 文件 | 负责人 |
|---|------|------|--------|
| 1 | 在 pre-push 中加入 `tsc --noEmit` 检查（TS 变更时触发） | `.githooks/pre-push` | — |
| 2 | 将 `diff-coverage` 的阻断点从 pre-push 移回 `prepare-commit-msg`（已有基础，需确认逻辑） | `.githooks/prepare-commit-msg` + `scripts/check-diff-coverage.mjs` | — |
| 3 | 更新 `docs/adr/adr-258-pre-push-门禁分层与改动面分流.md` 状态为 ✅ 已采纳 | `docs/adr/adr-258*.md` | — |
| 4 | 更新 `docs/status.md` 索引（`npm run gen:status`） | — | — |

### Phase 2：需设计（本 ADR 通过后排期）

| # | 行动 | 文件 | 负责人 |
|---|------|------|--------|
| 1 | 设计 `scripts/domain-map.mjs`：文件路径 → 领域映射 | 新脚本 | — |
| 2 | 扩展 pre-push 中的 `CHANGED_*` 变量，支持子目录分流 | `.githooks/pre-push` | — |
| 3 | 定义各领域的最小检查集矩阵 | 本文档 §三 | — |
| 4 | 实现并验证分流逻辑 | `.githooks/pre-push` | — |

### Phase 3：长期治理（ADR-254 待办清单联动）

| # | 行动 | 文件 | 负责人 |
|---|------|------|--------|
| 1 | 将 B 类遗留项（outfit/env-caustics/scene-stage-lights/perception/motion-detail-ui/load-manager/virtual-skirt/mirror-debug）纳入技术债清算轮 | `docs/adr/adr-254.md` | — |
| 2 | 将 C 类测试缺口（load-manager 并发/反序列化、perception/env-impl、env-bridge 中间件链）纳入补测排期 | `docs/adr/adr-254.md` | — |
| 3 | 定期（每月）review P2 参考层检查的基线值，防止 deadcode/duplicate 回退 | CI schedule | — |

---

## 影响

### 需修改的文件

| 文件 | 改动内容 |
|------|---------|
| `.githooks/pre-push` | 加入 `tsc --noEmit` 检查；移除 `diff-coverage` 阻断逻辑（保留提示） |
| `.githooks/prepare-commit-msg` | 接入 `check-diff-coverage.mjs --suggest --staged`，输出覆盖率缺口建议 |
| `docs/adr/adr-258*.md` | 状态更新为 ✅ 已采纳 |
| `docs/status.md` | `npm run gen:status` 自动更新 |

### 无需修改的文件

- `scripts/check-diff-coverage.mjs`：已支持 `--suggest` 模式，无需改动
- `scripts/check-deadcode-baseline.mjs`：维持 CI 侧运行，无需改动
- CI workflow（`.github/workflows/ci.yml`）：deadcode-baseline / coverage schedule 维持现状

---

## 备选方案

### 方案 A：维持现状（不采纳）

**理由**：diff-coverage 已降级为建议，tsc 未在 pre-push 运行，门禁空心化风险高。

### 方案 B：全部恢复阻断（不采纳）

**理由**：全量 test:coverage（~66s）和全量 lint（~16s）对 AI 协作效率影响过大，与「快速迭代」目标冲突。

### 方案 C：分层 + 分流（已采纳）

**理由**：在保证 P0 红线的前提下，通过 commit 期护栏（diff-coverage）和 CI 兜底（deadcode/全量 coverage）实现速度与质量的平衡；Phase 2 分流进一步减少无谓检查。

---

## 相关文档

- [ADR-230](adr-230-docs-automation-toolchain.md)：文档自动化工具链（check:docs 链路的理论基础）
- [ADR-206](adr-206-test-infra-consolidation-and-assertion-quality.md)：测试基础设施收敛（测试分层与 mock 治理）
- [ADR-254](adr-254-p4-backlog-registry.md)：历轮审核 P4 遗留项登记簿（Phase 3 技术债来源）
- [ADR-229](adr-229-e2e-automation-advancement.md)：E2E 自动化推进（diff-coverage 起源）
- `.githooks/pre-push`：当前 pre-push 门禁完整实现
- `scripts/check-diff-coverage.mjs`：diff-coverage 检查脚本（支持 `--suggest` 非阻断模式）
- `scripts/check-deadcode-baseline.mjs`：deadcode 基线检查脚本
