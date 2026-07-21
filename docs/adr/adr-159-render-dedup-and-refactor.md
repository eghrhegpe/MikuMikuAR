# ADR-159 渲染模块重复收口 + 关键补测 + 两项结构性重构决策

> **状态**: 已实施（Phase 1/2/P3-A/P3-B/P4 全部完成）
> **日期**: 2026-07-21
> **关联**: ADR-138（env-dispatcher 破循环依赖，回调注册范式）、ADR-148（overload 文件拆分）、ADR-152（舞台灯体积散射→光锥）、ADR-158（lighting 状态收口 P2-3）

## 背景

延续 ADR-158 对渲染管线（`scene/render/`）的审核，进一步做了「重复功能」交叉比对。结论：**无跨文件重复**（renderer/lighting/performance 职责边界清晰），但**文件内**有可收口的重复逻辑，且审核暴露两项结构性债务需单独决策：

1. **performance ↔ scene 循环依赖**（P2）：`performance.ts` 静态 `import { engine, setLightState, ... } from '../scene'`，而 `scene.ts` 又在渲染循环里调 `updatePerformance()`。运行时靠 ES module live binding + 函数体内访问不炸，但单测无法隔离——测 `performance.ts` 必然拉起 `scene.ts` 模块级 `new Scene()`。
2. **`lighting.ts` 1434 行巨兽**（P3）：主光 + 舞台灯 CRUD + 指示器 + 阴影生成器 + 太阳盘 + Tween + 预设，7 项职责挤一个文件。

## 建筑蓝图（结构总览）

作为建筑蓝图，本文把「已浇筑的墙」与「还在图纸上的承重梁」分层记录——前者是已验收落地的混凝土结构，后者是已设计、待施工的主体承重梁。

| Phase | 内容 | 状态 | 分层 |
|-------|------|------|------|
| 1 | 4 处文件内重复收口 + 附带隐患消除（DEV 守卫/GC/材质泄漏/skipAutoSave） | ✅ 已实施 | 🧱 已浇筑的墙 |
| 2 | 快照恢复 + 舞台灯生命周期补测（10 例）+ 测试范式沉淀 | ✅ 已实施 | 🧱 已浇筑的墙 |
| 3-A | performance→scene 静态重 import → 桥接注入（复用 ADR-138 延迟绑定范式） | ✅ 已实施 | 🧱 已浇筑的墙 |
| 3-B | lighting.ts（1434 行）按职责拆 5+1 文件（复用 ADR-148/158 barrel 范式 + 独立状态归属模块） | ✅ 已实施 | 🧱 已浇筑的墙 |

---

## 🧱 已浇筑的墙（Phase 1/2 已实施）

### Phase 1：文件内重复收口

| 位置 | 手法 | 效果 |
|------|------|------|
| `performance.ts` | 抽 `_restoreSnapshot(): boolean` | 快照恢复（提取→清空→抑制→应用→复位）从 2 份合 1 份，`applyDegrade` level=0 与 `resetPerformanceSnapshot` 共用；净减 ~30 行 |
| `renderer.ts` | `_applyRenderState` 复用 `rebuildOutlineState()` | 边缘高亮遍历不再两地维护；模块变量先行更新，重建应用完整当前状态，语义等价 |
| `lighting.ts` | 抽 `_disposeStageLightEntry(id, entry)` | 舞台灯释放（指示器+灯+阴影+光锥）统一，`removeStageLight`/`disposeLighting`/`loadStageLights` 三处共用 |
| `lighting.ts` | 抽 `_registerStageLight(id, entry)` | 舞台灯注册（写映射+阴影+光锥+指示器）统一，`addStageLight`/`loadStageLights`（2 处）共用 |

**豁免**：三处每帧时间进度样板（`transitionRenderState`/`transitionLighting`/`_tweenValue`）参数签名不同、语义独立，按 AGENTS.md「仅 2 处且语义独立可豁免」保留。

