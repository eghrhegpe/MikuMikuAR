# round40-env-sky 审核报告 — env-sky 测试与其生产源码

## 一、审核范围

| 项 | 文件 | 行号范围 |
|----|------|---------|
| 测试文件 | `frontend/src/__tests__/env-sky.test.ts` | 全文 87 行（6 用例） |
| 被测源码 | `frontend/src/scene/env/env-sky.ts` | 全文 504 行（天空 mesh / 立方体贴图 / 动态纹理 / 星辰纹理缓存 / clearStarsTexCache） |
| mock 对象源（核对其真实性） | `frontend/src/scene/env/_shared/env-context.ts`（103 行）、`frontend/src/scene/env/env.ts`（211 行）、`frontend/src/scene/env/env-impl.ts`（268 行）、`frontend/src/scene/render/lighting.ts`（_disposeSunDisc 由 lighting-sun re-export） | — |
| 设计意图参考 | `docs/knowledge/env-sky.md`（tier: leaf）、ADR-138/146/130（env 拆分与循环依赖治理）、ADR-063 §4.3（barrel re-export 型循环可接受） | — |

**与兄弟审核的关系**：round-2 已审 env-clouds（云）；round-1/round-3 审过 env 系列（facade/terrain）。本测试（env-sky.test.ts）是**唯一真实加载 env-sky.ts 源码**的单元测试——`scene/env-impl.test.ts` 与 `env-bridge/*.int.test.ts` 均只 mock env-sky 并断言「被调用」，不执行其内部逻辑。覆盖充分性详见 §四。

**验证记录**：
- `cd frontend && npm run test -- src/__tests__/env-sky.test.ts` → **6/6 通过**（vitest 4.1.9，5ms）。
- 覆盖率（v8，仅本文件 + env-sky.ts）：行 **10%**、语句 9.84%、分支 6.14%、函数 11.76%（未覆盖行 48-388 / 412-414 / 427-502）。单独跑本文件低于项目阈值（35/35/28/30）触发 coverage 报错；全量跑不受影响。
- `npm run check`（tsc --noEmit）：按任务约定（耗时过长可跳过）**未执行**，本报告结论不依赖类型检查结果；生产代码已确认无 `as any` / `@ts-ignore` / `@ts-expect-error` / 空 `catch{}`（grep 零命中）。

## 二、总体结论

**⚠️ 有条件通过**

测试本身质量良好：6 个用例断言全部有效，disposeSky 的资源释放契约（幂等 + mesh/material/cubeTexture/dynamicTex 三件套 + 跨模块 _disposeSunDisc 副作用）覆盖扎实，mock 形状与真实模块一致，无 skip、无空断言。**但覆盖充分性不足**：87 行测试对 504 行源码仅 10% 行覆盖——公共入口 `applySky`（L426-504，三种 skyMode 切换 / skyKey 缓存判定 / cube 旋转增量更新）完全未测，`_proceduralEnvTexture` 释放分支（L412-414）是 disposeSky 内唯一未覆盖语句，异步星辰纹理 generation 守卫（[fix P2] 竞态修复）无回归护栏。条件：补齐 applySky 模式切换与 _proceduralEnvTexture 分支测试后转「通过」。

## 三、亮点

1. **幂等契约显式测试**（`env-sky.test.ts:29-33`）：连续两次 `disposeSky()` 不抛错 + `_disposeSunDisc` 计数为 2，直接钉死「空资源幂等 + 每次调用必达太阳光晕清理」两个行为，对应源码 `env-sky.ts:395-424`。
2. **资源释放三件套逐项用例**（`env-sky.test.ts:35-68`）：mesh+material / skyCubeTexture / skyDynamicTex 各自独立用例，断言 `dispose` 调用 + 引用置 null + 副作用，与源码 `env-sky.ts:399-409` 一一对应；`makeDisposable` 工厂（L16-18）让断言零样板。
3. **跨模块副作用断言**（`env-sky.test.ts:10,45,56,67`）：`_disposeSunDisc` 用 `vi.fn()` 注入，验证天空释放必然联动 `render/lighting` 太阳光晕清理（源码 `env-sky.ts:423`），防跨模块清理链回归。
4. **竞态修复文档化**（`env-sky.ts:418-422`）：[fix P2] 注释完整记录「disposeSky 后异步纹理回调仍可能写入已 dispose 纹理 → `_texStarsGeneration++` 使回调经 L59/L66 守卫丢弃」的根因与方案，属高质量自文档化防御。
5. **统一释放模板**（`env-sky.ts:398/401/405/408`）：`safeDispose`（ADR-146）全覆盖 observer/mesh/texture，`_skyFollowHandle` 经 safeDispose 移除（L398），资源生命周期无缺口（创建点 L246/L381 的 observer 均配对释放）。
6. **生产代码类型卫生**：`env-sky.ts` 零 `as any` / `@ts-ignore`，异常路径（`loadSkyCube` 错误回调 L345-349 → logWarn + 回落 procedural）无静默吞错。

