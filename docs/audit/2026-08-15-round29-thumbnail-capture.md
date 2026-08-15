# Round 29 · thumbnail-capture — 审核结果

> **审核日期**: 2026-08-15
> **审核员**: 子代理 round29-thumbnail-capture
> **任务**: 第 29 轮审核第 2 个测试（本轮 3 个之一，仅审分配目标）

---

## 审核范围

| 项 | 范围 |
|----|------|
| 测试文件 | `frontend/src/__tests__/thumbnail-capture.test.ts`（191 行，fix P2 两处变更行验证） |
| 被测源码 | `frontend/src/scene/manager/thumbnail-capture.ts`（268 行，`renderInstanceThumbnail` / `_renderThumbnailImpl`，行 49-265） |
| 关键依赖 | `frontend/src/scene/manager/thumbnail-key.ts`（58 行，key 唯一推导源）、`frontend/src/scene/manager/model-loader.ts`（调用方封装层，行 153-230） |
| 验证执行 | `cd frontend && npm run test -- src/__tests__/thumbnail-capture.test.ts` → **2/2 通过（65ms）**；`npm run check` 未跑（本测试为纯单测、未改源码，tsc 基线由主模型批量验证，报告中注明） |

### fix P2 变更演进（git 溯源）

- `c393a768`（08-06）：裸 `as Mesh` → `instanceof Mesh` 守卫；readPixels 某行 detach 由 `continue`（黑条纹仍写缓存）→ `detachFailed` 整体放弃本帧。
- `aad46615`（08-07）：`instanceof Mesh` 守卫会误丢 InstancedMesh（Babylon 中 `InstancedMesh extends AbstractMesh` 而非 Mesh）→ 改为 `instanceof AbstractMesh` 守卫，即当前生产代码形态。
- `782daabe`：补入本测试文件（diff-coverage 门禁缺失单测）。

---

## 总体结论：⚠️ 有条件通过

**生产侧 fix P2 两处变更实现正确**：渲染收集改为 `m instanceof AbstractMesh && m.isVisible`（行 171-174）兼容 InstancedMesh 子节点；detach 竞态置 `detachFailed` 整体放弃本帧（行 219-235），不再污染缓存。资源释放（`rt.dispose`/`thumbCam.dispose` finally）、异常处理（SaveThumbnail catch+logWarn）、并发互斥（`_thumbMutex` promise 链）均健全，0 处新增 `as any`/`@ts-ignore`，测试运行通过。

**有条件项（测试侧）**：测试 1「正常渲染」为**弱断言**——mock 的 `RenderTargetTexture.render()` 是 no-op、`readPixels` 恒返回有效 buffer，因此无论 renderList 收集到 0 个还是 N 个子节点，`SaveThumbnail` 都会被调用、断言照常通过。该测试**无法拦截**「`instanceof AbstractMesh` 被回退为 `instanceof Mesh` 或被删除」这类核心回归（假阳性），与测试自身「覆盖 fix P2 变更行」的定位不符。建议补 renderList 检查点断言后转「通过」。

**P1：0 处；P2：0 处（生产侧）**；P3：4 处；P4：3 处（详见风险表）。

---

## 亮点

- **vi.hoisted 共享 mock 类引用，instanceof 语义成立**（`thumbnail-capture.test.ts:10-83`）：7 个 Babylon 模块（mesh/abstractMesh/transformNode/renderTargetTexture/freeCamera/math.vector/math.color）全部用 `vi.hoisted` 内定义的最小 mock class，再在 `vi.mock` 工厂中引用同一对象——使被测函数内 `m instanceof AbstractMesh` 对测试构造的子节点（`makeInst` 的 `new m.AbstractMesh()`，行 156）为真。这是重度 Babylon 依赖下唯一能让 instanceof 守卫被真实执行的正确模式，符合 frontend/AGENTS.md「vi.mock 工厂只可引用 hoisted 绑定」铁律。
- **detach 放弃帧的断言是强断言**（`thumbnail-capture.test.ts:177-190`）：`subarray: () => undefined` 精确触发 `flipped.set` 抛错 → 断言 `logWarn` 的完整消息（模块名 + 「readPixels buffer detached，放弃本帧缩略图」）且 `SaveThumbnail` **未被调用**（不污染缓存）。若 detach 逻辑回退为 `continue`，本测试立即失败——能真实验证 fix P2 第二处变更。
- **并发互斥双层防护**（`thumbnail-capture.ts:40-66` + `model-loader.ts:80,159,200,207`）：RT/framebuffer/物理冻结共享资源的 `_thumbMutex` promise 链串行化 + 调用方 `_thumbCaptureGen` 世代计数器（异步间隙后校验世代，过期即放弃）。对照 `docs/audit/thumbnail-system.md` 旧 P2「无并发生成守卫」已彻底解决，且 `release()` 在 finally 中调用，异常路径不卡死互斥链。
- **资源生命周期完整**（`thumbnail-capture.ts:188-264`）：`bindFramebuffer`/`unBindFramebuffer` 配对（198/255），物理刚体状态保存→填 0→渲染→恢复（186/190/259-261）置于嵌套 finally，任何异常路径（含 readPixels/翻转/编码失败）都会恢复物理并释放 RT/相机。
- **readPixels 返回类型安全**（`thumbnail-capture.ts:200,211`）：Babylon `readPixels` 声明返回 `Promise<ArrayBufferView>`（非 null，`thinEngine.pure.d.ts:1054`），第 5 参 `hasAlpha=true` 默认 Uint8Array，`pixels as Uint8Array` 断言合理、非裸 as；新版已改字节直拷（行 209-236），旧审核 P3「Float32Array NaN 守卫」问题自然消失。

