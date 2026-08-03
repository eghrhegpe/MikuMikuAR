# ADR-238: 循环依赖消解第二期 —— core→scene 根环与 motion/outfit 互依赖拆解

> **状态**: 📝 规划（2026-08-03 由 `check:circular --strict` 实测 21 个新增环立项；ADR-236 Phase 1 已解 render↔manager，本 ADR 承接其余 21 环）
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

21 个新增环（`check:circular --strict` 实测）：

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

35 条 `core → scene*` 边按文件聚类（脚本实测）：

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

### 1.2 根因二：`motion-algos → scene/motion` 单边（仅 1 条，且为 type-only）

```
motion-algos/footstep-detect-fallback.ts:23  →  import type { FootLandEvent } from '@/scene/motion/feet-adjustment'
```

仅 **1 条边**即形成 11 个环的「枢纽」：所有形如 `scene → motion-algos → scene/motion → … → scene` 的环（③⑤⑨⑪⑬⑭⑮⑯⑱⑲㉑，共 11 个）都必经 `motion-algos → scene/motion`。且它是 `import type`（运行期无代价，仅编译期成环），**拆解成本极低**。

### 1.3 根因三：`scene/manager ↔ outfit` 双向 2-环（2 条边）

```
scene/manager/model-manager.ts:30  →  import { disposeOverlay, restoreMaterials } from '@/outfit/outfit-overlay'
scene/manager/model-ops.ts:22      →  import { disposeAudio } from '@/outfit/audio'
outfit/outfit.ts:?                  →  import { _catOf } from '../scene/manager/material'   (反向边)
```

`scene/manager` 与 `outfit` 互相 import，构成环 ⑩，且不依赖 `core→scene`／`motion-algos→scene/motion`，须独立拆解。

### 1.4 分解结论（可逐步验证）

| 阶段 | 切断的边 | 消灭的环 | 边数 |
|------|----------|----------|------|
| Phase 1 | `core → scene`（根因一） | ①②⑥⑦⑧⑫⑰⑳（纯 core 抵达类） | 35 |
| Phase 2 | `motion-algos → scene/motion`（根因二） | ③⑤⑨⑪⑬⑭⑮⑯⑱⑲㉑（含 type-only 枢纽） | 1 |
| Phase 3 | `scene/manager ↔ outfit`（根因三） | ⑩ | 2（双向） |
| **合计** | | **21 → 0** | **38** |

> 注：环 ② 同时含 `core→scene` 与 `motion-algos→scene/motion`，任一阶段即可消除；上表按「首个命中阶段」归类，不重复计。

---

## 2. 决策：三阶段拆解，按 ROI 排序

### Phase 2（先做，最快解 CI 阻断）— 切断 `motion-algos → scene/motion` 的 type-only 边

- **目标**：1 条边 → 消灭 11 环。
- **拆法**：`FootLandEvent` 类型从 `scene/motion/feet-adjustment.ts` 下沉到共享叶（二选一，按零依赖原则）：
  - `motion-algos` 内部新增 `feet-event.ts`（纯类型，无 scene 依赖），`feet-adjustment.ts` 与 `footstep-detect-fallback.ts` 均从这里 import；或
  - 并入既有 `scene/shared/` 叶（与 ADR-236 `texture-lru` 同层）。
- **风险**：极低——`import type` 仅编译期，重定位后运行期行为零变化；`footstep-detect-fallback` 仅消费类型。
- **验证**：`check:circular --strict` 应剩 **10 环**（①及 core 类 9 + ⑩）；`tsc --noEmit` + `vitest run motion-algos`。

### Phase 1（结构根治）— 解构 `core → scene` 白名单根环（35 条边）

- **目标**：消除 `core` 对 `scene` 的全部依赖，使 `core` 回归叶子；消灭 9 环，并顺带令 12 个白名单历史环（含 `core→scene→core` 等）一并消失，可收紧白名单。
- **拆法（依赖反转 + 注入，不动运行期行为）**：
  1. **动作定义迁移（13 条边，最大簇）**：`core/action-defs/*` 与 `core/ai/action-registry-defs.ts` 改为——core 只定义「动作 id / handler 类型 / 注册表接口（`registerAction(id, handler)` + `ActionContext`）」；scene 侧各模块在 bootstrap 时注册 handler（handler 内部 import scene 符号）。迁移后 `core/action-defs` 不再 import `scene/*`。
  2. **启动/调试/事件层 DI（其余 22 条边）**：`core/init.ts`、`dev-hooks.ts`、`events.ts`、`render-loop.ts`、`load-manager.ts`、`mmar-globals.ts`、`shortcut-app.ts`、`shortcut-app.ts` 对 `scene` 单例的 import，改为由 scene 层在启动时**把实例/回调注入 core**（构造函数参数 / setter / 事件订阅），core 只持接口或 `unknown` 句柄。
