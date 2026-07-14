# ADR-109: AR 模块审查结论与遗留项排期

> **状态**: `部分实现`
> **阶段**: 审查逐条核实 + 即时修复（#2/#3/#5 已落地 `ce9010b`）+ 遗留项登记（#1/#6/#7 排期）
> **分类**: 架构债 + 审查结论登记
> **日期**: 2026-07-14
> **来源**: AR 模块代码审查报告（10 项指控）+ 逐条源码核实
> **关联**: ADR-037（session UI / zip 布局约定）、ADR-100（相机行为双轴控制）、ADR-104（设计债登记范式）

---

## 背景

AR 模块（含场景序列化、打包、相机系统、AR 模式）收到一份 10 项代码审查报告。逐条核实后发现：**报告整体方向正确，但具体诊断存在 3 处误报、1 处严重低估**。本报告将上述核实结论正式登记，避免下轮审查重复指控（参考 ADR-104「审核的审核」教训：盲从审查会引入回归）。

核实覆盖文件：
- `frontend/src/scene/scene-serialize.ts`、`scene.ts`
- `frontend/src/scene/scene-bundle.ts`
- `frontend/src/scene/ar/ar-scene.ts`
- `frontend/src/scene/camera/camera.ts`
- `internal/app/integration.go`
- `frontend/src/core/utils.ts`、`fileservice.ts`、`i18n/locales/*.ts`

---

## 决策

1. **即时修复（已落地 `ce9010b`）**：#2 打包资源链路断裂、#3 AR 接触阴影不跟随、#5 observer 残留。
2. **关闭误报**：#4（未 await 是有意乐观提交）、#8（`SceneFile` 已普遍用 `?`）、#9（i18n key 五语言全定义）。
3. **登记排期**：#1 循环依赖、#6 性能剖析、#7 错误日志增强，列为遗留项，各自设触发条件，不混入功能迭代。

---

## 详细处置

### A. 打包 `assets/` 前缀链路断裂（#2，已修复，最严重）

**根因（比报告更严重）**：报告称「只缺纹理」，实为**整条链路断裂**。

- `BundleScene`（`internal/app/integration.go:581`）按 ADR-037 布局把资源写入 zip 的 `assets/<rel>`。
- `importSceneBundle` 却把 `libraryRoot` 设为 `extractDir`（cache 根）。
- `resolveLibraryRef`（`frontend/src/core/utils.ts:375` 附近）**不补 `assets/` 前缀**；`rewriteRefsForBundle` 写入的 `libraryRef='models/foo/foo.pmx'` 解析为 `extractDir/models/...`，而文件实际在 `extractDir/assets/models/...`。
- 结果：**连主 PMX 都加载不出**，不仅纹理。

**两步修复（缺一不可）**：

| 步 | 文件 | 改动 |
|----|------|------|
| #2a | `frontend/src/scene/scene-bundle.ts` | `importSceneBundle` 中 `setLibraryRoot(extractDir)` → `setLibraryRoot(normPath(extractDir + '/assets'))`，补偿 `BundleScene` 的 `assets/` 前缀，保持 zip 布局不变 |
| #2b | `internal/app/integration.go` | `BundleScene` 新增 `expandBundleAssets()`：对每条资产按其模型目录递归收集纹理/材质扩展名文件（png/jpg/jpeg/tga/dds/webp/spa/sph/toon/bmp 等）一并入包 |
| 清理 | `frontend/src/scene/scene-bundle.ts` | 删除从未调用的死桩 `collectModelTextures`（coverage 标 not covered，原为空实现） |

### B. AR 接触阴影跟随（#3，已修复）

- **原状**：`_createContactShadow()`（`ar-scene.ts`）仅在 `setARMode(true)` 时调用一次（`ar-scene.ts:157`），模型移动/换焦点后阴影位置与尺寸不变。
- **改为**：`setARMode(true)` 注册 `scene.onBeforeRenderObservable` 每帧回调 `_updateContactShadow()`，按 `_getFocusedFootprint()` 重算聚焦模型 AABB，对已有 `_contactShadow` 做 `position.set(...)` + `scaling = currentRadius/baseRadius`（免重建 mesh），失焦时隐藏；`setARMode(false)` 的 `_disposeContactShadow()` 中 `removeCallback` 精确注销 observer。

### C. observer 残留清理（#5，已修复）

