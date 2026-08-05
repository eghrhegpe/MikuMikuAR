# ADR-243: EnvState 默认值从 Schema 自动推导 —— 消除 100+ 字段双源手工映射

> **日期**: 2026-08-06
> **状态**: 🔄 规划中 —— 已登记方案与实施步骤，待落地
> **编号**: 243
>
> **关联**: [ADR-137](adr-137-envstate-single-source-schema.md)（EnvState 单一源 Schema）、[ADR-141](adr-141-state-split.md)（state.ts 拆分）、[ADR-226](adr-226-ground-material-spec-single-source.md)（地面材质单一事实源，同款「单源派生」先例）
>
> **来源**: 2026-08-06 第 10 轮代码审核（`docs/audit/`）P3-1：`state.ts` `buildDefaultEnvState` 手工映射 100+ 字段，schema 变更时易遗漏。

**决策者**: Riku（联邦首席架构师 AI）、Jieling（人类侧首席架构师）

---

## 背景

`frontend/src/core/state.ts` 的 `buildDefaultEnvState()`（L26-178）手工逐字段映射 `ENV_STATE_SCHEMA` 的默认值：

```ts
function buildDefaultEnvState(): EnvState {
    const s = ENV_STATE_SCHEMA;
    return {
        skyMode: s.skyMode.default,
        skyColorTop: s.skyColorTop.default.slice() as [number, number, number],
        // ... 共 120+ 个字段
    } satisfies EnvState;
}
```

### 问题

| # | 问题 | 影响 |
|---|------|------|
| 1 | **双源维护**：每新增 env 字段需改 schema（type + default + group）**并**在 `buildDefaultEnvState` 手写映射。schema 是 ADR-137 钦定的单一事实源，此处却存在第二份「默认值投影」 | 漏改一处 → 新字段初始值 undefined，UI/渲染读默认值分支不一致，难以排查 |
| 2 | **认知负担**：120+ 行纯样板代码，与 schema 内容一一重复，review 时逐行比对成本高 | 新增字段的 PR 体积 +30 行样板 |
| 3 | **漂移风险**：`satisfies EnvState` 只能校验字段**存在性**，无法校验默认值**正确性**（如把 `skyMode.default` 误写成 `skyMode.default.slice()` 不会报错，因为 string 也有 slice） | 编译期防线覆盖不了类型误用 |

### 现状事实

Schema 字段类型定义（`env-state-schema.ts` L7-12）已携带足够信息：

```ts
type _FieldDef<TType extends string, TDefault> = {
    type: TType;          // 'enum' | 'number' | 'boolean' | 'string' | 'tuple3' | ...
    default: TDefault;    // 默认值（tuple3 为 [number, number, number]）
    group?: string | readonly string[];
} & (TType extends 'enum' ? { values: readonly string[] } : object);
```

唯一需要特殊处理的是 **tuple3 引用类型**：默认值数组必须 `slice()` 克隆，否则 `reactive()` 深层追踪下多个实例共享同一数组引用，一处 mutate 污染全局（现有代码 L30 等处的 `slice()` 正是为此）。

## 候选方案

| 方案 | 描述 | 优点 | 缺点 |
|------|------|------|------|
| **A. 运行时自动推导** | 用 `Object.entries(ENV_STATE_SCHEMA)` 遍历，按字段 `type` 决定克隆策略（tuple3 → `slice()`，其余 → 直接引用），返回 `satisfies EnvState` 的完整对象 | 单一事实源彻底落地；新增字段零样板；删除字段自动跟随 | 依赖字段 type 与默认值类型一致性；需处理 `as unknown as EnvState` 断言（schema 与 EnvState 类型未通过 `satisfies` 互锁） |
| **B. 保持手工映射** | 维持现状 + `satisfies EnvState` 编译期兜底 | 零改动、显式 | 双源问题持续存在 |
| **C. 代码生成器** | 脚本读 schema 生成 `buildDefaultEnvState` 源码 | 显式 + 单一事实源 | 引入构建期脚本依赖；生成物与手写代码仍需 review 对账，收益不及 A |

### 关键约束（无论选哪个方案）

1. **tuple3 必须克隆**：`reactive()` 深层追踪下共享引用 = 幽灵状态污染（现有 `slice()` 语义必须保留）。
2. **`satisfies EnvState` 编译期防线保留**：字段存在性校验不能丢。
3. **反序列化路径不动**：`restoreEnvState`（config 恢复）与本函数职责正交，本 ADR 只管「默认值」。

## 决策

**采纳方案 A（运行时自动推导）**，理由：

1. schema 的 `type` 字段就是为区分克隆策略而存在的（enum/number/boolean/string 值类型直接引用，tuple3 需克隆），推导逻辑 < 20 行，复杂度可控。
2. 与 ADR-226（GroundMaterialSpec 单源）精神一致：**派生值一律从真相源计算，禁止手工投影**。
3. 消除 120+ 行样板，新增字段 PR 从「改 2 处」降为「改 1 处」。

### 实施步骤（Phase 1：纯函数抽取 + 单测）

1. 在 `core/env-state-schema.ts` 或新文件 `core/env-state-defaults.ts` 抽取纯函数：
   ```ts
   /** 从 schema 派生默认 EnvState；tuple3 克隆防共享引用污染 */
   export function deriveDefaultEnvState(): EnvState {
       const out: Record<string, unknown> = {};
       for (const [key, def] of Object.entries(ENV_STATE_SCHEMA)) {
           out[key] = def.type === 'tuple3'
               ? (def.default as readonly number[]).slice()
               : def.default;
       }
       return out as unknown as EnvState; // schema 与 EnvState 字段集由 check:docs 一致性兜底
   }
   ```
2. `state.ts` `buildDefaultEnvState()` 改为 `deriveDefaultEnvState()` 的薄转发（或直接替换调用点），保留 `satisfies` 语义（可在推导函数返回值处断言）。
3. **单测**（新文件 `env-state-defaults.test.ts`）：
   - 字段数与 schema keys 数一致；
   - tuple3 字段返回**新引用**（`not.toBe(schema.default)`）且值相等；
   - 每个字段值 `=== schema.default`（值类型）或 deep-equal（tuple3）；
   - 覆盖 `satisfies EnvState` 编译期约束（字段存在性）。
4. 跑 `npm run test` + `npm run build` 验证无回归。

### 验收标准

- [ ] `buildDefaultEnvState` 不再手工逐字段映射（或映射体 ≤ 3 行转发）
- [ ] 新增 env 字段只需改 schema 一处
- [ ] tuple3 克隆语义与现状完全一致（单测锁定）
- [ ] 全量单测通过，构建通过

---

## 附：为什么不做 C（代码生成器）

生成器产出的是「另一份手写等价物」，虽由脚本保证同步，但生成物仍需入库、review、且构建链多一环。运行时推导直接把 schema 当运行时数据用，是**零额外构建依赖**的等价方案，且推导逻辑本身可单测——比生成器更接近「单一事实源」的本意。
