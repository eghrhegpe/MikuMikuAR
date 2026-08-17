# ADR-272: 状态路径类型化：把「schema 与菜单 bind 必须同步」交给编译器

> **状态**: ✅ 已采纳（2026-10-24）
> **日期**: 2026-10-24

## 背景

### 一个 0 号指标量不出来的耦合

`node scripts/check-coupling.mjs` 只看 import 边。但菜单的 `control: { bind: 'env.waterLevel' }` 是**字符串**，它和 `ENV_STATE_SCHEMA` 的键之间没有任何静态关系。这意味着：

- schema 里把 `waterLevel` 改名成 `waterSurfaceHeight` → 菜单这一行照旧编译通过，运行时 `envState['waterLevel']` 是 `undefined`，**滑块拖了没反应**；
- schema 里删掉一个键 → 菜单成了悬空绑定，`tsc` 不报、`vitest` 不报、`check:coupling` 不报。

2026-10-24 的变更耦合（co-change）审计把这类耦合量化出来了：在全历史 2952 次提交里，`core/env-state-schema.ts` 与 `menus/env-water-levels.ts` 共同变更 9 次（lift 34）、与 `env-ground-levels.ts` 6 次（lift 33）、与 `scene/env/env-lighting.ts` 8 次（lift 24）——**Top50 共现文件对里 70% 在静态 import 图上完全没有边**。加一个环境字段要同时改 schema、`EnvState`、菜单节点、i18n 四处，就是这条「镜像耦合」在历史里的显影。

### 最后一段路本来只差类型

`EnvState` 不是手写的，它**已经**从 schema 派生：

```ts
// frontend/src/core/types.ts:548
export type EnvState = {
  -readonly [K in keyof EnvStateSchema]: SchemaToTSType<EnvStateSchema[K]>;
};
```

状态侧的单一时真源早就有了，缺的只是把菜单的字符串 `bind` 接上去。

## 决策

### 1. `StatePath` 的每个前缀都从各自的 state 类型派生

`frontend/src/scene/shared/menu-node-types.ts`（零运行时依赖的类型叶）：

```ts
import type { EnvStateSchema } from "@/core/env-state-schema";
import type { UIState } from "@/core/types";
import type { RenderState } from "@/scene/render/renderer";
import type { LightState } from "@/scene/render/lighting-stage-types";
import type { PerceptionState } from "@/scene/motion/perception-shared";
import type { MotionModuleStatePath } from "@/scene/motion/motion-modules/module-param-keys";

export type EnvStateKey = keyof EnvStateSchema & string;
export type RenderStateKey = keyof RenderState & string;
export type LightStateKey = keyof LightState & string;
export type UIStateKey = keyof UIState & string;
export type PerceptionStateKey = keyof PerceptionState & string;
export type PerceptionVirtualKey = "allEnabled";

export type StatePath =
  | `env.${EnvStateKey}`
  | `render.${RenderStateKey}`
  | `light.${LightStateKey}`
  | `ui.${UIStateKey}`
  | `perception.${PerceptionStateKey | PerceptionVirtualKey}`
  | MotionModuleStatePath;
```

前缀与 `menus/menu-schema.ts:36` 的 `getStateValue` 映射一一对应（env→`envState`、render→`getRenderState()`、light→`getLightState()`、ui→`uiState`、perception→`getPerceptionState()`）。全部 type-only 引用，**不产生任何运行时边**，`scanSourceGraph` 的 typeOnly 过滤会让它继续视而不见（`check:coupling` 维持 62 模块对 / 4 SCC / 8 文件 / max 2 不变）。

### 2. `LightState` 下移到 `lighting-stage-types.ts` 叶子

`light.` 前缀的可绑定视图是 `getLightState(): LightState`（`frontend/src/scene/render/lighting.ts:194`），而 `LightState` 原本定义在这个 538 行的模块里。若直接从 `lighting.ts` 引类型，会把整条渲染链的类型图拖进每个菜单文件的检查；因此把 `LightState`（13 个字段，纯数据形状）与已有的 `StageLightState`/`StageLightType` 一起放进 `frontend/src/scene/render/lighting-stage-types.ts`，`lighting.ts` 用 `import` + `export` 两行保持既有导入路径兼容。

### 3. `motionModule.` 的「两段动态」是误判，实际可静态化

第一版把它留成了 `motionModule.${string}`，理由是「模块 id 与参数键都由运行时决定」。**这个判断是错的**：24 处 bind 全部是模板拼接，模块 id 是 `const` 字面量（`const MODULE_ID = 'body-posture'`）或工厂里的窄联合（`cfg.moduleId: HandModuleId`），参数键是裸字面量。退化只发生在「拼接结果」这一层，而 TS 对模板字面量类型会**按联合分布展开**：

```ts
export type MotionModuleStatePath = {
  [K in MotionModuleId]: `motionModule.${K}.${MotionModuleParamKeys[K]}`;
}[MotionModuleId];
```

