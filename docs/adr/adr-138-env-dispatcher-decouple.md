# ADR-138: env-dispatcher 破循环依赖

- **状态**: 部分实施（2026-07-19 Phase 1-3 完成：env-dispatcher.ts 新建 + env-bridge.ts 改造 + env-impl.ts 回调注册）
- **日期**: 2026-07-19
- **相关**: ADR-130（场景 UI 路线图）、ADR-137（EnvState 单一源 schema）

## 背景与问题

`env-bridge.ts`（771 行）与 `env-impl.ts`、`env-water.ts` 形成循环依赖三角：

```
env-bridge → env-bridge → env-impl (applyGround/applySky/applyFog)
env-bridge → env-water (updateUnderwaterTransition)
env-impl → env-bridge (setEnvState)
env-water → env-bridge (setEnvState)
```

循环依赖导致：
1. 模块初始化顺序敏感，HMR 热重载易出时序 bug
2. 单测需 mock 整个环境系统，测试成本指数级增长
3. 后续拆分 state.ts 时，store 边界被循环依赖"粘住"无法切割

## 决策

新建 `env-dispatcher.ts`（纯调度层，无状态），将 setEnvState 的响应逻辑从 env-bridge 解耦到各子系统：

```
当前:
  setEnvState → env-bridge → 直接调用 env-impl/env-water

目标:
  setEnvState → env-bridge → env-dispatcher.dispatch(changed)
                              ↓
                              ├── env-impl 注册回调（响应 sky/ground/fog 变化）
                              ├── env-water 注册回调（响应 water 变化）
                              └── env-clouds 注册回调（响应 clouds 变化）
```

env-bridge 只 import dispatcher，不 import env-impl/env-water。循环依赖全部变为单向：env-bridge → dispatcher ← subsystem。

## 方案设计

### 1. env-dispatcher.ts（新建）

```typescript
// env-dispatcher.ts — 纯调度层，无状态
type EnvCallback = (changed: Partial<EnvState>) => void;

const _callbacks = new Set<EnvCallback>();

/** 子系统注册响应回调（延迟绑定，避免循环导入） */
export function registerEnvCallback(fn: EnvCallback): () => void {
    _callbacks.add(fn);
    return () => _callbacks.delete(fn);
}

/** setEnvState 调用此函数分发变化 */
export function dispatchEnvChange(changed: Partial<EnvState>): void {
    for (const cb of _callbacks) {
        cb(changed);
    }
}
```

### 2. env-bridge.ts 改造

- 删除 `import * as impl from './env-impl'`
- 删除 `import { updateUnderwaterTransition } from './env-water'`
- setEnvState 内调用 `dispatchEnvChange(migrated)` 替代直接调用 impl.applyXxx

### 3. env-impl.ts / env-water.ts 改造

- 删除 `import { setEnvState } from './env-bridge'`
- 模块初始化时调用 `registerEnvCallback(changed => { ... })` 注册响应

### 4. 初始化顺序保障

- 子系统在 `createXxx()` 时注册回调
- env-bridge 的 setEnvState 在 dispatcher 注册完成后才可调用
- 启动时 `applyEnvState(envState)` 全量分发一次，触发各子系统初始化

## 影响面

- **代码**: env-bridge.ts、env-impl.ts、env-water.ts、env-clouds.ts、env-particles.ts
- **行为**: 无行为变化，仅内部解耦
- **测试**: 各子系统可独立 mock dispatcher，无需 mock 整个 env-bridge

## 风险与缓解

| 风险 | 等级 | 缓解 |
|------|------|------|
| 初始化时序导致回调未注册 | 🟠 中 | 启动时全量 dispatch 一次；回调注册幂等 |
| 子系统响应顺序变化 | 🟢 低 | 响应顺序本就不保证，各子系统独立响应 |
| 回调注册后未清理导致泄漏 | 🟡 中 | dispose 时调用 registerEnvCallback 返回的清理函数 |

## 分阶段实施

- **阶段 0（本 ADR）**: 立项
- **阶段 1**: 新建 env-dispatcher.ts + 改造 env-bridge.ts
- **阶段 2**: 改造 env-impl.ts / env-water.ts 注册回调
- **阶段 3**: 改造 env-clouds.ts / env-particles.ts
- **阶段 4**: 验证循环依赖解除（`dpdm` 0 循环）+ 全量测试

## 验收标准

- `dpdm --circular frontend/src` 0 循环
- `npm run test` 全绿
- env-bridge.ts 不 import env-impl / env-water
