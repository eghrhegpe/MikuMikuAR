# ADR-206: 测试基础设施收敛与断言质量治理

> **状态**: 🟢 已完成（Phase 0-4 全部完成）
> **日期**: 2026-07-29
> **关联**: [ADR-204](adr-204-unit-test-layering-and-hygiene.md)（单测分层与治理规范，本 ADR 在其拆分成果之上收敛 mock 基础设施）、[ADR-060](adr-060-e2e-testing-strategy.md)（E2E 策略）
> **背景**: ADR-204 P1-P3 已完成 15 个上帝文件拆分（207 文件 / 2428 用例 / 全绿），但拆分暴露了一个认知偏差：**mock 密度高不完全是卫生问题，而是 vitest hoist 的结构性约束**——拆分后 3 个文件各带 44 个 `vi.mock` = 132 处，原来一个文件只有 92 处。真正该治的不是 `vi.mock` 调用数（不可消除），而是**工厂代码的水平重复**与**共享基础设施的空转**。

---

## 一、问题边界

### 1.1 现状清点（2026-07-29 grep 实测）

| 项 | 事实 | 来源 |
|----|------|------|
| 测试文件 | **207 个** `*.test.ts` | `git ls-files` |
| 用例总数 | **~2428** | `npm run test` |
| 断言总数 | **~4660** `expect(` | `grep -cE 'expect\('` |
| 平均每文件断言 | 22.5 | 4660 / 207 |
| 共享 `mocks/` 消费者 | **2 / 207**（仅 `app.contract.test.ts` + `env-lighting.test.ts`） | `grep "from '.*mocks/"` |
| 共享 `fixtures/` 消费者 | **8 / 207**（仅 `menu/*.test.ts`） | `grep "from '.*fixtures/"` |
| 模块级 `-mocks.ts` | **22 个**（ADR-204 P3 拆分产物） | `git ls-files '*-mocks.ts'` |
| 模块级 `-helpers.ts` | **8 个** | `git ls-files '*-helpers.ts'` |
| 死代码 | `mocks/babylon.ts`（220 行）+ `mocks/factories.ts`（120 行）= **340 行零引用** | `grep -r "from '.*mocks/babylon'"` = 0 |

### 1.2 核心矛盾（按杠杆率排序）

1. **共享基础设施空转**：`mocks/` 层有 6 个文件 1434 行，仅 2 个测试文件使用。22 个 `-mocks.ts` 各自为政，重复定义相同的 Babylon 工厂函数。
2. **工厂水平重复**：`model-preset-mocks.ts`、`material-editor-mocks.ts`、`outfit-mocks.ts` 三份各自定义 ~20 个几乎相同的 Babylon 工厂（`mockEngine`/`mockScene`/`mockCamera`/`mockTexture`/`mockMaterial` 等），总计 ~130 行冗余。
3. **mock 密度指标的误导性**：vitest 要求 `vi.mock()` 在每个测试文件顶层调用（hoist 机制），拆分必然增加 mock 调用总数。ADR-204 的「单文件 vi.mock ≤ 20 软上限 / 40 硬上限」应修正为**工厂代码行数**或**内联工厂数**，而非 `vi.mock` 调用数。
4. **断言质量参差**：`toHaveBeenCalledWith` 重度使用者（top 5: 34/32/27/19/19 处）中，3 个是合理的（转发模块/WASM 桥接的本质就是测调用），2 个有改善空间。

### 1.3 非目标

- **不消除 `vi.mock` 调用**：vitest hoist 机制的结构性约束，不可消除。
- **不批量转换断言风格**：转发模块和 WASM 桥接的调用断言是正确模式，不盲目追求「行为断言教条」。
- **不强制拆分所有 >500 行文件**：契约/perf 测试保持整体是正确选择。
- **不新建平行基础设施**：复用已有 `mocks/babylon-classes.ts`（683 行），不另起炉灶。

---

## 二、方案设计

### 2.1 两层 mock 架构

将分散的 mock 基础设施收敛为清晰的两层：

