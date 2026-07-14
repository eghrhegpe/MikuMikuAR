# 模型管理层代码审核 — 逐条验真 Triage（2026-07-14）

> 范围：`model-ops.ts` / `model-manager.ts` / `model-loader.ts` / `material.ts`
> 方法：对 17 项主张逐条定位真实源码核验（信任但验证）。结论与「直接按审核改代码」相反——**绝大多数主张为误报或已落地，仅 2 项为真实可安全改进，并已实施。**

## 总体裁定

| 类别 | 项数 | 说明 |
|------|------|------|
| 误报 / 已落地 / 过度设计 | 13 | 代码中已处理或主张与事实不符，勿据此改动 |
| 真实且已实施 | 2 | #3 材质分类缓存、#12 材质状态泄漏修复 |
| 真实但需单独评估（推迟） | 2 | #9 AbortController、#14/#16/#17 边缘项 |
| — | — | — |

**请勿据此审核直接重构全局状态（#1）或引入事件总线（#2）——属大型高风险改动，当前代码已用 DI 注入 + 动态 import 规避，且与用户「未经确认不动大改动」铁律冲突。**

---

## 逐条核验

### #1 全局状态过度共享 — ❌ 误报 / 设计意见
- 主张：`modelRegistry/focusedModelId/uiState/mmdRuntime` 暴露于 `@/core/config`，难追踪、难测试。
- 真相：`ModelManager`（model-manager.ts）已封装 registry 与生命周期；`triggerAutoSave` 经**构造函数注入**（`model-manager.ts:191` `private triggerAutoSave` + `scene.ts:237` 传入），规避循环依赖。
- 裁定：DI / Service 化是大型重构，高风险、收益不确定，**拒绝（超出针对性优化范围，需 ADR）**。

### #2 循环依赖隐患 — ❌ 误报 / 已处理
- 主张：`focus()` 动态 import `proc-motion-bridge`、`model-loader` 动态 import `renderer`，运行时仍隐式耦合，`swallowError` 吞错。
- 真相：动态 `import()` 已规避**编译期**循环（model-manager.ts:313、model-loader.ts:318）；`swallowError` 包裹是有意（renderer 未初始化时忽略，不阻断加载）。
- 裁定：当前解耦机制合理，**误报**。

### #3 材质分类重复计算 — ✅ 真实 / 已实施
- 主张：`_catOf(name)` 每次正则匹配，`_applyAll` 每 mesh 调用，调整参数时全量重算。
- 真相：`_applyAll`（material.ts:418 原 :397）确实每 mesh 调 `_catOf(m.name)`。
- 实施：新增 `_catCache`（`WeakMap<Material, {mapRef, cat}>`）+ `categoryOfMaterial()`，按 `uiState.materialCategoryMap` 引用失效，避免 stale；`_applyAll` 改调 `categoryOfMaterial`。增益微小（字符串扫描本就亚毫秒级），但零风险、直接回应主张。

### #4 骨骼叠加层每帧更新 — 🟡 部分误报（已门控）
- 主张：`createBoneOverlay` 的 `updateFn` 每帧遍历所有骨骼。
- 真相：`updateFn`（model-manager.ts:810）已按 `inst.showBoneLines && lineSystem.isEnabled()`（:812）与 `showBoneJoints`（:839）门控；`_boneUpdateObserver`（:891）对未启用 overlay 的实例直接 dispose（:895）。仅用户开启骨骼显示时刷新。
- 裁定：debug 功能、用户显式开启，每帧更新可接受。脏标记为 **P4 可选**，非阻塞。

### #5 频繁触发自动保存 — ❌ 误报
- 主张：`setScaling/setPosition/setMatParams` 每次调 `triggerAutoSave()`，拖拽时大量保存阻塞主线程。
- 真相：`triggerAutoSave`（`core/utils.ts:518`）转发至 `triggerAutoSaveImpl`（`scene-serialize.ts:866`），后者调用 **`_autoSaveDebounced()`**（`scene-serialize.ts:851` `debounce(...)`）。**早已防抖。**
- 裁定：**误报**。

### #6 `_applyAll` 重复应用全量材质 — ❌ 误报 / 过度设计
- 主张：只改一个材质参数却影响所有材质。
- 真相：分类参数（category params）语义上**本就作用于同分类全部材质**，`_applyAll` 遍历全部 mesh 是正确行为；逐材质 override (`_matState`) 在其上叠加。重算成本可忽略（已加 #3 缓存）。
- 裁定：按材质定向更新会破坏分类语义，**过度设计/误报**。

### #7 可选链静默失败 — ❌ 误报
- 主张：`modelManager?.xxx()` 未检查返回值。
- 真相：`?.` 是防御性守卫；`loadPMXFile` 入口已 `if (!_scene || !_mmdRuntime) return null`（model-loader.ts:232）前置检查。
- 裁定：**误报**；加 `isReady()` 守卫属过度工程。

### #8 加载失败资源清理不彻底 — ❌ 误报（已守卫）
- 主张：`createMmdModel` 失败后 `remove(registeredId)` 触发 `onRemoveModel`，可能二次销毁未初始化 `wasmModel` 致崩溃。
- 真相：catch（model-loader.ts:495-516）对 `destroyMmdModel` 与 `remove` **均独立 try/catch**；actor 路径中 `createMmdModel` 抛错时 `registeredId` 仍为 `null`，走 `loadedMeshes` 直删分支（:516），**不会触发 `onRemoveModel`**。即便更晚步骤失败致双重 `destroyMmdModel`，亦被 catch 吞护，不崩溃。
- 裁定：**误报**（无崩溃风险）。

