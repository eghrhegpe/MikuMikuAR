# Round 28 — vmd-layers-dispose 审核

## 审核范围

| 项 | 内容 |
|----|------|
| 测试文件 | `frontend/src/__tests__/vmd-layers-dispose.test.ts`（249 行，6 用例） |
| 被测源码 | `frontend/src/scene/motion/vmd-layers.ts`（734 行）— 重点 `_rebuildCompositeAnimation` L410-462、`_rebuildComposite` L504-626、`_rebuildFallback` L468-497、`_tryWasmBlender` L635-712 |
| 关联生产代码 | `frontend/src/core/mmd-adapter.ts` `switchAnimation` L478-506（P1 修复落点，ADR-192）；`frontend/src/scene/motion/vmd-loader.ts` L149（fallback 路径同链调用）；`frontend/src/scene/motion/wasm-layers-blender.ts` L115-139 |
| 验证 | `npx vitest run src/__tests__/vmd-layers-dispose.test.ts` → **6/6 通过（54ms）** |

**总体结论：✅ 通过** — 测试真实有效、断言命中修复点；P1（composite 路径旧 WASM 动画句柄未 dispose）的修复机制经代码走查 + 测试运行双重确认已覆盖全部绑定出口分支。无 P1/P2 遗留，仅 3 项 P3 测试覆盖缺口与若干 P4 洁净度项。

## 与 round-5 的关系

- round-5（`docs/audit/round-5-vmd-layers.md`，2026-07-22）审 vmd-layers.ts：P1「模块零测试」，其中明确点名 `_rebuildCompositeAnimation()` 未测试（合成重建错一步则全错）。
- 同一批处置（commit `391277c1`，2026-07-22）即发现并修复了本 P1（composite 重建不 dispose 旧 WASM 句柄），初始版本测试文件（177 行、1 用例）与修复同日落地。
- 2026-07-27 commit `15754fcf`（ADR-192 MmdAdapter Phase 1）：把 vmd-layers/vmd-loader 散落的「切换+归零」补丁收敛为 `mmd-adapter.switchAnimation`，dispose 逻辑迁入 L483-496（行为不变，纯重构）。
- 此后测试文件演进至 249 行 6 用例（补 null 安全、dispose 抛异常、remove/toggle fallback、去重守卫），2026-08 切 node 环境分流（vitest 配置 ADR-255）。
- 结论：round-5 发现 → 修复 + 初版测试 → ADR-192 重构收口 → 本测试持续跟踪，修复闭环成立。

## 亮点

- **dispose 收口于单一适配边界**：`mmd-adapter.ts:478-506` `switchAnimation` 按「取出旧句柄（私有字段 currentAnimation，A 类 augmentation）→ `setRuntimeAnimation(null)` 解绑 → `try{ prevAnim.dispose() }catch{}` → 创建绑定新动画 → `seekAnimation(0)` 归零」五步固化契约，两处生产调用点（vmd-layers.ts:604 与 vmd-loader.ts:149）共用同一释放逻辑，杜绝散落补丁再次漂移（注释明确固化 ADR-192 / ADR-106 依据）。
- **dispose 覆盖全部绑定出口分支**（走查确认）：
  - JS composite 路径：vmd-layers.ts:604 → `switchAnimation(composite)` 直接释放旧句柄；
  - WASM 单层降级：vmd-layers.ts:591 → `loadVMDMotion` → vmd-loader.ts:149 → `switchAnimation`；
  - WASM blender 成功：vmd-layers.ts:662 → `setupWasmLayersBlender`（wasm-layers-blender.ts:120 先 `teardown` 再 :138 `loadVMDMotion`）→ 同链释放；
  - gen 过期/异常退出（vmd-layers.ts:542/551/574/622）：不产生新绑定，旧动画仍归模型所有，无泄漏路径。
- **fork 层 WASM 资源链核验**：node_modules 中 `MmdWasmAnimation.prototype.dispose`（mmdWasmRuntimeModelAnimation.pure.js:416-427）→ 遍历 `runtimeModelAnimations[i].dispose(true)` → `_onDispose()` 回收 WASM AnimCurve —— P1 的「泄漏 WASM AnimCurve」论断与释放链均属实，修复点正确。
- **测试 mock 有效性**：`import('../scene')` 经 Vite resolver 实测解析到 `src/scene/scene.ts`（与测试 `vi.mock('../scene/scene')` 同文件），mock 真实生效而非死 mock。
- **round-5 P3 已修复确认**：权重归一化除零守卫 `totalWeight > 0`（vmd-layers.ts:559）在位；`_filterVmdBones` 长度校验（L73-82，round-17 P2）在位。

