# Round-34 审核：模型替换状态继承（ADR-150 补测）

**审核日期：** 2026-08-15
**审核员：** 子代理 round34-replace-model-inherit（本轮第 3/3 个测试）

## 审核范围

| 项 | 内容 |
|----|------|
| 测试文件 | `frontend/src/__tests__/scene/replace-model-inherit.test.ts`（383 行，16 用例，全绿 82ms） |
| 被测源码 | `frontend/src/scene/manager/model-ops.ts:327-466`（`ReplaceSnapshot` 接口 + `captureInheritedState` + `applyInheritedState`） |
| 依赖（真实执行） | `@/core/logger`（logWarn）、`@/core/scene-action-bridge`（零依赖叶子，加载期 `registerSceneAction` 无害） |
| 依赖（mock） | modelManager setter（`../../scene/scene`）、`setBoneOverride`（bone-override）、camera 三函数（getOrbitBoneLock/setOrbitBoneLock/getFocusedModelBoneNames）、lighting-follow 三函数、core/config、core/state、env/playback/audio/registry/model-manager/transform-adapter |

**与 round-13 的关系（任务要求注明）：** round-13（`docs/audit/2026-08-06-round13-scene-render-core-ui.md`）整体审过 model-ops，记录其真实循环依赖 `model-ops → ../scene`（ADR-251 立档，治理分批）。本测试是 **ADR-150 状态继承补测**，聚焦 capture/apply 两纯函数；测试通过 `vi.mock('../../scene/scene')` 切断该循环依赖——mock seam 本身即验证了 ADR-251 的可解耦性。本次未复评 round-13 已立档的循环依赖项，仅核实未新增依赖环。

## 总体结论

⚠️ **有条件通过** — 生产代码健康（无 P1；1 个 P2 设计风险、当前调用流正确），测试 16/16 全绿、断言总体有效；条件为补强 4 个 P3 测试覆盖缺口（含 1 处空断言）。

---

## 亮点

- **纯函数 + seam 化 mock 策略（测试 1-99 行 ↔ 源码 358-466）**：12+ 个重依赖全部 `vi.mock`，被测两函数保持真实执行，模块加载期不触发 `new Scene` 等副作用；行为断言走 `mmState._applied` 累积 + `toMatchObject`（测试 272-280），不逐参断言、抗 setter 签名重构，是"重依赖空 mock 测纯函数"的正确切法。
- **modelManager null 守卫 + 调用方 try-catch 双层兜底（model-ops.ts:392-395 + library-actions.ts:220-237）**：apply 缺 manager 时 logWarn 早退；调用侧捕获继承异常降级为"不继承但替换成功"，继承失败不阻断替换原子操作、不残留新旧并存。
- **bone override 同名骨过滤（model-ops.ts:421-427）**：仅对新模型存在的骨骼写入，防 store 堆积无效条目，与 ADR-150 裁定表（2026-07-26 终态）逐项一致；排除项（outfit/morph/perception）为类型层结构排除，`ReplaceSnapshot` 字段清单即契约。
- **personalLight fire-and-forget 时序兼容（model-ops.ts:455-465）**：entry 已建→`setPersonalLightState` 覆写点亮；未建→`attachPersonalLight` 带 overrides 建灯，利用 `attachPersonalLight` 内部 `_entries.has` 早退（lighting-follow.ts:174-176）保证幂等——注释完整解释了竞态策略，测试 359-375 两分支分别断言。
- **排除项是真实验证而非死断言**：orbit 分支断言 `not.toHaveProperty('position')`（测试 294）、bone lock 缺失断言 `not.toHaveBeenCalledWith(true, …)`（测试 325）——排除逻辑可被实现回归真正触发。
- **rotationY 无丢失**：capture 仅取 `rotation`，apply 经 `mm.setRotation` 写入，model-manager.ts:626 派生 `inst.rotationY = rotation.y`——朝向角随 rotation 完整继承，非缺口。