---

## 风险表

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|--------|------|------|------|----------|
| 🟡 P3 | `frontend/src/__tests__/thumbnail-capture.test.ts` | 166-175（测试 1） | **弱断言（假阳性）**：mock RT `render()` 为 no-op、`readPixels` 恒返回有效 buffer，收集 0 或 N 个子节点都照常走到 `SaveThumbnail`。测试 1 无法拦截「`instanceof AbstractMesh` 回退为 `instanceof Mesh`（c393a768 态）或被删除」的核心回归，与测试头部「覆盖 171/172 行」的定位不符（行被执行 ≠ 行为被验证） | 给 mock `RenderTargetTexture` 加 renderList 检查点（如 `render() { this._lastRenderList = this.renderList }`），断言 `rt.renderList` 长度/成员为两个 `AbstractMesh` 子节点；再补一条 `new m.TransformNode()` 子节点被排除的反例断言 |
| 🟡 P3 | `frontend/src/scene/manager/thumbnail-capture.ts` | 172 | `m as Mesh` 类型谎言：`instanceof AbstractMesh` 收集的集合含 InstancedMesh（`extends AbstractMesh` 而非 Mesh），`renderList: Mesh[]` + 断言是类型不诚实（运行时安全：Babylon `RT.renderList` 类型实为 `Nullable<AbstractMesh[]>`，InstancedMesh 自带 render） | 将 `renderList` 声明为 `AbstractMesh[]`（对齐 Babylon 类型），删除 `as Mesh` 断言 |
| 🟡 P3 | `frontend/src/scene/manager/thumbnail-capture.ts` | 98-99、136-143 | 魔法数值：`minZ=0.1`/`maxZ=5000` 裸数值；相机聚焦系数 `0.55/0.65/0.75`（行 136-143）有注释解释但未命名常量，`dist` 公式 `×0.75 / (2·tan(fov/2))` 亦无命名 | 抽命名常量（如 `THUMB_MIN_Z/THUMB_MAX_Z/FOCUS_HEIGHT_RATIO=0.65/DISTANCE_COEF=0.75`），集中维护 |
| 🟡 P3 | `frontend/src/scene/manager/thumbnail-capture.ts:184-191,257-261` vs `frontend/src/scene/manager/model-loader.ts:181-186,222-225` | 物理冻结「保存→填 0→渲染→恢复」在两层各自实现一遍（双层是故意的：model-loader 提前冻结防异步间隙，thumbnail-capture 渲染期兜底），但逻辑几乎相同 | 抽公共 helper（如 `core/physics-freeze.ts` 的 `withFrozenPhysics(model, fn)`）统一两处，避免将来一侧改一侧漏 |
| 🟢 P4 | `frontend/src/scene/manager/thumbnail-capture.ts` | 205-207 | `ctx` 为 null 时静默 `return`（无 logWarn），与本文件「失败有日志」风格不一致（detach/SaveThumbnail 失败均有 logWarn） | 加 `logWarn('thumbnail-capture', 'canvas 2D context unavailable')` 后再 return |
| 🟢 P4 | `frontend/src/scene/manager/thumbnail-capture.ts` | 1-7、267-268 | **注释/实现漂移**：头注释「vmd-loader 通过动态 import 调用 renderInstanceThumbnail（规避静态循环）」与尾注释「vmd-loader 摆姿后直接调用 renderInstanceThumbnail」——当前 `scene/motion/vmd-loader.ts` 全文件 grep `thumb|renderInstanceThumbnail` 零匹配，动作缩略图调用已不存在 | 同步更新头/尾注释为「当前仅 model-loader 经 captureThumbnail 调用」，避免误导后续开发者 |
| 🟢 P4 | `frontend/src/__tests__/thumbnail-capture.test.ts` | 124、151、162 | 测试文件内 3 处 `as any`（`HTMLCanvasElement.prototype`、`makeScene`/`makeInst` 返回值）；测试代码不受生产「0 as any」指标约束，但会掩盖形状错误 | 为 engine/scene/inst 定义最小接口形状（如 `TestEngine { bindFramebuffer: Mock; ... }`），消除 as any |

---

## 测试质量评价

**总体**：测试文件定位清晰（fix P2 变更行覆盖）、mock 体系设计正确（vi.hoisted instanceof 链路 + 7 个 Babylon 模块桩隔离）、运行稳定（2/2 通过 65ms）、无跳过测试（`it.skip`/`describe.skip` 零命中）、测试内声明的覆盖行号（171/172/219/228/229/232/233/234）与当前生产代码逐行一致。