同时把 `performance.ts` 3 处 `console.info` 包 `import.meta.env.DEV` 守卫；`light-cone.ts` 每帧 `light.position.clone()` 改为复用模块级 `_tmpApex` 消除 GC 压力；`disposeLighting()` 显式重置 `_skipLightAutoSave`（防预设动画中途销毁导致自动保存永久失效）+ 太阳盘改走 `_disposeSunDisc()`（含材质释放，堵 StandardMaterial 泄漏）。

### Phase 2：关键补测

审核发现渲染模块 ~4300 行仅 62 行测试。针对 Phase 1 收口的两个高风险路径补测：

| 文件 | 覆盖对象 | 用例 | 关键断言 |
|------|---------|------|---------|
| `performance-snapshot.test.ts` | `_restoreSnapshot` | 4 | 回写瞬间抑制标志为 true（防「降级→恢复→再降级」反馈循环）；env 快照成对切换降级标志；无快照 no-op |
| `lighting-stage.test.ts` | `_registerStageLight`/`_disposeStageLightEntry` | 6 | NullEngine 真实驱动，`removeStageLight` 后断言 `light.isDisposed()` + `scene.lights` 计数减 1（真实释放配对，非泄漏） |

**测试范式沉淀**（供后续同类测试参考）：

1. `vi.mock` 工厂提升——引用外部 `const` 会「Cannot access before initialization」→ 用 `vi.hoisted()` 声明 spy。
2. 过度 mock `@/core/*` 会断掉 transitive 依赖（env-bridge→env-lighting 需 `clamp01`/`registerSetEnvState`）→ 一律 `importOriginal` 展开，只覆盖目标字段。
3. mock 路径须匹配解析结果：`performance.ts` 的 `'../scene'` 解析为 `src/scene/scene.ts`，从测试文件是 `'../../scene/scene'`，mock barrel `'../../scene'` 拦不住。
4. lighting 测试用 `NullEngine`（同 env-water/env-ground 套路），mock `./performance` 断开 scene 链 + 桩掉 gizmo/transform-adapter 聚焦生命周期。

---

## Phase 3 结构性重构（已实施 — 承重梁已浇筑）

> 以下两项主体重构均已完成施工，图纸已落地为混凝土结构，复用 ADR-138/148/158 既有范式推进。

### P3-A：performance → scene 静态重 import → 桥接注入（✅ 已实施，复用 ADR-138 延迟绑定范式）

**根因校正**：非双向循环，而是单向重 import——`scene.ts` 本身并不 import performance，但 `performance.ts` 静态 `import { engine, setLightState, ... } from '../scene'`，importing performance 即强制求值 `scene.ts`（`export let engine = new Engine()` / `export let scene = new Scene()`），单测无法隔离。

**决策落地**：采用 ADR-138「延迟绑定」范式的依赖注入变体，单向化为 `scene → performance`：

- 新增 `registerRenderBridge({ engine, setLightState, setRenderState, getLightState, getRenderState })`，由 `scene.ts` 在 `initScene()` 末尾注入（HMR 重入时 engine 已重建，每次重新注入最新引用）。
- `performance.ts` 内部以模块级函数变量持有 bridge 成员（`_bridgeEngine`/`_bridgeSetLightState`/…），未注册时为安全默认（`engine.getFps` 返回 0，`setXxx` 为 no-op），杜绝 bridge 未就绪调用崩溃。
- 删除 `performance.ts` 对 `'../scene'` 的全部值/类型 import；`LightState`/`RenderState` 类型改从同源 `./lighting`、`./renderer` 导入（type-only，零运行时耦合）。
- 渲染循环由 `core/render-loop.ts` 调 `updatePerformance()`，不依赖 scene 静态引用。

**收益**：单测可直接 `registerRenderBridge({ engine: { getFps: () => 60 }, setLightState: vi.fn(), ... })` 注入 mock，无需 mock 整个 `scene.ts` 模块（Phase 2 的 `'../../scene/scene'` 全量 stub 成为可删的权宜之计）。

