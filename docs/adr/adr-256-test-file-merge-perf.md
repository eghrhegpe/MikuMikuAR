# ADR-256: 性能导向的单测文件组织：同系列合并取代一刀切拆分 — isolate 下每文件独立依赖图是墙钟税；importDurations 实测 self ~100ms 却付 ~5s total 的文件优先合并；行数/vi.mock 阈值让位于依赖图成本

> **状态**: ✅ 已采纳（2026-08-10）
> **日期**: 2026-08-10

## 背景

ADR-204（2026-07-29）以**可维护性**为纲拆分上帝测试文件（单文件 ≤300 软线 / 500 硬线、
vi.mock/fn/spyOn ≤20/40），已跨 12+ 文件验证，用例守恒。

但 2026-08-10 的 `experimental.importDurations` 实测暴露了**性能反转**：
vitest `isolate: true` 下**每个测试文件独立加载完整依赖图**（模块图不跨文件复用），
同一系列拆出来的分片文件各自付一次相同的重依赖加载。典型样本：

| 样本 | self（用例本体） | total（含依赖图） | 占比 |
|------|------------------|-------------------|------|
| library-actions.test.ts | 80ms | **6.00s** | 1.3% |
| model-preset.apply.test.ts | 98ms | **5.92s** | 1.7% |
| library-core.resource-items.test.ts | 16ms | **4.77s** | 0.3% |
| model-detail-ui.*（拆分产物） | ~100ms | **~5s ×3** | ~2% |

同一系列（`library-core.*`、`model-preset.*`、`material-editor.*`、`model-detail-ui.*`）
的拆分文件 **vi.mock 列表几乎完全同构**（共享同一批 mocks 工厂），合并后依赖图只付一次。
实测：18 个文件合并为 4 个，import 累加 **201s → 148s**，全量墙钟 **35.67s → 29.88s**
（283 文件 / 4934 用例全绿），且不损失可维护性——mocks 工厂仍共享在 `*-mocks.ts`。

## 决策

**取代 ADR-204 的「拆分阈值」部分**（行数软硬线、vi.mock 计数线），改为**依赖图成本导向**：

1. **合并判据**（新增/触碰文件时评估，命中即倾向合并而非拆分）：
   - 同系列前缀（`xxx.*.test.ts`）且 vi.mock 列表重叠 ≥80%；
   - 单文件 `self/total import` 比 < 5%（轻用例 × 重依赖图）；
   - 合并后用例数守恒 + 全量绿（硬验收，沿用 ADR-204 原则）。
2. **行数阈值降级为软建议**：单文件 ≤1200 行提醒，不再强制拆分。
   `material-editor.test.ts`（1064 行）与 `library-core.test.ts`（1007 行）为当前上限样板。
3. **vi.mock 注册行不设上限**：合并文件的 30-45 行注册是「依赖图只付一次」的必然胶水，
   不算 mock 过载；但 **mock 工厂必须共享**（`*-mocks.ts` / `mocks/`），
   测试文件内禁止私造同类 mock——ADR-204 的 mock 治理原则完整保留。
4. **保留 ADR-204 的其他决策**：三层单测模型（L1 `*.test.ts` / L2 `*.int.test.ts`）、
   用例数守恒验收、总量不砍、fixtures 复用原则、触碰即改善的渐进策略。
5. **共享桩抽取双赢**：合并时若发现同系列 mock 工厂分散（如 model-preset-mocks 与
   model-detail-ui-mocks 的缺口互补），顺手统一进共享层，提升复用率（ADR-204 §1.2 痛点 3）。
6. **环境分流协同**（ADR-255）：无 DOM 依赖文件仍优先 `// @vitest-environment node`；
   合并针对「必须 happy-dom + 重依赖图」的系列，两条路线互不冲突。

## 备选方案

- **维持 ADR-204 拆分阈值，接受性能**：拆分后 40s+ 墙钟与每文件 ~5s 固定税，
  与「CI 2 核 runner」目标冲突。弃。
- **isolate=false 批量共享依赖图**：ADR-219 三次实验判死（vi.mock 单例穿透结构性不可修）。
  合并是 isolate=true 约束下的次优解。弃。
- **只合并不抽桩**：vi.mock 注册行重复留在各合并文件，工厂共享率不变。
  保留（本轮已执行），抽桩作为持续改进项。

## 影响

- 4 个合并文件：`model-detail-ui.test.ts` / `model-preset.test.ts` /
  `material-editor.test.ts` / `library-core.test.ts`（原 18 个文件删除）。
- import 累加 201s → 148s；全量墙钟 35.67s → 29.88s；用例守恒 4934。
- `frontend/vitest.config.ts` 盘点注释追加 P0-3 记录。
- ADR-204 状态行标注「被 [ADR-256] 取代」（拆分阈值部分；mock 治理/分层/验收原则保留）。
- `*.int.test.ts` 命名、`test:unit`/`test:int` 脚本、coverage 阈值均不受影响。

## 相关文档

> ADR-204 单测分层与治理规范（被取代方）
> ADR-255 测试环境分流（协同路线）
> ADR-219 测试并发调优与 isolate 污染治理（isolate=false 判死依据）
