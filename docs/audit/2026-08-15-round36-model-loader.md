# round36 — model-loader Stage/Actor 全路径 + abort 清理 + 回调验证审核

**审核日期：** 2026-08-15
**审核员：** 子代理 round36-model-loader（第 36 轮第 2 个测试）

## 审核范围

| 类别 | 文件 | 行号 |
|------|------|------|
| 测试文件 | `frontend/src/__tests__/model-loader.test.ts` | 1–622（全量，21 用例） |
| 被测源码 | `frontend/src/scene/manager/model-loader.ts` | 1–870（全量：initLoader / captureThumbnail / collectTextureFiles / _applySceneMotion / loadPMXFile） |
| 关联源码 | `frontend/src/scene/motion/vmd-loader.ts` | 1–60（_applySceneMotion 动态 import 链，未 mock 的模块树） |
| 历史关系 | `docs/audit/2026-08-06-round13-scene-render-core-ui.md` | L123、L140（model-loader 知识卡漂移 + 整模块零覆盖） |
| 历史关系 | `docs/adr/adr-251-scene-circular-import-cleanup.md` | 全量（scene 反向 import 治理；model-loader 不在环内） |
| 历史关系 | `docs/audit/2026-08-06-round11-core-backend-serialize-motion-menu.md`、`2026-08-15-round24-library-state.md`、`2026-08-15-round30-library-thumbnail-streaming.md`、`2026-08-15-round29-thumbnail-capture.md` | library 读侧链路 / 缩略图键收敛 / 并发生成守卫 |

**历史关系与遗留（任务要求注明）：**
- **round-13（2026-08-06）**：审核过 model-loader（21 模块之一），记录两件事——① 知识卡漂移「加载锁/重复检测/清理由 scene.ts 编排器负责」不实（实际均在 model-loader.ts 内 L434/448/724）；② 测试覆盖缺口「model-loader 整模块零覆盖」。**本测试文件正是对 round-13 缺口 #2 的直接补位**：L434（自动取消前一次加载）、L448（existing 快速路径）、L724→733（abort 后清理）均已覆盖，另有 stage/actor 全路径 + abort mesh 清理 + 回调验证。**缺口 #1（知识卡漂移）仍未修**——`docs/knowledge/model-loader.md:24/50` 仍写「加载锁/重复检测/清理由 scene.ts 编排器负责」，为 round-13 遗留债务，见风险表 P4。
- **ADR-251（scene 反向 import 循环依赖治理）**：目标环是 `model-ops/camera/camera-auto → ../scene`；**model-loader 不在环内**——它经 `initLoader` 回调注入（`model-loader.ts:91-121`，注入 reGroundAllModels / tryAutoApplyPreset / loadOutfits 等）切断对 scene.ts 的反向依赖，符合 ADR-251 红线 1 的「新代码一律走注入回调」方向。本测试的 25+ 模块 vi.mock 集（含 `@/scene/physics/wind-physics`、`../scene/env/env-impl` 等）恰好实证了该注入 seam 的可解耦性，未引入任何新环。另 `vmd-loader` 动态 import（:369）与 `@/core/config` 动态 import（:676）延续 round-31 web-dynamic-import 审计的「改静态会重新引入 core↔scene 循环」结论。
- **round-11 / round-24 library 链路**：round-11 审 library-core（加载链读侧编排），round-24 library-state / round-30 library-thumbnail-streaming + thumbnail-key 契约测试将读侧键（library-core.ts:194-200）与写侧键（model-loader.ts:211）收敛到 thumbnail-key.ts 单一实现（round-30 P2 根治）。**本测试覆盖写侧触发端**（stage :630-632 / actor :806-808 的 setTimeout captureThumbnail），与 thumbnail-key 契约测试互补不重叠：契约测试护「key 推导一致」，本测试护「缩略图确被触发」。round-29 审过 thumbnail-capture（_thumbCaptureGen + 物理冻结双层），本测试的 captureThumbnail 用例仅断言 `renderInstanceThumbnail` 被调；冻结/恢复与互斥逻辑由 thumbnail-capture 自身测试覆盖。**遗留**：round-29 登记的 P3「物理冻结保存→填 0→恢复在 model-loader:181-186/222-225 与 thumbnail-capture:184-191/257-261 双层重复」仍未修（见风险表 P4 附带）。
- **round-15 P2**：stage 分支注册后 abort guard（:587-600）为 round-15 修复，本测试 :4-6 头注释 + 用例 :148-158/:160-166 明确记录其「结构上不可达、v8 ignore」的判定并验证不破坏既有 guard——测试对不可达代码的处理方式诚实且可审计。

## 总体结论

