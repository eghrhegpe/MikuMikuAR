# transform-gizmo 模块 — 审核结果（round-26 / 测试反推源码）

## 一、审核范围

| 项 | 内容 |
|----|------|
| 测试文件 | `frontend/src/__tests__/transform-gizmo.test.ts`（490 行，37 用例，无跳过，`@vitest-environment node`） |
| 被测源码（主目标） | `frontend/src/scene/render/transform-gizmo.ts:46-64`（`initTransformGizmo` 场景重建守卫）、`:85-99`（`computeSnapDistance` 三轴派生纯函数）、`:126-219`（`attachGizmo` 独占策略+拖拽回调+吸附应用）、`:222-249`（`detachGizmo` 拖拽中 flush 回写）、`:293-307`（`setGizmoSnapDistance` 实时生效） |
| 同文件附带 | `_getOrCreateLayer`（`:66-78`）、查询函数组（`:254-286`）、`getGizmoSnapConfig`（`:310-312`） |
| 依赖模块（mocked） | `@babylonjs/core/Gizmos/{positionGizmo,rotationGizmo,scaleGizmo}`、`Rendering/utilityLayerRenderer`、`Misc/observable`、`@/core/dispose-helpers`（safeDispose）、`@/core/logger`（logWarn） |
| 生产调用点（抽查） | `scene/transform/transform-adapter.ts:69-83`（attachGizmoForKind 收敛）、`scene/scene.ts:319-321`（disposeScene 级联 detachGizmo）、`scene/render/lighting.ts:168`（initTransformGizmo） |
| ADR 核实 | ADR-126（Phase 2 双模态 / Phase 3 吸附，含审核后 P4 修复：`computeSnapDistance` 抽纯函数 + 单测扩展）与实现逐条一致；ADR-048 经知识卡确认是 Gizmo 统一抽象的文档锚点 |

**验证结果**：`cd frontend && npm run test -- src/__tests__/transform-gizmo.test.ts` → **37/37 通过（310ms）**。`npm run check`（tsc + i18n 全量）→ **exit 0 通过**。

## 二、总体结论

✅ **通过**

- **生产代码健康**：无 P1/P2 活动缺陷。类型安全（0 处 `as any`/`@ts-ignore`，唯一强转 `as AbstractMesh` 有注释说明业务理由）；资源释放完备（detachGizmo/initTransformGizmo 双路径 safeDispose 全量 gizmo+layer，`shouldRender` 复位）；异常处理到位（flush 循环 try/catch + logWarn、onDragEnd 先复位 `_isDragging` 再调用户回调——回调抛异常不卡死拖拽态）；状态流清晰（attach→detach 状态机、场景重建守卫、独占策略均由单一模块级单例承载）。
- **测试质量**：37 用例覆盖主目标全部行为面（吸附派生数学 / 场景重建守卫 / 独占 / 拖拽回调 / flush 幂等 / 异常韧性 / 实时生效 / 边界类型），断言落在真实行为而非 mock 自证；`vi.resetModules()` + 动态 import 正确隔离模块级单例。
- **附带发现**：3 项 P3（重入守卫 / attach 非原子 / 空 types 成功语义）+ 6 项 P4（魔法数值 / 文档漂移 / 测试侧小项），均不阻断通过，见风险表。

## 三、亮点

- **吸附派生抽为导出纯函数**（`transform-gizmo.ts:85-99`）：`computeSnapDistance(type, enabled, step)` 无模块状态依赖，单测可直接验证三轴数学（position→step / rotation→step·π/12 / scale→step·0.1 / enabled=false→0 / 未知类型→0）——正是 ADR-126 Phase 3 审核 P4「原 `_snapFor` 私有不可测」的修复落地，`_snapFor` 委托之（`:102-104`），可测性设计正确。
- **拖拽中 detach flush 回写机制**（`:34-37` 收集 `_activeDragEndCallbacks`、`:222-237` flush 循环）：拖拽中切换选中/关闭开关时 Babylon 已实时改写 transform 但 `onDragEndObservable` 不再触发——flush 一次保证位移落入持久化 + autosave，杜绝「视觉与保存状态分叉」；flush 回调逐个 try/catch + `logWarn`（`:230-234`），单回调抛错不阻断其余回调且不崩。
- **onDragEnd 先复位再回调**（`:157-160` / `:179-182` / `:201-204`，P3 fix）：`_isDragging = false` 先于用户回调执行，用户回调抛异常不会让 `scene.ts` 点击拾取闸 `isGizmoDragging()` 永久闸死——测试 `:320-331` 用抛错回调真实验证了复位顺序（`toThrow` + `isGizmoDragging()===false`）。
- **场景重建守卫 + 订阅保留注释**（`:46-64`）：`_scene` 引用比较触发全量释放重置；刻意**不清空** `onGizmoDragObservable` 并给出完整推理（滑杆订阅无重订阅钩子，clear 会丢实时更新），行为有注释背书。
- **独占策略 + Set 去重**（`:132` detachGizmo() 前置、`:144` `[...new Set(options.types)]`）：二次 attach 自动释放上一个；types 含重复项只建一个 gizmo，修复「同类重复创建→后者覆盖前者泄漏」的 P4 缺陷。
- **防御性守卫**（`:66-78`）：`_getOrCreateLayer` 显式抛「layer requested before init」代替此前 `_gizmoLayer!` 空值穿透（disposeScene 后未 re-init 的编程错误会得到明确报错而非运行时 crash）。
- **测试隔离范式正确**：`vi.hoisted()` 共享 mock 工厂（`test:12-56`，符合 frontend AGENTS.md「vi.mock 工厂只可引用 hoisted 绑定」规则）+ `vi.resetModules()` + beforeEach 动态 import（`:93-97`）——模块级单例每测重建；`@vitest-environment node` 分流符合 ADR-255；7 个运行时 import 全量 mock、type-only import（Scene/Node/AbstractMesh）编译期擦除无需 mock，mock 面恰好完整。

