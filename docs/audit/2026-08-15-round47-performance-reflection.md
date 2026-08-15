# round47-performance-reflection — 性能↔反射联动桥 + 质量档位注册表审核

## 审核范围

| 项 | 内容 |
|----|------|
| **测试文件** | `frontend/src/__tests__/scene/performance-reflection.test.ts`（114 行，全文件，8 用例） |
| **被测源码** | `frontend/src/scene/render/performance-env-bridge.ts`（40 行，全文件）；`frontend/src/scene/render/quality-profile.ts`（130 行，重点 L35-104 注册表与派生、L113-130 编译期 default 校验） |
| **关联调用方** | `frontend/src/scene/render/performance.ts`（L221-236 qualityProfile→子字段传播、L248-274 快照恢复、L359-381 降级写 env + ADR-151 上限守卫）；`frontend/src/scene/env/_bridge/env-bridge.ts`（L419-445 中间件、L477 `registerSetEnvState`） |
| **依赖源头** | `frontend/src/core/env-state-schema.ts`（L231-250：reflectionQuality/cloudQuality/particleQuality/qualityProfile 的 type+default+group 单源定义） |
| **对应 ADR** | ADR-130 Phase 2.3（性能降级↔反射质量联动，docs/adr/adr-130-scene-ui-roadmap.md:182 ✅ 完成）、ADR-174（质量维度注册表，✅ 已完成）、关联 ADR-151（反射统一架构）、ADR-173（env-bridge 中间件） |

**与历史审计关系**（按任务要求注明）：
- **round-13**（`docs/audit/2026-08-06-round13-scene-render-core-ui.md`）：整体审过 `performance.ts`（⚠️ 有条件通过），覆盖快照/桥/阈值，其中「bridge 空快照守卫」P2 已在 L105 修复；当时已将本测试列为 performance 覆盖项之一（该报告 L139）。
- **round-29**（`docs/audit/2026-08-15-round29-perception-perf.md`）：审 `perception.perf.test.ts`（⚠️ 有条件通过）——那是感知层**性能基准**（ADR-165，为 ADR-164 全员感知降级提供阈值），与本轮**功能联动桥**无重叠。
- **本轮**：聚焦 ADR-130 Phase 2.3 的联动链路（`setAutoDegradingReflection` 标志 + `setEnvStateForPerformance` 延迟绑定 + 注册表驱动档位映射），不重复 round-13 的阈值/快照部分与 round-29 的基准部分。

**总体结论：⚠️ 有条件通过**

- 测试 8/8 全绿（实测 `npx vitest run src/__tests__/scene/performance-reflection.test.ts` → 8 passed，15ms），断言全部有效，无跳过用例，mock 隔离设计正确（成功避开 performance.ts / Babylon 初始化）。
- 被测源码类型安全（无 `as any`/`@ts-ignore` 新增）、无资源泄漏、状态流单一（性能档位 → 注册表 → 子字段 → env 中间件），ADR-174 编译期 default 双向校验设计优秀。
- 无 P1/P2 风险；3 个 P3（测试两两重复、`inferQualityProfile` 生产零消费者、ADR-151 上限守卫无直接测试）+ 4 个 P4，均为维护性/覆盖性建议，不影响正确性，处理后可升 ✅。

## 亮点

- **循环依赖破解 + 延迟绑定**：`performance-env-bridge.ts:1-5` 头注明示打破 performance.ts ↔ env-bridge.ts 循环依赖的意图；`L7` 用 `import type { EnvState }` 使桥模块零运行期依赖（测试在 node 环境可直载）；`setEnvState` 延迟绑定（L23-40）由 env-bridge.ts:477 在初始化时注册。
- **异常安全的标志成对切换**：`performance.ts:261-266` 与 `375-380` 均以 `setAutoDegradingReflection(true)` → try/finally → `(false)` 包裹 `setEnvStateForPerformance`，中间件抛错也不会让降级标志残留为 true。
- **注册表驱动 + 三值完备约束**：`quality-profile.ts:35-51` 的 `QUALITY_DIMENSIONS` 用 `satisfies readonly QualityDimension[]`，`mapping: Record<QualityProfile, T>` 编译期强制 high/medium/low 三值完备；新增维度只需加一行，`resolveQualityProfile`/`inferQualityProfile`/`QualityProfileSettings`（mapped type，L60-62）全部自动派生。
- **零运行期成本的编译期 default 双向校验**：`quality-profile.ts:113-130` 用 `SchemaDefaults = {} as DimensionDefaults` 与反向赋值做双向 assignable 校验——schema（env-state-schema.ts）或注册表任一方改动 default 而另一方未同步即编译报错，`void` 引用防未用告警。这是 ADR-174「default 一致性」的真正防线。
- **状态流单一且闭环**：档位聚合源 qualityProfile → 注册表解析 → env 子字段 → env-bridge pre/post-facade 中间件（env-bridge.ts:419-445）；`freezeAutoDegradeOnReflectionChange` 用 post-facade + `isAutoDegradingReflection()` 区分「自动降级 vs 用户手动」，与 ADR-173 文档 L24 设计意图完全一致。
- **测试隔离设计**：`performance-reflection.test.ts:4` 注释明示避免 import performance.ts 触发 Babylon；动态 `await import()` 只拉两个轻模块（纯类型/纯逻辑），`@vitest-environment node` 标注与 vitest.config.ts:38-44 的 ADR-255 环境分流一致，实测 15ms 完成。
- **注册表完备性断言有效**：test 8（L105-113）`Object.keys(settings).sort()` 全等比对，注册表新增维度即红——这是对「注册表驱动」最直接的运行时护栏；'off' 边缘值（L102）验证 fallback 分支。