**断言有效性**：
- 测试 2（detach 放弃）✅ 强断言，能拦截回归，验证真实。
- 测试 1（正常渲染/收集）⚠️ 弱断言，见风险表 P3 首条——建议补 renderList 检查点断言与 TransformNode 排除反例。

**mock 合理性**：
- Babylon mock 经 `vi.hoisted` 共享类引用，instanceof 语义正确；`RenderTargetTexture.renderTarget = {}` 非 null 使 `engine.bindFramebuffer(rt.renderTarget!)` 正常执行（`thumbnail-capture.test.ts:26`）。
- `@/core/state` 的 `uiState` mock（`thumbnail-capture.test.ts:102-104`）是共享工厂 `src/__tests__/mocks/state-superset.ts:14`（`uiState: {}`）的**超集**（注入生产读取的 3 个字段），不违反「同模块 mock 形状超集一致」铁律。
- `@/core/config` mock 为静态替换（`thumbnail-capture.test.ts:98-101`）：生产 `thumbnailCache` 是 `export const`（`core/library-state.ts:36`，非 `export let` 活绑定），无「importOriginal spread 断活绑定」风险；`setThumbnailCache` mock 不实现原地 mutate+回调通知，但本测试不验证缓存更新，简化可接受。
- happy-dom 下 canvas 2D 上下文在 `beforeEach` 挂 `HTMLCanvasElement.prototype.getContext`（行 123-131），否则 `ctx` 为 null 被测函数提前 return——环境适配必要且正确；`isolate=true` 每文件重建环境，原型挂载无跨文件污染。

**边界覆盖缺口**（本测试为变更行聚焦测试，未覆盖可接受，但应注明）：
- 舞台分支（`isStageLike` mock 恒 false → 16:9 + activeCamera 复用路径未走，`thumbnail-capture.ts:118-126`）
- 物理冻结恢复分支（`makeInst` 无 `mmdModel.rigidBodyStates`，行 184-191/257-261 未执行）
- `inst.rootMesh instanceof Mesh` 追加分支（行 175-177；rootMesh mock 是对象字面量，恒 false）
- `ctx` null 提前 return（行 205-207）、SaveThumbnail 失败 logWarn（行 251-253）、空场景/无可见 mesh、`_thumbMutex` 并发互斥
- 与 `docs/audit/thumbnail-system.md` 遗留对照：该专题（2026-07-13）指出的「舞台/物理等行为无直接测试」在本次聚焦测试后仍保持空缺，建议后续补舞台与物理分支用例

---

## 与 docs/audit/thumbnail-system.md（专题审核）的关系

| 专题风险（2026-07-13） | 当前状态 | 落实位置 |
|------------------------|----------|----------|
| 🔴 P2 无并发生成守卫 | ✅ 已解决 | `_thumbMutex`（thumbnail-capture.ts:40-66）+ `_thumbCaptureGen` 世代计数（model-loader.ts:80,159,200,207） |
| 🔴 P2 键值构造不一致 | ✅ 已解决 | `thumbnail-key.ts` 唯一推导源（P0 治理，buildThumbnailKey/thumbnailBaseKey） |
| 🔴 P2 死代码 model-manager.ts:captureThumbnail | ✅ 已解决 | 全 src grep 零匹配，已删除 |
| 🟡 P3 像素 NaN（旧 Float32Array 转换） | ✅ 已解决 | 新版改 Uint8Array 字节直拷（行 209-236），问题自然消失 |
| 🟢 P4 失败无声 | ✅ 已解决 | detach/SaveThumbnail 失败均有 logWarn（行 233/252） |
| 🟢 P4 无单元测试 | ✅ 已解决 | 本测试文件（782daabe 引入，2/2 通过） |
| 🟡 P3 单帧等待不足 | ⏳ 部分遗留 | thumbnail-capture 层由调用方负责摆姿；model-loader 层 `withTimeout(whenReadyAsync)+rAF` 兜底仍在（设计使然，非本次范围） |
| 测试缺口（舞台/物理分支） | ⏳ 遗留 | 见上文「边界覆盖缺口」 |

**本审核与专题的关系**：专题审的是全链路（含旧版 model-loader 内嵌渲染逻辑）；本次审的是从 model-loader 抽取后的独立模块 `thumbnail-capture.ts` + 针对 fix P2 变更行的新测试。专题的并发/键值/死代码三大 P2 均已闭环，本报告聚焦新模块自身的两处 fix P2 实现正确性与测试断言有效性。

---

## 结论摘要

- **生产源码**：fix P2 两处变更实现正确、资源释放与异常处理健全、0 处新增 `as any`/`@ts-ignore`，无 P1/P2 生产风险。
- **测试**：2/2 通过；测试 2 强断言有效；测试 1 为弱断言（无法拦截首处变更回归），建议补 renderList 检查点断言。
- **有条件项**：测试 1 断言增强后即可转「通过」；P3/P4 均为非阻断改进项。

**审核日期**: 2026-08-15
**审核员**: 子代理 round29-thumbnail-capture
