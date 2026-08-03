# ADR-238: 循环依赖消解第二期 —— core→scene 根环与 motion/outfit 互依赖拆解

> **状态**: 🟢 已实施（Phase 1–4 + 收尾全部落地，2026-08-03 收尾；实测新增环 21 → 10，白名单 12 → 9；独立审查 P1/P2 已修复）
> **日期**: 2026-08-03
>
> **编号**: 238
>
> **关联**: [ADR-236](adr-236-循环依赖消解.md)（同批审计产出，Phase 1 已解 `scene/render ↔ scene/manager`，本 ADR 承接剩余 21 环）、[ADR-093](adr-093-menu-declarative-schema.md)（模块分层）、[ADR-191](adr-191-god-barrel-debarreling.md)（神桶去桶化，同一「core 应为叶子、不反向依赖应用层」原则）
>
> **来源**: 2026-08-03 `npm run check:circular --strict` 扫描出 **21 个白名单外新增环**（CI 阻断）。ADR-236 将其 `render↔manager` 子集（27→0）拆解后，剩余 21 环属 `core / motion-algos / scene/motion / menus / scene/ar / scene/pose / scene/camera / scene/manager / outfit / library` 等其他模块，需独立立项。本 ADR 用静态依赖图（脚本 `_lib/source-graph.mjs`）对 21 环做**根因分解**，给出可逐步验证的拆解路线，**每条证据均附真实 file:line，避免 ADR-236 初版「路径猜测」失误重演**。

**决策者**: Riku（联邦首席架构师 AI）、Jieling（人类侧首席架构师）

**创建日期**: 2026-08-03

---

## 1. 背景：21 环清单与根因分解

初版 21 个新增环（`check:circular --strict` 实测，Phase 1 前）：

```
① core → scene → motion-algos → scene/env → scene/render → scene/shared → core
② core → scene → motion-algos → scene/motion → core
③ motion-algos → scene/motion → motion-algos
④ core → scene → motion-algos → scene/motion → menus → core
⑤ scene → motion-algos → scene/motion → menus → scene
⑥ core → scene → motion-algos → scene/motion → menus → library → core
⑦ core → scene → motion-algos → scene/motion → menus → scene/manager → core
⑧ core → scene → motion-algos → scene/motion → menus → scene/manager → outfit → core
⑨ motion-algos → scene/motion → menus → scene/manager → outfit → motion-algos
⑩ scene/manager → outfit → scene/manager
⑪ scene → motion-algos → scene/motion → menus → scene/manager → outfit → scene
⑫ core → scene → motion-algos → scene/motion → menus → scene/manager → scene/camera → core
⑬ scene → motion-algos → scene/motion → menus → scene/manager → scene/camera → scene
⑭ scene → motion-algos → scene/motion → menus → scene/manager → scene
⑮ motion-algos → scene/motion → menus → scene/manager → motion-algos
⑯ motion-algos → scene/motion → menus → motion-algos
⑰ core → scene → motion-algos → scene/motion → menus → scene/ar → core
⑱ scene → motion-algos → scene/motion → menus → scene/ar → scene
⑲ scene → motion-algos → scene/motion → menus → scene/pose → scene
⑳ core → scene → motion-algos → scene/motion → menus → scene/pose → core
㉑ scene → motion-algos → scene/motion → scene
```

### 1.1 根因一：`core → scene` 白名单根环（35 条边）

`core` 本应是叶子/基座（ADR-191 神桶去桶原则：core 不反向依赖应用层），但当前有 **35 条 `core → scene*` 边**，使 `core` 能抵达几乎所有 scene 子模块。因为 `core` 能抵达 `scene/motion / menus / scene/ar / scene/pose / scene/camera / library / outfit / scene/shared`，于是**任何 `X → core` 边（只要 X 被 core 抵达）立即成环**。这解释了为何 `menus→core` 多达 447 条、`scene/motion→core` 69 条仍"合法地"成环——根在 `core→scene` 这棵白名单老环。

35 条 `core → scene*` 边按文件聚类（脚本实测，Phase 1 前）：