```
mocks/babylon-classes.ts  (683 行，不动)
  └── 底层 Mock 类定义：MockScene / MockMesh / MockMaterial / MockEngine ...
  └── 所有工厂的数据来源

mocks/babylon-factories.ts  (新建，~95 行，从 model-preset-mocks.ts 提升)
  └── 工厂函数：mockEngine() / mockScene() / mockCamera() / mockTexture() ...
  └── 返回 { ClassName: MockClassFromBabylonClasses } 格式
  └── 所有 Babylon/BMD 相关测试的唯一工厂源

各模块 *-mocks.ts  (保留，只放领域特有 mock)
  └── model-manager-mocks.ts: mockModelManager / mockModelRegistry
  └── perception-mocks.ts: mockPipeline / mockState
  └── 不含通用 Babylon 工厂（改为 import from mocks/babylon-factories）
```

### 2.2 Mock 密度指标修正

ADR-204 §2.2 的「单文件 `vi.mock/fn/spyOn` 计数」阈值保留为**参考**，但增加补充指标：

| 维度 | 软上限 | 硬上限 | 说明 |
|------|--------|--------|------|
| `vi.mock` 调用数 | 20 | 40 | 结构性约束，拆分文件必然增加总数，仅作参考 |
| **内联工厂定义数** | 5 | 10 | `function mockXxx()` 或 `const mockXxx = () =>` 在测试文件内的定义数；超线说明应提取到共享层 |
| **mock 代码行数占比** | 15% | 25% | mock 相关代码（vi.mock + 工厂定义 + beforeEach reset）占总行数的比例 |

新增指标的原因：`vi.mock` 调用数不可消除（vitest hoist），但内联工厂定义和 mock 代码占比是可控的——它们反映了真正的重复度。

### 2.3 断言质量分级

不是所有 `toHaveBeenCalledWith` 都该替换。按模块类型分级：

| 模块类型 | 调用断言是否合理 | 理由 | 代表文件 |
|----------|-----------------|------|----------|
| **薄转发/适配器** | ✅ 合理 | 转发模块的行为**就是**调用下游，测调用 = 测行为 | `lipsync-bridge`、`env-bridge/facade` |
| **WASM/外部桥接** | ✅ 合理 | WASM API 本质是指令式的，调用顺序**就是**契约 | `wind-physics-state`、`physics-contract` |
| **有状态输出的业务逻辑** | ❌ 应转行为断言 | 应验证「状态变成什么」而非「调了什么」 | `drop-import`、`replace-model-inherit` |
| **UI builder** | ⚠️ 视情况 | 纯布局允许无测试（ADR-204 已豁免）；有逻辑的 builder 应测 DOM 输出 | `model-detail-ui` |

### 2.4 死代码处置

| 文件 | 行数 | 当前状态 | 处置 |
|------|------|---------|------|
| `mocks/babylon.ts` | 220 | 0 消费者 | 阶段 0 评估：若可作为简单测试的一站式 import 则激活，否则删除 |
| `mocks/factories.ts` | 120 | 0 消费者 | 同上；其功能将被 `babylon-factories.ts` 覆盖 |
| `mocks/binding-factories.ts` | 315 | 被 `fixtures/backend.ts` 部分替代 | 保留（仍有消费者），阶段 0 确认 |

---

## 三、落地路标

### Phase 0：清理死代码（1-2h，零风险）

**目标**：消除 340 行零引用代码，或激活它们。

**步骤**：
1. 评估 `mocks/babylon.ts` 能否被 3+ 个简单测试文件作为一站式 `import './mocks/babylon'` 使用（替代其内联的 15-20 个 `vi.mock` 调用）。
2. 若可以：转换 3+ 个文件，验证全绿。
3. 若不可以（因各文件需要定制 mock 行为）：删除 `mocks/babylon.ts` 和 `mocks/factories.ts`。

**验收**：`npm run test` 全绿；死代码文件数 = 0。

### Phase 1：收敛重复工厂（2-3h，高杠杆）

**目标**：消除 `model-preset-mocks.ts` / `material-editor-mocks.ts` / `outfit-mocks.ts` 之间的 ~130 行重复 Babylon 工厂。

**步骤**：
1. 以 `model-preset-mocks.ts` 为唯一规范源（已被 7 个文件引用）。
2. 编辑 `material-editor-mocks.ts`：删除重复的 Babylon 工厂函数，改为 `import { mockEngine, mockScene, ... } from './model-preset-mocks'`。保留材质编辑器特有逻辑（`_mockMat` 等）。
3. 编辑 `outfit-mocks.ts`：同上，删除重复工厂，保留换装特有逻辑（`mockSceneModule`/`mockT`/`mockToast` 等）。

