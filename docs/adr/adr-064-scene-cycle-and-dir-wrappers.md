# ADR-064: 技术债清偿（续）—— *Dir 包装维持现状 + scene.ts 业务循环依赖破除

> **状态**: 实施中（2026-07-08 起草并落地；build + tsc + 单测验证后定稿）
> **背景**: 承接 ADR-063 的架构债务清偿。ADR-063 §5.3 将 scene.ts 循环依赖暂标记为“可接受”，并预留“若积累更多循环依赖则引入 scene-context 模块”的退路。本轮排查确认存在两条**业务型**双向循环（scene↔outfit、scene↔model-preset），与 ADR-063 §4.3 纠结三所接受的 model-ops “barrel re-export 型”循环性质不同——这两条涉及运行时实参传递与函数体惰性调用，当前虽运行时无害，但属结构性坏味道，应破除。同时复盘 `*Dir` / `ensureDir` 包装，结论为“刻意设计、非债”。
> **关联**: ADR-063（架构债务清偿）、ADR-053（惰性 import 破环先例）、ADR-029（回调注入避免循环）

---

## 一、决策总览

| # | 决策 | 选项 | 最终选择 | 纠结度 |
|---|------|------|---------|--------|
| D1 | `*Dir()` 对 `ensureDir` 的重复包装是否重构 | A. 内联 `ensureDir` / B. 保留命名包装 | **B. 保留命名包装（刻意设计，非债）** | ⭐ |
| D2 | scene.ts 业务型双向循环依赖 | A. 接受（沿用 ADR-063 §5.3）/ B. 引入 scene-context 模块 / C. 动态 `import()` 破除 | **C. 动态 `import()` 破除（复用既有惯例）** | ⭐⭐ |

---

## 二、D1 — `*Dir()` 包装维持现状

### 2.1 事实

`internal/app/app.go` 中：
- `ensureDir(subDir, useCache)`（:497）是唯一原语：`CacheRoot/AppDataRoot` + `MkdirAll`。
- `configDir / extractedDir / thumbnailDir / softwareDir` 是 4 个一行透传 `return ensureDir(...)`。
- `settingDir(cfg)` 额外含 `ResourceRoot` 回退逻辑（合法差异，其 AppData 兜底已复用 `configDir()`）。

5 个包装**全部集中在 app.go**，无跨文件重复实现。“文件量多”的真实含义是**调用点**横跨 7 个 Go 文件（integration / model_preset / library / scene_preset / zipextract / thumbnail），约 13 处。

### 2.2 选项

#### 选项 A：内联 `ensureDir`

- 删除 4 个透传包装，调用点改为 `ensureDir("extracted", true)` 等字面量
- **代价**：动 7 个文件、13 处调用；语义丢失（"extracted" 是魔法字符串，无编译期保护）；`settingDir` 的特殊逻辑仍要保留 → 不一致

#### 选项 B：保留命名包装

- 包装是惯用 Go（语义化命名 + 稳定 API，避免裸字面量）
- `settingDir` 的差异逻辑证明其存在的正当性
- **代价**：几乎为零

### 2.3 决策

**保留命名包装，不重构。** 该结构属“刻意设计”而非失效重复；ROI 为负（减少 4 行声明，代价是动 7 文件、零收益）。此条从技术债 backlog 移出，标“已评估·维持现状”。

---

## 三、D2 — scene.ts 业务型循环依赖破除

### 3.1 事实（两条双向环）

**环 A** `scene.ts ↔ outfit/outfit.ts`
- `scene.ts`：`import { loadOutfits }`（:56）+ `export { loadOutfits, applyOutfitVariant, resetOutfit } from '../outfit/outfit'`（:418，静态 re-export 即静态边）
- `outfit.ts`：`import { scene, _catOf } from '../scene/scene'`（:15）
- `scene` 仅用于 outfit.ts:212/412 函数体内；`_catOf` 仅 :448 用 → 运行时无碍（live binding 惰性解引用）

**环 B** `scene.ts ↔ menus/model-preset.ts`
- `scene.ts`：`import { tryAutoApplyPreset }`（:64），在 `initLoader(..., tryAutoApplyPreset, ...)`（:229）作为实参传入
- `model-preset.ts`：`import { setModelPosition, ..., applyMatState } from '../scene/scene'`（:24）

