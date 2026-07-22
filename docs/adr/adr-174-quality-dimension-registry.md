# ADR-174: 质量维度注册表 — 统一 qualityProfile 扩展点

> **状态**: 已完成
> **日期**: 2026-07-22
> **关联**: ADR-130（qualityProfile 统一档位）、ADR-173（env-bridge 中间件化）、ADR-137（env-state-schema 单一数据源）
> **审核记录**: 2026-07-22 审核发现 P1×2 / P2×4，已就地修订并实施

## 背景

当前新增一个 quality 维度（如 `reflectionQuality`、`cloudQuality`、`particleQuality`）需要修改以下文件：

| 步骤 | 文件 | 是否本 ADR 覆盖 |
|------|------|----------------|
| 1. Schema 定义 + group + default | `env-state-schema.ts` | 否（schema 是单一数据源，注册表与之对齐而非替代） |
| 2. Profile → 值映射 | `quality-profile.ts`（加 mapping + 改 `QualityProfileSettings` + 改 `resolveQualityProfile` + 改 `inferQualityProfile`） | ✅ Phase 1+2 |
| 3. 状态初始化 | `state.ts` | 否（从 schema default 派生，已自动化） |
| 4. 降级传播 | `performance.ts`（`levelDiff` + snapshot） | 否（仍硬编码 3 行 if，**本 ADR 不覆盖**，未来或扩展） |
| 5. setEnvState 子字段同步 | `env-bridge.ts` | 部分（`qualityProfile` 解析由 ADR-173 中间件化解决） |
| 6. Consumer 模块 | 如 `env-particles.ts`、`env-clouds.ts` | 否（消费侧逻辑） |
| 7. 测试夹具 × N | `env-state.test.ts`、`binding-factories.ts`、`performance-snapshot.test.ts`、`performance-reflection.test.ts` | Phase 4 补充 |

**修订说明**：原版称"步骤 4~5 的样板已经在 ADR-173 中间件化中解决"不准确。ADR-173 仅覆盖步骤 5 中 `qualityProfile` 解析的 if-block，步骤 4（`performance.ts` 的 `levelDiff` 仍硬编码 3 行 if 比对 `reflectionQuality`/`cloudQuality`/`particleQuality`）不在 ADR-173 范围内。本 ADR 聚焦步骤 2 的去样板化。

步骤 2 存在重复样板：每个维度有一组 profile→value 映射，一个 `QualityProfileSettings` 字段，`resolveQualityProfile` 和 `inferQualityProfile` 中各多一行。

## 建筑蓝图

### Phase 1：注册表定义

在 `quality-profile.ts` 中新增注册表类型和实例。

**修订要点**：
- `default` 必须与 `env-state-schema.ts` 中对应字段的 `default` **完全一致**（见 Phase 3 一致性约束）
- 示例值已校正：`reflectionQuality` schema default 为 `'low'`（非 `'medium'`）
- `mapping` 的 key 必须是 `QualityProfile` 三值完备

```typescript
interface QualityDimension<T extends string = string> {
    key: string;                              // 字段名，如 'reflectionQuality'
    default: T;                               // 必须与 env-state-schema.ts 的 default 一致
    mapping: Record<QualityProfile, T>;       // profile→值映射，三值完备
}

const QUALITY_DIMENSIONS = [
    {
        key: 'reflectionQuality',
        default: 'low' as const,              // 与 schema default 'low' 一致
        mapping: { high: 'high', medium: 'medium', low: 'low' },
    },
    {
        key: 'cloudQuality',
        default: 'high' as const,             // 与 schema default 'high' 一致
        mapping: { high: 'high', medium: 'high', low: 'standard' },
    },
    {
        key: 'particleQuality',
        default: 'high' as const,             // 与 schema default 'high' 一致
        mapping: { high: 'high', medium: 'medium', low: 'low' },
    },
] as const satisfies readonly QualityDimension[];
```

注意：**注册表不再有 `group` 字段**。原版的 `group` 与 `env-state-schema.ts` 的多 group 语义冲突（如 `reflectionQuality` 在 schema 中 group 为 `['ground', 'water', 'reflection']`，注册表只声明 `'reflection'` 会漏字段）。注册表与 schema 是正交维度：注册表管"哪些字段是 quality 维度"，schema 管"哪些字段属于哪个 dispatch 子系统"。两者不互相替代。

### Phase 2：自动派生函数

从注册表驱动当前手写的 3 个函数：

| 函数 | 当前 | 改为 |
|------|------|------|
| `resolveQualityProfile(p)` | 硬编码 3 行 return | `reduce` 注册表 → `QualityProfileSettings` |
| `inferQualityProfile(...)` | 硬编码 3 字段比对 | 遍历注册表逐字段比对 |
| `QualityProfileSettings` | 手动 interface | const 对象 + `satisfies` 派生（见下） |

**`QualityProfileSettings` 同步机制（修订版）**：interface 不能 `satisfies`，改为 const 对象派生类型：

