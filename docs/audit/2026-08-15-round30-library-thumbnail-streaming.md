# round30 — 缩略图流式加载 AbortSignal 协作式取消审核（ADR-136）

**审核日期：** 2026-08-15
**审核员：** 子代理 round30-library-thumbnail-streaming（第 30 轮第 2 个测试）

## 审核范围

| 类别 | 文件 | 行号 |
|------|------|------|
| 测试文件 | `frontend/src/__tests__/library-thumbnail-streaming.test.ts` | 1–281（全量，11 用例） |
| 被测源码 | `frontend/src/menus/library-core.ts` | 239–322（THUMB_STREAM_CONCURRENCY / `_thumbAbortController` / loadThumbnailsStreaming / abortThumbnailStreaming） |
| 调用链（读侧） | `frontend/src/menus/library-core.ts` | 700–708（renderGridMode 流式加载入口）、661–676（openResourceFullscreen onEnterFolder 取消钩子） |
| 调用链（弹窗） | `frontend/src/menus/library-browse.ts` | 345–353（showModelPopup 重开取消钩子） |
| 依赖 | `frontend/src/core/ui-resource-panel.ts` | 516–520（notifyThumbnailUpdate） |
| 依赖 | `frontend/src/core/library-state.ts` | 36（thumbnailCache 真实 Map） |
| 依赖 | `frontend/bindings/mikumikuar/internal/app/app.ts` | 423（GetThumbnail 真实契约 `$CancellablePromise<string>`） |
| 决策记录 | `docs/adr/adr-136-thumbnail-abortsignal.md` | 全量（✅ 已完成） |
| 对照 | `frontend/src/__tests__/library-core-mocks.ts` | 8–18、33–59、81–157（共享 mock 工厂） |

**ADR-136 落地核实：** `loadThumbnailsStreaming(keys, signal?)` 协作式取消 ✅（library-core.ts:260）；`abortThumbnailStreaming()` 导出 ✅（:317）；`showModelPopup` 重开取消 ✅（library-browse.ts:353）；`renderGridMode` / 全屏 `onEnterFolder` 接入 ✅（library-core.ts:705 / :675）。ADR §方案 2 的 `loadThumbnailsForLevel` 符号已不存在（现流程 renderGridMode 直接调 loadThumbnailsStreaming），见 P4 文档漂移行。

## 总体结论

✅ **通过**（0 项 P1 / 0 项 P2；2 项 P3 维护建议，不阻断）

被测源码类型安全（被测区域 0 处 `as any`/`@ts-ignore`）、资源释放与取消语义正确（`finally` 条件清引用防误清新批次）、异常路径完整（per-key catch + logWarn，不静默吞错、取消后 promise 正常 settle）。测试 11/11 全绿、确定性设计无 flaky，`tsc --noEmit` exit 0。

## 亮点

- **双闸门协作式取消**（library-core.ts:282-284 派发前检查 + :292-294 拉取后复查）：abort 后既不派发新 worker、也丢弃已拉取未写入的过期结果，完整兑现 ADR「避免向已不可见的面板写缓存/通知」；复查闸门是防「过期写入」的关键，测试「新批次取代旧批次」（:219-229）直接断言旧批次 key 未入缓存。
- **`finally` 条件清引用防误清新批次**（library-core.ts:306-313）：批次结束时仅当 `_thumbAbortController === internalCtrl` 才置 null，若已被外部/新批次取代则不动——比 ADR 伪代码多一层防御，配合 `abortThumbnailStreaming` 同步置 null（:317-322）构成完整引用生命周期。
- **`AbortSignal.any` 合并而非 `??` 回退**（library-core.ts:273-276）：注释显式引用 ADR-096/105 同款考量（`??` 会忽略内部批次取消），与 model-loader 范式一致；外部 signal 与内部控制器任一 abort 即生效。
- **具名并发常量 + per-key 异常隔离**（library-core.ts:244 `THUMB_STREAM_CONCURRENCY = 4`、:289-302）：无魔法数值；单个 key 拉取失败仅 logWarn 跳过，不影响同批其他 key（测试 :199-209 断言「bad 不影响 ok」）。
- **测试确定性设计**（test:158-163、179-181、270-280）：`cancellable()` helper 精确对齐真实绑定契约（bindings/app.ts:423 验证 `$CancellablePromise<string>`），注释诚实说明 SUT 不调用 cancel/cancelOn；慢批次用 `setTimeout(0)` 且 abort 均在同步窗口内先行，无 fake timers、无时序赌博，11 用例稳定绿。
- **「空 keys 也 abort 上一批次」回归用例**（test:177-187）：锁死「每次新调用取消上一批次」契约恒定——空目录渲染时旧批次不得再写缓存，这是 ADR 针对空目录场景专门补的语义，属易被后续重构踩掉的隐含契约。
- **缓存断言用真实 Map**（test:6-16、93-95、166）：`thumbnailCache` mock 为真实 Map（.has/.set 真语义），区别于桩对象，缓存读写断言有实际意义；`beforeEach` 全量重置无跨用例污染。

