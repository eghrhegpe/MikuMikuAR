# 审核报告：setupE2ECapture 双运行时开关（ADR-229 P8-A 补测）

**审核范围：**
- 测试文件：`frontend/src/__tests__/dev-hooks.test.ts`（193 行，10 用例）
- 被测源码：`frontend/src/core/dev-hooks.ts`（277 行）——`setupE2ECapture`（24–276）双运行时开关全链：
  - 门控三态（30–34、38、58）、`__dumpBones`（39–55）、`__capture`（62–72）、`__state`（78–94）、`__scene`（99–276，含 driver 写钩子 103–134、只读探针 136–275）
  - 关联核实：`core/test-mesh.ts`（13–36，driver.createTestMesh 共享工厂）、`core/e2e-state-bridge.ts`（12–18，reader 注入桥）、`menus/menu-schema.ts:127-130`（reader 注册）、`scene/scene.ts:210-214`（`isHeadless` 定义）、`core/init.ts:641`（bootstrap 调用点）、`vite-env.d.ts:17-29`（全局类型声明）
- 设计依据：ADR-229（§10 headless 信号、§2.3 `__capture` 约束）、ADR-238（e2e-state-bridge 切断 core→menus）、提交 bb5972e9（钩子收敛）、02b909d3（守卫域前短路移除）、a767d771（driver 命名空间收敛）、ADR-242（dev-hooks 6 条 core→scene 反向边为已知结构性保留）
- **验证执行**：`npm run test -- src/__tests__/dev-hooks.test.ts` → **10/10 通过（49ms）**；`npm run check`（tsc --noEmit + check:lint）→ **通过，exit 0**（未跳过）

**总体结论：✅ 通过**

P8-A 补测目标达成：bb5972e9 新增的「e2e 钩子仅 isHeadless/VITE_E2E_MODE 注入、`__dumpBones` 保留 DEV 注入」三态门控逻辑（dev-hooks.ts:30-31/38/58）被测试 1/2 用真实可切换的 isHeadless live binding 验证，非 e2e 模式仅剩 1 个可写全局（`__dumpBones`），收敛声明成立。测试 10/10 绿，生产代码类型安全达标（0 处 `as any`/`@ts-ignore`）。无 P1/P2。3 条 P3：全局类型声明与实现漂移、用例 9 标题与断言不符、VITE_E2E_MODE 注入路径缺单测。

---

## 亮点

- **三态门控被真实验证，而非 mock 形状自证**（dev-hooks.test.ts:16-31、95-112）：`isHeadless` 用 `vi.hoisted` 共享状态 + mock getter 实现 ESM live binding，每次访问读最新值，两态切换在 `setupE2ECapture()` 调用时生效；测试 1（isHeadless=true）断言 `__capture`/`__scene`/`__dumpBones` 全注入，测试 2（isHeadless=false）断言仅 `__dumpBones`、三个 e2e 钩子 `toBeUndefined()`——正是 bb5972e9「普通 dev 页面不再裸露 21 个可写全局」的收敛语义，断言直指安全目标。
- **被测生产模块零 mock，动态导入路径真实走通**（dev-hooks.test.ts:23-78、124-130、171-176）：仅 mock 9 个外部依赖模块 + 3 个 Babylon 动态导入模块；`dev-hooks.ts` 与共享的 `core/test-mesh.ts` 真实执行。`__dumpBones` 经真实动态 `import('../scene/motion/bone-override')` 断言 `deepEqual {totalBones:12,totalOverridden:3}`（124–130）；`createTestMesh` 走通共享工厂 + Babylon mock 创建（171–176）——正是「测试复制实现抓不到生产回归」修复（test-mesh 共享，P1）的回归护栏。
- **读写分离设计有测试背书**（dev-hooks.ts:99-134 vs dev-hooks.test.ts:157-169）：只读探针（fps/meshCount/currentAnimation/fingerprint…）留 `__scene` 顶层、写钩子收敛到 `driver` 命名空间（a767d771），测试 8 逐一断言 driver 五个写钩子（applyOutfit/createTestMesh/clearTestMeshes/removeActiveModel/setWindSpeed）存在并真实调用不抛，防「测试误用写钩子做断言」的耦合。
- **守卫域就绪探测真实化有回归用例**（dev-hooks.ts:87-92 vs dev-hooks.test.ts:139-147）：02b909d3 移除 `isLightingReady`/`isRenderReady` 的 headless 前短路后返回真实就绪状态，测试 6 断言两个 getter 存在且读到 mock 真值（`true`），守住「越跳过门禁越绿」反模式。
- **异常兜底与数值 getter 逐项断言**：`__capture` headless 空串兜底（62–67 → 132–137）；`__scene` 数值可读（114–122：fps=30/meshCount=0/currentAnimation='idle'/windPhysicsActive=false）；`applyOutfit` 无聚焦模型返回 false 不抛（149–155）；物理探针/outfitVariants 无 runtime 时安全兜底（178–192）。
- **测试隔离质量高**：vi.mock 工厂仅引用 hoisted 绑定（无 TDZ 违规）；`beforeEach clearHooks()`（82–93）防用例间 window 全局泄漏；happy-dom 环境提供 `window`/`document`；全文件无 `it.skip`/`describe.skip`/`xit`；测试侧无 `as any`（统一 `as unknown as` 窄化）。

---