**验证**：tsc 零新增错误；render/scene 单测无回归。

### P3-B：`lighting.ts`（1434 行）按职责拆分（✅ 已实施，复用 ADR-148/158 barrel 范式）

#### 前置：状态归属设计（✅ 已完成勘察）

拆分前必须先决定 27 处模块级状态的归属，否则拆完即「跨文件幽灵状态」。全量盘点：

| 类别 | 状态（行号） | 归属 |
|------|-------------|------|
| **共享上下文**（barrel 注入、`initLighting` 接收） | `_scene`(139)、`_modelRegistry`(140)、`_propRegistry`(141)、`_envSysShadow`(142)、`triggerAutoSave`(143) | → `lighting-state.ts` |
| **主光** | `_hemiLight`(145)、`_dirLight`(146) | → `lighting.ts`（主光管理） |
| **舞台灯** | `_stageLights`(164)、`_activeStageLightId`(165)、`_stageLightCounter`(166)、`_stageCones`(700)、`_coneUpdateHandle`(702)、`_CONE_UPDATE_KEYS`(189) | → `lighting-stage.ts` |
| **阴影配置 + 舞台阴影** | `_shadowEnabled`(168)、`_shadowType`(169)、`_shadowCascades`(170)、`_shadowResolution`(171)、`_shadowBias`(172)、`_SHADOW_REBUILD_KEYS`(182)、`_stageShadows`(697) | → `lighting-shadow.ts` |
| **太阳盘** | `_sunDisc`(173)、`SUN_DISC_DISTANCE`(208)、`SUN_DISC_MIN_INTENSITY`(211) | → `lighting-sun.ts` |
| **自动保存守卫** | `_skipLightAutoSave`(176) | → `lighting-state.ts`（被多职责共享写） |
| **Tween** | `_tweenIdCounter`(1221)、`_activeTweens`(1222) | → `lighting-tween.ts` |
| **临时向量** | `_tmpTarget`(313)、`_tmpDir`(314) | → `lighting.ts`（主光太阳定位用） |

**归属决策**：新建第 6 个文件 **`lighting-state.ts`** 作为**唯一可变状态所有者**，集中持有全量模块级可变状态（`_scene`/`_modelRegistry`/`_propRegistry`/`_envSysShadow`/`triggerAutoSave`/`_skipLightAutoSave` 及上述各分类状态），对外暴露 typed getter/setter；各子文件（含 barrel）一律 `import` 状态于 `lighting-state.ts`（单向：子文件 → lighting-state），函数级引用则按职责从兄弟子文件导入（不在模块求值期访问，循环依赖安全，同 ADR-158 `motion-popup`）。此方案彻底消除「跨文件幽灵状态」风险，符合 ADR-159 原风险注记的「独立 `lighting-state.ts`」建议。

**决策**：barrel re-export 保持 API 兼容（外部零改动），按职责拆为：

| 文件 | 预估行数 | 职责 |
|------|---------|------|
| `lighting.ts` | ~250 | barrel + `initLighting`/`disposeLighting` + 主光（hemi/dir）管理 + 临时向量 |
| `lighting-state.ts` | ~120 | **唯一可变状态所有者**：7 类模块级状态 + typed getter/setter |
| `lighting-stage.ts` | ~550 | 舞台灯 CRUD + 指示器 + `_registerStageLight`/`_disposeStageLightEntry` + 光锥 |
| `lighting-shadow.ts` | ~250 | 阴影配置 + 生成器（`_ensureStageShadow`/CSM）+ 投射者重建 |
| `lighting-sun.ts` | ~200 | 太阳盘可视化 + `_disposeSunDisc` |
| `lighting-tween.ts` | ~200 | 主光/舞台灯 Tween 动画 + 预设应用 |