## 风险表

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|--------|------|------|------|----------|
| 🔴 P1 | — | — | 无（修复已闭环，全部绑定出口分支均经 switchAnimation 释放旧句柄） | — |
| 🟠 P2 | — | — | 无 | — |
| 🟡 P3 | vmd-layers-dispose.test.ts | L135-137（`MmdWasmRuntime: class {}`） | 测试仅覆盖 JS composite 路径：`mockMmdRuntime` 非 `instanceof` 被 mock 的 `MmdWasmRuntime`，WASM 分支（L579-596 单层降级、`_tryWasmBlender` L635-712、blender teardown/evaluator dispose）结构性不可达；P1 标题为「WASM AnimCurve 资源」，测试证明的是 dispose 被调用而非 WASM 内存实际回收 | 补 WASM 运行时形态（`Object.create(MmdWasmRuntime.prototype)` 或原型上移）覆盖 blender 成功/降级两分支，并在 dispose 回调内断言 WASM 释放链（可挂 mock 计数）；与 round-5 遗留 P2「wasm-layers-blender 零功能测试」合并处理 |
| 🟡 P3 | vmd-layers-dispose.test.ts | 全文件 | 边界与并发缺口：`hasBaseVmd` 触发 composite 的变体（1 层 + baseVmd）、移除至 0 层、gen 竞态快速调整（L542/551/574/665-693 过期分支）均无用例；生产 gen 守卫逻辑完备但无测试固化 | 补 3 个用例：① 1 层 + `inst.vmdData` 置位 → composite + dispose；② 连删至 0 层；③ 连续两次 `addVmdLayer` 不 await 的竞态（断言最终只绑定新 gen 结果、dispose 恰一次） |
| 🟡 P3 | vmd-layers.ts | L476-485（`_rebuildFallback` 0 层分支） | 0 层且无 baseVmd 时直接 return，不清除已绑定动画（模型继续播旧动作）——行为未经测试固化，且「移除全部图层后是否应停播」属产品语义，当前无定论 | 确认产品意图：若应停播则在此分支显式解绑/停播并补测试；若有意保留则补注释 + 测试固化现状 |
| 🟢 P4 | vmd-layers-dispose.test.ts | L204-206 | 断言可强化：`toHaveBeenCalled()` 未限定次数/顺序，回归为「dispose 被调用 2 次」或「先绑定后 dispose」仍会误绿 | 加 `mockDispose`/`setRuntimeAnimation` 的 `toHaveBeenCalledTimes(1)` 与调用顺序断言（`mock.invocationCallOrder`，要求 `setRuntimeAnimation(null)` 先于 dispose） |
| 🟢 P4 | vmd-layers-dispose.test.ts | L130-132（`MmdAnimationSpan` mock 构造 3 参） | mock 构造签名（`_anim,_weight,_additive`）与生产调用 5 参（L560-566）不符，weight 归一化/offset 语义回归无法被测试捕获 | 对齐签名并断言 span 构造参数（weight 归一化结果） |
| 🟢 P4 | vmd-layers.ts | L569-571 | `finally { /* 仅注释 */ }` 空块，无实际清理语义 | 删除空 finally 或移注释至 try 块首 |
| 🟢 P4 | vmd-layers.ts | L665-673 / L685-693 | `_tryWasmBlender` 两处过期 teardown 块逐字重复 | 提取 `_teardownIfStale` 局部 helper |
| 🟢 P4 | vmd-layers.ts | L617、L696 | `maxEndFrame / 30` 魔法数值 ×2（VMD 30fps） | 命名常量如 `VMD_FPS = 30`（与 L58 `VMD_BONE_FRAME_SIZE` 同风格） |

## 测试质量评价

- **断言有效性**：核心用例（用例 1）命中修复落点——`switchAnimation` 内 `prevAnim.dispose?.()`（mmd-adapter.ts:492）被 `mockDispose` 捕获，且补充 `setRuntimeAnimation`/`createRuntimeAnimation` 调用断言证明「释放后仍完成新绑定」，非仅测 dispose 存在。负向用例（用例 2 null 句柄、用例 3 dispose 抛异常）分别验证 `?? null` 守卫与 L491-495 try/catch，均真实覆盖生产分支，非空转断言。
- **路径编排**：`resetToCompositeState` 以 2 层已启用 VMD 精确构造 composite 触发条件（`length > 1 || hasBaseVmd`，与 L455 判定一致）；`fakeVmdBuffer(extraBytes)` 以 byteLength 差分支撑去重用例，设计干净。
- **mock 工程**：全量 mock 生产模块（config/scene/vmd-loader/babylon-mmd 内部模块），`as any` 仅 3 处且限测试 mock 对象；`MmdCompositeAnimation` mock 缺 `dispose` spy，无法验证「旧 composite 自身 dispose → span 清理」深链（当前由 mockCurrentAnimation.dispose 代理验证，可接受）。
- **环境**：`// @vitest-environment node` 分流（vitest 配置 ADR-255 口径），与项目「46 测试文件切 node」卫生一致；无 `it.skip`/`it.todo`/`xit`；实际运行 6/6 绿（54ms）。
- **缺口**（见风险表 P3）：WASM 分支不可达、hasBaseVmd/0 层/竞态边界缺失——均为测试覆盖缺口，非生产缺陷。

---

审核日期：2026-08-15
审核员：子代理 round28-vmd-layers-dispose