## 风险表

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|--------|------|------|------|----------|
| 🟡 P3 | frontend/src/__tests__/scene/performance-reflection.test.ts | L18-35 ≈ L71-92；L57-67 ≈ L94-103 | ADR-174 块完整重复 ADR-130 块的断言（前者覆盖后者全部 + particleQuality/'off' 边界），文件内两两重复；项目把重复测试明确视为债（vitest.config.ts:77「P1-1 双份测试删 8 文件」） | 合并两个 describe：保留完整断言块（含 particleQuality 与 'off'），删除重复的 it，保留各自头注 |
| 🟡 P3 | frontend/src/scene/render/quality-profile.ts | L85-104 | `inferQualityProfile` 生产零消费者（全 src 仅定义处与本测试调用），注释声称「预设场景加载后同步 qualityProfile 时使用」但无接线 | 在预设加载路径接线，或头注标注「待接线/测试专用」，避免函数映射表误导 |
| 🟡 P3 | frontend/src/scene/render/performance.ts:361-371 + frontend/src/scene/env/_bridge/env-bridge.ts:435-445 | applyDegrade 内 ADR-151 反射上限守卫 / freezeAutoDegradeOnReflectionChange | 联动链关键约束（用户反射 off → 降级不得回抬）无直接测试：本文件只测桥与注册表，兄弟文件（performance-snapshot/refresh-rate）只测快照与阈值，均未触达守卫分支 | 补 1 个 applyDegrade 定向用例：用户 reflectionQuality='off' 时降级不抬升（断言 changes.env.reflectionQuality 被钳回 'off'） |
| 🟢 P4 | frontend/src/scene/render/quality-profile.ts | L71 / L75 | `const result = {} as Record<string,string>` + `return result as unknown as QualityProfileSettings` 双重强转（非 `as any`，且注册表派生已有编译期约束，风险低） | 可改 reduce + 类型收窄，或加注释说明强转依据（映射值均为 string 字面量） |
| 🟢 P4 | frontend/src/__tests__/scene/performance-reflection.test.ts | L71（用例标题） | 标题「与 schema default 对齐」过承诺：运行期只断言映射字面量，未 import ENV_STATE_SCHEMA 比对；default 对齐实际由 quality-profile.ts:113-130 编译期校验兜底 | 标题改为「三档映射与注册表一致」，或让断言直接引用 schema default 常量 |
| 🟢 P4 | frontend/src/scene/render/performance-env-bridge.ts | L26-30 / L37-39 | `registerSetEnvState` 无重复注册守卫（last-wins 静默覆盖，当前仅 env-bridge.ts:477 一个调用方）；`setEnvStateForPerformance` 未注册时静默 no-op，接线错误难排查（与 RenderBridge 安全默认一致，属取舍） | 在未注册分支加 `import.meta.env.DEV` 单次 warn，提示「setEnvState 未注册」 |
| 🟢 P4 | frontend/src/__tests__/scene/performance-reflection.test.ts | L49-55 | test 4 只测已注册路径，未覆盖 `_setEnvState === null` 的 no-op 分支（L37-39 guard） | 补 1 行断言：未注册时 `setEnvStateForPerformance(...)` 不抛错且无副作用 |

## 测试质量评价

- **断言有效性**：质量映射（三档 × 三维度）与注册表完备性均有真实断言，非 smoke-only；test 8 的键集合比对是注册表驱动最直接的运行时护栏；`inferQualityProfile` 的不一致 fallback（'high'）与 'off' 边缘值均被验证。test 6 标题与实际断言略有出入（见 P4）。
- **mock 合理性**：✅ 通过动态 import 只加载桥与注册表两个轻模块，成功避免 import performance.ts 触发 Babylon 场景初始化（测试头注 L4 明示意图）；`vi.fn()` 仅用于延迟绑定透传断言；无 window 污染、无 module mock 形状债，符合 ADR-219 测试卫生铁律（frontend/AGENTS.md §2.3）；`@vitest-environment node` 标注与项目 ADR-255 环境分流约定一致。
- **边界覆盖**：三档 × 三维度 ✓、不一致组合 fallback ✓、'off' 非档位值 ✓、默认值一致性（编译期兜底）✓；缺口：延迟绑定未注册分支、重复注册、applyDegrade 反射上限守卫（见 P3/P4）。
- **跳过测试**：无（0 个 skip/xit/todo）。
- **运行验证**：`cd frontend && npx vitest run src/__tests__/scene/performance-reflection.test.ts` → **8/8 passed，15ms**（项目基线全绿）。`npm run check`（tsc）未单独跑——本审计只读不改码，无新增类型面，且被测文件的编译期防线（quality-profile.ts:113-130）已在本仓库既有 check 流程覆盖，故跳过并在报告中注明。

## 附：审计结论

- **审核日期**：2026-08-15
- **审核员**：子代理 round47-performance-reflection
- **结论**：⚠️ 有条件通过（无 P1/P2；3 P3 + 4 P4 均为维护性/覆盖性建议；测试全绿、源码设计优秀）