子文件通过函数级引用互访（不在模块求值期访问），状态统一经 `lighting-state.ts` 单点读写，循环依赖安全，同 ADR-158 `motion-popup` 拆分。

**风险/成本**：中高。状态归属已设计（见上表），实施时须严格按表迁移，禁止在子文件新建等价模块级状态副本。**须先建 `lighting-state.ts` 再动刀拆子文件**，否则拆分即负债。

---

## 验证（Phase 1/2）

- tsc 零新增错误；eslint 零告警（prettier 修复 CRLF）
- 全量单测 **1786/1786 通过**（新增 10 例：4 快照 + 6 舞台灯，含 1 个 `saveCalls` 自动保存契约断言）
- 提交：`5480b351`（收口）、`3ac42ad3`（补测）

## 验证（P3-A / P3-B）

- **P3-A**（提交 `da1ad8c6`）：tsc 零新增错误；`performance-snapshot.test.ts` 移除对 `scene` 的全量 stub，改 `registerRenderBridge` 注入 mock，4/4 通过；render/scene 单测无回归。
- **P3-B**（提交 `db7126eb`）：tsc 零错误（含测试类型修复——`RenderState` 改从 `./renderer` 导入）；全量单测 **1786/1786 通过**（拆分零回归）；eslint 零告警（prettier `--fix` 清 39 处子代理生成遗留格式告警）。
- 拆分落地文件：`lighting.ts`（barrel + 主光 + init/dispose）、`lighting-state.ts`（唯一可变状态所有者）、`lighting-stage.ts`、`lighting-shadow.ts`、`lighting-sun.ts`、`lighting-tween.ts`。外部 API 经 `export *` barrel 零改动。

## 验证（P4：observer 泄漏排查 + refreshRate 兜底）

- **P4-A `transitionLighting` observer 泄漏**：根因——`animLoopObs` 为 `transitionLighting` 局部变量，仅动画自然结束（t≥1）时由闭包自移除；**重入不取消旧 observer**（重复调用堆叠多个渲染循环 observer、并发打架）、**`disposeLighting()` 不跟踪它**（场景中途销毁后 observer 滞留旧 scene）。修复：在 `lightingState` 新增 `activeTransitionObs` 句柄；`transitionLighting` 入口先 `dispose` 在途动画；`animLoop` 加防御性 guard（scene/主光已销毁即退出并移除 observer）；`disposeLighting` 显式 `dispose` 并在途 observer。彻底消除泄漏与并发。
- **P4-B `refreshRate` 非标准 API 兜底**：`detectRefreshRate()` 原用 `as unknown as` 裸 cast 读取非标准 `screen.refreshRate`，缺异常防护。改为 `ScreenWithRefreshRate` 类型化安全读取 + `try/catch`，缺失/非有限正数/访问异常时回退 60Hz（RSCALE=1，行为与历史零回归），补文档说明非标准性。
- 验证：改动文件（lighting.ts/lighting-state.ts/performance.ts）tsc 零错误、eslint 零告警；P4 相关单测 `performance-snapshot(4)` + `env-lighting(22)` + `lighting-stage(6)` = **32/32 通过**。
- 注意：全量单测 68 失败 / 12 失败套件为独立问题——`src/scene/env/env-water.ts` 存在用户未提交的 Ground Ripples WIP（line 329 `new import('@babylonjs/core').Texture(...)` 非法语法），级联拖垮整个 env/asset 子系统。该 WIP 非 P4 范围，P4 改动本身隔离无回归。

## 待办

| 优先级 | 项 | 状态 |
|--------|----|----|
| P2 | P3-A performance→scene 桥接注入 | ✅ 已实施 |
| P3 | P3-B lighting.ts 拆分（6 文件落地：lighting-state + barrel + stage + shadow + sun + tween） | ✅ 已实施 |
| P4 | `transitionLighting` observer 泄漏排查 + `refreshRate` 非标准 API 兜底 | ✅ 已实施 |