## 四、风险表

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|--------|------|------|------|----------|
| 🔴 P1 | — | — | 无 | 无 |
| 🟠 P2 | — | — | 无 | 无 |
| 🟡 P3 | frontend/src/scene/render/transform-gizmo.ts | detachGizmo:226-237 | **flush 循环重入缺口**：flush 前只清空 `_activeDragEndCallbacks`，`_isDragging`/`_gizmoNode` 在循环**之后**才复位。若某个 flush 回调（用户 drag-end 持久化回调）同步重入 `attachGizmo()`，内层 attach 新建的 gizmo/layer 与新 `_gizmoTargetId` 会被外层 detach 循环后续的 dispose/置空逻辑**静默覆盖**（重入的 attach 白做）。当前适配器回调（modelManager.setPosition 等）不会重入，属潜在缺陷非活动 bug；测试未覆盖该分支。 | 进入 flush 循环前先捕获并置空 `_isDragging`/`_gizmoNode`（或加 `_detaching` 重入守卫标志），使回调重入与本次 detach 完全隔离；补一条「flush 回调内 attachGizmo」用例。 |
| 🟡 P3 | frontend/src/scene/render/transform-gizmo.ts | attachGizmo:146-218 | **attach 非原子**：先 detach 再逐个 `new` gizmo，若中间类型构造抛错，已创建的同类 gizmo 与 `layer.shouldRender=true` 残留、`_gizmoTargetId` 未设置（半 attach 状态），且 `_gizmoLayer` 已复用无回滚。当前 Babylon 构造在 layer 有效时不抛，属防御性缺口。 | 循环包 try/catch：失败时回滚已建 gizmo（safeDispose）并复位 `shouldRender` 后 rethrow；或先建全部实例再统一接线。 |
| 🟡 P3 | frontend/src/scene/render/transform-gizmo.ts | attachGizmo:216-218 | **空/全未知 types 的成功语义含糊**：`types: []` 或全为未知类型时仍返回 true 并记录 `_gizmoTargetId` → `isGizmoActive()===true` 但无任何可视 gizmo。`transform-selection.ts:64-89` 的重试逻辑把返回值当「attach 成功」信号，若未来某 kind 适配器返回空 types 会误判。当前三个适配器恒传非空 types（lighting point 灯也含 position），不可达；测试已将行为钉为契约（`:227-235`、`:479-489`）。 | 二选一：① 无任何 gizmo 创建时返回 false 且不记录 target；② 保持现状但加注释声明该语义，并在 GizmoAttachOptions.types 文档注明「必须非空」。 |
| 🟢 P4 | frontend/src/scene/render/transform-gizmo.ts | computeSnapDistance:93,95 / attachGizmo:172 | 魔法数值：`Math.PI / 12`（15° 派生）、`0.1`（scale 派生）、`32`（RotationGizmo 细分）均为内联硬编码，语义仅靠注释；测试侧 `π/12`/`0.1` 亦重复出现，两侧改一处漏一处。 | 抽模块级命名常量（`ROTATION_SNAP_DIVISOR = 12`、`SCALE_SNAP_FACTOR = 0.1`、`ROTATION_GIZMO_SUBDIVISIONS = 32`），测试引用同一语义。 |
| 🟢 P4 | frontend/src/scene/render/transform-gizmo.ts | attachGizmo:140 | `options.node as AbstractMesh` 类型强转（非 `as any`，`:137-139` 注释说明 Light 兼容理由），运行时依赖 Babylon 接受非 mesh node。 | 保留注释；Babylon 升级时校验收紧行为，必要时改 `attachedMesh` 或运行时适配。 |
| 🟢 P4 | frontend/src/scene/render/transform-gizmo.ts | _getOrCreateLayer:70-72 | throw 分支（layer requested before init）经公开 API 不可达（attachGizmo 前置 `!_scene` 守卫），防御性代码无测试覆盖。 | 可接受（防未来内部误用）；如需覆盖可加内部测试注入点，非必须。 |
| 🟢 P4 | docs/knowledge/transform-gizmo.md | :29、:34 | 知识卡 API 摘要过时：写 `attachGizmo(type, node, id)` / `setGizmoSnapDistance(step)`，实际签名是 `attachGizmo(options: GizmoAttachOptions)` / `setGizmoSnapDistance(enabled, step?)`（ADR-126 Phase 3 后已变更）。 | 同步知识卡「对外 API（节选）」，与 `docs/function-map.md` 口径一致。 |
| 🟢 P4 | frontend/src/__tests__/transform-gizmo.test.ts | :71-72、:122、:140、:469、:481 | 测试侧用 `as never` 大量规避参数类型（scene/node 桩、未知类型、helper 泛型）——测试非生产代码，无运行时风险，但降低可读性且与「有界断言」精神不符。 | 定义最小 `interface StubNode { id: string }` 并 `as unknown as Node` 收口，未知类型用例保留 `as never` 需注释意图。 |
| 🟢 P4 | frontend/src/__tests__/transform-gizmo.test.ts | :183 | `expect(shared.Observable).toHaveBeenCalled()` 为**弱断言**：Observable 构造发生在模块 import 时（`onGizmoDragObservable = new Observable()`），无论是否拖拽该断言恒真，不验证「拖拽连续通知」；真正验证在 `:386-394` describe（spyOn `notifyObservers`）。 | 删除该行（`:386-394` 已覆盖），或将此处改为断言 `onGizmoDragObservable.notifyObservers` 被调用。 |

