# ADR-137: EnvState 单一源 Schema

**日期**: 2026-07-19
> **状态**: 规划
> **关联**: ADR-130 Phase 2.1

---

## 一、问题

EnvState 的定义分散在三个位置，无单一权威源：

| 位置 | 职责 | 行号 |
|------|------|------|
| `core/types.ts` | TS interface 定义 | 480-635 |
| `core/state.ts` | 初始化默认值 | 269-418 |
| `internal/app/app.go` | Go struct（JSON 序列化） | 415-562 |

**已发现的漂移**：

经实际对比（2026-07-19），TS `EnvState` 127 字段与 Go `EnvState` 127 字段目前**完全一一对应**，无字段级漂移。但历史演化的过程中曾出现两次遗漏，后经补充修复：

| 字段 | 历史遗漏场景 | 修复方式 |
|------|-------------|---------|
| `qualityProfile` | ADR-130 Phase 2.3 落地 TS 侧时 Go 侧未同步 | 已补（`app.go:499`） |
| `groundInfinite` | ADR-114 Phase 2 落地 TS 侧时 Go 侧未同步 | 已补（`app.go:460`） |

**维护风险**：当前虽无漂移，但每次新增 EnvState 字段仍需手动同步 3 处，遗漏即静默丢失（Go 序列化忽略未知字段，反序列化缺字段取零值）。近期两次遗漏证明该风险是真实的。

---

## 二、目标

1. **单一源**：新建 `env-state-schema.ts`，types.ts 和 state.ts 从 schema 派生
2. **字段级对齐**：扩展 `app.contract.test.ts` 契约测试，验证 Go EnvState 与 TS EnvState 字段一一对应
3. **Go 侧分组**：按 sky/ground/water/atmosphere/clouds/fog/collision 分组（struct embedding 或注释分组）

---

## 三、方案

### 3.1 Schema 定义（`core/env-state-schema.ts`）

```typescript
/** Schema 字段类型定义 */
type FieldDef<TType extends string, TDefault> = {
    type: TType;
    default: TDefault;
} & (TType extends 'enum' ? { values: readonly string[] } : {});

/** EnvState 字段定义：name + type + default。types.ts/state.ts 从此派生。 */
export const ENV_STATE_SCHEMA = {
    skyMode:              { type: 'enum',   values: ['color', 'texture', 'procedural'] as const, default: 'color' as const },
    skyColorTop:          { type: 'tuple3', default: [0.3, 0.5, 0.8] as [number, number, number] },
    // ... 每个字段一行，共 127 行
} as const;

export type EnvStateSchema = typeof ENV_STATE_SCHEMA;
```

### 3.2 类型映射器 + 派生 Interface

```typescript
/** 核心类型映射：Schema 字段定义 → TS 类型。枚举值取字面量 union，非枚举取 type 映射。 */
export type SchemaToTSType<T> =
    T extends { type: 'enum'; values: infer V }
        ? V extends readonly string[] ? V[number] : never
        : T extends { type: 'tuple3' }    ? [number, number, number]
        : T extends { type: 'number' }    ? number
        : T extends { type: 'boolean' }   ? boolean
        : T extends { type: 'string' }    ? string
        : never;

/** 从 schema 派生 EnvState interface。 */
export type EnvState = {
    [K in keyof EnvStateSchema]: SchemaToTSType<EnvStateSchema[K]>;
};
```

### 3.3 派生默认值 + 响应式初始化（`core/state.ts`）

`Object.fromEntries` 会丢失嵌套数组的响应式追踪，且 `as const` + `Object.fromEntries` 的类型映射退化。因此改用**显式构造 + 逐字段读取 schema**，保留 `reactive()` 包装：

```typescript
import { reactive } from 'vue';

/** 从 schema 读取默认值构造初始 state，保留 reactive 深层响应式。 */
function buildDefaultEnvState(): EnvState {
    const s = ENV_STATE_SCHEMA;
    return {
        skyMode:              s.skyMode.default,
        skyColorTop:          s.skyColorTop.default.slice() as [number, number, number],
        // ... 127 个字段，每个显式构造，确保嵌套数组得新引用
        qualityProfile:       s.qualityProfile.default,
    } as EnvState;
}

export const envState: EnvState = reactive<EnvState>(buildDefaultEnvState());
```

**为什么不用 `Object.fromEntries`**：
1. Vue 3 `reactive()` 对嵌套数组的深层代理在 `fromEntries` 创建的对象上无法保证——`slice()` 创建的新数组才被独立追踪
2. `as const` schema 的精确字面量类型在 `Object.fromEntries` 中退化为 `string` / `number[]`，丢失 `skyMode` 的 `'color' | 'texture' | 'procedural'` 精确 union
3. 显式构造每行虽啰嗦，但 VS Code 的自动补全 + 字段级 `satisfies` 校验可防止漏写

**新增字段时需同步**：在 `ENV_STATE_SCHEMA` 加一行 + 在 `buildDefaultEnvState` 中加一行，两步而非三步（比当前少一处）。

### 3.4 契约测试扩展（`app.contract.test.ts`）

新增 `EnvState field parity` 测试：
- 遍历 TS schema 所有 key，验证 Go `EnvState` JSON 输出包含同名字段
- 遍历 Go `EnvState` JSON 输出所有 key，验证 TS schema 包含同名字段
- 类型兼容性：Go `float64` ↔ TS `number`，Go `string` ↔ TS enum，Go `bool` ↔ TS `boolean`

### 3.5 Go 侧分组（`internal/app/app.go`）

不改 struct 布局（保持 JSON 兼容），仅加注释分组：

```go
type EnvState struct {
    // --- Sky ---
    SkyMode          string     `json:"skyMode"`
    SkyColorTop      [3]float64 `json:"skyColorTop"`
    // ...

    // --- Ground ---
    GroundVisible    bool       `json:"groundVisible"`
    // ...

    // --- Water ---
    WaterEnabled     bool       `json:"waterEnabled"`
    // ...
}
```

---

## 四、落点清单

| 文件 | 改动 |
|------|------|
| `core/env-state-schema.ts` | **新建**，~130 行字段定义 |
| `core/types.ts` | `EnvState` interface 改为从 schema 派生 |
| `core/state.ts` | `envState` 初始化改为从 schema 派生 |
| `app.contract.test.ts` | 新增字段级 parity 测试 |
| `internal/app/app.go` | 添加注释分组（sky/ground/water/atmosphere/clouds/fog/collision） |

---

## 五、不在范围内

- **Go codegen**：不引入 schema → Go struct 自动生成（维护成本高于收益，120 字段的手写 Go struct 已稳定）
- **运行时校验**：schema 仅用于类型推导和测试，不引入运行时 JSON schema 校验
- **迁移**：无版本变更，纯重构

---

## 六、验证

- `tsc --noEmit` 通过
- `app.contract.test.ts` 字段 parity 测试通过
- `go build ./...` 通过
- 现有 `env-bridge.test.ts` 无回归