## 风险表

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|--------|------|------|------|----------|
| 🟡 P3 | `frontend/src/vite-env.d.ts` | 17–29 | **全局类型声明与实现漂移**：① `__scene`、`__dumpBones` 未声明——dev-hooks.ts:39/99 只能靠 `(window as unknown as Record<string,unknown>)` 写入，e2e 侧（`action-play.spec.ts:23` 等 8 个 spec）全部 `(window as any)` 读取，收敛后暴露面最大的 `__scene` 在类型层零登记，改名/误用无编译期防线；② `__state` 声明（26–28）缺实现已有的 `isLightingReady`/`isRenderReady` getter（dev-hooks.ts:87-92）；③ `__envDebug` 声明在 Window 上（20–24），但 scene.ts:361 是模块导出、从不挂 window（注释明言 "no window pollution"）——死声明；④ `ImportMetaEnv` 缺 `VITE_E2E_MODE`（dev-hooks.ts:30-31 使用），落到 vite/client 的 `[key:string]: any` 索引签名 → 门控变量类型为 any，与项目「VITE_ 键显式声明」惯例（已有 3 个）不符。 | ① `__scene` 定义完整 interface（或声明 `__scene?: unknown` + 专项类型）并补 `__dumpBones?: () => Promise<unknown>`；② `__state` 声明补 `readonly isLightingReady: boolean; readonly isRenderReady: boolean`；③ 删除 `__envDebug` 的 Window 声明（或真正挂载后保留）；④ `ImportMetaEnv` 补 `readonly VITE_E2E_MODE?: string`。 |
| 🟡 P3 | `frontend/src/__tests__/dev-hooks.test.ts` | 171–176 | **用例 9 标题「meshCount 增长」与断言不符**：实际只断言 `resolves.toBeUndefined()`，mock 的 `scene.meshes` 是静态数组、`MeshBuilder.CreateBox` mock 不 push，meshCount 增长从未被验证——标题承诺了「增长」语义但断言落空，属「断言弱于标题」的假覆盖（ADR-219 教训同型）。 | 让 mock 的 `CreateBox` 把 mesh push 进 `scene.meshes`（或断言 mock 被调用 + dispose 链），然后断言 `scene.meshCount` 由 0→1；否则改标题为「createTestMesh 走通 Babylon mock 创建」。 |
| 🟡 P3 | `frontend/src/__tests__/dev-hooks.test.ts` | 90–193 | **VITE_E2E_MODE 注入路径（双开关的另一半）零覆盖**：全部 10 用例只走 isHeadless 门控；`!devMode && !e2eMode` 早退（生产构建零注入，dev-hooks.ts:32-34）与非 headless 截图分支（68–71）在 vitest 下不可达（DEV 恒 true、VITE_E2E_MODE 未设）。双运行时开关名义「isHeadless 或 VITE_E2E_MODE」只验证了一半。 | 新增用例：`vi.stubEnv('VITE_E2E_MODE','true')` + `state.isHeadless=false`，断言 e2e 钩子仍注入（stubEnv 作用于 import.meta.env）；如需覆盖截图分支再 mock `Misc/screenshotTools` 的 `CreateScreenshotAsync`。 |

---

## 测试质量评价

- **断言有效性**：✅ 三态验证真实。测试 1/2 用 `typeof` + `toBeUndefined()` 精确区分「注入/未注入」，`beforeEach` 先 `clearHooks()` 保证断言针对本次 `setupE2ECapture()` 的产物而非残留；`__dumpBones`/`createTestMesh` 断言走真实动态导入路径的返回对象（deepEqual 完整形状）；`__scene` 数值 getter 逐一断言具体值（0/30/'idle'/false），非空泛存在性断言。**缺口**：用例 9 标题与断言不符（P3-2）、`applyOutfit`/`outfitVariants` 仅覆盖「无模型」分支（有模型走 `applyOutfitVariant`/`loadOutfits` 的 true 分支未测，mock 的 `applyOutfitVariant` 从无 `toHaveBeenCalled` 断言）、`rigidBodyCount`/`rigidBodyBundleCount` 仅覆盖 `mmdRuntime=null` 分支、`fingerprint`/`getBoneWorldPositions`/`__scene.capture`/`modelManager` getter 未覆盖——均非本轮 P8-A 目标，属可接受的后续补测面。
- **mock 合理性**：✅ 不过度。9 个外部模块 + 3 个 Babylon 动态导入模块全部文件级 `vi.mock`，工厂只引用 hoisted 绑定；关键的是被测模块（dev-hooks、test-mesh）**不 mock**——mock 面恰好停在「生产实现之外」，与「等价迁移」反模式（旧 mesh-lifecycle 测试复制实现）形成对照。内联 scene mock（23–31）与共享工厂 `sceneMockSuperset`（`focusedModelId`/`setEnvState`/`getScene`/`engine:{}`）形状不同，但该工厂不含 dev-hooks 所需的 `scene.meshes`/`engine.getFps`/`focusedModel`/`isHeadless`，内联实属必要（见 P4-4）。
- **边界覆盖**：isHeadless 两态切换 ✅（测试 1/2）、`__scene` getter 数值可读 ✅（测试 3）、headless 截图兜底 ✅（测试 5）、守卫域探测 ✅（测试 6）、driver 写钩子可调用 ✅（测试 8）。**缺口**：VITE_E2E_MODE 路径、生产零注入早退、`_reader` 为 null 时 `__state` 不挂载（78–79 分支）——后者可用 `getE2EStateReader: () => null` 的 mock 一行补上。
- **跳过测试**：无（全文件无 `it.skip`/`describe.skip`/`xit`/`todo`）。
- **测试卫生**：`clearHooks` 只删 window 属性、不替换 `window` 本体，符合 frontend/AGENTS.md §2.3 铁律；hoisted 状态（`state.isHeadless`/`state.model`）未在 beforeEach 重置，当前无跨用例污染（无用例设非空 model），但属脆弱点（见 P4-3）。

---

审核日期：2026-08-15
审核员：子代理 round20-dev-hooks
