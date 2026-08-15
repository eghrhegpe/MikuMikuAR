# 第 38 轮审核（2/3）— animation-retargeter 外部动作重定向桥

> **审核范围**
> - 测试文件：`frontend/src/__tests__/animation-retargeter.test.ts`（491 行，4 个 describe / 30 用例）
> - 被测源码：`frontend/src/scene/motion/animation-retargeter.ts`（273 行，全文件）
>   - `loadAndRetargetAnimation` :77-164、`playRetargetedAnimation` :176-209、`stopCurrentRetarget` :52-58、`getRetargetPlayState` :47-49、`restoreRetargetAnimation` :248-273、`_cleanupTempMeshes` :212-237
> - 相关调用方（只读核对）：`menus/motion-root-ui.ts:383-417`（UI 导入流）、`scene/scene-serialize.ts:592-603, 1216-1231`（序列化/反序列化）
> - 方法：read 源码 + 实测 `npm run test -- src/__tests__/animation-retargeter.test.ts` → **30/30 全绿（262ms）**；`npm run check` 因耗时未跑（项目基线全绿，本轮未改任何代码，风险可忽略）

**总体结论：✅ 通过**（0 🔴 P1 / 0 🟠 P2 / 3 🟡 P3 / 6 🟢 P4）

---

## 与 round-11 / round-15 审核的关系（任务要求注明）

- **round-11 P2#7「源 AnimationGroup + 源 Skeleton 泄漏」→ 已修复并被本测试固化**：当前 `_cleanupTempMeshes`（:212-237）统一 dispose 临时 mesh + **Set 去重后的 skeleton** + 全部源 animationGroups，成功路径（:153）与 4 条失败路径（:103/:119/:148/:161）全部调用，代码内 `[fix P2]` 注释（:216, :232）记录修复意图；测试以 dispose 断言固化（见亮点 1）。
- **round-11「零覆盖：animation-retargeter」→ 已补上**：本测试文件 30 用例覆盖加载/映射/播放/停止/恢复全链路，round-11 的改进优先级建议「补 retargeter 测试」已落地。
- **round-11 P3 同型问题残留**：round-11 曾对 motion-intent 标记「getSceneMotions 返回内部可变引用」；本模块 `getRetargetPlayState`（:47-49）同样返回内部可变引用（P4-3）。
- **round-15 motion-full 审核**曾对 animation-retargeter 各维度评「优」，本轮结论与其一致。
- 演进链：`0a2e42cc`（round-11 P2 batch 修泄漏）→ `169e4585`（僵尸 skeleton 修复）→ `2b6dad9a`（2026-08-12 测试反推源码：空映射兜底 +73 行测试）→ 当前 491 行测试文件。

---

## 亮点

1. **round-11 泄漏修复测试固化**：`_cleanupTempMeshes`（animation-retargeter.ts:212-237）用 `Set<Skeleton>` 去重骨架避免二次 dispose（:220-224），mesh/skeleton/动画组三类资源全部释放；测试直击断言——成功路径 `mesh/skeleton/group.dispose` 各被调（test:149-151）、**多 mesh 共享 skeleton 只 dispose 一次**（test:260-273，验证 Set 去重核心逻辑）、多动画组全量清理（test:287-289）。
2. **空映射/未知预设兜底设计**（animation-retargeter.ts:127-132）：`custom` 预设仅在传入非空映射时采用，空对象/未传/未知字符串一律 `?? PRESET_BONE_MAPS.mixamo` 回退，杜绝退化空重定向与 `setBoneMap(undefined)` 崩溃；3 个用例固化（test:291-324），`[fix]` 注释记录决策。
3. **失败路径全覆盖 + 无静默吞错**：ImportMeshAsync 抛错（:92-96）、无动画组（:100-105）、无骨骼（:116-121）、retargetAnimation 返 null/抛错（:145-150/:158-163）、animationGroups undefined（:100）——每条路径均有 `logWarn` + `feedbackStatus` + `_cleanupTempMeshes` 清理；对应 6 条守卫测试（test:154-211, 335-342）。
4. **单例播放状态机**（:176-209）：`playRetargetedAnimation` 先 `stopCurrentRetarget()` 再配置播放，stop 闭包以 `stopped` 标志保证幂等（:196-206）；「播放新动画自动停旧」由测试固化（test:380-393），`stop` 二次调用只清理一次（test:359-368）。
5. **测试 mock 工程素养高**：`vi.hoisted` 共享工厂 + getter/setter 闭包切换返回值/抛错（test:17-65），完全规避 vi.mock 工厂 TDZ（符合 frontend/AGENTS.md 2.3 卫生铁律）；AnimationRetargeter 用**假构造捕获实例**（`retargeterInstances`，test:23-43）实现逐方法断言，比 spy 包装更贴近真实调用；`beforeEach` 全量复位（clearAllMocks + registry 清空 + 实例清空 + stopCurrentRetarget，test:122-130）。
6. **环境选择正确**：`// @vitest-environment node`（test:1）+ 自述依赖 esbuild 剥离纯类型 import（test:8-10），实测 30 用例 262ms 全绿，无需实例化 Babylon 对象。

---