**验收**：`npm run test` 用例守恒 + 全绿；重复工厂 函数定义数 = 0。

### Phase 2：提升共享层（1-2h）

**目标**：将规范工厂集提升到 `mocks/babylon-factories.ts`，完成两层架构。

**步骤**：
1. 将 `model-preset-mocks.ts` 中的 Babylon 工厂函数移至 `mocks/babylon-factories.ts`。
2. `model-preset-mocks.ts` 改为薄 re-export shim（`export { mockEngine, mockScene, ... } from './mocks/babylon-factories'`），或直接删除并更新所有消费者 import 路径。
3. 其余 `-mocks.ts` 文件中若有 Babylon 工厂定义，统一改为从 `mocks/babylon-factories` 导入。

**验收**：`npm run test` 全绿；`mocks/` 层形成 `babylon-classes` → `babylon-factories` 清晰两层；各模块 `-mocks.ts` 只含领域特有 mock。

> **Phase 0-2 实施记录（2026-07-29）**：
>
> **Phase 0**：删除 `mocks/babylon.ts`（220 行）+ `mocks/factories.ts`（120 行），共 340 行零引用死代码。`mocks/binding-factories.ts`（315 行）有 2 个消费者，保留。验收：215 passed / 2428 tests passed / 0 failed。
>
> **Phase 1**：`material-editor-mocks.ts`（165→50 行）删除全部重复 Babylon/BMD 工厂定义，改为从 `model-preset-mocks` 的别名 re-export + 6 个空模块桩求值为 plain object（`physicsEngineModuleMock`/`tgaLoaderModuleMock`/`mmdSinglePhysicsReleaseMock`/`mmdRuntimeModelAnimMock`/`mmdModelLoaderDefaultMock`/`mmdTextureAlpha*Mock`——消费者按值引用而非函数调用，故必须求值）。`outfit-mocks.ts`（55→33 行）同理，保留换装特有 `mockEmpty`/`mockSceneModule`/`mockT`。关键踩坑：`model-preset-mocks` 的工厂是**函数** `() => ({})`，而 material-editor 消费者按**值**引用 `{}`——re-export 函数名会改变语义，必须对空模块桩单独求值。`_mockMat` 函数在 material-editor 测试中零引用，确认为死代码，随重构一并清除。补充 `mockTexture` 工厂至规范源（原 `model-preset-mocks` 缺失，`outfit` 测试依赖）。验收：215 passed / 2428 tests passed / 0 failed。
>
> **Phase 2**：新建 `mocks/babylon-factories.ts`（95 行），将全部 Babylon/BMD 工厂从 `model-preset-mocks.ts` 提升至此，形成 `babylon-classes`（类定义 683 行）→ `babylon-factories`（工厂函数 95 行）两层架构。`model-preset-mocks.ts` 降级为薄 re-export shim（46 行：33 个 Babylon re-export + 2 个 app mock `mockToast`/`mockPlayback`），7 个消费者无需改 import 路径。`material-editor-mocks.ts` 和 `outfit-mocks.ts` 改为直接从 `./mocks/babylon-factories` 导入（`mockToast` 仍经 `./model-preset-mocks`）。验收：215 passed / 2428 tests passed / 0 failed。
>
> **Phase 3 实施记录（2026-07-30）**：
>
> `replace-model-inherit.test.ts`（16 用例）断言质量改善：将 6 处 `toHaveBeenCalledWith` setter 调用断言收敛为 1 处 `toMatchObject` 行为断言。
>
> 方法：在 `mmState` hoisted 块中注入 `_applied` 数组，setter mock 每次调用时 push 状态快照（`{ visible: v }`/`{ opacity: v }`/`{ wireframe: v }`/`{ physicsEnabled: v }`/`{ scaling: v }`/`{ position: [x,y,z] }`/`{ orbit: [az,el,dist] }`）。测试用例改为 `Object.assign({}, ...mmState._applied)` 合并后 `toMatchObject` 验证最终状态。orbit 测试同理转为 `toMatchObject({ orbit: [30, -5, 10] })` + `not.toHaveProperty('position')` 互斥验证。
>
> 另外两个候选文件（`drop-import.test.ts` 27 处、`playback.observables.test.ts` 18 处）经审查确认调用断言合理（dispatcher/observable 模式，调用 = 行为），不转换。
>
> 验收：224 passed / 2428 tests passed / 0 failed。
>
> **Phase 4 实施记录（2026-07-29）**：拆分最后 2 个 >500 行功能测试文件（契约/perf 测试保持整体）：
>
> **browser-adapter.test.ts**（512 行 / 24 用例）拆为 4 个文件 + 共享 mock：`browser-adapter-mocks.ts`（17 行，`mem` Map + `setStore`/`eqBytes`/`resetMem`）+ `browser-adapter.texture-collision.test.ts`（109 行 / 4 用例）+ `browser-adapter.fsa-auth.test.ts`（124 行 / 10 用例）+ `browser-adapter.fsa-conflict.test.ts`（175 行 / 6 用例，含 `writeSimulatedImport` 领域 helper）+ `browser-adapter.ingest.test.ts`（98 行 / 4 用例）。vi.mock('./idb') 因 hoist 约束各文件内联，但共享 `mem` 实例（普通 const export，非 vi.hoisted）。
>
> **backend.test.ts**（984 行 / 71 用例）拆为 7 个文件 + 共享 mock：`backend-mocks.ts`（44 行，`idbStore` Map + `setWindow`/`clearWebFlag`/`resetIdb` + `goAdapterMock`）+ `backend.capabilities.test.ts`（98 行 / 15 用例）+ `backend.data-chain.test.ts`（204 行 / 20 用例）+ `backend.virtual-dir.test.ts`（100 行 / 9 用例）+ `backend.extract.test.ts`（290 行 / 12 用例）+ `backend.resolve.test.ts`（66 行 / 5 用例，保留 `vi.resetModules()`）+ `backend.fsa.test.ts`（230 行 / 6 用例）+ `backend.update.test.ts`（43 行 / 2 用例）。原 `for` 循环生成 7 个 `it` 块使实际用例数为 71（非 grep 估算的 65）。
>
> 验收：224 passed / 2428 tests passed / 0 failed。剩余 >500 行文件仅 `perception.perf.test.ts`（741，perf 基准）+ `app.contract.test.ts`（646，契约校验），均为 ADR-206 §Phase 4 标注的「保持整体」类型。
>
> **后续收敛记录（2026-07-30）**：
>
> **死代码清理**：删除 `camera-mocks.ts`（268 行，0 消费者），其 8 个 Mock 类已被 `babylon-classes.ts`/`babylon-mmd-mocks.ts`/`camera-adr100-mocks.ts` 完全覆盖。
>
> **工厂去重**：`model-manager-mocks.ts`（272→267 行）3 个与 `babylon-factories.ts` 逻辑完全重复的工厂（`babylonSceneModule`→`mockScene`、`babylonMathColorModule`→`mockMathColor`、`babylonStandardMaterialModule`→`mockStandardMaterial`）改为 re-export。保留 4 个独有定制（MergeMeshes 副作用、Vector3 原型补丁、MeshBuilder/Observable 独有工厂）。
>
> **内部类替换**：`env-mocks.ts`（438→392 行）删除内部 `Vec3`（26 行）和 `Col3`（19 行）类定义，改用 `babylon-classes.ts` 的 `MockVector3`/`MockColor3`（严格超集，6 个消费者仅用构造函数 + 属性读取，完全兼容）。
>
> **空桩收敛**：`material-editor-mocks.ts` 2 个本地 `{}` 空桩改为调用 `babylon-factories` 的 `mockTextureAlphaCheckerVertex()`/`mockTextureAlphaCheckerFragment()`，消除绕过工厂层的硬编码。
>
> 验收：224 passed / 2428 tests passed / 0 failed。至此 `babylon-classes` → `babylon-factories` 两层架构辐射 5 个模块级 mocks 文件，所有 Babylon Mock 类定义和工厂函数收归单一规范源。