## 风险表

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|--------|------|------|------|----------|
| 🟡 P3 | `frontend/src/__tests__/library-thumbnail-streaming.test.ts` | :6-146 | core/config 与 wails-bindings 的 mock 为 `library-core-mocks.ts` 工厂（:8-18/33-59/81-157）的近副本内联：仅 +`thumbnailCache` getter、+`GetThumbnail`，却少了 GetLastBrowseDir/SetLastBrowseDir/status-bar/library-path 等；grid-dispose.test.ts 已是第三个内联变体。与 frontend/AGENTS.md §2.3「核心模块 mock 优先复用共享工厂、形状保持超集一致，禁止各自内联出差异化形状」相悖——config 后续新增字段时三处形状需各自同步，存在静默漂移窗口 | 将 `thumbnailCache` getter 补进 `createMockState`/`configModuleFactory`、`GetThumbnail` 补进 `wailsBindingsFactory`（超集扩展，对现有 106 用例零影响），本测试与 grid-dispose 改从工厂取，消除第三份形状 |
| 🟡 P3 | `frontend/src/__tests__/library-thumbnail-streaming.test.ts` | :177-187、219-229、256-268、270-280 | 四个取消/取代用例只断言缓存侧，未断言 `notifyThumbnailUpdate` 未被调用；ADR 核心目标「避免向已不可见的面板写缓存/**通知**」的通知侧无断言——若回归把 notify 移到 abort 检查之外（只通知不写），缓存断言仍全绿 | 四个用例在触发 abort 后补 `expect(notify).not.toHaveBeenCalled()`（先 `notify.mockClear()`），锁死通知抑制语义 |
| 🟢 P4 | `frontend/src/__tests__/library-thumbnail-streaming.test.ts` | :186、266、279 | `toBeLessThan(n)` 弱断言：分析确认 abort 均在同步窗口内先行（worker 全部挂起于首个 await、timer 未触发），过期结果应精确丢弃为 0；现断言容忍 1..n-1 张过期写入不被捕获（仅拦截全量写入回归） | 确定性成立处收紧为 `toBe(0)`（或至少 `toBeLessThan(4)` 锁并发上限），使「部分过期写入」回归也能变红 |
| 🟢 P4 | `frontend/src/menus/library-core.ts` | :264-268 | 空 keys 提前 return 时 `_thumbAbortController` 仍指向已 abort 的旧控制器，直到下次非空调用/abortThumbnailStreaming 才替换/清空。功能无害（重复 abort 是 no-op），但「abort 后引用未清」语义不干净 | 空 keys 分支在 abort 后同步 `_thumbAbortController = null`，与 abortThumbnailStreaming 行为对齐 |
| 🟢 P4 | `frontend/src/__tests__/library-thumbnail-streaming.test.ts` | :199-209 | 「GetThumbnail 拒绝」用例故意 reject，SUT 走真实 `logWarn`（library-core.ts:301）→ 测试输出混入 Error stack trace（run 结果中可见 `[library-core] GetThumbnail failed for bad`） | mock `../core/logger` 或在用例内 `vi.spyOn(console, 'warn')` 静音，保持 CI 日志干净（纯卫生项） |
| 🟢 P4 | `docs/adr/adr-136-thumbnail-abortsignal.md` | :88-98、:121 | ADR 文本已漂移：§方案 2 的 `loadThumbnailsForLevel` 符号在代码中不存在（现 renderGridMode library-core.ts:705 直接调 loadThumbnailsStreaming）；验收记录「5 个确定性用例」实为 11 个（超集） | 更新 ADR 方案段与测试覆盖记录对齐现状（验收标准 :123-131 勾选状态同步） |
| 🟢 P4 | `frontend/src/menus/library-core.ts` ↔ `frontend/src/menus/library-actions.ts` | library-core.ts:39 ↔ library-actions.ts:47-52 | 双向顶层 import（既有、非 ADR-136 引入）：均为调用期函数引用，ESM 循环良性（测试实证 11/11），但 `dep:graph` 会亮环 | 既有债务，后续拆分 library-core 时留意即可，不在本轮范围 |

## 测试质量评价

- **断言有效性** ⚠️：核心契约断言扎实——「新批次取代旧批次」用 `get('a')` undefined 锁旧批次丢弃（:226）、「已缓存跳过」用 `toHaveBeenCalledTimes(2)` + `not.toHaveBeenCalledWith('a')` 锁精确拉取集（:193-194）、「拒绝不中断后续 key」锁 `resolves.toBeUndefined` + bad/ok 双断言（:205-207）。扣分点：三个取消用例用 `toBeLessThan(n)` 而非确定性 `toBe(0)`（见 P4 行），且通知侧无断言（见 P3 行）。
- **Mock 合理性** ⚠️：`cancellable()` 契约对齐真实绑定（bindings/app.ts:423 实证 `$CancellablePromise<string>`）；缓存用真实 Map 使断言有真语义；`vi.mocked(GetThumbnail)` + `beforeEach` mockReset 无跨用例污染。扣分点：绕过共享工厂内联第三份 config/wails mock 形状（见 P3 行）。
- **边界覆盖** ✅：加载中取消（:270-280）、完成后取消幂等（:231-236）、重复 abort（:234-235）、外部已 abort signal 传入（:238-244）、中途 abort（:256-268）、新批次取代（:219-229）、空 keys 即返且 abort 旧批次（:172-187）、拒绝/空值/缓存命中/无 signal 兼容（:189-254）——覆盖矩阵完整且与 ADR 验收标准一一对应。
- **跳过测试** ✅：0（grep `.skip`/`.todo`/`.only`/`xit` 无匹配）。
- **可维护性** ✅：用例按行为面命名清晰，注释完整记录 ADR 动机与同步窗口设计；唯一缺憾是 mock 未走共享工厂（P3）。
- **验证结果** ✅：`cd frontend && npm run test -- src/__tests__/library-thumbnail-streaming.test.ts` → **11/11 通过**（用例 53ms，总 14.86s 由 library-core 依赖图 import 主导，符合 vitest.config.ts 已知成本）；`npx tsc --noEmit`（frontend）→ **exit 0 无新增错误**。全量基线未重跑（任务口径：单文件验证 + 基线已知全绿）。

---

**审核日期：** 2026-08-15
**审核员：** 子代理 round30-library-thumbnail-streaming