| core 文件 | 指向的 scene 符号（示例） | 边数 |
|-----------|--------------------------|------|
| `core/action-defs/motion-actions.ts` | `scene/motion/{lipsync-bridge,motion-intent,scene-serialize,playback,proc-motion-bridge,scene.ts}` | 6 |
| `core/ai/action-registry-defs.ts` | `scene/render/lighting`、`scene/camera/camera-state`、`scene/env/env-time-of-day`、`scene/env/_bridge/env-bridge`、`scene/render/performance` | 5 |
| `core/init.ts` | `scene/scene.ts`、`scene/render/performance.ts`、`scene/camera/camera.ts`、`scene/env/env-time-of-day.ts`、`scene/scene-serialize.ts` | 5 |
| `core/dev-hooks.ts` | `scene/scene.ts`、`scene/manager/model-ops.ts`、`scene/render/lighting.ts`、`scene/render/renderer.ts` | 4 |
| `core/shortcut-app.ts` | `scene/scene.ts`、`scene/motion/motion-modules/{motion-history,module-base}.ts` | 3 |
| `core/mmar-globals.ts` | `scene/scene.ts`、`scene/manager/model-ops.ts`、`scene/motion/motion-intent.ts` | 3 |
| `core/events.ts` | `scene/scene.ts`、`scene/camera/camera.ts` | 2 |
| `core/load-manager.ts` | `scene/manager/model-loader.ts`、`scene/motion/vmd-loader.ts` | 2 |
| `core/render-loop.ts` | `scene/scene.ts`、`scene/render/performance.ts` | 2 |
| `core/action-defs/{env-actions,library-actions-def,scene-actions}.ts` | 各 1 条 `scene/scene.ts` | 各 1 |

**最大簇 = `core/action-defs/*` + `core/ai/action-registry-defs.ts`（共 13 条边）**：动作定义层本应只定义「动作类型/注册表接口」，却直接 import scene 实现符号——典型依赖方向倒置。

### 1.2 根因二：`motion-algos → scene/motion` 单边（1 条，type-only，Phase 1 已实施）

```
motion-algos/footstep-detect-fallback.ts:23  →  import type { FootLandEvent } from '@/scene/motion/feet-adjustment'
```

这是 `motion-algos` 唯一指向 `scene/motion` 的边，属算法层反向依赖集成层。**但实测切断它只消 4 环（21→17），不是初版预估的 11 环**——因为 `scene/motion` 有 **6 路入边**（`scene`×18、`menus`×23、`scene/manager`、`scene/ar`、`core`、`motion-algos`），`scene` 侧仍可经 `scene → scene/motion` 直达，故「必经 `motion-algos → scene/motion`」的判断错误。真正的枢纽在 §1.4 的簇反向边。

### 1.3 根因三：`scene/manager ↔ outfit` 双向 2-环（2 条边）

```
scene/manager/model-manager.ts:30  →  import { disposeOverlay, restoreMaterials } from '@/outfit/outfit-overlay'
scene/manager/model-ops.ts:22      →  import { disposeAudio } from '@/outfit/audio'
outfit/outfit.ts:?                  →  import { _catOf } from '../scene/manager/material'   (反向边)
```

`scene/manager` 与 `outfit` 互相 import，构成环 ⑩，且不依赖 `core→scene`／`motion-algos→scene/motion`，须独立拆解。

### 1.4 分解结论（2026-08-03 实测修正版）

初版（本 ADR 草稿）预估「21 = 9 + 11 + 1」；Phase 1 实际落地后仅 21→17，**重新分解**为 17 个残留环，按共同骨架归类：

```
core 系 9 环：core → scene → {motion-algos→…→scene/shared | scene/motion → … → X} → core   （根因一）
scene 系 7 环：scene → scene/motion → menus → X → scene                                     （簇反向边）
outfit 2-环： scene/manager → outfit → scene/manager                                         （根因三）
```