### Phase 3：断言质量改善（持续，触碰即改善）

**目标**：对有状态输出的模块，渐进将调用断言转为行为断言。

**候选文件**（按改善空间排序）：

| 文件 | 当前调用断言数 | 改善方向 |
|------|--------------|----------|
| `drop-import.test.ts` | 27 | 部分转为状态断言（注册表内容、场景状态） |
| `replace-model-inherit.test.ts` | 19 | 部分转为结果状态验证（模型属性继承） |
| `playback.observables.test.ts` | 18 | 部分转为 observable 输出值验证 |

**明确保留不动的文件**：

| 文件 | 调用断言数 | 理由 |
|------|-----------|------|
| `lipsync-bridge.test.ts` | 34 | 薄转发模块，调用 = 行为 |
| `wind-physics-state.test.ts` | 32 | WASM 桥接，调用顺序 = 契约 |
| `facade.int.test.ts` | 19 | 集成测试，边界调用模式是合理断言 |

**方式**：不搞批量转换。触碰上述候选文件时（bug 修复、功能变更），评估具体用例是否可转为更稳定的行为断言。

### Phase 4：剩余大文件（低优先级，触碰即改善）

| 文件 | 行数 | 类型 | 处置 |
|------|------|------|------|
| `backend.test.ts` | 984 | 新上帝文件 | 下次触碰时按 ADR-204 阈值拆分 |
| `physics-contract.test.ts` | 961 | 契约测试 | 保持（WASM 初始化成本高，拆分得不偿失） |
| `perception.perf.test.ts` | 741 | 性能基准 | 保持（基准测试需稳定可比条件） |
| `app.contract.test.ts` | 646 | 契约测试 | 保持（AGENTS.md 指定校验入口） |
| `audio.test.ts` | 552 | 功能测试 | 下次触碰时拆分 |
| `model-detail-ui.test.ts` | 536 | UI 测试 | 下次触碰时拆分 |
| `camera.adr100.test.ts` | 523 | 合规测试 | 下次触碰时拆分（仅超硬线 23 行） |
| `browser-adapter.test.ts` | 512 | 适配器测试 | 下次触碰时拆分 |

