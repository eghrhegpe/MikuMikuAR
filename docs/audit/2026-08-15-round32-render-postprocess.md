# [render-postprocess] 测试与纯函数层审核 — 第 32 轮

## 审核范围

**测试文件：** `frontend/src/__tests__/render-postprocess.test.ts`（269 行，38 用例，全部通过，0 跳过）

**被测源码（只读，未修改）：**
- `frontend/src/scene/render/renderer.ts` — 纯函数部分
  - `:28-32` `ToneMappingMode` 常量
  - `:36-77` `RenderState` 接口
  - `:234-269` `defaultRenderState()`
  - 参照：`:192-226` `getRenderState()` 的 `?? fallback` 默认值、`:309-327` `_applyRenderState` clamp 范围
- `frontend/src/scene/camera/camera-state.ts` — FOV 状态层
  - `:95-113` `DEFAULT_CAMERA_STATE` / `_fov`
  - `:215-221` `getFov` / `setFov`
  - `:370-388` `resetCameraState()`
- 参照（非本次直接被测，用于核实测试注释与分工）：`frontend/src/menus/scene-render-presets.ts:35-146`（`FILTER_PRESETS`）、`frontend/src/scene/camera/camera.ts:280-286,342-346`（`clampFov` / 相机层 `setFov`）、`frontend/src/__tests__/menu-schema.integrity.test.ts:140`（`RENDER_KEYS` 预设完整性护栏）、`frontend/src/__tests__/camera.test.ts:933-971`

**验证：** `npm run test -- src/__tests__/render-postprocess.test.ts` → 38/38 通过（3.66s）；`npm run check`（tsc + i18n）→ exit 0 通过。

## 总体结论

✅ **通过** — 测试断言有效、范围与生产 clamp 逐一交叉一致、FOV 分工清晰无重复；生产代码纯函数层类型安全（0 处 `as any`/`@ts-ignore`）、无资源与异常问题（本层无 `new`/Observer，`_fov` 无并发写入点）。仅 1 项 P3（默认值双源，round-13 前已存在）与 4 项 P4 文档/测试卫生问题，均不阻塞。

## 亮点

- **防共享可变状态回归**（test:138-148）：断言两次 `defaultRenderState()` 返回独立对象且 `outlineColor` 数组独立引用，修改 `a` 不污染 `b` — 直接防护 `getRenderState` 曾因返回共享引用导致的污染类缺陷（renderer.ts:196-198 已有防御拷贝注释）。
- **表驱动范围校验与生产 clamp 交叉验证**（test:163-194）：19 项参数以 `paramSpecs` 表驱动断言默认值在范围内；逐一与 `_applyRenderState` clamp（renderer.ts:309-327）核对，范围完全一致（exposure/contrast 0-4、bloomKernel 16-256、dofFocusDistance 1-300、dofFocalLength 20-200、celColorLevels 2-8、ssaoSamples 4-32，其余 0-1）。
- **键集合精确断言**（test:43-45）：`Object.keys(ToneMappingMode)` 精确等于 `['ACES','NEUTRAL','OFF']`，防新增别名漏出破坏「官方仅 3 值」契约（renderer.ts:26-27 注释背书）。
- **FOV 分工与边界设计清晰**（test:211-268）：注释明示「clamp 在 camera.ts 中处理」，原始层测试聚焦 UI 区间端点往返（0.1/3.0）、越界原样存储（0.01/-0.5/5/10）、精度往返（`toBeCloseTo(v,6)`）、默认值与 reset；与 camera.test.ts（clamp/NaN/Infinity/arc.fov 同步）零重叠。`resetCameraState` 用例（test:264-268）真实验证模块默认 0.8。
- **单一默认状态源**（camera-state.ts:92-113, 370-388）：模块级 `let` 初始化与 `resetCameraState()` 均从 `DEFAULT_CAMERA_STATE` 取值（round-13 code_review P3 修复），`fov: 0.8` 仅一处定义。
- **生产代码类型卫生**：renderer.ts 与 camera-state.ts 均 0 处 `as any`/`@ts-ignore`/`@ts-expect-error`；`_applyRenderState` clamp 全部经 `clamp()` 且 NaN 防护由 camera.ts:280-286 `clampFov` 承担（全局唯一调用点 camera.ts:343 已钳位）。