## 风险

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|--------|------|------|------|----------|
| 🔴 P1 | — | — | 无 | — |
| 🟠 P2 | — | — | 无 | — |
| 🟡 P3 | `scene/motion/animation-retargeter.ts` | :77-164（加载无代际守卫） | 并发两次 `loadAndRetargetAnimation` 时先发后至：慢加载完成后 `playRetargetedAnimation` 会停掉较新的播放，覆盖用户最新意图（`stopCurrentRetarget` 保证单例但不保证顺序）；测试未覆盖并发 | 加 generation token（加载开始时递增，完成时校验仍为最新才播放）或模块级 loading 锁；补并发用例 |
| 🟡 P3 | `scene/motion/animation-retargeter.ts` | :43-44, :191-205 | 场景销毁后模块状态未复位：`disposeScene()` 全仓不调用 `stopCurrentRetarget`（仅本模块与测试引用），场景重建后 `_currentRetarget` 仍指向已 dispose 的 group，序列化会写出陈旧 retarget 状态，且 stop 会对已释放 group 调 `stop()/dispose()` | 仿 `physics-bridge.ts:134-138` 挂 `scene.onDisposeObservable → stopCurrentRetarget()`，或接入 `disposeScene` 级联（scene.ts:293） |
| 🟡 P3 | `scene/motion/animation-retargeter.ts` | :156, :193；`restoreRetargetAnimation` :248-273 | custom 映射无法序列化恢复：`boneMapName` 记录的是原 preset 字符串而非实际映射，映射内容不写入 `RetargetPlayState`，恢复路径无 `customBoneMap` 参数 → 静默回退 mixamo。且 UI 路径（motion-root-ui.ts:409）从不传 customBoneMap，「自定义骨骼映射」菜单入口实际永远回退 mixamo，名不副实 | 短期：UI 侧隐藏/标注 custom 入口；长期：将实际映射（或引用）写入 `RetargetPlayState` 并在 restore 时透传 |
| 🟢 P4 | `scene/motion/animation-retargeter.ts` | :63-64, :130 | 2 处 `as unknown as Record<string,string>` + 1 处 `customBoneMap!`（有注释/守卫支撑，非 `as any`） | 可封装类型化访问器（如 `getBoneMap(preset)`）消除强转 |
| 🟢 P4 | `scene/motion/animation-retargeter.ts` | :17, :19 | `Scene`/`Skeleton` 值导入仅作类型用；测试正确性依赖 esbuild 剥离（test:8-10 自述），未来启用 `verbatimModuleSyntax` 会破坏 node 环境测试 | 改 `import type`，与 :16 的 `AnimationGroup` 一致 |
| 🟢 P4 | `scene/motion/animation-retargeter.ts` | :47-49 | `getRetargetPlayState` 返回内部可变引用，调用方可原地改状态（与 round-11 motion-intent P3 同型） | 返回浅拷贝 `{..._currentRetarget}` |
| 🟢 P4 | `docs/knowledge/animation-retargeter.md` | :49, :52-53 | 知识卡 API 漂移：列出 `retargetAndPlay`/`stopRetarget` 及 `RetargetResult.sourceSkeleton`，源码实际为 `loadAndRetargetAnimation`/`playRetargetedAnimation`/`stopCurrentRetarget`，`RetargetResult` 无 `sourceSkeleton` | 按 function-map.md 同步知识卡 |
| 🟢 P4 | `__tests__/animation-retargeter.test.ts` | :156/166/177/190/205/219/296/307/319/338/362/372 等 | `as any`×11 与 `as never`×14 混用；`setTargetSkeleton` 仅断言"被调用"未断言实参（:224） | 参数占位统一 `as never`（比 `any` 更安全）；补 `setTargetSkeleton` 实参断言 |
| 🟢 P4 | `__tests__/animation-retargeter.test.ts` | — | `loop=false` 播放路径、restore 的 custom 回退路径未覆盖（低价值） | 可选补测 |

---

## 测试质量评价

- **数量与结构**：30 用例 / 4 describe（加载+重定向+清理 17、additive 播放+stop 幂等 4、stop/getState 边界 2、场景反序列化恢复 7），实测全绿（262ms），**无任何 skip/xit/todo**。
- **断言有效性**：高。dispose 断言直击 round-11 P2 泄漏修复（含 Set 去重语义）；反馈断言验证 UX 契约（loading/retargeting/success/loadFailed/noAnimation/noSkeleton/failed 全部键名精确匹配）；retargeter 实例方法断言验证映射选择与 3 类回退；播放状态断言验证序列化契约（filePath+preset 精确 toEqual）。
- **mock 合理性**：假对象最小化且形状与源码消费方式匹配——`modelRegistry` 用 `Map`（与 `core/scene-state.ts:43` 真实现一致）、`ImportMeshAsync` 用 `mockResolvedValue` 切换返回值/抛错、`AnimationRetargeter` 用假构造捕获实例、`retargetedGroup`/`retargetImpl` getter/setter 支持按用例切换；`beforeEach` 全量复位保证用例隔离。
- **边界覆盖**：充分——6 条失败/守卫路径、5 条预设回退（custom 有映射/无映射/空对象/未知字符串/vrm）、多 mesh 共享 skeleton 去重、多动画组取首、stop 幂等、播放切换、恢复链路 4 守卫（model 缺失/无 mmdModel/无 skeleton/加载失败不污染状态）。
- **文件头自述的未覆盖项影响**：`_cleanupTempMeshes` 为私有函数未直接调用，但其核心逻辑（mesh/skeleton/group dispose、Set 去重）已被成功/失败路径的间接断言覆盖（test:149-151, 169-171, 270-273, 287-289, 341-342），影响有限，可接受。
- **薄弱点**：并发加载竞态、场景销毁状态复位两场景无测试（对应源码 P3 风险）；个别断言为"被调用"级（`setTargetSkeleton`）。

---

- **审核日期**：2026-08-15
- **审核员**：子代理 round38-animation-retargeter
