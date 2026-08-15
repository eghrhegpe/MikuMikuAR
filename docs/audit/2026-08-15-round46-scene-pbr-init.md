# scene-pbr-init — 审核结果（round-46）

## 审核范围

| 项 | 内容 |
|----|------|
| 测试文件 | `frontend/src/__tests__/scene/scene-pbr-init.test.ts`（32 行，ADR-188 PBR 材质构建器初始化补测） |
| 被测源码 | `frontend/src/scene/manager/pbr-builder-init.ts`（24 行）：`tryApplyPbrMaterialBuilder`（L12-23，成功加载 PBRMaterialBuilder / 动态导入失败回退） |
| 关联调用链 | `scene.ts:770-778`（`_initMmdRuntime`：`getMaterialMode()==='pbr'` 时 `await tryApplyPbrMaterialBuilder()`，PMX 加载前完成覆盖） |
| 历史轮次关系 | round-13 审 scene 初始化路径（`2026-08-06-round13-scene-render-core-ui.md`，scene.ts 整体 ✅，当时 PBR builder 逻辑尚未独立成模块）；round-24 审 material-editor（PBR 参数分支零覆盖 P3，`round24-material-editor.md:30`）；round-40 审 model-preset（PBR 双材质矩阵 + 数值断言，`round40-model-preset.md:23-24`）。本测试聚焦 PMX 加载阶段 builder 切换（round-24/40 的上游），三份覆盖互补、无重叠 |
| 验证 | `cd frontend && npm run test -- src/__tests__/scene/scene-pbr-init.test.ts` → **1 passed (3ms)**；`npm run check`（全量 tsc）耗时过长按任务约定跳过——本次为只读审核、未改任何代码，无新增类型风险 |

**总体结论：⚠️ 有条件通过**

生产源码（pbr-builder-init.ts，24 行）健康度良好：类型安全、异常处理、职责单一、并发安全均达标，无 P1/P2/P3 级源码风险。扣分集中在测试自身：文件头注释（L3-5）声明覆盖「成功加载 + 动态导入失败回退」两分支，但 `describe` 内仅 1 个 `it` 覆盖成功分支，**回退路径（源码 L21-23 catch 分支）零覆盖**——测试与注释不符，生产异常处理路径无任何测试锚定（P2）。另有断言弱化、mock 工厂违反 AGENTS.md 约定（侥幸安全）等 P4 项。

## 亮点

- **`.pure` 变体规避 Babylon 顶层初始化**：`pbr-builder-init.ts:1-2` 注释明确设计意图——用 `babylon-mmd/esm/Loader/mmdModelLoader.pure`（无副作用）而非 `mmdModelLoader.js`（顶层调用 `RegisterMmdModelLoaderDefaultSharedMaterialBuilder` 注册默认 StandardBuilder，`node_modules/.../mmdModelLoader.js:4`），测试环境无需 Babylon 即可导入。测试 mock 同一 `.pure` 模块，与设计意图一致（`scene-pbr-init.test.ts:11`）。
- **动态导入失败不吞错、不半更新**：`pbr-builder-init.ts:13-23` try/catch 包裹两个 `await import`，失败时 `logWarn` 携带原始错误 `e`（非 `catch{}` 静默），且 catch 前无任何对 `SharedMaterialBuilder` 的写入——两个 import 之间的异步窗口若失败，共享 builder 保持进入函数前的原状，无中间态暴露。
- **调用时序正确（await 屏障）**：`scene.ts:777` `await tryApplyPbrMaterialBuilder()` 处于 `_initMmdRuntime` 早期，PmxLoader 在后续 `SceneLoader` 触发时才读取 `MmdModelLoader.SharedMaterialBuilder`（`mmdModelLoader.pure.js:52`），PBR 覆盖必然先于所有 PMX 加载生效；`scene.test.ts:803-807` 另有集成断言（pbr 模式 → 调用）。
- **多次调用幂等、无资源泄漏**：`new PBRMaterialBuilder()`（L16）每次覆盖 static，`MaterialBuilderBase` 构造仅持有 `materialConstructor`（`node_modules/.../materialBuilderBase.js:101`），无资源持有，旧实例 GC 回收；HMR 重入重复调用结果一致。
- **mock 通过对象引用共享可变状态**：`scene-pbr-init.test.ts:10-13` `MmdModelLoader: mockSharedBuilder` 使生产写入与测试断言指向同一对象，`beforeEach`（L20-22）重置保证用例隔离，无需重新 mock。