## 风险表

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|--------|------|------|------|----------|
| 🟡 P3 | renderer.ts | :234-269 vs :192-226 | 默认值双源：`defaultRenderState()` 硬编码默认值，`getRenderState()` 另用 `?? fallback` 重复同一批默认（bloomThreshold 0.5 / bloomKernel 64 / dofFocusDistance 22 / dofFocalLength 50 / ssaoSamples 8 / exposure 1 等）。任一处改动另一处不跟随 → UI 显示与默认态漂移。本纯函数测试只护 `defaultRenderState`，护不到 fallback（需 pipeline，集成范畴）。round-13 前已存在，非本次引入 | 提取 `DEFAULT_RENDER_STATE` 常量单源；`getRenderState` 的 `??` fallback 改为从常量取值，`defaultRenderState()` 直接展开常量 |
| 🟢 P4 | render-postprocess.test.ts | :8 与全文 | 头注释声称覆盖「FILTER_PRESETS 预设参数完整性」，但文件内无对应 describe；`FILTER_PRESETS` 实际位于 `menus/scene-render-presets.ts:35`（非 renderer.ts）。预设完整性实际由 `menu-schema.integrity.test.ts:140`（RENDER_KEYS 子集校验）兜底 | 修正头注释（改为指向 menu-schema.integrity.test.ts 分工），或在 scene-render-presets 侧补「预设各字段值落在合法范围」测试 |
| 🟢 P4 | render-postprocess.test.ts | :252-254 | 「默认 FOV 为 0.8」用例依赖 beforeEach:228 的 `setFov(0.8)` 前置写入，实际断言的是 beforeEach 而非模块默认；真默认由 :264-268 reset 用例验证 | 删除该用例，或把 beforeEach 改为 `resetCameraState()`（一石二鸟：隔离 + 天然验证默认值） |
| 🟢 P4 | render-postprocess.test.ts | :21, :51, :154, :189 | 测试侧 4 处 `any`/`as any`（`ToneMappingMode` 类型、`defaultRenderState` 返回类型、`(state as any)[spec.key]` 取值）。生产代码 0 处，不影响健康度结论 | 用 `RenderState` 精确类型 + `Record<string, unknown>` 收窄；`spec.key` 可改为 `keyof RenderState` |
| 🟢 P4 | render-postprocess.test.ts | :163-184 | `paramSpecs` 范围硬编码与 `_applyRenderState` clamp（renderer.ts:309-327）范围重复；测试仅验证「默认值在范围内」（默认值均居中，clamp 范围变更不会触发失败）。当前为默认值 sanity 设计，可接受 | 如需强约束，从 renderer.ts 导出共享 RANGE 常量供测试引用（单源）；当前设计保留亦可 |
| 🟢 P4 | camera-state.ts | :219-221 | 原始层 `setFov` 无 NaN/Infinity 防护（设计使然：clamp 在 camera.ts:286 处理，全局唯一调用点 :343 已钳位）。若未来新增直接调用 `setFovState` 的路径，NaN 可能写入 `_fov` 污染相机渲染 | 现状可接受；建议在函数处注释「仅限 camera.ts 钳位后调用」，或增加 NaN 防御性忽略 |

## 测试质量评价

- **断言有效性：强。** 38 用例全绿、0 跳过；字段级完整断言（`defaultRenderState` 39 个字段逐一核对）；`Object.keys` 精确集合断言；独立引用回归；FOV 精度往返 `toBeCloseTo(v, 6)`；reset 用例真实覆盖模块默认。
- **边界覆盖：符合「纯函数层」定位。** 曝光越界（>4）与预设缺字段的 clamp 行为需要 pipeline 实例，属集成范畴——文件头注释已声明由 `env-feature-levels.contract.test.ts` 覆盖（文件存在，分工成立）。FOV 侧覆盖 UI 区间端点、越界原样存储、默认、精度、reset 五类边界。
- **FOV 覆盖分工：** camera.test.ts:933-971 管相机层（clamp min/max/negative/NaN/Infinity + arc.fov 同步）、camera.presets.test.ts:175 管载入钳位、camera-state.test.ts:168-172 仅有 1 个基础往返用例与本文件 FOV describe 轻微重叠（可接受，本文件严格更深）。
- **轻微瑕疵：** ① 头注释与实测不符（声称测 FILTER_PRESETS 实未测，P4）；② 「RenderState 参数边界值」describe 名与实际「默认值范围 sanity」略有出入；③ 「默认 FOV」用例被 beforeEach 架空（P4）。
- **基线验证：** `npm run check`（含 tsc 与 i18n parity）exit 0，类型层无新问题。

## 与 round-13 审核的关系与遗留

- **关系：** round-13（`docs/audit/2026-08-06-round13-scene-render-core-ui.md`）审核过 renderer.ts（4 处 P2）与 camera-state（P2#1）；本次为纯函数层独立测试（`render-postprocess.test.ts`），不触碰 `_applyRenderState`/pipeline 集成路径，两者互不重叠。
- **遗留核实（本次均已在当前代码修复，无未决项）：**
  - renderer P1#3 快照回写覆盖用户改动 → setRenderState 先 `resetPerformanceSnapshot()` 再应用 patch（:696-702，含 `_suppressSnapshotReset` 防降级循环）；
  - renderer P2#3 transitionRenderState onComplete 顺序 → try/finally 保证 `_cancelRenderTransition` 必达（:877-883）；
  - renderer P2#4 reattachPipeline SSR/SSAO 静默关闭 → 记录启用态并主动重建（:903-947）；
  - renderer P2#5 cel 幂等守卫 → 已激活 + true 为 no-op（:497-499）；
  - renderer P2#6 glow 往返 → `getRenderState` 改用 `_glowLayer !== null` 判定（:221）；
  - camera-state P2#1 bridge 只写状态不切相机 → `registerSceneAction('setCameraMode')` 委托 `switchCameraMode`，未注册时降级状态写入（:390-409）。
- **本层新识别：** 默认值双源 P3（见风险表）为 round-13 未覆盖项，建议列入后续单一常量源治理（与 ADR-141/191 的「单一状态源」方向一致）。

---

审核日期：2026-08-15
审核员：子代理 round32-render-postprocess
