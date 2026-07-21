# ADR-159 渲染模块重复收口 + 关键补测 + 两项结构性重构决策

> **状态**: 部分实现（Phase 1/2 已实施；Phase 3 两项结构性重构规划中）
> **日期**: 2026-07-21
> **关联**: ADR-138（env-dispatcher 破循环依赖，回调注册范式）、ADR-148（overload 文件拆分）、ADR-152（舞台灯体积散射→光锥）、ADR-158（lighting 状态收口 P2-3）

## 背景

延续 ADR-158 对渲染管线（`scene/render/`）的审核，进一步做了「重复功能」交叉比对。结论：**无跨文件重复**（renderer/lighting/performance 职责边界清晰），但**文件内**有可收口的重复逻辑，且审核暴露两项结构性债务需单独决策：

1. **performance ↔ scene 循环依赖**（P2）：`performance.ts` 静态 `import { engine, setLightState, ... } from '../scene'`，而 `scene.ts` 又在渲染循环里调 `updatePerformance()`。运行时靠 ES module live binding + 函数体内访问不炸，但单测无法隔离——测 `performance.ts` 必然拉起 `scene.ts` 模块级 `new Scene()`。
2. **`lighting.ts` 1434 行巨兽**（P3）：主光 + 舞台灯 CRUD + 指示器 + 阴影生成器 + 太阳盘 + Tween + 预设，7 项职责挤一个文件。

## 决策

### Phase 1：文件内重复收口（已实施）

| 位置 | 手法 | 效果 |
|------|------|------|
| `performance.ts` | 抽 `_restoreSnapshot(): boolean` | 快照恢复（提取→清空→抑制→应用→复位）从 2 份合 1 份，`applyDegrade` level=0 与 `resetPerformanceSnapshot` 共用；净减 ~30 行 |
| `renderer.ts` | `_applyRenderState` 复用 `rebuildOutlineState()` | 边缘高亮遍历不再两地维护；模块变量先行更新，重建应用完整当前状态，语义等价 |
| `lighting.ts` | 抽 `_disposeStageLightEntry(id, entry)` | 舞台灯释放（指示器+灯+阴影+光锥）统一，`removeStageLight`/`disposeLighting`/`loadStageLights` 三处共用 |
| `lighting.ts` | 抽 `_registerStageLight(id, entry)` | 舞台灯注册（写映射+阴影+光锥+指示器）统一，`addStageLight`/`loadStageLights`（2 处）共用 |

**豁免**：三处每帧时间进度样板（`transitionRenderState`/`transitionLighting`/`_tweenValue`）参数签名不同、语义独立，按 AGENTS.md「仅 2 处且语义独立可豁免」保留。

同时把 `performance.ts` 3 处 `console.info` 包 `import.meta.env.DEV` 守卫；`light-cone.ts` 每帧 `light.position.clone()` 改为复用模块级 `_tmpApex` 消除 GC 压力；`disposeLighting()` 显式重置 `_skipLightAutoSave`（防预设动画中途销毁导致自动保存永久失效）+ 太阳盘改走 `_disposeSunDisc()`（含材质释放，堵 StandardMaterial 泄漏）。

### Phase 2：关键补测（已实施）

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

### Phase 3：两项结构性重构（规划中）

#### P3-A：performance ↔ scene 循环依赖 → 回调注册（复用 ADR-138 范式）

**现状**：`performance.ts` 静态导入 `scene.ts` 的 `engine`/`setLightState`/`setRenderState`/`getLightState`/`getRenderState`；`scene.ts` 渲染循环调 `updatePerformance()`。

**决策**：沿用 ADR-138 已验证的「延迟绑定」范式，方向单向化为 `scene → performance`：

- 新增 `registerRenderBridge({ engine, setLightState, setRenderState, getLightState, getRenderState })`，由 `scene.ts` 初始化时注入。
- `performance.ts` 内部持有 bridge 引用，删除对 `'../scene'` 的静态 import。
- `scene.ts` 保持调 `updatePerformance()`（单向依赖，无环）。

**收益**：单测可直接注入 mock bridge，无需 mock 整个 `scene.ts` 模块（Phase 2 的 `'../../scene/scene'` 全量 stub 是权宜之计，此后可删）。

**风险/成本**：中。`performance.ts` 6 处 `../scene` 引用点改为 bridge 字段访问；`scene.ts` 初始化时序需保证 bridge 在首帧 `updatePerformance()` 前注册（参照 ADR-138 「dispatcher 注册完成后才可 setEnvState」）。

#### P3-B：`lighting.ts`（1434 行）按职责拆分（复用 ADR-148/158 barrel 范式）

**决策**：barrel re-export 保持 API 兼容（外部零改动），按职责拆为：

| 文件 | 预估行数 | 职责 |
|------|---------|------|
| `lighting.ts` | ~250 | barrel + `initLighting`/`disposeLighting` + 主光（hemi/dir）管理 |
| `lighting-stage.ts` | ~550 | 舞台灯 CRUD + 指示器 + `_registerStageLight`/`_disposeStageLightEntry` |
| `lighting-shadow.ts` | ~250 | 阴影生成器（`_ensureStageShadow`/CSM）+ 投射者重建 |
| `lighting-sun.ts` | ~200 | 太阳盘可视化 + `_disposeSunDisc` |
| `lighting-tween.ts` | ~200 | 主光/舞台灯 Tween 动画 + 预设应用 |

子文件通过函数级引用互访（不在模块求值期访问），循环依赖安全，同 ADR-158 `motion-popup` 拆分。

**风险/成本**：中高。舞台灯与阴影/光锥/太阳盘共享大量模块级状态（`_stageLights`/`_stageShadows`/`_stageCones`/`_scene`），拆分需先决定状态归属——建议状态留在 barrel 或独立 `lighting-state.ts`，子模块通过 getter 访问，避免拆完变成「跨文件幽灵状态」。**须在实施前先做状态归属设计**，否则拆分即负债。

## 验证（Phase 1/2）

- tsc 零新增错误；eslint 零告警（prettier 修复 CRLF）
- 全量单测 **1786/1786 通过**（新增 10 例：4 快照 + 6 舞台灯，含 1 个 `saveCalls` 自动保存契约断言）
- 提交：`5480b351`（收口）、`3ac42ad3`（补测）

## 待办

| 优先级 | 项 | 状态 |
|--------|----|----|
| P2 | P3-A performance↔scene 循环依赖回调化 | 规划中 |
| P3 | P3-B lighting.ts 拆分（须先做状态归属设计） | 规划中 |
| P4 | `transitionLighting` observer 泄漏排查、`refreshRate` 非标准 API 兜底 | 未处理（ADR-158 遗留同批） |
