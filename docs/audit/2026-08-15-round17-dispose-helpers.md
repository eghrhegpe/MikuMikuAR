# dispose-helpers — 审核结果（round17-1/3）

## 审核范围

- **测试文件**：`frontend/src/core/__tests__/dispose-helpers.test.ts`（142 行，10 用例）
- **被测源码**：
  - `frontend/src/core/dispose-helpers.ts:29-35`（`safeDispose`）
  - `frontend/src/core/dispose-helpers.ts:64-86`（`detachSharedTextures`，含 `SHAREABLE_TEXTURE_SLOTS` 常量 41-46 行）
- **依赖相关代码**：
  - 消费者 `frontend/src/scene/manager/model-manager.ts:330-344`（`remove()` 中 detachSharedTextures → mat.dispose(false, true) 的调用链）
  - 全仓 27 个模块 60+ 处 `safeDispose` 调用点（env/render/camera/menus/core 等）
  - 决策依据 `docs/adr/adr-146-function-duplication-triage.md`（主题3，62-69、394-421 行）、知识卡 `docs/knowledge/dispose-helpers.md`、buglog `docs/buglog/2026-08-03-shared-toon-disposed-on-model-remove.md`

## 总体结论

✅ **通过**

- 生产代码 86 行，零运行时依赖（仅 2 个 type-only import），类型检查 `tsc --noEmit` 0 错误，无 `as any`/`@ts-ignore`
- 单测 10/10 通过（Vitest 34ms，node 环境分流），覆盖 `safeDispose` 与 `detachSharedTextures` 的核心语义
- 未发现 P1/P2/P3 风险，仅 4 项 P4 低风险观察

## 亮点

- **`safeDispose` 与手写模板语义严格等价且有类型化约束**：`obj?.dispose(...args)` + 恒返 `null`（dispose-helpers.ts:29-35）。返回值类型固定为 `null` 而非 `T | null`，从类型层面强制调用方 `x = safeDispose(x)` 完成置空——比「dispose 后忘记置空」的手写隐患更安全。泛型约束 `{ dispose(...args: unknown[]): void }` 用 `unknown[]` 而非 `any[]`，比 ADR-146 原设计稿（`any[]`，adr-146:69）更严格。
- **`detachSharedTextures` 先摘除后释放的正确顺序**：消费者 model-manager.ts:341 在 `mat.dispose(false, true)`（forceDisposeTextures=true）**之前**调用，注释完整交代了 babylon-mmd 共享 toon 全局单例无引用计数的背景（model-manager.ts:336-340），与 buglog `2026-08-03-shared-toon-disposed-on-model-remove.md` 形成闭环。
- **独占纹理不摘除、避免 GPU 泄漏**：只摘除「确有幸存者引用」的纹理（dispose-helpers.ts:75-77），独占纹理保留交由 dispose 释放，注释明确该设计（dispose-helpers.ts:59-60）。
- **空集合/无场景安全**：`disposing.values().next().value?.getScene()` 对空 Set 短路返回（dispose-helpers.ts:65-68），测试覆盖（test:139-141）。
- **槽位常量提取**：`SHAREABLE_TEXTURE_SLOTS` 用 `as const` 声明（dispose-helpers.ts:41-46），无魔法字符串散落。
- **测试替身最小化**：`FakeMaterial` 只实现依赖的 3 个接口点（test:52-72），`FakeDisposable` 记录 `lastArgs` 验证参数透传（test:6-13），不引入 Babylon 运行时，测试快且隔离干净。
- **测试用例与 bug 修复闭环**：detachSharedTextures 的 5 个用例（共享摘除/独占保留/整组不摘/多槽位/空集合）正好对应 buglog 的场景矩阵，注释写明「场景还原」（test:47-50）。

## 风险

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|--------|------|------|------|----------|
| 🟢 P4 | dispose-helpers.ts | 78 | `mat as unknown as Record<string, BaseTexture \| null>` 双重类型断言。非 `as any`，且因 babylon-mmd 扩展字段（toonTexture/sphereTexture）不在标准 Material 类型上而无法避免，但 `Record<string, ...>` 使所有字符串键均可写，类型上失去字段约束 | 可将断言收窄为 `Pick<Material, 'diffuseTexture'\|'emissiveTexture'> & { toonTexture?: ...; sphereTexture?: ... }`，仅对扩展字段断言；或加注释说明断言原因 |
| 🟢 P4 | dispose-helpers.ts | 65-69 | 函数隐含「disposing 集合内材质同属一个 scene 且均已挂载」的前提（只取第一个材质的 scene 判断幸存者）。当前消费者 model-manager 单场景成立，但函数签名未显式声明该前提 | 在 JSDoc 中补充该前置条件；若未来出现跨场景材质集合，需改为按场景分组处理 |
| 🟢 P4 | dispose-helpers.ts | 74-84 | `SHAREABLE_TEXTURE_SLOTS` 仅覆盖 4 个槽位；若共享纹理挂在其他字段（如 opacityTexture/specularTexture），不会被摘除。对 babylon-mmd toon/sphere 场景正确，但注释未说明枚举依据 | 在 39-40 行注释补充「为什么是这 4 个字段」的说明，明确枚举边界 |
| 🟢 P4 | dispose-helpers.test.ts | 23-26 | 用例名 "is a no-op" 仅断言返回 null 与不抛异常，未显式断言「未调用 dispose」（传 null 时实例不存在，no-op 为隐含语义）；另 safeDispose 的「dispose 抛异常时异常传播而非吞错」行为无测试覆盖 | 可补一条用例：传入 dispose 会 throw 的替身，断言 safeDispose 上抛异常（验证无静默吞错） |

## 测试质量评价

**整体良好，与生产代码的文档承诺（dispose-helpers.ts:1-17 头注释）逐条对应。**

- **断言有效性**：`safeDispose` 5 用例覆盖「非空 dispose + 返回 null」「null no-op」「单参/多参透传」「返回值赋值置空」；`detachSharedTextures` 5 用例覆盖「幸存者引用→摘除」「独占→保留」「整组卸载→不摘除（无幸存者分支，dispose-helpers.ts:70-72）」「多槽位同时摘除」「空集合不抛异常」。引用断言用 `toBe`/`toBeNull`，值断言用 `toEqual`，均有效。
- **边界覆盖**：null、空 Set、全组卸载、共享/独占纹理、参数透传均已覆盖；未覆盖「getScene() 返回 null」（dispose-helpers.ts:65-67 的 `?.` 分支，空集合已覆盖 `next().value` 为 undefined，但非空集合内材质无 scene 未测）与「异常传播」，均为低风险边界。
- **无跳过**：通读全文无 `it.skip`/`it.todo`/`.only`。
- **测试隔离**：`// @vitest-environment node` 显式声明，符合最近「无 DOM 依赖测试分流 node 环境」的提交策略（da3d41d4）；测试内无 window/globalThis 操作、无 vi.mock、无共享全局状态，每个用例自建场景，隔离完整。`FakeDisposable` 用 `any[]`、`asSet` 用 `as unknown as Material[]` 属测试侧类型放宽，不影响生产代码 0 逃生的结论。
- **验证结果**：`npm run test -- src/core/__tests__/dispose-helpers.test.ts` → 10/10 通过（34ms）；`npx tsc --noEmit` → 0 错误；`git status` 工作区干净。与项目全量基线（全绿）一致，无需备注异常。

---

审核日期：2026-08-15
审核员：子代理 round17-dispose-helpers