- **原状**：`switchCameraMode`（`camera.ts:628`）的 AR 早退分支（`camera.ts:639-661`）`return` 绕过了「停止当前模式 side-effect」块（`camera.ts:668-680`），使 orbit+骨骼锁 → 切 AR 时 `_boneLockUpdateFn` 等 observer 残留（靠 `camera.ts:1106` 的 `_cameraMode!=='orbit'` 守卫变 no-op，功能无害，但属残留注册）。
- **改为**：将「停止当前模式 side-effect」块前移、合并 `setARMode(false)` 分支，覆盖 orbit→ar / ar→X 全切换路径，消除残留 observer。

### D. 误报关闭（#4 / #8 / #9）

| # | 报告主张 | 核实结论 | 证据 |
|---|---------|---------|------|
| 4 | `switchCameraMode('ar')` 未 `await` 致状态不一致 | **误报**。未 await 是有意乐观提交（`camera.ts:643-646` 注释），为「进入 AR 期间用户切走」的离开检测服务；且 `setCameraState` 已在 `camera.ts:1267` 以 `finalMode !== 'ar'` 跳过 AR 恢复 | 设计意图明确，失败有回退 |
| 8 | `SceneFile` 可选字段未用 `?` 标记 | **误报**。字段已普遍使用 `?`（如 `positionY?: number`）；`CameraState.mode` 弃用迁移已在 `setCameraState` 经 `LEGACY_MODE_MAP` / concert→surround 重定向推进（ADR-100） | 源码已合规 |
| 9 | i18n 缺 key `scene.serialize.modelPathUnresolved` | **误报**。该 key 在 zh-CN/zh-TW/ko/ja/en **全部已定义**（zh-CN.ts:729） | 五语言全定义 |

> 审查方法论提示：#9 举的具体反例在源码中实际存在，说明该审查未跨语言文件核对，结论可信度需打折。

### E. 遗留项登记（#1 / #6 / #7）

均非阻塞、不影响当前功能，按**触发条件**而非优先级数字排期：

| # | 项 | 性质 | 触发条件（何时值得做） | 工作量 | 风险 |
|---|----|------|----------------------|--------|------|
| 1 | `scene` ↔ `scene-serialize` 循环依赖 | 架构债（ESM live binding 下运行时安全，仅影响 Vite tree-shaking） | 有专门「模块拆分」窗口时；提取 `scene-common.ts` 或依赖注入。**不要混进功能迭代**——`scene.ts` 是中枢，重构会 ripple | 中 | 中 |
| 6 | `updateProcMotion` 每帧开销 | 未证实（需运行时剖析） | **先加 DEBUG 门控 `perf.now()` 埋点**，在跑起来的 app 读真实耗时，再决定是否降频/Worker。**无数据不优化** | 小（埋点）/ 中（优化） | 低（埋点） |
| 7 | 错误日志仅 `setStatus` | 真实 UX 缺陷（bundle 导入/导出无详细日志；`deserializeScene` 错误靠 DOM 事件 `scene-restore-errors` 但 UI 不强制监听） | 随时可做，成本最低。加结构化 `showErrorToast` + 开发态打印堆栈。若求快速收益，优先此项 | 小（集中 2 处） | 低 |

---

## 影响范围

| 文件 | 改动性质 | 回归风险 |
|------|---------|---------|
| `internal/app/integration.go` | 新增 `expandBundleAssets()` ~55 行 | 低（仅扩展入包集合，zip 布局不变） |
| `frontend/src/scene/scene-bundle.ts` | `libraryRoot` 指向 `extractDir/assets`；删死桩 | 低（路径补偿，已 `tsc` 验证） |
| `frontend/src/scene/ar/ar-scene.ts` | 每帧阴影更新 + observer 生命周期 | 低（免重建 mesh，失焦隐藏） |
| `frontend/src/scene/camera/camera.ts` | stop 块前移覆盖全切换 | 低（`camera.test.ts` 69/69 通过） |

**无破坏性变更**，zip 对外布局维持 ADR-037 约定。

---

## 验证

- `go build ./...`：✓ 通过。
- `npm run check`（`tsc --noEmit`）：✓ 0 错误。
- `npm run test -- src/__tests__/camera.test.ts`：✓ **69/69** 通过（#5 改动零回归）。
- 已提交：`ce9010b` `fix: AR 审查修复 — 打包纹理收集 + AR 阴影跟随 + observer 清理`（4 files, +112/-45）。

---

## 行动计划

1. ✅ 创建 `adr-109-ar-audit-resolution-and-deferral.md`（本文件）。
2. ✅ 即时修复 #2/#3/#5 并落地 `ce9010b`。
3. ⏸ #1/#6/#7 按上表触发条件排期，不自动实施。
4. ⏸ 遗留项实施时各自开独立 PR，不与功能迭代混批（遵循 `git add -A` 前确认范围惯例）。