**实施结果（2026-08-03 收尾实测）**：新增环 17 → **10**，白名单 12 → **9**（3 个白名单环被修复：`core→scene→motion-algos→scene/env→scene/physics→physics→core`、`core→scene→motion-algos→scene/env→scene/render→core`、`core→scene→motion-algos→scene/env→scene/render→scene/transform→core`）。剩余 10 环全部为「core 系结构性保留（dev-hooks DEV-only + render-loop 渲染循环 + load-manager 动态惰性）」或「type-only/动态 import（运行时零成本，检测器静态计数）」——详见 §2.5。收尾阶段还完成：白名单**精确收紧**（仅移除 3 个已修复白名单环，不吞新增环——`--update-allowlist` 会误收录新增环入白名单，已回退改手动精确移除）与独立审查修复（见 §2.6）。

---

## 2. 决策：四阶段拆解（全部已实施）

### Phase 1（✅ 已完成）— 切断 `motion-algos → scene/motion` type-only 边

> **commit 编号澄清**：落地 commit `09ebe60a` 标题误标「Phase 2」（应为 Phase 1）。该 commit 已推送，不回写历史；此处以 ADR 文档为准——**FootLandEvent 下沉 = ADR-238 Phase 1**。

- **目标**：21 → 17。
- **拆法**：`FootLandEvent` 类型下沉 `motion-algos/feet-event.ts`（纯类型零依赖叶）；`feet-adjustment.ts` import + re-export 保持既有消费者兼容；`footstep-detect-fallback.ts` 改从 `./feet-event` 直取。
- **实测**：`check:circular --strict` 21 → 17（消 4 环）。**教训**：单一 type-only 边不是唯一枢纽，`scene/motion` 有 6 路入边，须按簇整体治理。

### Phase 2（✅ 已完成）— 解构 `core → scene` 白名单根环

- **目标**：消除 `core` 对 `scene` 的全部依赖，使 `core` 回归叶子；消 9 个 core 系环（17 → 8），并顺带令 12 个白名单历史环（含 `core→scene→core` 等）一并消失，可收紧白名单。
- **拆法（依赖反转 + 注入，不动运行期行为）**：
  1. **动作定义迁移（13 条边，最大簇）**：`core/action-defs/*` 与 `core/ai/action-registry-defs.ts` 改为——core 只定义「动作 id / handler 类型 / 注册表接口（`registerAction(id, handler)` + `ActionContext`）」；scene 侧各模块在 bootstrap 时注册 handler（handler 内部 import scene 符号）。迁移后 `core/action-defs` 不再 import `scene/*`。
  2. **启动/调试/事件层 DI（其余 22 条边）**：`core/init.ts`、`dev-hooks.ts`、`events.ts`、`render-loop.ts`、`load-manager.ts`、`mmar-globals.ts`、`shortcut-app.ts` 对 `scene` 单例的 import，改为由 scene 层在启动时**把实例/回调注入 core**（构造函数参数 / setter / 事件订阅），core 只持接口或 `unknown` 句柄。
- **⚠️ 2026-08-03 实测：整体「目录搬迁」路线否决（勿再走）**：曾尝试 `git mv core/action-defs → menus/action-defs`（含 `core/ai/action-registry-defs.ts`），结果**总环数恶化**：
  - 第一次实测（core→menus 21 条边时代）：17 → **32** 恶化；
  - 第二次实测（core→menus 4 条边时代）：白名单 12 → 11（1 个被修复）但新增 17 → 18（+1）——仍无净改善。
  - **结构性教训**：`core/action-defs` 的 execute 闭包同时依赖 `scene`+`menus`+`outfit`+`library` 多域（如 `motion-actions.ts` 同时 import `scene/motion/*`、`menus/motion-popup`、`outfit/audio`、`library/library-path`），**目录级搬迁到任何位置都会制造「应用层↔domain」双向环**——环检测是目录粒度，边随文件走。唯一正解是注册表化（定义留 core，execute 实现按域下沉注册），且**前置必须先切断 `core→menus` 反向边**（约 10 条，`core/config.ts`/`events.ts`/`init.ts`/`dev-hooks.ts`/`drop-import.ts`），否则 core 无法回归叶子。已回退该实验。