```typescript
// 从注册表派生默认值对象
const QUALITY_PROFILE_DEFAULTS = Object.fromEntries(
    QUALITY_DIMENSIONS.map(d => [d.key, d.default])
) as { [K in (typeof QUALITY_DIMENSIONS)[number]['key']]: any };

// 派生 QualityProfileSettings 类型
export type QualityProfileSettings = {
    [K in keyof typeof QUALITY_PROFILE_DEFAULTS]: typeof QUALITY_PROFILE_DEFAULTS[K]
};

// 编译期一致性检查：注册表 key 与 QualityProfileSettings 字段必须一一对应
type _CheckDimensionKeys = keyof QualityProfileSettings;
type _CheckRegistryKeys = (typeof QUALITY_DIMENSIONS)[number]['key'];
// 若不一致，下行报错
const _dimensionKeyCheck: Record<_CheckDimensionKeys, true> &
    Record<_CheckRegistryKeys, true> = {} as never;
```

`resolveQualityProfile` 改为：

```typescript
export function resolveQualityProfile(profile: QualityProfile): QualityProfileSettings {
    const result: Partial<QualityProfileSettings> = {};
    for (const dim of QUALITY_DIMENSIONS) {
        (result as Record<string, string>)[dim.key] = dim.mapping[profile];
    }
    return result as QualityProfileSettings;
}
```

`inferQualityProfile` 改为遍历注册表逐字段比对，保持"不完全匹配则返回 `'high'`"的保守 fallback。

### Phase 3：Schema 一致性约束（修订版）

**原版"从注册表读取 group 匹配"已删除**——会与 schema 多 group 语义冲突（`getEnvKeys('reflection')` 当前返回 `reflectionQuality` + `reflectionMode` + `qualityProfile`，注册表只覆盖质量维度字段，会漏 `reflectionMode`）。

改为：注册表 `default` 与 schema `default` 的编译期一致性检查。在 `quality-profile.ts` 末尾加：

```typescript
// 编译期校验：注册表 default 与 env-state-schema.ts 的 default 一致
// 若 schema 修改了 default 而注册表未同步，下行报错
import { ENV_STATE_SCHEMA } from '@/core/env-state-schema';

const _schemaDefaultCheck = QUALITY_DIMENSIONS.map(d => {
    const schemaDefault = (ENV_STATE_SCHEMA as Record<string, { default: unknown }>)[d.key]?.default;
    return schemaDefault === d.default;
});
// 若任一不一致，下行类型报错
const _enforce: true[] = _schemaDefaultCheck as true[];
```

### Phase 4：降级守卫同步路径（新增）

`performance.ts:354` 用 `REFLECTION_QUALITY_ORDER[changes.env.reflectionQuality]` 做降级上限守卫。若 `reflectionQuality` 的值类型扩展（如新增 `'off'`），`REFLECTION_QUALITY_ORDER` 必须同步。

方案：在 `quality-profile.ts` 暴露 `REFLECTION_QUALITY_ORDER` 派生元数据，`performance.ts` 从注册表读取：

```typescript
// quality-profile.ts
export const REFLECTION_QUALITY_ORDER: Record<string, number> = {
    off: 0, low: 1, medium: 2, high: 3,
};
```

未来若值类型扩展，注册表旁追加 `order` 元数据字段，`performance.ts` 自动派生。本 Phase 暂不实施，仅在注册表设计中预留扩展点。

### Phase 5：测试计划（新增）

- **注册表完备性测试**：每个 `QualityDimension` 的 `mapping` 必须覆盖 `high`/`medium`/`low` 三值
- **`resolveQualityProfile` 回归测试**：三档 profile 解析结果与当前硬编码版本完全一致
- **`inferQualityProfile` 回归测试**：三档正向匹配 + 不一致组合返回 `'high'` fallback
- **default 一致性测试**：注册表 `default` 与 schema `default` 运行时断言
- **`QualityProfileSettings` 类型推导测试**：编译期 `satisfies` 通过即可
- 现有测试夹具（`env-state.test.ts`、`binding-factories.ts`、`performance-snapshot.test.ts`、`performance-reflection.test.ts`）无需改动，因 `QualityProfileSettings` 字段集合不变

## 边界条件

- `mapping` 的 key 必须是 `QualityProfile`（`'high' | 'medium' | 'low'`）三值完备
- `default` 必须与 `env-state-schema.ts` 中对应字段 `default` 完全一致（Phase 3 编译期校验）
- `inferQualityProfile` 仍保持「不完全匹配则返回 `'high'`」的保守 fallback 语义
- 注册表只覆盖质量维度字段（`reflectionQuality`/`cloudQuality`/`particleQuality`），**不动 schema 的 `getEnvKeys`**——schema 的 group 用于 dispatch，与质量维度正交
- 新增质量维度只需：注册表加 1 行 + schema 加字段（保持 default 一致）+ consumer 模块 + 测试夹具

## 落地后工作量对比

| 旧 | 新 |
|----|----|
| 改 8+ 文件，`quality-profile.ts` 4 处手写 | 注册表加 1 行 + schema 加字段（default 对齐）+ consumer 模块 + 测试夹具；`resolveQualityProfile`/`inferQualityProfile`/`QualityProfileSettings` 自动派生 |

## 与 ADR-173 的关系

ADR-173 的 `resolveQualityProfileMiddleware` 调用本 ADR 派生的 `resolveQualityProfile`。本 ADR 改派生逻辑（注册表驱动）不影响 ADR-173 的 middleware 结构。两者解耦演进。