✅ **通过**（0 项 P1 / 0 项 P2；4 项 P3 维护建议，不阻断）

- 生产代码：abort 六道防线 + 三岔清理 + 回调异常隔离，资源释放链路完整，类型安全（0 处新增 `as any`/`@ts-ignore`，仅 1 处有注释的双重断言 `as unknown as File[]`，为 fork 类型声明偏差的既有合理转义）。
- 测试：21/21 全绿（Vitest 4.1.9，实测 4.24s），0 跳过；abort 清理与并发取消用例为真实断言，非形式断言。
- 4 项 P3 均为维护/测试强度问题，不构成功能缺陷。

## 亮点

- **abort 六道防线**（`model-loader.ts`）：`AbortSignal.any([signal, abortCtrl.signal])` 合并外部取消 + ADR-096 内部自动取消（:441，`??` 回退会失效内部取消，注释已声明）；guard 分布 473（读阶段）/ 508（import 后 mesh 清理）/ 592（stage 注册后，防御）/ 733（actor 注册后，防御）/ `_applySceneMotion` :406（VMD 后 remove registeredId）；`finally` 条件清引用 `if (_loadAbortController === abortCtrl)`（:866-868）与 library-core.ts:306-313 同范式。
- **abort 后 mesh 全量释放**（:508-518）：`instanceof Mesh` 过滤 + `dispose(false, true)`（连带材质/纹理），且 import 解析 → 清理在同一微任务内同步完成，无渲染帧泄漏窗口；测试以 2 mesh 逐个体 dispose 断言实证（test:248-259）。
- **catch 三岔清理**（:834-859）：registeredId 已设 → `_modelManager.remove`；否则 wasmModel → `destroyMmdModel`；loadedMeshes → 逐个 dispose；AbortError 专判 return null（:835-837）；`dom.loadingEl` 在 catch 与 finally 双保险复位。
- **缩略图并发与资源**（:153-229）：`_thumbCaptureGen` 世代守卫（:159/200/207）；物理冻结在 finally 恢复且带 `byteLength` 校验防 WASM memory.grow detach（:222-226）；`THUMBNAIL_TIMEOUT_MS`/`CONCURRENCY` 具名常量；纹理 ArrayBuffer 尽早置 null + 清数组（:538-541）防数百 MB GC 峰值。
- **回调异常隔离**：`_onMeshesReady`/`_onModelLoaded`/`_tryAutoApplyPreset`/`_loadOutfits` 全部 try/catch 或 swallowError 包裹（:609-615/:759-765/:783-789/:809-818），回调同步抛错与 rejected Promise 均不阻断加载主流程——测试两分支均有真实用例（test:527-542）。
- **并发测试真实还原异步窗口**（test:457-477）：deferred promise 挂起 load1 的 `readFileBytes`，load2 启动触发 `_loadAbortController.abort()`，再释放 deferred——精确还原 ADR-096「第二次加载自动取消前一次」的竞态时序，断言 id1=null / id2='gen-id'，是全文件含金量最高的用例。
- **不可达代码的诚实处理**：stage guard :589-600 以 `v8 ignore` + 头注释做可达性分析（test:4-6），测试明确断言「新 guard 未触及」而非假装覆盖——与 round-30 对死代码的处理风格一致。