## 五、测试质量评价

- **有效性**：✅ 强。吸附数学用 `toBeCloseTo` 验证派生值（position→step、rotation→step·π/12、scale→step×0.1，`:106-119`）；独占策略断言 `first.dispose` 被调 + target/类型切换（`:217-225`）；flush 语义用 `toHaveBeenCalledTimes(1)` 与「两次 detach 幂等」（`:309-318`）；异常韧性断言 logWarn + 不崩 + 拖拽态复位（`:298-307`、`:320-331`）；实时生效断言三个 gizmo 的 `snapDistance` 具体数值（`:339-347`）；RotationGizmo 全自由度参数被 `toHaveBeenCalledWith(expect.anything(), 32, true)` 钉住（`:191`）。
- **合理性**：✅ mock 面恰好完整——被测模块 7 个运行时 import 全量 mock（`test:58-66`），type-only import（Scene/Node/AbstractMesh）无需 mock；`safeDispose` mock 返回 `null` 与生产契约一致；`Observable` mock 含 `add/remove/notifyObservers` 满足生产调用面；`UtilityLayerRenderer` mock 可变 `shouldRender` 支撑「detach 后重建 layer」断言（`:265-272`）。`vi.hoisted` 共享 + `resetModules` 动态 import 符合仓库测试卫生铁律。
- **边界覆盖**：✅ 全面——未 init 直接 attach（false+不构造）、重复 attach 独占、**拖拽中二次 attach flush 一次**（`:250-263`）、拖拽中 detach flush、双 detach 幂等、未 attach detach 幂等、空 types、重复 types 去重、未知类型忽略、仅未知类型、step=0/负值、无激活 gizmo set snap 不崩、先 set 再 attach 应用配置。缺口仅两处低危：flush 回调重入 attach（对应生产 P3-1）与 attach 中途构造抛错回滚（对应生产 P3-2），均为生产同款防御路径。
- **模块级单例隔离**：✅ `vi.resetModules()` + beforeEach 动态 import 每测重建模块态（`:93-97`）；`vi.clearAllMocks()` 同时清 `mock.instances`，`lastInstance` 辅助函数（`:74-76`）每测取到新实例，无跨用例串扰。
- **跳过**：✅ 无 `it.skip`/`describe.skip`/`xit`/`.only`/`.todo`（grep 确认）。
- **可执行性**：✅ 单文件 310ms；node 环境下纯 mock 驱动，无真实 Babylon/WebGL 依赖，无脆弱环境耦合。
- **脆弱性**：⚠️ 辅助函数 `dragEndCb`/`dragStartCb`/`dragCb` 读 `add.mock.calls[0][0]`（`:78-91`），隐含「每个 observable 恰注册一次回调」前提——当前生产如此，若未来某类型注册多个回调会静默取到第一个；建议加注释声明该前提。

## 六、附注

- 与 ADR-126 逐条对齐：Phase 2（onGizmoDragObservable 只显示同步不持久化、防 triggerAutoSave 风暴）、Phase 3（snap 三轴派生 + 默认关闭零副作用 + 实时生效）、审核后修复（computeSnapDistance 抽纯函数 + 单测扩展）全部在源码与测试中可核验；吸附为全局偏好（场景重建不清 `_snapEnabled/_snapStep`），测试 `:367-374` 间接锁定。
- 知识卡 `docs/knowledge/transform-gizmo.md` 的 API 摘要漂移（见 P4-4），属文档债，不影响本次结论。
- 审核日期：2026-08-15
- 审核员：子代理 round26-transform-gizmo