### #9 异步操作缺乏取消机制 — 🟡 推迟（非平凡）
- 主张：`loadPMXFile`/`captureThumbnail` 无 `AbortController`。
- 真相：`ImportMeshAsync` 当前版本不支持 `AbortSignal`；加载竞态已有 `existing` 检查（model-loader.ts:240）+ 缩略图 `_thumbCaptureGen`。引入 AbortController 改动大、收益不确定。
- 裁定：**推迟**，需单独评估（如 Babylon 版本升级后）。

### #10 `any` 类型与类型断言 — ❌ 误报（已守卫）
- 主张：`filter(m => m instanceof Mesh) as Mesh[]` 后直接用；`material` 可能为 `MultiMaterial` 强转 `StandardMaterial`。
- 真相：cast 前已 `instanceof Mesh` 收窄；`_applyAll` 用 `instanceof StandardMaterial` 守卫（material.ts:391 原 :391）。
- 裁定：**误报**。

### #11 全局函数/内部状态暴露 — ❌ 误报（设计意图）
- 主张：`_catState/_matState` 导出供测试破坏封装。
- 真相：显式注释 `@internal exported for testing + pre-capture in scene-loader`（material.ts:358），是有意测试接缝。
- 裁定：**误报**。

### #12 副作用分散（材质状态泄漏） — ✅ 真实（小）/ 已实施
- 主张：`modelManager.remove` 调 `disposeOverlay/restoreMaterials` 但不清理材质状态（`disposeModelMaterialState` 仅在 `model-ops.removeModel` 调），直接调 `remove` 会泄漏。
- 真相：`disposeModelMaterialState`（material.ts:617）清理 `_catState/_matState/_matEnabled`；`model-manager.remove`（:251-280）确实不调它；`model-loader` 加载失败 catch（:504）直接 `_modelManager.remove`，该 id 的材质 map 残留（仅加载失败路径命中，id 唯一不复用）。
- 实施：`model-loader.ts` catch 中 `remove` 后补 `disposeModelMaterialState(registeredId)`（:508-515），并补导入。覆盖唯一直接调用 remove 的路径。

### #13 硬编码魔术字符串 — ❌ 误报 / 已落地
- 主张：物理正则、材质关键词、形成算法常量散落。
- 真相：`PHYSICS_CAT_PATTERNS`（model-manager.ts:34）、`CATEGORY_RULES`（material.ts:183）**均为命名常量**；`uiState.materialCategoryMap` 已支持用户覆盖。
- 裁定：**误报**。

### #14 captureThumbnail 离屏渲染 — 🟢 低优先（设计固有限制）
- 主张：`RenderTargetTexture` + `renderList`，阴影/动态光可能不一致，`readPixels` 阻塞。
- 真相：缩略图生成固有方式；阴影不一致属边缘情况。
- 裁定：**P4**，非阻塞，维持现状。

### #15 applyVPDPose 直接改骨骼 — ❌ 误报（已测试/按设计）
- 主张：直接写 `linkedBone.position/rotationQuaternion`，播放 VMD 会否覆盖存疑。
- 真相：`applyVPDPose` 位于 `model-ops.ts`，已有单测覆盖（model-ops.test.ts：`applies bone transforms and morph weights to a valid model`）；注释明确「WASM runtime 无动画输入时不覆盖」，播放 VMD 覆盖骨骼属**预期行为**。
- 裁定：**误报**（已测试、按设计）。

### #16 focus auto-frame 取景偏移 — 🟢 低优先（P4）
- 主张：遍历全部 mesh（含禁用）算包围盒致偏移；建议缓存。
- 真相：`focus`（model-manager.ts:303）仅在加载/切换时触发（低频）；`computeWorldMatrix(true)`（:321）确保正确。含禁用 mesh 是边缘偏移。
- 裁定：**P4**，缓存收益低（focus 罕见）。

### #17 resolveFileUrl 动态解析 — 🟢 低优先（设计意见）
- 主张：与 Babylon 加载机制耦合紧，不易换后端。
- 真相：`resolveFileUrl` 已封装于 `@/core/fileservice`，平台细节隔离。
- 裁定：**P4**，进一步抽象收益低。

---

## 已实施改动（diff 摘要）

### material.ts（#3）
```diff
+ const _catCache = new WeakMap<Material, { mapRef: unknown; cat: MaterialCategory }>();
+ function categoryOfMaterial(mat: Material): MaterialCategory {
+     const mapRef = uiState.materialCategoryMap ?? null;
+     const hit = _catCache.get(mat);
+     if (hit && hit.mapRef === mapRef) return hit.cat;
+     const cat = _catOf(mat.name);
+     _catCache.set(mat, { mapRef, cat });
+     return cat;
+ }
  // _applyAll 内：
- const p = state.get(_catOf(m.name));
+ const p = state.get(categoryOfMaterial(m));
```

### model-loader.ts（#12）
```diff
- import { _capture } from './material';
+ import { _capture, disposeModelMaterialState } from './material';
  // catch 块内，_modelManager.remove 之后：
+ try { disposeModelMaterialState(registeredId); } catch { /* 不影响主回滚 */ }
```

## 验证
- `npm run check`（tsc --noEmit）：**0 错误**
- 单测：model-manager 87 + model-ops 36 + material-editor 50 = **173/173 全绿**

## 建议
- 该审核**不具备直接执行依据**，请勿据此进行全局状态 DI 化或事件总线重构。
- 如确有必要推进 #9（AbortController）或 #1（DI 化），应单独立 ADR 并走「先计划再执行」流程。