## 风险表

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|--------|------|------|------|----------|
| 🟡 P3 | `frontend/src/scene/manager/model-loader.ts` | :603-632 vs :753-808 | Stage/Actor 两分支注册后的副作用序列近 30 行逐行重复：`_capture` 循环、`_onMeshesReady` try/catch、toast、aria-label、arrange、refreshWaterRenderList、rebuildShadowCasters、_rebuildOutlineState、triggerAutoSave、CustomEvent、setTimeout 缩略图。历史反弹模式（缩略图 async 修复、stage 缩略图补位均为此处双写）——一侧改一侧漏的风险持续存在 | 抽共享 helper（如 `finalizeModelLoad(inst, meshes, { kind, vmdApplied })`）承载公共副作用序列，两分支仅传差异参数（stage 无 focus/VMD，actor 有） |
| 🟡 P3 | `frontend/src/scene/manager/model-loader.ts` | :861 | 裸 `console.error('loadPMXFile:', err)` 绕过 `@/core/logger`——round-18 logger 审计确立「全仓统一从 logger 导入」，环形日志面板（设置→系统→缓存占用）消费的是 logger 缓冲，此致命路径的详情在面板中不可见，与同文件其他 10+ 处 logWarn 风格不一致 | 改 `logError('model-loader', 'loadPMXFile:', err)`（logger.ts:112 已有 logError） |
| 🟡 P3 | `frontend/src/__tests__/model-loader.test.ts` | :322-339 | 用例标题「activeMotion + compatible → **loadVMDMotion 被调用**」，但断言仅 `register` + `focus`——未 mock `../scene/motion/vmd-loader`，动态 import 拉起真实 vmd-loader 模块树（真实 babylon-mmd VmdLoader/MmdWasmRuntime、mmd-adapter、motion-intent 均未 mock），该用例实测耗时 2.1s（全文件 4.2s 的一半）；且结果不依赖 VMD 成败——loadVMDMotion 失败会落入 :384 catch 走 incompatible，断言同样通过。**若 VMD 兼容链路整体损坏，此用例仍绿** | mock `../scene/motion/vmd-loader` 导出 `loadVMDMotion: vi.fn()`，断言 `toHaveBeenCalledWith` + `inst.motionSlots.primary.status === 'compatible'`；同时把 `mmdRuntime.createMmdModel` 的 runtimeBones 断言收紧 |
| 🟡 P3 | `frontend/src/__tests__/model-loader.test.ts` | :128 / :331-405 / :574-590 | `mmdRuntime.createMmdModel` 为模块级 `vi.fn()`，各 describe 的 beforeEach 均未 `mockReset`——`_applySceneMotion` 4 个用例设置的 `mockReturnValue({rigidBodyStates:null, runtimeBones:[...]})` 顺序泄漏到后续 describe（captureThumbnail / 回调等用例），当前靠执行顺序侥幸无害，重排/并发执行即脆化 | beforeEach 统一 `mmdRuntime.createMmdModel.mockReset()`，各用例自设返回值；`mockMeshes`（:173）同理改为每用例新建 |
| 🟢 P4 | `frontend/src/scene/manager/model-loader.ts` | :702-703 | 魔法数值：`18 / h` 的 18 为 actor 目标身高（babymmd 1unit=0.1m ⇒ 1.8m）无命名常量；`h > 1e-3` epsilon 同理 | 提取 `ACTOR_TARGET_HEIGHT_UNITS = 18`、`HEIGHT_EPSILON = 1e-3` 具名常量 |
| 🟢 P4 | `frontend/src/scene/manager/model-loader.ts` | :556-634 vs :746-751 | Stage 分支无贴地：`getGroundHeightAt` 仅 actor 路径（:747）与 terrain-ready 回调 reGroundAllModels（:112）调用，stage 模型加载瞬间悬浮于 y=0，直到地形就绪/地面变化回调才贴合——stage/actor 行为不一致 | 若有意（stage 自由定位）在 stage 分支补注释声明；否则与 actor 对称补 `rootMesh.position.y = getGroundHeightAt(...)` |
| 🟢 P4 | `frontend/src/scene/manager/model-loader.ts` | :733-743 vs :589-600 | actor 注册后 abort guard 与 stage guard（:592）同为结构性不可达防御代码（:713 注册至 :775 await 之间无 await，signal 单线程内不可翻转），但仅 stage 侧有 `v8 ignore` + 可达性注释，actor 侧无——diff-coverage 语义不一致 | 两处统一处理：要么都加 `v8 ignore` + 注释，要么统一删除（保留防御则统一注明） |
| 🟢 P4 | `frontend/src/scene/manager/model-loader.ts` | :196-199 / :204-209 | captureThumbnail 超时 catch 注释「超时直接抛错，不静默降级」与实现 `return`（静默）矛盾；且 :204-209 `if (!ready)` rAF 分支在 whenReadyAsync 正常解析（ready 恒 true）后为死分支 | 修正注释为「超时静默放弃缩略图（finally 恢复物理）」；删除 `!ready` rAF 死分支或补充可达性说明 |
| 🟢 P4 | `frontend/src/scene/manager/model-loader.ts` | :365-374 | `_applySceneMotion` 中 VMD 读取（readFileBytes await）后无 abort 复查即调用 loadVMDMotion——abort 发生于读取期间时，VMD 仍会被应用，随后 :406 清理才移除模型。功能无害（模型将销毁）但浪费一次 VMD 加载 | 在 :366 generation 检查处并行复查 `effectiveSignal.aborted`；若 loadVMDMotion 支持 signal 则传入 |
| 🟢 P4 | `frontend/src/__tests__/model-loader.test.ts` | :47-57 / :526-533 | `fireAndForget` mock 为 `vi.fn()` no-op → auditMissingTextures 分支（生产 :526-533）零执行；`reportResourceWarning` 链路未被触发 | fireAndForget mock 改为透传真实调用（保留 p.catch），或单列用例断言 audit 差集提示路径 |
| 🟢 P4 | `frontend/src/__tests__/model-loader.test.ts` | :194-198 / :493-503 | 两个异常用例触发生产 :861 `console.error`，stderr 混入完整 Error stack trace（round-30 library 侧已登记同类 P4 卫生项） | 用例内 `vi.spyOn(console, 'error').mockImplementation(() => {})` 静音 |
| 🟢 P4 | `frontend/src/__tests__/model-loader.test.ts` | :12-14 | `Mesh` mock 的 `Symbol.hasInstance` 技巧对 `new h.Mesh()` 实例与原生 instanceof 等价（冗余），仅对 `__proto__` 拷贝对象更稳健；`(obj: any)` 为测试内类型逃生 | 保留技巧可，建议补一行注释说明「为何不用原生 instanceof」（如防结构化克隆对象），维持测试侧类型收紧 |
| 🟢 P4 | `frontend/src/__tests__/model-loader.test.ts` | 全文件 | 未覆盖分支（诚实清单）：:430-432 未初始化 guard（文件尾注释 :620-622 已声明同文件不可测，由代码审核覆盖——本次审核确认该 guard 正确）；:473 `!pmxBytes` 空字节；:835-837 AbortError 专判；:838-843 registeredId 失败清理；:674-697 metaComment/metaCache；:699-705 autoScale（uiState mock 空对象恒 false）；:709-732 prevInst 槽位继承；:766-771 storeRigidBodyState（mock MmdWasmModel 为 `class {}`，createMmdModel 返回普通对象致 instanceof 恒 false）；:526-533 audit | 建议补 autoScale（uiState 注入 autoScaleModel:true + getHierarchyBoundingVectors 已 mock）与 storeRigidBodyState（createMmdModel 返回 `new (mock MmdWasmModel)()`，需把 MmdWasmModel mock 类挂入 h.hoisted）两处；其余为防御性/纯副作用分支可维持现状 |
| 🟢 P4 | `docs/knowledge/model-loader.md` | :24 / :50 | round-13 登记的漂移仍存在：「加载锁/重复检测/清理由 scene.ts 编排器负责」不实（三者均在 model-loader.ts :434/:448/:733），与现状（本测试已覆盖这三处）矛盾 | 更新知识卡不变量为「加载锁/重复检测/abort 清理由 model-loader 内自管理，scene.ts 仅编排调用」；顺带补 tests 字段指向本测试文件 |

