# ADR-131 资源浏览选中结果统一契约（BrowseOutcome）

- **状态**：✅ 已完成（2026-07-20 代码核查确认：BrowseOutcome 类型定义、`activateItem` 派发（stay/jumpToDir/close）、grid 模式适配、`buildLevel` outcome 参数均已落地；旧全局标志位 `modelReplaceTargetId`/`layerBindingTargetId`/`motionBindingTargetId` 已移除）
- **日期**：2026-07-18
- **相关**：ADR-094（模型替换自动返回资源库）、ADR-065（纯 items 层级语言热刷新）

## 背景与问题

资源浏览器（模型库 / 动作库 / 音频 / 相机 VMD）在"选中一个资源后该发生什么"这一行为上，缺乏统一契约。当前实现把**行为语义编码进全局绑定标志位**，再由 `activateItem` / `onModelRowClick` **反向推断**该走哪条分支，并在每个分支里**硬编码 `closeAllOverlays()`**：

| 选中路径 | 位置 | 选中后行为 | 模式来源 |
|---------|------|-----------|---------|
| 模型库正常点选 | `library-actions.ts:368` | `closeAllOverlays()` + load | 无标志 |
| 模型库替换模式（自动跳转） | `library-actions.ts:285-302` | `resetToRoot()` + `push(buildLevel(dir))` | `modelReplaceTargetId` |
| 动作库场景浏览 | `library-core.ts:488` | `closeAllOverlays()` + load | `layerBindingTargetId` |
| 动作库图层/动作绑定 | `library-core.ts:490/494` | `closeAllOverlays()` + load | `layer/motionBindingTargetId` |

这导致三个结构性缺陷：

1. **无法连续预览**：动作库场景浏览每次点选都 `closeAllOverlays()` 收起整个弹窗，用户想依次试听多个动作必须反复重进浏览器（用户反馈"想看多个动作很麻烦"）。
2. **能力不统一**：模型库的"自动跳转"（ADR-094）只是一处局部创可贴，没有上升为契约，因此动作库想要"连续试听"时仍只能套用 `closeAllOverlays` 老路径——问题未被根除。
3. **隐式耦合**：行为正确性依赖全局标志位的"先 set、后反推、再清空"时序，新增资源类型或模式时极易遗漏清理（如 `closeAllOverlays` 内必须同步清空所有绑定标志位）。

## 决策

引入**一等契约类型 `BrowseOutcome`**，由**浏览入口显式声明**"选中后行为"，挂载在 `PopupLevel.outcome` 上；`activateItem` / `onModelRowClick` 直接读取契约派发，**删除所有"靠全局标志位反推 + 硬编码 closeAllOverlays"的散落逻辑**。

```ts
export type BrowseOutcome =
    | { mode: 'close' }                                  // 默认：加载即完成，关闭浏览器
    | { mode: 'stay'; modelId?: string }                 // 连续预览：加载后保持浏览器打开
    | { mode: 'jumpToDir'; modelId?: string; dir?: string } // 加载后回到指定目录（模型替换）
    | { mode: 'bindLayer'; modelId: string }             // 绑定到图层（一次性，关闭）
    | { mode: 'bindMotion'; modelId: string };           // 绑定到动作槽（一次性，关闭）
```

`buildLevel` 增加第 6 个可选参数 `outcome?: BrowseOutcome`（默认 `undefined` ⇒ `{ mode: 'close' }`），对所有既有调用方**向后兼容、零行为变化**。

## 方案

### 1. 类型基座（`core/types.ts`）
- 新增 `BrowseOutcome` 联合类型。
- `PopupLevel` 增加可选字段 `outcome?: BrowseOutcome`。

### 2. 签名扩展
- `library-core.ts` 的 `buildLevel` 增加 `outcome?: BrowseOutcome` 参数并赋给返回 level。
- `core/utils.ts` 的 `stackRegistry.buildLevel` 类型同步增加 `outcome?` 参数。

### 3. 派发（`library-core.ts` `activateItem`）
- 读取 `stack.currentLevel?.outcome`（缺省 `{ mode: 'close' }`）。
- `vmd` + `mode === 'stay'`：`loadManager.load({ kind: 'vmd', modelId })` 后直接 `return`，**不** `closeAllOverlays`。
- 其余 vmd 分支（`layerBindingTargetId` / `motionBindingTargetId`）保留为**兼容回退层**，行为不变。

### 4. 入口迁移（契约实例）
- **动作库场景浏览**（`motion-popup.ts` `__scene_motion_browse__`）：用 `buildLevel(..., { mode: 'stay', modelId: target.id })` 取代 `setLayerBindingTargetId(target.id)`。
- **模型库替换**（`library-actions.ts` `replaceModel` / `onModelRowClick`）：在当前浏览层声明 `{ mode: 'jumpToDir', modelId }` 取代单靠 `modelReplaceTargetId` 反推；全局标志位保留为兼容回退。这把 ADR-094 的"自动跳转"机制**收敛为契约实例**，行为完全不变。

## 影响与风险

| 项 | 说明 |
|----|------|
| 向后兼容 | `outcome` 全可选；既有 `buildLevel` 调用方不传 ⇒ 默认 `close`，行为零变化 |
| 全局标志位 | `layerBindingTargetId` / `motionBindingTargetId` / `modelReplaceTargetId` 暂保留为兼容层（绑定手势仍走老分支）；后续 ADR 可彻底移除 |
| 测试 | 既有 `library-core.test.ts` 的 `buildLevel` 调用（≤5 参）不受影响；需补 `outcome` 相关用例 |
| 并发 | `stay` 模式快速连点由 `loadManager` 既有 `_current` 守卫去重，无新增竞态 |

## 后续

- 将音频 / 相机 VMD / 阶段等资源的"连续选择"需求统一声明为 `mode: 'stay'`，无需再写分支。
- 在绑定手势全部迁移到 `bindLayer` / `bindMotion` 契约后，移除 `layerBindingTargetId` / `motionBindingTargetId` / `modelReplaceTargetId` 三个全局标志位及 `closeAllOverlays` 中的对应清理。
