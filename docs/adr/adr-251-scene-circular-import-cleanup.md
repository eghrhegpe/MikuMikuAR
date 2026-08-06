# ADR-251: scene 反向 import 循环依赖治理 —— model-ops/camera 对 `../scene` 的真实静态循环

> **日期**: 2026-08-06
> **状态**: ✅ 已立（2026-08-06 立项；来源审核第 13 轮：`docs/audit/2026-08-06-round13-scene-render-core-ui.md` 跨模块模式问题 #2「坐标系契约混淆 / 循环依赖」）。本 ADR 固化现状认知与治理方向，实现分批跟进
> **编号**: 251
>
> **关联**: [ADR-100](adr-100-camera-control-behavior-dual-axis.md)（相机系统拆分：子模块单向依赖 camera-state，禁止互相 import）、[ADR-242](adr-242-toplevel-layering-axiom.md)（顶层目录分层公理）、[ADR-191](adr-191-god-barrel-debarreling.md)（barrel 去重与单向依赖）、[ADR-244](adr-244-init-phase-split.md)（初始化阶段拆分）
>
> **来源**: 2026-08-06 第 13 轮代码审核（`docs/audit/2026-08-06-round13-scene-render-core-ui.md`）——`model-ops.ts:24`、`camera.ts:26`、`camera-auto.ts:14` 从各自子模块反向 `import '../scene'`，与 scene.ts 的 `export *` 构成真实静态循环。

**决策者**: AtomCode（联邦首席架构师 AI）、Jieling（人类侧首席架构师）

---

## 背景

### 触发证据：三个子模块反向 import `../scene`

```ts
// frontend/src/scene/manager/model-ops.ts:24
import { modelManager } from '../scene';

// frontend/src/scene/camera/camera.ts:26
import { focusModel, reattachPipeline } from '../scene';

// frontend/src/scene/camera/camera-auto.ts:14
import { getProcBeatDetector } from '../scene';
```

而 `scene.ts:823` 存在 `export * from './manager/model-ops'`，形成：`scene.ts → model-ops.ts → scene.ts` 的静态循环。camera/camera-auto 同理（`scene.ts → camera.ts → scene.ts`）。

| 依赖 | 现状 | 风险 |
|------|------|------|
| `model-ops.ts` → `modelManager`（scene.ts 单例） | ESM live binding 运行期侥幸工作 | 违反 model-manager.md「不引用 scene.ts 任何符号」原则；测试全部 mock 掉 scene 掩盖该环 |
| `camera.ts` → `focusModel`/`reattachPipeline` | 同上 | 违反 camera.md「子模块禁止互相 import」原则；ADR-100 拆分子模块时残留的反向边 |
| `camera-auto.ts` → `getProcBeatDetector` | 同上 | beatcut 节拍源经 scene 间接获取，分层语义模糊 |

## 决策

### 决策 1：承认现状 + 分三批治理（不改接口的渐进式收口）

| 批次 | 依赖 | 治理方向 | 改动面 |
|------|------|----------|--------|
| A | `camera-auto.ts → getProcBeatDetector` | 节拍检测器经注入回调（`setBeatDetectorProvider`）或 `scene-action-bridge` 提供，切断对 scene 的直接 import | 小（单符号） |
| B | `model-ops.ts → modelManager` | `modelManager` 单例经构造函数/上下文注入（model-ops 工厂化），或经 `scene-action-bridge` 暴露 | 中（model-ops 调用方较多） |
| C | `camera.ts → focusModel`/`reattachPipeline` | 两者已有 scene-action 注册（`focusModel` 经 action-defs、`reattachPipeline` 为 renderer 功能），camera 侧改经 bridge 获取 | 中 |

### 决策 2：治理期间的三条红线（立 ADR 即生效）

1. **禁止新增** 子模块对 `../scene` 的直接 import——新代码一律走 `scene-action-bridge` / 注入回调 / 依赖参数。
2. `npm run dep:graph` 或 `check:layering` 应把「`scene/manager/*`、`scene/camera/*` → `scene.ts`」反向边纳入基线告警（对齐 ADR-242 R2/R3 棘轮思路），消除反向边后收紧基线。
3. 测试 mock 不得掩盖循环——`model-ops`/`camera` 的专项测试应使用 `vi.mock('@/scene/scene')` 显式断言桥接契约，而非依赖全量 mock 绕过。

### 决策 3：不重构 scene.ts 的 `export *`（保持对外 barrel 兼容）

`scene.ts` 作为对外唯一入口的 barrel 职责保留（`export * from './manager/model-ops'` 等），治理只消除**反向** import 边，不改变正向 barrel 结构——避免大爆炸式重构（与 ADR-191「去 barrel」的既定节奏一致：先断环、再视需要收 barrel）。

## 与其他 ADR 的关系

- 不取代 [ADR-100](adr-100-camera-control-behavior-dual-axis.md)——ADR-100 约束的是相机子模块**互相** import；本 ADR 针对子模块 → scene 根的反向边，是同一拆分子模块工作的残余项。
- 不取代 [ADR-242](adr-242-toplevel-layering-axiom.md)——ADR-242 管顶层目录分层（算法层/绑定层）；本 ADR 管 scene 目录内部的反向依赖。
- 触及 model-manager.md / camera.md 知识卡的「不引用 scene.ts 符号」不变量——**该不变量是目标态**，本 ADR 登记现状违约与治理路径，不改写知识卡（知识卡描述目标态，ADR 登记偏差）。

## 影响与验收

- **验收标准**：三批治理完成后，`grep -rn "from '../scene'" frontend/src/scene/manager frontend/src/scene/camera` 无结果；`check:layering` 无 scene 目录内部反向边告警。
- **风险**：治理 B（modelManager 注入）改动面最大，需同步 10+ 调用方；建议拆独立 PR 逐批落地，每批保持全量测试绿。
- **回退**：逐批独立，任一批回退不影响其他批。