## 四、风险表

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|--------|------|------|------|---------|
| 🟠 P2 | `env-sky.test.ts` | 全文 | 行覆盖仅 10%；`applySky`（L426-504）三种模式、skyKey 缓存判定（L462）、cube→procedural 切换（L467-474）、cube 旋转/强度增量更新（L490-498）、`loadSkyCube` 整函数（L327-390）、`_proceduralEnvTexture` 释放分支（L412-414）、异步星辰 generation 守卫（L47-72/190-213）零覆盖 | 用 `vi.mock('@babylonjs/core')` 桩 Babylon 后补 applySky 用例（skyKey 不变→early return、cube 路径未变→仅更新 rotationY、三种模式切换）；最低成本先补 `_proceduralEnvTexture` 分支（经 applySky(procedural) 真实创建后 dispose，或按测试钩子导出） |
| 🟠 P2 | `env-sky.ts:21` + `env.ts:13` + `env-impl.ts:44` | 依赖环 | 存在 **env-sky → env → env-impl → env-sky** 环（env-sky 经 facade 取 ensureEnvUpdateObserver，env-impl barrel re-export applySky 回引）。ESM 函数级引用运行时安全，属 ADR-063 §4.3「barrel re-export 型可接受」范畴；但未在 `scripts/circular-allowlist.json` 显式登记（白名单均为 core 根环），也无代码注释说明 | 现状可接受；建议在 `env-sky.ts:21` 加注释标注已知可接受环；后续将 `ensureEnvUpdateObserver` 下沉 `_shared/env-context`（零依赖共享层，同 ADR-217 做法）彻底破环 |
| 🟡 P3 | `env-sky.test.ts:82-86` | clearStarsTexCache | 仅断言「不抛错」，无法验证缓存真清空（`_texStarsImg`/`_texStarsImgUrl`/`_texStarsGeneration` 为模块私有）；而 `scene/env-impl.test.ts:298` 已断言该函数被 `disposeEnvUpdateObserver` 调用，行为验证缺失 | 行为路径验证：mock Babylon 后 applySky(procedural+starsTexture) → 触发 `_ensureStarsTextureImage` → `clearStarsTexCache()` → `vi.spyOn(globalThis, 'Image')` 断言下次加载重建 Image 实例 |
| 🟡 P3 | `env-sky.ts` | L263-271 vs L452-461 | starsPhase 量化（魔法数值 10 / -5 / 15）+ skyKey 拼接逻辑在 `createProceduralSky` 与 `applySky` **两处逐字重复**，后续改一处漏一处即成缓存失效 bug（如 ADR-132 曾因 skyKey 不含 EB 触发重载隐患） | 提取共享纯函数（如 `buildSkyKey(state, effectiveBrightness)`），ADR-096 同款收敛 |
| 🟡 P3 | `env-sky.ts` | L224 / L360 | `diameter = Math.min(20000, Math.max(2000, farZ * 1.8))` 在 procedural/cube 两分支重复，20000/2000/1.8 魔法数值无常量 | 提取模块级常量或共享直径计算函数（`SKY_DOME_RADIUS(farZ)`） |
| 🟡 P3 | `env-sky.ts` | L103/L118/L122/L131-133 | 星星 alpha 过渡阈值（10/-5/15）、`starCount = 400 + alpha*200`、y 范围 0.55、辉光 `sr*3` 等魔法数值散落 `drawSkyGradient` | 命名常量或补充参数来源注释（渐变绘制属渲染美学参数，至少集中成常量块便于调参） |
| 🟢 P4 | `env-sky.test.ts` | L4-8 | `_envSys` mock 仅 sky 字段（真实对象含 ground/particles/splash/clouds/water/shadow）、`getScene` mock 仅 `{environmentTexture:null}`——最小可用但未来被测代码访问其它字段会静默 undefined；且 `env-sky` 测试未复用 `sceneMockSuperset` 类共享工厂（frontend/AGENTS.md 测试卫生铁律） | 加注释说明「mock 覆盖 env-sky 使用面即可」；若扩展到 applySky 用例建议抽取共享 mock 工厂 |
| 🟢 P4 | `env-sky.test.ts` | L38/L50/L61 | 三处 `as any` 注入 mock 对象（测试代码，非生产，可接受） | 可改 `as unknown as Mesh` 或让 `makeDisposable` 泛型化，减少裸 `as any` |
| 🟢 P4 | `env-sky.test.ts` | L35-46 | 未覆盖「mesh 存在但 material 为 null」边界（源码 L400 `mesh.material?.dispose()` optional chain 分支） | 补 `makeDisposable()` 不带 material 的用例，断言 mesh.dispose 仍被调用且不抛错 |
| 🟢 P4 | `env-sky.test.ts` | L48-57 | skyCubeTexture 释放时 `scene.environmentTexture = null`（源码 L404）未被断言 | mock scene 已有该字段，补一行断言即可 |
| 🟢 P4 | `docs/knowledge/env-sky.md` | L41-42 | 知识卡过时：`createProceduralSky` 实为 `MeshBuilder.CreateSphere` + StandardMaterial + DynamicTexture（非 `CreateProceduralSkyTexture`）；`updateSkyDynamicTexture` 无「太阳光晕圆形渐变」（光晕在 `render/lighting` sun disc） | 更新知识卡（本报告仅留档，不改文件） |
| 🟢 P4 | `env-sky.ts` | L3 / L330 | 头注释「导入共享依赖通过 env-impl.ts barrel」与实际 `import './env'`（facade）不符；`supported = ['hdr','dds','exr']` 为函数内局部字面量 | 修正注释；supported 提升模块级常量 |