---

## 四、风险与权衡

| 风险 | 缓解 |
|------|------|
| 提升工厂到 `mocks/` 后 import 路径变长 | 路径别名 `@/` 不适用测试文件（vitest 相对路径语义），但 `./mocks/` 与 `./xxx-mocks` 层级相同，无实质差异 |
| 删除 `mocks/babylon.ts` 后未来可能需要 | 其功能由 `babylon-factories.ts`（Phase 2）覆盖，不会丢失能力 |
| 断言转换中引入假阳性/假阴性 | 触碰即改善，不批量操作；转换时保留原调用断言作为辅助验证 |
| `model-preset-mocks.ts` 被提升后，其 7 个消费者需更新 | 可用 re-export shim 过渡，不要求原子切换 |

---

## 五、决策

采用**两层 mock 架构 + 工厂收敛 + 断言分级 + 死代码清理**的渐进治理方案。核心认知修正：**mock 密度的真正敌人不是 `vi.mock` 调用数（vitest 结构性约束），而是工厂代码的水平重复**。

Phase 0-2 半天工作量，解决 80% 的结构性问题（死代码清理 + 工厂去重 + 共享层就位）。Phase 3-4 按触碰即改善渐进推进，不搞大爆炸。

---

## 六、与 ADR-204 的关系

ADR-204 解决了「文件太大」和「分层缺失」两个维度（拆分 + L1/L2 脚本）。本 ADR 在其成果之上解决剩余两个维度：「共享基础设施空转」和「断言质量参差」。两个 ADR 共同构成单测治理的完整框架：

| 维度 | ADR-204 | ADR-206 |
|------|---------|---------|
| 文件大小 | ✅ 拆分阈值 + 上帝文件拆解 | — |
| 分层模型 | ✅ L1/L2/L3 + 命名约定 | — |
| Mock 共享 | 提出规范，实施不足（复用率 2/131） | ✅ 两层架构 + 工厂收敛 + 死代码清理 |
| Mock 密度指标 | `vi.mock` 计数（结构性约束下误导） | ✅ 修正为内联工厂数 + mock 代码占比 |
| 断言质量 | 未涉及 | ✅ 分级模型 + 候选改善清单 |
| fixtures | 提出规范，P2 落地 `backend.ts` + `menu.ts` | 保持（已够用） |