## 风险表

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|------|------|------|------|------|
| 🟠 P2 | model-ops.ts | 422、446 | `applyInheritedState(newId, snap)` 的 boneOverride 过滤与 boneLock 匹配基于**全局焦点模型**（`getFocusedModelBoneNames()` 读 `focusedModelId`，camera-bone-lock.ts:62-69；`setOrbitBoneLock` 内部同样绑定 focusedModelId），而非参数 `newId`。当前调用流（library-actions.ts:216-217 注释声明"焦点已由 model-loader 切换"）成立，但函数契约"仅对新模型存在的骨骼应用"与实现脱钩——未来在非焦点模型上调用将静默过滤/锁定到错误模型；测试 mock 亦固化该耦合（固定骨骼列表，无法区分 newId 与焦点） | 为 camera-bone-lock 增 `getModelBoneNames(id)` 按 id 查询，apply 用 `newId` 过滤；或在 apply 入口断言 `focusedModelId === newId` 不符则 logWarn；测试相应改为按 newId 驱动骨骼列表 |
| 🟡 P3 | replace-model-inherit.test.ts | 225-227 | feet 深拷贝断言**空转**：`snap.feet.enabled = false` 后 `expect(inst.feet.enabled).toBe(false)`——makeMockInst（138-147 行）feet.enabled 本就为 false，改后值相同，断言恒真，未证明深拷贝（boneOverrides 部分 224/226 有效） | 改为变更非默认字段：`snap.feet.intensity = 9; expect(inst.feet.intensity).toBe(0.6)` |
| 🟡 P3 | replace-model-inherit.test.ts | 22、30、37 行 mock + 260-281 用例 | apply 侧 4 个 setter 未记录未断言：`setBoneLinesVis`/`setBoneJointsVis`/`setRotation`/`setPositionMode` 为裸 `vi.fn()` 不入 `_applied`，"应用基础状态"实际只验证 11 个继承字段中的 7 个，snap 传入的 `showBoneLines:true` 是死输入 | 4 个 setter 仿照 `setRotation` 记录 euler、`setPositionMode` 记录 mode，断言补全至覆盖全部继承字段 |
| 🟡 P3 | replace-model-inherit.test.ts | 186-229、248-383 | 边界覆盖缺口（任务清单的空状态/部分字段/多模型切换）：capture 未测 `meshes` 空→`[0,0,0]`（model-ops:373-375）、`feet` undefined→`createDefaultFeetState`（380）、boneLock 非空捕获（382，默认 mock 恒 null）；apply 未测 orbit 模式缺轨道参数的 cartesian 回退分支（408-419）、sceneMotionId undefined 时 motionSlots 不被改写（434）、二次 apply（双替换）；全程单一 `new-1`，无多模型切换序列 | 补 5-6 个边界用例：空 meshes/feet undefined 的 capture、orbit 回退的 apply、双替换幂等、两模型交替替换 |
| 🟢 P4 | docs/adr/adr-150-model-replace-contract.md | 143 | 文档漂移：声称"11 单测（capture 4 + apply 7）"，实际文件已 16 用例（capture 4 + 个人灯 2 + apply 10），ADR-168 补测后未回写计数 | 更新实施文件索引的单测计数 |
| 🟢 P4 | replace-model-inherit.test.ts | 59-99 | mock 形状偏离共享工厂约定（frontend/AGENTS.md §2.3）：scene/scene 内联 `{ modelManager }` 而非 `sceneMockSuperset`、core/state 内联而非 `stateMockSuperset`、core/config 静态整替（无 importOriginal spread——AGENTS.md 警示的 god-barrel 活绑定风险，本测试覆盖路径不触碰 live binding 故低危） | 若未来扩展该测试触碰 config 活绑定（如 focusedModelId 变化），改 `...(await importOriginal())` 超集；形状尽量对齐共享工厂 |
| 🟢 P4 | replace-model-inherit.test.ts | 运行期 stderr | 真实 `@/core/logger` 未 mock：bone-lock 缺失用例触发真实 logWarn 输出（`[adr-150] bone lock '消失的骨' not found...`），测试输出带噪音 | 可 `vi.mock('../../core/logger', () => ({ logWarn: vi.fn() }))`，并顺带断言 logWarn 被调 |
| 🟢 P4 | replace-model-inherit.test.ts | 84 行 camera mock | mock 非超集：model-ops 还 import `getCameraMode`/`switchCameraMode`（model-ops.ts:14-20），mock 未提供——当前覆盖路径不调用故安全，未来加 removeModel/focusModel 用例会直接 `not a function` | mock 补全为真实 camera 导出超集，或注释注明覆盖范围 |

## 测试质量评价

- **执行验证**：`cd frontend && npm run test -- src/__tests__/scene/replace-model-inherit.test.ts` → 16/16 passed（82ms），无 `it.skip`/`describe.skip`/`only`；项目基线全绿。
- **断言有效性**：capture 完整性断言强（13 个继承字段逐一断言 + motionSlots undefined + boneOverrides 空数组 + 深拷贝隔离）；apply 行为断言模式好（_applied 累积 + toMatchObject），排除项验证真实（orbit vs position、bone lock 缺失、personalLight 三态）。**缺陷**：feet 深拷贝断言空转（恒真）；4 个 setter 未记录致 apply 侧覆盖不完整；`setBoneOverride` 断言显式带 `undefined` 第 6 参（absolute），有效但不脆弱地固化了 mock 形状。
- **mock 合理性**：重依赖空 mock 策略正确（纯函数隔离 + 加载期副作用规避）；`scene-action-bridge` 零依赖叶子保留真实（加载期 `registerSceneAction` 仅写 Map，scene-action-bridge.ts:173-183）；与 AGENTS.md 测试卫生铁律的 4 处偏离（scene/state 共享工厂、core/config 静态整替、logger 未 mock、camera mock 非超集）均为低风险，未触碰活绑定。
- **边界覆盖**：空状态（meshes 空/feet undefined）、部分字段（orbit 缺参回退）、多模型切换三块均有缺口（见 P3 行），是"有条件通过"的主要条件项。
- **测试命名与组织**：describe 按 capture/apply/个人灯分层，中文用例名可读，注释标注 ADR 出处（adr-150/adr-168），与项目惯例一致。

---

*审核范围限定：只读生产代码，未修改任何生产/测试文件；报告写入 `docs/audit/2026-08-15-round34-replace-model-inherit.md`。*