## 五、测试质量评价

**断言有效性**：6 个用例全部有效——dispose 调用计数、引用置 null、幂等不抛错、跨模块副作用计数（`_disposeSunDisc` 1→2→3 次累进断言，L70-79）。无空断言、无 `it.skip`/`describe.skip`/`only`（grep 零命中）。

**mock 合理性**：三个 `vi.mock` 均为最小形状但与真实模块接口一致——`_disposeSunDisc` 确为 `render/lighting` 导出（`lighting.ts:27` re-export 自 lighting-sun）、`ensureEnvUpdateObserver` 确为 `env.ts:13` 导出（自 env-impl:125）、`_envSys.sky` 字段名与 `env-context.ts:76-80,96` 逐一相符。无 TDZ/hoist 陷阱（工厂只用字面量，符合「vi.mock 工厂只可引用 hoisted/import 绑定」铁律），无裸 `window` 操作，`// @vitest-environment node` 环境选择正确（不依赖 DOM）。

**边界覆盖**：空资源幂等 ✓（测试 1）、重复 dispose ✓（测试 1/5）、资源释放三件套 ✓（测试 2/3/4）；缺口——mesh 无 material（L400 optional chain）、`_proceduralEnvTexture` 分支（L412-414）、`_skyFollowHandle` observer 移除（模块私有，仅能经幂等间接推断）、`_lastProceduralSkyKey`/`_lastSkyCubePath` 复位、`_texStarsGeneration` 递增（[fix P2] 核心守卫无回归护栏）。

**覆盖充分性（87 行小文件 vs 504 行源码）**：行覆盖 10%，是**显著不足**。需说明的合理性边界：env-sky.ts 的渲染路径（CreateSphere/DynamicTexture/CubeTexture/RawCubeTexture/Canvas 绘制）依赖 Babylon 场景对象，node 环境直测成本高，测试策略选择「只测纯资源释放逻辑」是可辩护的取舍；但 `applySky` 的模式切换与缓存判定是纯分支逻辑（不依赖真实 GPU），完全可以通过 `vi.mock('@babylonjs/core')` 覆盖——这是当前最值得补的缺口。另注意 applySky 有 E2E 冒烟（`e2e/env-sky.spec.ts`，ADR-041/060）与 `facade.int.test.ts:198` 的错误捕获路径兜底，但 E2E 非单测，分支级回归护栏仍缺失。

**结论**：测试**通过但覆盖不足**，与 round-2（env-clouds）/round-1/3（env 系列）对比，本测试是 env 子系统中覆盖最薄的之一（round-3 曾因 env-impl 无单测列为 P1 并促成 ADR-130 拆分，本次 applySky 未测属同类风险的低配版）。

---

审核日期：2026-08-15
审核员：子代理 round40-env-sky