## 测试质量评价

- **断言有效性** ✅：核心用例均为真实断言——abort 清理（mesh1/mesh2 `.dispose` 各 1 次 + register 未调用，:248-259）、并发取消（id1=null / id2='gen-id'，:457-477）、abort 后 VMD 清理（register 1 次 + remove 调用，:565-597）、createMmdModel 抛错（mesh.dispose 被调，:493-503）、回调异常（register 仍 1 次，:527-542）、回调实参（`cb.mock.calls[0][0]` 长度断言，:286）。无 `toBeTruthy`/空 `not.toThrow` 类空洞断言。
- **Mock 合理性** ✅/⚠️：`vi.hoisted` + 25+ 模块 mock 覆盖了 model-loader 全部 import 面，注入 seam（initLoader）经 mock 验证可解耦；`Mesh` `Symbol.hasInstance` 技巧使生产 `instanceof` 过滤在 mock 域内自洽（真实 Babylon 实例在测试中不存在，无混淆）；`swallowError` mock 附加 catch 抑制 unhandled rejection 合理。⚠️ 两处：`mmdRuntime.createMmdModel` 跨 describe 不重置（顺序依赖）；`fireAndForget` no-op 使 audit 分支零执行。
- **边界覆盖** ⚠️：abort 时机三态（读取前 :160-166 / import 期间 :148-158 / VMD 后 :565-597）覆盖到位；加载失败（import 抛错 / 空 meshes / createMmdModel 抛错 / VMD 读取失败）覆盖到位；但 loadVMDMotion 兼容/不兼容/过期三用例共用「只断言 register/focus」的弱断言（见 P3 风险表），VMD 成功路径的真实性未钉死。
- **跳过测试** ✅：0（grep `.skip`/`.todo`/`.only`/`xit`/`xdescribe` 无匹配）。
- **验证结果** ✅：`cd frontend && npm run test -- src/__tests__/model-loader.test.ts` → **21/21 通过**（Vitest 4.1.9，实测 4.24s，含 vmd-loader 动态 import 约 2.1s）。`npm run check`（tsc 全量）按任务约定跳过（耗时较长），本次审核未改动任何生产/测试代码，无类型面风险；全量基线项目口径已知全绿。

---

**审核日期：** 2026-08-15
**审核员：** 子代理 round36-model-loader