- **风险**：中——涉及启动链路（`init.ts`/`dev-hooks.ts`/`render-loop.ts`）与动作分发，须保证注入时序与 ADR-236「改前先 commit、独立 commit」纪律；参照 `texture-lru` 下沉先例。
- **验证**：`check:circular --strict` 应剩 **1 环**（⑩）；`tsc --noEmit` + `vitest`（init / dev-hooks / action-registry 相关 4 文件全绿）。

### Phase 3（收尾）— 解 `scene/manager ↔ outfit` 2-环（2 条边）

- **目标**：消灭最后 1 环 ⑩。
- **拆法**：
  - `scene/manager → outfit`：`model-manager.ts:30`（`disposeOverlay/restoreMaterials`）、`model-ops.ts:22`（`disposeAudio`）——这些是「卸载模型时清理 outfit」的副作用，改为经 **事件/回调注入**：`scene/manager` 在模型卸载时派发事件，`outfit` 自行监听清理；或把 `outfit-overlay/audio` 的清理函数下沉到 `scene/shared` 叶供 manager 调用（纯函数、无 outfit 反向依赖）。
  - `outfit → scene/manager`：`outfit/outfit.ts` import `_catOf from '../scene/manager/material'`——把 `_catOf` 纯函数下沉到 `scene/shared/material-cat.ts`，两侧均引用下沉模块，切断互引。
- **风险**：低——清理/分类函数纯函数化，无状态耦合。
- **验证**：`check:circular --strict` → **0 环**。

### 收尾（三阶段全完成后）

1. `node scripts/check-circular.mjs --update-allowlist` 收紧白名单（core→scene 等历史环一并消失）。
2. `package.json`：将 `check:circular --strict` 挂入 `check:docs` 链（ADR-236 已注明「待整体环归零后转正」——本 ADR 完成后达标）。
3. 顺序纪律：每阶段独立 commit，`tsc --noEmit` + `vitest` 全绿后再进下一阶段；用 `npm run codemod move-function`（AST 感知）移函数，禁 Python re.sub（AGENTS.md）。

---

## 3. 备选方案

| 方案 | 评估 |
|------|------|
| A. 仅 `--update-allowlist` 吞掉 21 环 | ❌ 掩盖真实互依赖（恰是 `core→scene` 根环使 447 条 `menus→core` 全成环），门禁失效、运行时初始化顺序隐患照旧——ADR-236 已定性「不吞白名单」|
| B. 只做 Phase 2（1 条边）不碰 core→scene | ⚠️ 可立刻把 21→10、解大部分 CI 阻断，但留下 `core→scene` 根环（9 环）未治，白名单继续掩盖结构性债务；作为**过渡**可接受，不作为终点 |
| C. 全量重构（一次性拆 38 边） | ❌ 改动面过大、回归风险高；违背「小步验证、每阶段可回滚」纪律 |
| **D. 三阶段（本 ADR，采纳）** | ✅ Phase 2 秒级解 CI + Phase 1 结构根治 + Phase 3 收尾，每阶段有 `check:circular` 硬验证 |

---

## 4. 影响

- `core/action-defs/*`、`core/ai/action-registry-defs.ts`：改为注册表模式，scene 侧注册 handler。
- `core/init.ts`、`dev-hooks.ts`、`events.ts`、`render-loop.ts`、`load-manager.ts`、`mmar-globals.ts`、`shortcut-app.ts`：scene 实例/回调注入，不再 import scene。
- `motion-algos/footstep-detect-fallback.ts` + `scene/motion/feet-adjustment.ts`：`FootLandEvent` 类型下沉共享叶。
- `scene/manager/{model-manager,model-ops}.ts`、`outfit/{outfit,outfit-overlay,audio}.ts`、`scene/manager/material.ts`：清理/分类函数下沉 `scene/shared` 或事件化。
- `scripts/circular-allowlist.json`：环归零后清理。
- `package.json`：`check:circular --strict` 挂入 `check:docs`。
- 回归：`tsc --noEmit`、`vitest` 全量、`check:docs`。

---

## 5. 验证

- 每阶段末：`npm run check:circular -- --strict` 环数分别降至 **10 → 1 → 0**。
- `tsc --noEmit` 零错误（每阶段）。
- `vitest` 相关模块全绿（motion-algos / action-registry / init / dev-hooks / outfit / model-manager）。
- 全量归零后：`--update-allowlist` + `check:docs` 链含 `check:circular --strict` exit 0。

---

## 6. 关联说明（对 ADR-236 的订正）

ADR-236 实施记录称「剩余 21 个新增环全部不含 render（属 motion-algos↔scene/motion↔menus↔core 等其他模块）」**与实测不符**：环 ① 明确含 `scene/render → scene/shared`，且其 `scene/shared → core` 边正是 ADR-236 Phase 1 把 `texture-lru` 下沉到 `scene/shared` 时引入（`scene/shared/texture-lru.ts → core/wails-bindings.ts`）——即 ADR-236 的修复**自身制造了环 ①**。本 ADR Phase 1（消除 `core→scene`）会一并消除环 ①。建议同步订正 ADR-236 实施记录该行表述。