与 ADR-063 §4.3 纠结三接受的 model-ops “barrel re-export 型”环不同：环 A/B 涉及**运行时实参传递**（initLoader 注入）与**函数体惰性调用**，是结构性耦合，应破除而非暂接受。

### 3.2 选项

#### 选项 A：接受（沿用 ADR-063 §5.3）

- 沿用“barrel re-export 型循环可接受”的立场
- **否决理由**：本轮确认的是业务型循环，与 §4.3 讨论的 barrel 型性质不同；若放任积累，scene.ts 作为编排器会越来越难独立测试与演进

#### 选项 B：引入 scene-context 模块

- 新建 `scene-context.ts` 持有共享实例（scene / modelManager），outfit / model-preset 从 context 取，彻底解耦
- **代价**：新模块 + 大量 import 改造；当前仅 2 条环，属过度设计

#### 选项 C：动态 `import()` 破除

- `scene.ts` 侧移除对 outfit / model-preset 的**静态** import 与静态 re-export，改为在 `initScene()`（`async`）内 `await import(...)`，复用 scene.ts:204 `import('./motion/wasm-layers-blender')` 与 ADR-053 的既有惰性 import 惯例
- `initLoader` 实参改用动态模块导出的函数
- **代价**：极小且局部

### 3.3 决策

**选项 C。** 理由：
1. **与既有惯例一致**——scene.ts:204 与 ADR-053 已用惰性 import 破环，本次同构
2. **改动局部、可逆**——删 2 个静态 import + 1 个静态 re-export，改 2 处 initLoader 实参；`main.ts` 仅改 1 处 import 源
3. **不动公共 API**——`initLoader` 签名不变；re-export 移除后，唯一经 scene.ts 取换装符号的消费者 `main.ts` 直取 `../outfit/outfit`（其余消费者 scene-serialize.ts / outfit-ui.ts / 各 test 早已直取）
4. **initScene 为 async**（:162），动态 import 合法；运行时 model-preset / outfit 的静态 `import '../scene/scene'` 解析到已加载的 scene 模块，无 TDZ、无环

### 3.4 最终方案（落地清单）

| 文件 | 改动 |
|------|------|
| `scene.ts` | ① 删 `import { loadOutfits } from '../outfit/outfit'`（:56）；② 删 `import { tryAutoApplyPreset } from '../menus/model-preset'`（:64）；③ 删静态 re-export `export { loadOutfits, applyOutfitVariant, resetOutfit } from '../outfit/outfit'`（:418）；④ `initScene` 内 `initLoader` 前 `const outfitMod = await import('../outfit/outfit'); const presetMod = await import('../menus/model-preset');`；⑤ `initLoader` 第 5 实参 `presetMod.tryAutoApplyPreset`、第 6 实参 `(id) => outfitMod.loadOutfits(id).then(() => {})` |
| `core/main.ts` | `applyOutfitVariant, loadOutfits` 的 import 源由 `../scene/scene` 改 `../outfit/outfit`（:46-47） |
| `outfit/outfit.ts` | `_catOf` 改从 `../scene/manager/material`（:224）直取，去掉经 scene.ts 的传递边（卫生项；`scene` 仍单向 import，符合 ADR-063 §4.3 既定模式） |

**残留说明**：outfit.ts 仍单向 `import { scene } from '../scene/scene'`，属 ADR-063 §4.3 接受的“子模块从 scene 取核心实例”模式，不构成环。彻底解耦（将 `scene` 单例迁 `core/config`）属更大重构，不在本轮范围。

**验证**：`npm run check`（tsc 零错）+ `npm run test` + `npm run build`。

---

## 四、经验教训

1. **“暂接受”的债要显式设触发条件**——ADR-063 §5.3 的“若积累更多循环依赖”正是本轮触发点；本次确认的新环性质不同（业务型 vs barrel 型），故升级为破除而非继续接受
2. **动态 import 是破环的最低成本武器**——当循环一端能在 async 初始化期内惰性获取，动态 import 比引入新模块或重构签名更优
3. **“重复包装”要先判断是否真债**——惯用命名包装 + 稳定 API 是设计选择，不应为“减少行数”牺牲调用点安全
