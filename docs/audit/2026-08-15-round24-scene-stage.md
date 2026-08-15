# [scene-stage] 审核结果 — 第 24 轮 · 测试 3/3

## 审核范围

| 项 | 值 |
|----|----|
| 测试文件 | `frontend/src/__tests__/scene-stage.test.ts`（584 行，26 个用例，vitest run 全绿，380ms） |
| 被测源码 | `frontend/src/menus/scene-stage-levels.ts`（1–211 行，`buildStageSchema` / `buildStageLevel` / `buildStageTransformLevel`） |
| 说明 | 任务描述指向 `scene/stage.ts`，grep 定位后**不存在**该文件；被测模块实为 `menus/scene-stage-levels.ts`（scene-render-levels.ts 拆分产物，见 scene-render-levels.ts:3）。舞台渲染（地面/水面/反射）在 `scene/env/*`，不在本测试覆盖内 |
| 依赖链 | core/config、core/feedback、core/icons、core/ui-helpers、scene/manager/model-ops、scene/scene、scene-menu-state、resource-detail-helpers、core/i18n/t、render-menu、menu-schema（前 4 者与 i18n/render 链真实加载，其余 mock） |
| 验证 | `cd frontend && npm run test -- src/__tests__/scene-stage.test.ts` → 26 passed (26) |

**总体结论：✅ 通过**（无 P1/P2；P3 两项均不阻塞，属可优化项）

---

## 亮点

- **共享 mock 工厂铁律符合**：`vi.mock('../core/state', () => stateMockSuperset({ envState: mockEnvState }))`（测试:64）复用 `stateMockSuperset`（mocks/state-superset.ts），opts 只覆盖测试定制字段，与 `motion-modules-timed.test.ts:32` 用法形状一致，无内联差异化；工厂引用 hoisted/import 绑定，无 TDZ 隐患。
- **god-barrel mock 保留活绑定**：`vi.mock('../core/config', async (importOriginal) => ({ ...(await importOriginal()), ... }))`（测试:38-54）——符合「async importOriginal spread 禁静态化」铁律（core/config 是 `export *` barrel，静态超集会断开活绑定）。
- **异步加载流程三段守卫 + 错误反馈**（scene-stage-levels.ts:38-62）：`getBrowseDir` 为空 → `feedbackStatus('scene.statusNoModelLib')` 早退；`getSceneMenu()` 为空 → 静默早退；`buildLevel` 抛错 → `feedbackStatus('scene.statusOpenStageLibFailed')` + `console.error`。测试三个分支全覆盖（测试:329-342 / 371-397 / 470-484）。
- **破坏性操作撤销保护与 ADR-127 一致**（scene-stage-levels.ts:127-138）：`pushUndoSnapshot → removeModel → reRenderSceneMenu → offerSceneUndo(onRestored 重渲染)`；测试对 offerSceneUndo 的 msg/snap/onRestored 三参数做提取断言（测试:308-327），并单独验证 onRestored 触发 reRender（测试:433-448）。
- **渲染实时快照，无陈旧状态**：`buildStageSchema` 每次 `renderCustom` 时从 `modelRegistry.entries()` 现取舞台列表（scene-stage-levels.ts:20-22、166-169），列表变更后经 `reRenderSceneMenu()` 自愈，无幽灵路径。
- **dispose 链透传**：`buildStageLevel.renderCustom` 返回 `renderMenu(...)` 的级联 dispose（scene-stage-levels.ts:166-169，render-menu.ts:26-39），测试断言其为函数（测试:498-503）。
- **测试断言参数级为主**：`toHaveBeenCalledWith` 精确参数（setModelVisibility/removeModel/feedbackStatus/feedbackInfo/buildLevel 四参）、回调参数解构校验（filter 全分支含空对象，测试:450-468）、事件冒泡抑制（测试:410-418，验证 `e.stopPropagation()` 生效）。26 用例无任何 skip。

---

