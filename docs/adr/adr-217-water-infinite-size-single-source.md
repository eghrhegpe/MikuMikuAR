# ADR-217: 地水无限尺寸单源化 — 水面跟进 groundInfiniteEnabled

- **状态**: ✅ 已实施
- **日期**: 2026-07-30
- **相关**: ADR-134（无限地面：固定大 mesh + 世界空间平铺）、ADR-062（水面系统）、ADR-115（地平线淡出/无限水面视觉）、ADR-137（EnvState 单一源 Schema）、ADR-211（水面功能开关体系）
- **源码锚点**: `frontend/src/scene/env/_shared/env-context.ts`（共享常量 + `effectiveGroundSize`）、`frontend/src/scene/env/env-water.ts`（mesh 缩放 ×2 + 地平线淡出距离）、`frontend/src/core/env-state-schema.ts`（`groundInfiniteEnabled` / `groundSize` dispatch group）

---

## 一、问题陈述

「无限地面」（ADR-134）开启时地面 mesh 切到固定大尺寸 `INFINITE_GROUND_SIZE = 2000`，但**水面从未跟进这套逻辑**：

- 水面 mesh 缩放恒为 `max(1, groundSize / WATER_BASE_SIZE)`，只认 `groundSize`（默认 500），不认 `groundInfiniteEnabled`。
- 水面地平线淡出距离 `uHorizonStart/End = groundSize * 0.7 / 0.95`，同样只按 `groundSize`。

### 后果：甜甜圈断崖

默认 groundSize=500 开无限地面时：

| 元素 | 延伸范围 |
|------|---------|
| 地面 | 2000 单位 |
| 水面 mesh | 500 单位 |
| 水面地平线淡出 | 350（start）~ 475（end）完全淡出 |

水面在 475 处淡成天空色，而地面延伸到 2000 → 画面呈**中心 475 有水、外圈 475~2000 是裸露干地**的甜甜圈。用户对「无限地面 + 水面」的预期是水覆盖到天边，实际得到割裂。

### 根因：地水演进不对称

ADR-134 对地面做了无限化改造，水面停留在 ADR-062 的 `groundSize` 缩放模型，改造未波及水面。缺一个「地水尺寸单源」的联动。ADR/测试均无覆盖：ADR-134 只字未提水面；`groundInfiniteEnabled` 的测试全在 ground/契约侧，无一测水面响应。

## 二、决策

### 2.1 抽取地水共享尺寸单源

在 `env-context.ts`（零循环依赖共享层）新增：

```ts
export const INFINITE_GROUND_SIZE = 2000;
export function effectiveGroundSize(groundSize: number, infiniteEnabled: boolean): number {
    return infiniteEnabled ? INFINITE_GROUND_SIZE : groundSize;
}
```

**为何放 env-context 而非 env-ground 导出**：`env-ground.ts` 已 `import from './env-water'`，若让 env-water 反向 import env-ground 会形成循环依赖（正是项目一贯用注入模式规避的坑）。env-context 是 env 子系统零循环依赖的共享层，地面/水面均已依赖它。

### 2.2 水面三处消费点改用派生

`env-water.ts` 的 2 处 mesh 缩放 + 1 处地平线淡出距离，`state.groundSize` → `effectiveGroundSize(state.groundSize, state.groundInfiniteEnabled ?? false)`。

### 2.3 补 dispatch 联动缺口

`groundInfiniteEnabled` / `groundSize` 原为 `group: 'ground'`，改动只触发地面重建，**不触发水面重同步**。改为 `group: ['ground', 'water']`，使 `getEnvKeys('water')` 含这两字段，改动即触发 `createWater` 重算水面 scale。这是 schema-driven 的干净修法，不在回调里加特判。

> 注：`env-lighting.ts` 的 `env:ground` / `env:water` 数组是**预设分类清单**（供「保存当前为预设」），与 schema dispatch group 是两套独立机制，无需改动。

## 三、效果

开无限时：水面 mesh 铺到 2000、地平线淡出推到 1400~1900，与地面延伸对齐，甜甜圈消除。且随 groundSize 自适应，无魔法数。

## 四、验证

- `npx tsc --noEmit`：0 错误
- 补专项单测（env-water.test.ts）：`groundInfiniteEnabled=false` → `uHorizonStart`=350；`=true` → 1400，覆盖此前测试盲区
- 引入新 export 后同步更新 `env-context` 的 `vi.mock`（补 `effectiveGroundSize` / `INFINITE_GROUND_SIZE`），env-water/env-state/app.contract/feature-levels 共 90 测试通过

## 五、经验（vi.mock 与新 export 的同步纪律）

`env-water.test.ts` 手工 `vi.mock('_shared/env-context')`，新增模块 export 若不同步进 mock 工厂，运行时报 `No "xxx" export is defined on the mock`。教训：给被 mock 的共享模块加 export 时，须一并更新其所有 vi.mock 工厂的 return。