配套三个前提，缺一个都会漏：

1. **参数键必须有一份可被编译器核对的声明**（`frontend/src/scene/motion/motion-modules/module-param-keys.ts`，纯类型叶、零 import）。这是本 ADR 唯一新增的类型面。
2. **这份声明不是第四份镜像**：各模块的 `DEFAULTS` 改成 `const DEFAULTS = { ... } satisfies Record<XxxParamKey, ParamValue>`，键集与类型声明**双向**对齐——多一个键（无默认值 → 运行时 `undefined`）、少一个键（菜单 bind 到不存在的参数）都编译失败。镜像被钉在运行时真源上，而不是靠人记得同步。
3. **工厂里的 `moduleId: string` 要收窄成 `'left-hand' | 'right-hand'`**（foot 同理），否则模板拼接退回 `string`，左右手/足两条路径的 bind 不受检。

分布展开而非笛卡尔积（`${MotionModuleId}.${AllParamKeys}`）：错配组合如 `motionModule.riding-model.handPosX` 不会混进合法集合，实测该写法会报 TS2820。

同理 `perception.allEnabled` 仍是虚拟路径（见下）。

## 备选方案

**A. 从 schema 生成整个菜单节点** — 否决。9 个 `env-*-levels.ts` 共 2134 行、130 个节点，其中 `slider:77 / colorSlider:12 / modeSlider:5 / toggle:6` 是叶子控件，但还有 `folder:18 / custom:10 / sectionTitle:2` 的结构与预设/预览/联动逻辑（`renderCustom:12`、`headerToggle:9`、`get:17`、`set:6`、`onChange:1`）。而且每个键在菜单里**本来就只声明一次**——生成并不会消掉重复，只会把 2134 行手工排序的结构换成生成器的配置。收益（新增字段少改一个文件）不足以补偿一次 2000 行的迁移风险。

**B. 写脚本做 parity 检查（schema 键 ⇄ bind 键）** — 否决，且已审计。150 个 schema 键里 110 个被字符串 `bind` 覆盖，剩下 40 个抽查后确认**不是「漏写的 UI」**：它们走的是第二种绑定方式——`kind: 'custom'` 节点里直接读写 `envState`，本来就是类型化的：

| 键                                                      | 实际入口                                       | 形态                                                                                     |
| ------------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `cloudEnabled` / `fogEnabled` / `particleEnabled`       | `menus/env-menu.ts:156-158` 主开关行           | custom 节点，`bind: () => envState.cloudEnabled` + `onChange: (v) => setEnvState({...})` |
| `skyTexture` / `starsTexture` / `particleCustomTexture` | `menus/env-sky-levels.ts:86-94` 贴图选择器     | custom 节点，读 `envState.skyTexture` 后调 `openTexturePicker`                           |
| `waterEnabled` / `reflectionMode` / `mirrorWidth`       | `menus/scene-menu.ts:124/164/272` 镜像与反射组 | `modeSlider` + custom，直接读 `envState.reflectionMode`                                  |
| `groundTextureScale` / `groundProceduralSeed` 等 12 个  | `scene/env/env-ground-presets.ts`              | 只由预设写入，UI 入口是预设芯片                                                          |

因此「必须配一张 40 条豁免清单」的 parity 门禁没有必要：**custom 节点访问的是 `envState.X`，`EnvState` 已经由 schema 派生，改名本来就编译失败**。真正的风险面只有字符串 `bind`，而它已被本 ADR 类型化——一条清单都不用加。

**C. 保留 string，运行时校验** — 否决。运行时断言在生产构建里要么被裁掉（等于没有），要么在拖滑块时才炸（比编译期晚几个小时，且只在被点到的路径上暴露）。

## 影响

### 改动文件

| 文件                                                                                                | 改动                                                                                                                                             |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `frontend/src/scene/shared/menu-node-types.ts`                                                      | `StatePath` 六个前缀类型化 + 5 个 key 类型导出 + `PerceptionVirtualKey`                                                                          |
| `frontend/src/scene/motion/motion-modules/module-param-keys.ts`                                     | 新增类型叶：6 个模块 id × 参数键的字面量联合 + `MotionModuleStatePath`（分布展开）                                                               |
| `frontend/src/scene/motion/motion-modules/{body-posture,riding-model,hand-modules,foot-modules}.ts` | `DEFAULTS` 改 `satisfies` 双向校验；hand/foot 的 `moduleId` 从 `string` 收窄为左右联合；body/riding 的 `buildSchema` 补返回类型（见实测第 3 条） |
| `frontend/src/scene/render/lighting-stage-types.ts`                                                 | 新增 `LightState`（13 字段，纯类型）                                                                                                             |
| `frontend/src/scene/render/lighting.ts`                                                             | 删除本地 `LightState` 定义，改 import + re-export                                                                                                |