## 风险

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|--------|------|------|------|----------|
| 🟡 P3 | scene-stage.test.ts | 86 / 91 / 92 | 三个 mock 路径相对测试文件解析：`./scene-menu` / `./env-ground-levels` / `./env-water-levels` → `src/__tests__/` 下不存在（glob 证实），与项目惯例 `../menus/scene-menu`（env-feature-levels.contract.test.ts:61、library-core.test.ts:48 等 6 处）不符，**不会命中真实模块，是死 mock**。且 `./scene-menu` mock 形状含 `reRenderSceneMenu`——真实 scene-menu.ts 不导出该符号（在 scene-menu-state，测试实际用的是真实 scene-menu-state），形状与真实导出不符。当前真实链路无人加载 scene-menu.ts（依赖链已被 scene/scene、model-ops、resource-detail-helpers 的 mock 切断，core/config barrel 也不触 menus），故无实际危害，但注释宣称的「防止 importActual 链加载真实 scene-menu」防护实际未生效 | 删除三处死 mock；若确需防护，改为 `vi.mock('../menus/scene-menu', ...)` 并核对真实导出（getSceneMenu/showSceneMenu/refreshRoot 等） |
| 🟡 P3 | scene-stage-levels.ts | 183–209 | `buildStageTransformLevel.renderCustom` 不返回 dispose，menu.ts 的 `_customDispose` 清理链（menu.ts:1090-1094、1141）接不到；其依赖的 `buildTransformCard` 注册了模块级 `onGizmoDragObservable` 订阅（resource-detail-helpers.ts:47、233），面板关闭后订阅存活到下次 gizmo 事件才经 guard 自清理（:205-210）。不累积（重建前先 remove，:147-150），但语义上「销毁不释放」 | renderCustom 返回清理函数，或让 buildTransformCard 返回 dispose 并透传；与 buildStageLevel 的 dispose 语义对齐 |
| 🟢 P4 | scene-stage.test.ts | 158–198 | `_findToggleRow` 死代码 helper（前缀 `_` 声明未使用），查询 .collapsible-header/.toggle-row 结构 | 删除或改为真实断言使用 |
| 🟢 P4 | scene-stage.test.ts | 480 | `await new Promise((r) => setTimeout(r, 0))` 依赖微任务时序等动态 import 完成，脆弱 | 改用 `vi.waitFor(() => expect(mockBuildLevel).not.toHaveBeenCalled())` 类轮询 |
| 🟢 P4 | scene-stage-levels.ts | 113–122 / 127–138 | leading（可见性）与 trailing（卸载）回调重复 `e.stopPropagation() + 操作 + reRenderSceneMenu + feedback` 接线模式 | 可提取小工厂，属低价值重构 |
| 🟢 P4 | scene-stage-levels.ts | 21 / 54 / 185 | `'stage'` / `'scene'` kind/type 字符串字面量、`'✕'`、icon 名（lucide:eye 等）为魔法值；core/types.ts:319 `LibraryModel.type` 已是 `string`，可误传任意值 | 集中 kind/type 联合类型常量，编译期约束 |

---

## 测试质量评价

- **断言有效性：高**。26 个用例绝大多数为参数级断言（与源码实参逐一核对一致：feedbackStatus 双分支、buildLevel(dir, label, filter, sm) 四参、buildTransformCard/buildMaterialCard/buildDangerCard 的 handle/onRemoved/targetStack 提取、offerSceneUndo 三参），DOM 断言用 textContent/querySelector/`data-testid`，异步统一 `vi.waitFor`。
- **mock 合理性：符合铁律**。core/state 复用共享工厂 stateMockSuperset 且无内联差异化（§2.3）；core/config 保留 `...(await importOriginal())` 活绑定；scene/scene 完整 mock 必要性成立——scene.ts:245 模块级 `new Scene(engine)` 副作用必须阻断（注释准确）；全部 mock 工厂仅引用 hoisted/import 绑定。
- **边界覆盖：完整**。空场景双空态（241-251）、未知舞台 id 回退（537-545）、菜单未注册早退（420-431）、browse 后菜单消失早退（470-484）、buildLevel 抛错分支（371-397）、可见性双向切换（296-306 / 399-408）、卸载撤销与 onRestored（308-327 / 433-448）、filter 全分支含 `{}`（450-468）、多舞台渲染（486-496）、dispose 返回（498-503）。无跳过用例。
- **未覆盖点（非阻塞）**：buildStageTransformLevel 的 renderCustom 返回值未断言（与 P3-2 呼应，源码确实不返回 dispose）；多舞台下逐行可见性图标的 eye/eye-off DOM 未断言；连续重复 buildStageLevel 的幂等性无显式用例（各测试反复重建隐含覆盖）。

---

审核日期：2026-08-15
审核员：子代理 round24-scene-stage
