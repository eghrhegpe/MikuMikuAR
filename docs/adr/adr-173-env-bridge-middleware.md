# ADR-173: env-bridge setEnvState 中间件化重构

> **状态**: 已完成
> **日期**: 2026-07-22
> **关联**: ADR-130（qualityProfile）、ADR-151（反射架构）、ADR-137（单一数据源 Schema）、ADR-159（桥接注入范式）、ADR-174（质量维度注册表）
> **审核记录**: 2026-07-22 审核发现 P1×2 / P2×2 / P3×1，已就地修订并实施

## 背景

`env-bridge.ts` 的 `setEnvState()` 是环境状态写入的唯一入口，当前包含 4 个特判 if-block：

| 行号 | 职责 | 来源 | 执行阶段 |
|------|------|------|---------|
| ~590 | `sunAngle` → `envSunAngle` 缓存同步 | ADR-132 双源漂移修复 | pre-facade |
| ~594-602 | `qualityProfile` → 子字段解析回写 | ADR-130 Phase 2.3 | pre-facade |
| ~608-613 | `reflectionQuality` → 模式冻结（auto→custom） | ADR-130 Phase 2.3 | **post-facade** |
| ~616-618 | `lightingPresetName` → 灯光预设过渡 | ADR-152 | post-facade |

每新增一个跨系统字段就追加一个 if-block。长期累积导致 `setEnvState` 职责膨胀（当前 ~55 行），评审时不易追踪各块的因果链。

**关键观察**：4 个块并非都可在同一时机执行。`_applyEnvStateFacade` 是分界线——pre-facade 块用于在派发前补全 `envState`/`migrated`，post-facade 块用于在派发后处理副作用（如调用 `setPerformanceMode`、`applyLightingPresetFromEnv`）。强行统一遍历会破坏语义：

- `qualityProfile` 解析必须在 facade **之前**：解析出的 `reflectionQuality` 等子字段要让 facade 看到并通知 reflection 子系统
- `reflectionQuality` 模式冻结必须在 facade **之后**：自动降级路径（`setEnvStateForPerformance`）会让 `isAutoDegradingReflection()` 为 true，需在 facade 完成后再次读取标志，避免误把自动降级当作用户操作触发 `setPerformanceMode('custom')`

## 建筑蓝图

### Phase 1：中间件注册机制（修订版）

在 `env-bridge.ts` 中引入 `EnvStateMiddleware` 类型和分阶段注册表。**修订要点**：middleware 必须显式声明 `phase`，主流程分两段遍历；签名暴露 `envState` 引用（pre-facade 块需直接写 `envState`，post-facade 块需读最新 `envState`）。

```typescript
type EnvStateMiddlewareFn = (
    envState: EnvState,           // 已 Object.assign 的最新状态（可读写）
    migrated: Partial<EnvState>,  // 传给 facade 的 partial（pre-facade 阶段可读写）
    ctx: { skipAutoSave: boolean }
) => void;

interface EnvStateMiddleware {
    name: string;                 // 调试用，如 'syncEnvSunAngle'
    phase: 'pre-facade' | 'post-facade';
    fn: EnvStateMiddlewareFn;
}

const _middlewares: EnvStateMiddleware[] = [];

export function registerEnvStateMiddleware(mw: EnvStateMiddleware): void {
    _middlewares.push(mw);
}
```

`setEnvState()` 核心流程：

```
migrate → Object.assign(envState, migrated)
  ↓
[遍历 phase='pre-facade' 的 middleware]   ← 补全 envState/migrated
  ↓
_applyEnvStateFacade(envState, migrated)
  ↓
[遍历 phase='post-facade' 的 middleware]  ← 处理副作用
  ↓
_envPersistTimer.schedule(...) + triggerAutoSave
```

**错误处理**：每个 middleware 用 `try/catch` 包裹，异常时 `console.warn('[env-mw] ${name} failed', e)` 并继续后续 middleware，避免单点故障中断 persist/autoSave。

**注册约束**：middleware 只允许在 `env-bridge.ts` 模块级作用域注册（禁止跨文件 `import` 副作用注册），避免 import 图顺序不可控。需要跨模块的逻辑由 `env-bridge.ts` 显式 `import` 后包装为 middleware。

### Phase 2：现有块迁移清单

| 当前块 | 中间件名 | phase | 提取后位置 | 备注 |
|--------|---------|-------|-----------|------|
| sunAngle 同步 | `syncEnvSunAngle` | pre-facade | `env-bridge.ts` 内 | 逻辑简单，不跨文件 |
| qualityProfile 解析 | `resolveQualityProfileMiddleware` | pre-facade | `env-bridge.ts` 内 | 需 import `resolveQualityProfile`；写 `envState.reflectionQuality/cloudQuality/particleQuality` + `Object.assign(migrated, resolved)` |
| reflection 模式冻结 | `freezeAutoDegradeOnReflectionChange` | **post-facade** | `env-bridge.ts` 内 | 需 import `isAutoDegradingReflection` / `getPerformanceMode` / `setPerformanceMode`；读 `migrated.reflectionQuality` |
| lightingPreset 过渡 | `applyLightingPresetMiddleware` | post-facade | `env-bridge.ts` 内 | 读 `migrated.lightingPresetName`（不再读 `partial`，保持与 migrated 语义一致）；调 `applyLightingPresetFromEnv` |

### Phase 3：测试

- middleware 执行顺序可单测验证（pre-facade 全部先于 post-facade）
- 新增 middleware 独立单元测试，不依赖 `setEnvState` 整体
- middleware 异常隔离测试：某 middleware 抛错时，后续 middleware 和 persistTimer 仍执行
- 回归：`env-bridge.test.ts` + `environment-integration.test.ts`

## 边界条件

- middleware **不应修改 `partial`**（原始入参），只能读 `partial`、读/写 `migrated` 和 `envState`
- pre-facade middleware 修改 `envState.xxx` 后，若希望 facade 派发该字段，需同步写入 `migrated`（参考 block 2 的 `Object.assign(migrated, resolved)`）
- middleware 之间不依赖顺序（用 `envState`/`migrated` 作为契约传递，不读其他 middleware 的内部状态）
- `Object.assign(envState, migrated)` 发生在 middleware 遍历**之前**，middleware 看到的 `envState` 已含本次变更
- 注册只允许在 `env-bridge.ts` 内进行，调用顺序 = 注册顺序（同 phase 内）
- middleware 抛异常被主流程吞掉并日志，不影响后续流程

## 与 ADR-174 的关系

ADR-174 的注册表派生 `resolveQualityProfile`/`inferQualityProfile`，本 ADR 的 `resolveQualityProfileMiddleware` 调用这些函数。两者解耦：ADR-174 改派生逻辑不影响本 ADR 的 middleware 结构。