### 实测

- `npx tsc --noEmit -p tsconfig.json`（在 `frontend/` 下）**EXIT=0**，105 处 `bind` 全部通过。
- 破坏验证（证明门是活的）：把 `frontend/src/menus/env-water-levels.ts:70` 的 `bind: 'env.waterLevel'` 改成 `'env.waterLevelX'` → `error TS2820: Type '"env.waterLevelX"' is not assignable to type 'StatePath'. Did you mean '"env.waterLevel"'?`；把 `frontend/src/menus/env-sky-levels.ts:133` 的 `'light.dirIntensity'` 改成 `'light.dirIntensityZZ'` → 同样 TS2820。改回即 EXIT=0。
- `npm run test:quick` 262 files / **6071 tests passed**。
- `check:coupling` 62 / 4 SCC / 8 文件 / max 2（不变）；`check-deadcode-baseline` 38 / 17 / 1（不变）；`check:circular --strict` EXIT=0。
- **24 处 `motionModule.` bind 破坏验证（第二阶段）**：body-posture `tilt`→`tiltX`、riding-model `pedalSpeed`→`pedalSpeedX`、hand `fingerIntensity`→`fingerIntensityX`（左右手联合）、foot `footPosX`→`footPosXX`（左右足联合）、前缀 `motionModule`→`motionmodule`、跨模块错配（body-posture 里写 `handPosX`）——六种全部 EXIT≠0，改回 EXIT=0。
- **诊断质量是门禁的一部分**：body-posture / riding-model 的 `buildSchema: () => { return [...] }` 原本没有返回类型，数组字面量拿不到上下文类型，于是整个函数被推断成巨型联合，tsc 只在「函数不是 `() => MenuNode[]`」上报 TS2322，既指不出是哪个滑块、也没有 `Did you mean`。补上 `(): MenuNode[] =>` 之后同一处错误变成 TS2820 + `Did you mean '"motionModule.body-posture.tilt"'?`。**报错能否定位到犯错的那一行，决定这个门禁有没有人愿意用。**

### 顺带查清的三件事

1. **`light.dirIntensity` 不是悬空绑定**。它指向 `getLightState()` 返回的 `LightState`，只是原先那个类型定义在 `lighting.ts` 里、且 `StatePath` 是 `light.${string}` 所以从没被校验过。这类「存在但未被校验」的绑定正是本次收紧的价值面——它此前既不能证明对，也不能证明错。
2. **`perception.allEnabled` 是虚拟路径，不是 bug**。`frontend/src/menus/motion-gaze-levels.ts:59-72` 的「全员感知开关」节点，`get: () => isAllPerceptionEnabled()`、`set: (v) => enableAllPerception()/disableAllPerception()`，状态对象上根本没有这个键。所以显式引入 `PerceptionVirtualKey = 'allEnabled'` 并在类型注释里点名它的出处，而不是把 `perception.` 整个前缀退回 `string`——**保留其余 21 个 perception 键的校验，同时让唯一的例外可见**。
3. **仓库有两套绑定风格，风险面只在字符串那套**。声明式节点用 `bind: 'env.X'`（本次已类型化）；`kind: 'custom'` 节点用函数 `bind: () => envState.X` + `onChange`，直接访问类型化的 `envState`——schema 改名时它们本来就会编译失败。40 个「未被字符串 bind 覆盖」的 schema 键全部落在第二套或预设里（明细见备选 B 的表），因此没有遗留的静默失败面。

### 未做

- `state.params.<key>` 的**读取侧**仍未类型化：`getModuleState(...).params` 是 `Record<string, ParamValue>`（`module-base.ts:125`），只有 `DEFAULTS` 与 bind 受检，读参数时手滑写 `params.til` 仍不报错。要把这条也收掉，需要给每个模块的 params 读加键参数类型，属另一轮（届时 `module-param-keys.ts` 会顺带成为读取侧的真源）。
- 40 个未被字符串 `bind` 覆盖的 schema 键已审计归因（custom 节点 / 预设驱动），未做「每个键都必须被绑定」的门禁——理由见备选 B。
- 五个前缀的破坏验证已全部跑过（`env` / `light` / `ui` / `render` / `perception` 各一处，改坏后均 `TS2820` + EXIT=2，改回 EXIT=0）。

## 相关文档

> ADR-271（文件级 SCC 拆分）/ ADR-238（类型叶下沉与「消除依赖本身」）/ ADR-268（环门禁接线与白名单抗漂移）/ `frontend/src/scene/shared/menu-node-types.ts` / `frontend/src/core/env-state-schema.ts` / `frontend/src/menus/menu-schema.ts:36` / `frontend/src/menus/env-sky-levels.ts:133` / `frontend/src/scene/motion/motion-modules/module-param-keys.ts` / `frontend/src/menus/motion-gaze-levels.ts:59-72`