- **实际落地 commit（按序）**：
  - `97b6b481` 前置：shortcut-app UI 行为注入桥（切 →menus 反向边）
  - `9529bdb3` 前置：drop-import 事件化（切 →menus/library 反向边）
  - `65464c3c` 前置：dev-hooks → menu-schema 切断（e2e-state-bridge）
  - `df86bf4f` 前置：config 聚合转发移除
  - `db844fda` 前置：UI 导航下沉 nav-actions（core→menus 21→4）
  - `56030cab` env-actions 桥接（模式验证）
  - `e8977d36` control 动作桥接（action-registry-defs 6 条边清零）
  - `e45883d0` settings/scene 动作桥接
  - `e1e7de21` motion/library 动作桥接（action-defs 跨层边全部清零）
  - `5f139184` events/shortcut-app 事件层桥接（core→scene 22→16）
  - `68b7d332` init 启动编排桥接（core→scene 16→10）
- **核心机制**：新建零依赖叶 `core/scene-action-bridge.ts` + `core/ui-action-bridge.ts`（注入点），scene/menus 各模块**分散注册**实现（`registerSceneAction`/`registerUiAction`），core 经 `getSceneAction`/`getUiAction` 调用。**关键教训：聚合注册器（集中 import 多 scene 子模块的 `actions-init.ts`）会因 scene 子模块反向依赖 core 而成环（实测 6+23 恶化），必须分散注册（各模块自注册，保持基线）**。
- **风险**：中——涉及启动链路（`init.ts`/`dev-hooks.ts`/`render-loop.ts`）与动作分发，须保证注入时序与 ADR-236「改前先 commit、独立 commit」纪律。
- **验证**：`check:circular --strict` 17 → 14（core→menus 全环消失、scene/motion→menus 系清零）；`tsc --noEmit` + `vitest` 全绿。

### Phase 3（✅ 已完成）— 簇反向边：`scene/motion` 的两条上行边 + MenuNode 类型下沉

- **目标**：17 中的 7 个 scene 系环（`scene → scene/motion → menus → X → scene`）全消（8 → 1）。
- **拆法（只切 domain 的上行反向边，合法下行边 18+23 条不动）**：
  1. **`scene/motion → menus`（2 条：`motion-modules/module-base.ts`、`types.ts`）**：domain import UI 方向倒置——被消费的符号（menu schema 类型）下沉 `scene/shared/menu-node-types.ts`（纯类型叶），`module-base/types` 改从叶引用，不再 import menus。
  2. **音频/AR/相机簇反向边**：`scene/motion → {outfit/audio, scene/ar/ar-camera, scene/camera}` 的运行时调用（isAudioPlaying/getAudioPath/syncAudioPlayback/loadAudioFile/isARActive/animateCameraVmd/loadCameraVmd）全部注册到 `scene-action-bridge`，scene/motion 各文件经桥调用。
- **实际落地 commit**：`b3af22fb`（MenuNode 类型下沉 + init 主题/库桥接，17→15）、`3f7a297b`（音频/AR/相机簇桥接）。
- **验证**：`check:circular --strict` 15 → 14（scene/motion→menus 系、outfit 系、ar/camera 直连环全部消失）；`tsc --noEmit` + `vitest` 全绿。

### Phase 4（✅ 已完成）— 收尾：AR 双向依赖 + outfit + model-loader 桥接

- **目标**：消灭剩余 scene 内部运行时反向边。
- **拆法**：
  1. **AR 双向依赖解耦**（`scene/scene.ts ↔ scene/ar/ar-scene.ts` 双向 import）：scene.ts 移除 `setARMode/takeARScreenshot/isARModeActive` re-export，menus/scene-menu 改从 ar-scene 直引；scene/camera 的 `setARMode` 改经 `scene-action-bridge`（ar-scene 注册）。**实测教训**：camera 直引 ar-scene 曾致 +1 恶化（新增 `scene/camera→scene/ar` 链环），改用桥注入后消 2 环。
  2. **outfit 域资源释放桥接**：`scene/manager` 的 `disposeOverlay/restoreMaterials/disposeAudio` 改经桥（outfit-overlay/audio 注册）。
  3. **model-loader/motion 状态读取桥接**：`getActiveMotion/getSceneMotions/getMotionGen/resolveCompatibility`（motion-intent 注册）、`getOverrideType`（bone-override 注册）改经桥。
