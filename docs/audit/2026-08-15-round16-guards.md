# 第 16 轮审核报告 — guards（guardNum）模块

> **日期**: 2026-08-15
> **审核员**: 子代理 round16-guards
> **审核范围**:
> - 测试文件: `frontend/src/core/__tests__/guards.test.ts`（87 行）
> - 被测源码: `frontend/src/core/guards.ts`（7 行，唯一导出 `guardNum`）
> - 依赖相关: guards.ts 为**零依赖叶模块**（无任何 import）；比对同类实现 `frontend/src/core/color-helpers.ts`；核实 8 个生产消费者（proc-motion-shared / lighting-tween / lighting-follow / audio / wasm-layers-blender / perception-gaze-wasm / feet-adjustment / env-bridge）
> **总体结论**: ⚠️ 有条件通过（P1×0 / P2×1 / P3×1 / P4×3）

---

## 执行摘要

| 项 | 结果 |
|----|------|
| 测试运行 | `npm run test -- src/core/__tests__/guards.test.ts` → **18/18 通过**（4ms） |
| 类型检查 | `npm run check` 失败（exit 1），但 4 处 TS2353 错误全部位于**无关文件** `src/__tests__/motion-intent-ratio-guards.test.ts`（`kind` 属性不在 `SceneMotionIntent` 类型），与 guards 模块无关联；guards.ts 本身无类型错误 |
| 跳过测试 | 无（无 `it.skip`/`describe.skip`） |
| 类型安全 | guards.ts 0 处 `as any`/`@ts-ignore` |
| 资源释放 | 纯函数无 `new` 对象，不适用 |
| 循环依赖 | guards.ts 零 import，无环 |

---

## ✅ 亮点

- **参数签名正确**（`guards.ts:5-6`）: `v: unknown` + `typeof v === 'number'` 收窄 + `Number.isFinite(v)`，一次调用同时拦截 NaN / ±Infinity / 非数字类型，返回类型收窄为 `number`，无任何 `as` 断言。比同类实现（color-helpers 本地版只挡 NaN 不挡 Infinity）语义更完整。
- **文档注释点明设计动机**（`guards.ts:2-3`）: 明确说明替代 `??` 的原因（`??` 不挡 NaN）——这是真实踩坑后的决策记录，防止后人"优化"回 `??`。
- **零依赖纯函数**（`guards.ts:1-7`）: 无 import、无状态、无资源，天然线程/重入安全，无幽灵路径；被 8 个生产模块复用（motion 管线、灯光、音频、环境桥接等），是典型的收敛点。
- **测试覆盖全分支**（`guards.test.ts`）: 正常值（正/负/浮点/零/自定义 fallback）、NaN（默认/自定义 fallback）、±Infinity、undefined/null、6 种非数字类型（字符串"42"、空串、true/false、对象、数组），18 用例全部断言真实返回值，无 mock 自证、无 vi.mock。

---

## 🔴 P1 问题（必须修复）

无。

---

## 🟠 P2 问题（建议修复）

| # | 文件 | 位置 | 观察 | 改进建议 |
|---|------|------|------|----------|
| 1 | `frontend/src/core/color-helpers.ts` | 9-11 | **重复实现且语义漂移**：本地私有 `guardNum(v: number \| undefined)` 与 `guards.ts:5` 导出版是同类"数字守卫"逻辑（重复代码维度，≥2 文件），但行为不一致——本地版用 `!Number.isNaN(v)` **放行 Infinity**，guards.ts 用 `Number.isFinite(v)` **拦截 Infinity**。`col3FromTriple`（:18）与 `rgbString`（:43）均经此函数构造 Color3/CSS 串，若颜色分量来自外部/JSON 数据含 Infinity，`new Color3(Infinity, ...)` 将污染渲染；两处守卫语义漂移会让后续维护者困惑"到底挡不挡 Infinity" | 删除本地私有版，改 `import { guardNum } from '@/core/guards'`（类型签名 `unknown` 兼容 `number \| undefined`），统一为 `Number.isFinite` 语义；此为跨文件收敛，建议主模型分配改动权限后执行 |

---

## 🟡 P3 关注项

