# ADR-242: 顶层目录分层公理 —— 「纯算法层」假说的证伪与重定性

> **日期**: 2026-08-06
> **状态**: 提案（Proposed）—— 待裁决，暂未落地任何代码改动
> **关联**：ADR-191(core/utils 神桶拆分)、ADR-236/237/238(循环依赖重构)、ADR-226(地面 spec 单源)

## 背景

`frontend/src/` 顶层与 `scene/` 子域存在名称重叠的「双胞胎」目录：

| 顶层目录 | 文件数 | `scene/` 下同名子域 | 文件数 |
|---|---|---|---|
| `motion-algos/` | 19 | `scene/motion/` | 28 |
| `physics/` | 2 | `scene/physics/` | 3 |
| `library/` | 1 | — | — |
| `materials/` | 1 | — | — |
| `outfit/` | 3 | — | — |

坊间流传的隐含假说是：**顶层 = 纯算法层（零 Babylon 运行时依赖、可独立单测），`scene/` 子域 = 场景绑定层**。本 ADR 用两轮全量依赖扫描验证该假说。

## 决策依据（实测数据）

### 1. 假说判定：🔴 不成立

顶层 5 个目录中，**6 个文件持有运行时 Babylon 依赖**：

| 文件 | 违规内容 |
|---|---|
| `motion-algos/pose-preset.ts` | 运行时 `Quaternion.FromEulerAngles` |
| `motion-algos/vmd-evaluator.ts` | `new NullEngine()` / `new Scene()`，模块级 `_sharedScene` + `dispose()` |
| `physics/physics-bridge.ts` | 运行时 `new Vector3`，每帧 observer 编排注册表 |
| `physics/wind-physics.ts` | 运行时 `Vector3` + `MmdWasmRuntime`，`disposeWindPhysics()` |
| `materials/SssPBRMaterial.ts` | `class extends PBRMaterial`，纯渲染资产 |
| `outfit/*.ts` (3/3) | Texture / Mesh / Bone / StreamAudioPlayer 全量运行时 |

反向证伪同样成立：`scene/` 内亦有零 Babylon 的纯文件（`lipsync-bridge.ts`、`footstep.ts`、`motion-modules/motion-math.ts`）。**「顶层 / scene」这条线与「纯 / 绑定」这条线不重合。**

### 2. 真实规律

分界不是位置，而是**消费面方向**：

| 顶层目录 | 被 scene 引用 | 被 menus 引用 | 实际定性 |
|---|---|---|---|
| `motion-algos/` | 22 | 5 | 🟢 **算法内核**——被 scene 主消费，假说局部成立（16/19 纯净） |
| `physics/` | 7 | 0 | 🟡 **共享基建**——被 scene 反向消费，非算法层 |
| `library/` | 1 | **12** | 🔴 **UI 公共服务层**——消费面几乎全倒向 menus |
| `outfit/` | 1 | **4** | 🔴 **UI 公共服务层**——同上 |
| `materials/` | **0** | **0** | ⚪ **生产零消费**——仅被单测引用 |

`motion-algos/` 是唯一被刻意抽出、有明确设计意图的目录（`feet-adjustment.ts` 注释明写「纯数学解算，便于单测」）。其余 4 个是**未被收编的历史特性模块**，与「算法层」无关。

### 3. 依赖方向破口

顶层算法层 → `scene/**` 反向边共 **4 条，全部运行时**：

| 源 | → 目标 | 符号 |
|---|---|---|
| `outfit/outfit.ts:8` | `scene/shared/texture-lru` | `readTextureWithLRU` |
| `outfit/outfit.ts:23` | `scene/manager/material` | `_catOf`（**下划线私有符号穿透**） |
| `outfit/outfit.ts:49` | `scene/scene` | 动态 `await import` |
| `motion-algos/footstep-detect-fallback.ts:16` | `scene/env/env-impl` | `getGroundHeightAt`（已入环白名单） |

**更重的破口在 `core/`**：13 条生产反向边 / 5 文件，构成 `core → menus → core` 等 3 个 CI 阻断环。其中 `core/main.ts:11` 的 `import '../menus/library-setup'` 经核实是 **ADR-238 桥接注册链的有意副作用导入**（源码有 3 行注释说明），属已知代价而非事故。

`check:circular --strict` 现状：**9 个白名单内已知环 + 13 个白名单外 CI 阻断环**。

### 4. 零依赖 menus

5 个顶层目录**无一** import `@/menus/**`。这是全局唯一无例外的规律，可直接固化为 lint 规则。

## 候选方案

| 方案 | 内容 | 代价 | 风险 |
|---|---|---|---|
| **A · 立规守护** | 承认现状分层，把「顶层目录禁止 import `@/menus/**`」写成 `check:layering` 规则挂 CI；`motion-algos/` 额外加「禁止运行时 Babylon 导入」白名单制（现存 2 例外登记在册） | 小，纯新增脚本 | 低。固化了不完美现状 |
| **B · 目录收编** | `materials/` → `scene/render/`；`library/library-path.ts` → `core/`；`physics/` → `scene/physics/`；`outfit/` 拆为 `scene/outfit/`(绑定) + menus 侧调用 | 中。涉及数十处 import 路径改写（用 `npm run codemod` 可自动化） | 中。可能触发新环，需逐步验证 |
| **C · A + B 分期** | Phase 1 落 A（守护先行，防止继续恶化）；Phase 2 按目录逐个收编，每个目录一次独立 commit + 全量验证 | 中，但风险分摊 | 低 |

## 附带发现（独立于本 ADR 范围）

| 严重度 | 发现 |
|---|---|
| 🟡 P2 | `materials/SssPBRMaterial.ts`（242 行）**生产代码零消费**，仅 `sss-pbr-material.test.ts` 引用。`scene/manager/material-sss.ts` 只在注释里提到它。属死代码或未接线特性，需确认是哪种。 |
| 🟡 P2 | `outfit/outfit.ts:23` 穿透引用 `scene/manager/material` 的下划线私有符号 `_catOf`。下划线约定在跨模块处已失效。 |
| 🟡 P2 | `motion-algos/footstep-detect-fallback.ts` 住在算法目录却持有 observer 与 `start/stopFallbackDetection` 生命周期——**分层颠倒**，它是绑定层。 |
| 🟢 P3 | 文件命名越狱 2 处：`materials/SssPBRMaterial.ts`(PascalCase)、`scene/camera/invertablePointersInput.ts`(camelCase，且 `invertable` 疑为 `invertible` 拼写错误)。全库其余为 kebab-case。 |
| 🟢 P3 | `_bridge` / `_shared` 下划线目录约定仅存在于 `scene/env/`，其他子域无对应约定但同样存在桥接代码。 |

## 成对文件核验（假说溯源）

| 组 | 结论 |
|---|---|
| `lipsync` / `lipsync-bridge` | 真配对，但轴是「纯算法 / 状态转发」，非「算法 / Babylon 绑定」 |
| `footstep-detect(+fallback)` / `footstep` | **分层颠倒**（fallback 是绑定层） |
| `feet-adjustment-math`+`feet-event` / `feet-adjustment` | 真配对，最干净的范本 |
| `physics-bridge` / `scene/physics/*` | **名字巧合 + 方向反转**（bridge 被 scene 消费） |
| `proc-motion-*`(6) / `motion-modules/` | 真配对（共享内核式，非 1:1 对偶） |

## 待裁决

1. 选 A / B / C 哪个方案？
2. `SssPBRMaterial` 是死代码（删）还是未接线特性（接）？
3. 13 个白名单外阻断环是否纳入本 ADR 范围，还是归 ADR-238 续作？