## 风险

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|--------|------|------|------|----------|
| 🟠 P2 | `frontend/src/__tests__/scene/scene-pbr-init.test.ts` | L3-5 注释 vs L24-31 | 注释声明覆盖「1. 成功加载 / 2. 动态导入失败回退」两分支，实际仅 1 个 `it` 覆盖成功分支；**回退路径（`pbr-builder-init.ts:21-23`）零覆盖**。该 catch 是 ADR-188 的核心风险缓解（PBR 加载失败 → 回退 Standard），一旦未来被删改（catch 改 throw / 失败后污染状态）无任何测试拦截 | 补回退用例：`vi.hoisted` 布尔开关 + mock 工厂内 `get PBRMaterialBuilder() { if (failPbrImport) throw new Error(...) }`；断言失败后 `SharedMaterialBuilder` 保持 beforeEach 设置的 sentinel 原值（未被改动）+ `logWarn` 被调用（spy） |
| 🟢 P4 | `frontend/src/__tests__/scene/scene-pbr-init.test.ts` | L10-13 | `vi.mock` 工厂引用模块级运行期变量 `mockSharedBuilder`，违反 frontend/AGENTS.md「vi.mock 工厂只可引用 hoisted/import 绑定」明文约定。本用例因动态 import 在测试运行期惰性触发、const 已初始化而侥幸无 TDZ（实测通过）；但若 `pbr-builder-init.ts` 未来改为顶层静态 import 会立即崩 | 改 `const mockSharedBuilder = vi.hoisted(() => ({ SharedMaterialBuilder: null }))`，工厂与断言统一引用 |
| 🟢 P4 | `frontend/src/__tests__/scene/scene-pbr-init.test.ts` | L28-30 | 两断言语义重叠（`toBeTruthy()` 已蕴含 `not.toBeNull()`），且均为弱断言——只能区分 null/undefined 与有值，**无法验证「是 MockPbrBuilder 实例」**（vi.mock 工厂内 class 在测试作用域不可达；若未来实现 bug 把 SharedMaterialBuilder 设为任意真值对象也通过） | `vi.hoisted` 导出 `MockPbrBuilder` 类引用，断言改 `expect(mockSharedBuilder.SharedMaterialBuilder).toBeInstanceOf(MockPbrBuilder)`；顺带消掉重叠断言 |
| 🟢 P4 | `pbr-builder-init.ts:15` vs `material-proxy-resolver.ts:34` | 同一动态导入路径字符串 `'babylon-mmd/esm/Loader/pbrMaterialBuilder'` 在两处独立重复；且 `getPBRMaterialBuilder`/`resolveMaterialProxy` 全仓无消费者（疑似历史残留） | 提取共享常量（如 `PBR_BUILDER_MODULE`）；或评估删除 material-proxy-resolver 死代码，收敛单点导入 |
| 🟢 P4 | `pbr-builder-init.ts:17` | 成功启用用 `logWarn`（warn 级）记录成功事件，语义略怪（与 `scene.ts:771` 材质模式日志惯例一致，非硬伤；ADR-248 热路径约束不适用——此为初始化路径一次调用） | 可选：成功路径改 `logInfo`，仅失败路径保留 `logWarn` |
| 🟢 P4 | `scene-pbr-init.test.ts:10-16` | mock 以普通对象 `{ SharedMaterialBuilder: null }` 模拟 class `MmdModelLoader`（真实声明 `mmdModelLoader.pure.d.ts:142` `static SharedMaterialBuilder: Nullable<IMmdMaterialBuilder>`）；当前生产代码只读写 static 属性故可行，但第三方模块契约未被锁定，babylon-mmd 升级改导出形状测试无感知 | 注释标注形状对齐依据（d.ts 行号），或补真实模块 export 形状的 contract 校验 |

## 测试质量评价

- **断言有效性 — 部分有效**：成功分支断言能验证「SharedMaterialBuilder 被写入非空值」（经对象引用共享，读写同源，验证真实）；但无法验证实例类型（弱断言，P4），且成功路径的 `logWarn`（L17）未被断言。
- **mock 合理性 — 良好**：仅 mock 两个 babylon-mmd 模块即隔离全部 Babylon 依赖，与生产 `.pure` 变体设计意图一致；`MmdModelLoader` 直接指向共享对象使断言直读生产写入点；`beforeEach` 重置保证隔离。共享工厂 `mocks/babylon-mmd-mocks.ts` 无 MmdModelLoader/PBRMaterialBuilder 类，内联 mock 无现成工厂可复用，属合理；唯工厂引用运行期变量违反 AGENTS.md 约定（P4，惰性执行下安全）。
- **边界覆盖 — 不足**：**回退分支缺失（P2，见风险表）**；多次调用（HMR 重入）真实函数幂等性无测试（scene.test.ts:809-819 的二次 initScene 中该函数为 vi.fn mock，不覆盖真实实现）；失败后恢复无测试（与回退缺失同源）。条件分支 `materialMode==='pbr'` 由 scene.test.ts:803-807 覆盖 ✅。
- **无 skip/todo** ✅。
- **32 行充分性 — 不充分**：对单个成功分支够用，但文件头注释声明的双分支只测其一；补一个回退用例（约 +10~15 行）即达充分。另注意 `daa499fd` 提交历史中该文件原断言 `expect(SharedBuilder).toBeUndefined()`（无意义断言）已被替换为 `not.toBeNull()`，但弱断言问题延续至今。
- **测试运行**：`vitest run src/__tests__/scene/scene-pbr-init.test.ts` → 1 passed（3ms），无 stderr 噪音（logWarn 输出属预期）。

---

审核日期：2026-08-15
审核员：子代理 round46-scene-pbr-init