| # | 文件 | 位置 | 观察 | 改进建议 |
|---|------|------|------|----------|
| 1 | `frontend/src/core/guards.ts` | 5 | **fallback 参数本身未守卫**：`guardNum(NaN, Infinity)` 返回 `Infinity`、`guardNum(NaN, NaN)` 返回 `NaN`——fallback 绕过 `Number.isFinite` 校验，违背模块注释"防止 NaN 污染"的承诺。当前 8 个生产调用点的 fallback 均为写死常量（0 / 0.7 / -1 等），实际风险低 | 可选：fallback 也做 `Number.isFinite` 兜底（如 `typeof v === 'number' && Number.isFinite(v) ? v : (Number.isFinite(fallback) ? fallback : 0)`），或在 JSDoc 注明"fallback 须为有限数字，调用方负责" |

---

## 🟢 P4 低风险观察

| # | 文件 | 位置 | 观察 | 改进建议 |
|---|------|------|------|----------|
| 1 | `frontend/src/scene/motion/feet-adjustment.ts` | 38 | **未使用的导入**：`import { guardNum } from '@/core/guards'` 全文件无使用点（grep 仅 1 处命中即 import 行），属死代码；tsconfig 未开 noUnusedLocals 故 tsc 未拦截 | 删除该 import（锁文件制下由主模型分配） |
| 2 | `frontend/src/core/__tests__/guards.test.ts` | 16 | `toBeCloseTo(0.75)` 对精确浮点字面量可用 `toBe(0.75)` 即可，`toBeCloseTo` 是给浮点运算结果用的，此处属过度写法（无害） | 可简化为 `toBe` |
| 3 | 多个 core 模块 | orbit.ts:26-28 / ui-rows.ts:163 / ui-advanced-rows.ts:27-29 / param-adapters.ts:22 / ai/config-store.ts:147 | 同类 `Number.isFinite` 守卫散落多处，均带各自业务条件（clamp、>0、数组元素校验），当前为合理内联不构成强制合并项 | 若未来再次出现语义漂移（如 color-helpers 式重复），考虑以 guards.ts 为唯一守卫出口并下沉业务变体 |

---

## 测试质量评价

**总体**: 良好（符合预期，18/18 通过）。

- **断言有效性**: ✅ 全部 18 个 `expect` 直接断言 `guardNum` 的真实返回值（`toBe`/`toBeCloseTo`），无 vi.mock、无 mock 自证；测试文件仅 import `guardNum` 与 vitest，环境声明 `// @vitest-environment node` 合理（纯函数无需 DOM）。
- **边界覆盖**: ✅ 强。NaN（默认+自定义 fallback）、±Infinity、undefined、null、字符串/空串/布尔/对象/数组等 6 种非数字类型全覆盖；"42" 明确断言回退 0 而非类型转换——正确锁定了"守卫不转换"的语义。
- **遗漏边界**（轻微）: ① 未覆盖 `-0`（`guardNum(-0)` 返回 `-0`，`Object.is` 可区分，生产无影响）；② 未覆盖 fallback 为 NaN/Infinity 的退化输入（对应 P3-1，测试与源码的盲区一致）；③ 未覆盖 `Number.MAX_VALUE`/`MIN_VALUE`（`Number.isFinite` 对二者返回 true，行为正确，缺测不影响结论）；④ Symbol/bigint/函数未测（签名 `unknown`，生产路径不会传入）。
- **跳过测试**: 无。
- **源码→测试映射完整性**: guards.ts 唯一导出 `guardNum` 已被测试覆盖全部代码分支（typeof 两分支 × isFinite 两分支 × fallback 默认/自定义），模块行/分支覆盖完整。

---

## 附：审核过程记录

- 审核手册已读（`docs/audit-playbook.md`，9 维度 + 报告模板）。
- 测试文件已读（87 行），import 链: 仅 `../guards`。
- guards.ts 已读（7 行），零依赖，无上游模块需标注审核状态。
- 消费者核查: grep `guardNum` 命中 54 处（8 生产模块 + 测试），确认生产复用面广。
- 类型检查: 全量 `npm run check` 失败，4 处错误均位于无关文件 `src/__tests__/motion-intent-ratio-guards.test.ts`（TS2353 `kind` 不存在于 `SceneMotionIntent`），与本次审核目标无关，未纳入本报告风险表。

---

> 审核日期: 2026-08-15
> 审核员: 子代理 round16-guards