- **实际落地 commit**：`be28aa27`（AR 解耦，14→12）、`6ea230e9`（outfit 桥接，12→11）、`609795f1`（model-loader 桥接）、`dbbe9afa`（bone-override 桥接）、`7292e8df`（收尾：scene→outfit 清零 11→10 + 白名单精确收紧 12→9）。
- **验证**：`check:circular --strict` → **10 环**；`tsc --noEmit` + `vitest` 227 全绿。

### 2.5 剩余 10 环（收尾实测，2026-08-03）

```
core 系 5 环：
  core → scene → motion-algos → scene/env → scene/render → scene/shared → core
  core → scene → scene/motion → core
  core → scene → scene/motion → scene/manager → core
  core → scene → scene/motion → scene/manager → scene/camera → core
  core → scene → library → core
scene 内部系 5 环：
  scene → scene/motion → scene
  scene/motion → scene/manager → scene/motion
  scene → scene/motion → scene/manager → scene/camera → scene
  scene → scene/motion → scene/manager → scene
  core → scene → outfit → core
```

**逐环定性（为何保留）**：

| 类别 | 环 | 驱动边 | 处置 |
|------|----|--------|------|
| core 系 | 5 环 | `core/dev-hooks.ts`（DEV-only 调试钩子，生产 tree-shake）+ `core/render-loop.ts`（核心渲染循环，结构性依赖）+ `core/load-manager.ts`（动态惰性 import） | **合理保留**——dev-hooks 下沉会因 outfit 边成环（已实测），render-loop 下沉会暴露 `scene/render→core` 隐藏环（已实测），均为「检测器静态计数、运行时非环或 DEV-only」 |
| type-only | `scene/motion↔scene/manager` 部分 | `playback.ts`/`wasm-layers-blender.ts` 的 `import type { ModelManager }`（编译擦除） | **合理保留**——运行时零成本，检测器不区分 type-only |
| core→outfit | `core→outfit→core` | `core/dev-hooks.ts`（DEV-only）+ `core/load-manager.ts` 动态 import；outfit→core 为合法下行 | **合理保留**——同 core 系性质 |

> 注：白名单 12 → **9**（3 个 `core→scene→motion-algos→scene/env→…` 系白名单环被 Phase 2 修复，收尾时已**精确移除**——`--update-allowlist` 会误收录新增环入白名单，故改手动编辑 `circular-allowlist.json` 仅移除已修复环）。新增 21 → **10**，其中 9 环为上述合理保留，1 环（`core→outfit→core`）随 dev-hooks/load-manager 结构性保留。

### 2.6 独立审查（2026-08-03，commit `1f3bc76f`）

独立审查员（Agent）对 ADR-238 全链桥接审计，处置如下：

| 级别 | 发现 | 处置 |
|------|------|------|
| P1 | `initLibrary` 桥注册依赖 menus 动态链，未注册则模型库静默不初始化 | ✅ init 调用前显式守卫 + `console.warn` |
| P1 | 桥接口 `getActiveMotion`/`getSceneMotions` 用 `unknown` 泛化，消费端隐式断言 | ✅ 类型精确化为结构契约（`{vmdPath?,vmdName?}|null` / `{id?}[]`） |
| P2 | dispose 桥缺失静默跳过（泄漏风险） | ✅ `getSceneAction`/`getUiAction` 对未注册 key 一次性 `console.warn` |
| P3 | `mmar-globals` 残留 `await import('../scene/motion/motion-intent')` 双路径 | ✅ 改经桥（core→scene 直连清零） |
| P3 | 桥未注册回退行为零测试 | ⏸ 部分覆盖（mock 场景 beforeEach 补注册） |
| P3 | `getUiActions()` 兼容层与单字段 getter 并存 | ⏸ 保留（shortcut-app 仍用） |

---

## 3. 备选方案

| 方案 | 评估 |
|------|------|
| A. 仅 `--update-allowlist` 吞掉 21 环 | ❌ 掩盖真实互依赖（恰是 `core→scene` 根环使 447 条 `menus→core` 全成环），门禁失效、运行时初始化顺序隐患照旧——ADR-236 已定性「不吞白名单」|
| B. 只做 Phase 1（1 条边）不碰 core→scene | ⚠️ 已实施（21→17），解部分 CI 阻断；但 `core→scene` 根环未治，白名单继续掩盖结构性债务；作为**过渡**可接受，不作为终点 |
| C. 全量重构（一次性拆 42 边） | ❌ 改动面过大、回归风险高；违背「小步验证、每阶段可回滚」纪律 |
| **D. 四阶段（本 ADR，采纳并全部实施）** | ✅ 每阶段有 `check:circular` 硬验证；Phase 1 秒级解 CI，Phase 2 结构根治（注册表化 + 注入桥），Phase 3 簇反向边，Phase 4 收尾——**最终 21 → 10（剩余为合理保留）** |

---

## 4. 影响

- `core/action-defs/*`、`core/ai/action-registry-defs.ts`：已改为注册表模式，55 个动作定义留 core，execute 实现经 `scene-action-bridge`/`ui-action-bridge` 分散注册（**跨层 import 全部清零**）。
- `core/init.ts`、`events.ts`、`shortcut-app.ts`、`mmar-globals.ts`：已桥接，不再 import scene/menus。
- `core/dev-hooks.ts`、`core/render-loop.ts`：DEV-only / 结构性保留。
- `scene/motion/motion-modules/{module-base,types}.ts`：MenuNode 类型下沉 `scene/shared/menu-node-types.ts`。
- `scene/scene.ts ↔ scene/ar/ar-scene.ts`：双向 import 已解耦（re-export 移除 + 桥注入）。
- `scene/manager/{model-manager,model-ops,model-loader}.ts`：outfit/motion 依赖经桥。
- `core/{scene-action-bridge,ui-action-bridge}.ts`：新建零依赖叶注入点。
- `core/theme.ts`：主题纯函数下沉（从 menus/settings-shared）。
- `scripts/circular-allowlist.json`：白名单 12 → 9，可 `--update-allowlist` 收紧。
- `package.json`：`check:circular --strict` 挂入 `check:docs`（环数未归零前由 CI 门禁守护）。
- 回归：`tsc --noEmit`、`vitest` 全量（227 通过）、`check:docs`。

---

## 5. 验证

- 每阶段末 `npm run check:circular -- --strict` 实测：**21（基线）→ 17（Phase 1）→ 15（Phase 3 类型下沉）→ 14（Phase 2 收尾）→ 12（Phase 4 AR）→ 11（Phase 4 outfit/motion）→ 10（收尾 scene→outfit 清零）**。
- 白名单：12 → **9**（3 个 `scene/env` 系白名单环被修复）。
- `tsc --noEmit` 零错误（每阶段）。
- `vitest` 相关模块全绿（motion-algos / action-registry / init / dev-hooks / outfit / model-manager / mmar-globals，core 全量 227 通过）。
- 剩余 10 环为合理保留（DEV-only / type-only / 动态惰性 / core 系结构性），见 §2.5 逐环定性。

---

## 6. 关联说明（对 ADR-236 的订正）

ADR-236 实施记录称「剩余 21 个新增环全部不含 render（属 motion-algos↔scene/motion↔menus↔core 等其他模块）」**与实测不符**：环 ① 明确含 `scene/render → scene/shared`，且其 `scene/shared → core` 边正是 ADR-236 Phase 1 把 `texture-lru` 下沉到 `scene/shared` 时引入（`scene/shared/texture-lru.ts → core/wails-bindings.ts`）——即 ADR-236 的修复**自身制造了环 ①**。本 ADR Phase 2（消除 `core→scene`）会一并消除环 ①。**ADR-236 已按此订正**（其 §实施记录已更新该行表述）。
