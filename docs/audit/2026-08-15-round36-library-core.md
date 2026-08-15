# round36 — library-core 主测试（1205 行合并版）审核

**审核日期：** 2026-08-15
**审核员：** 子代理 round36-library-core（第 36 轮第 3 个测试）

## 审核范围

| 类别 | 文件 | 行号 |
|------|------|------|
| 测试文件 | `frontend/src/__tests__/library-core.test.ts` | 1–1205（全量，117 个 `it(` + 1 个 `it.each` 双跑 = 119 例） |
| 被测源码 | `frontend/src/menus/library-core.ts` | 1–1068（全量：ResourceViewMode / 路径工具 / 缩略图键 / modelToRow / modelToResourceItem / buildResourceItemsForDir / buildLevel / buildModelFormationLevel / buildModelRootItems） |
| 调用链（测试直连） | `frontend/src/core/path.ts` | 15–77（normPath / isUnderRoot） |
| 调用链（测试直连） | `frontend/src/core/fileservice.ts` | 115（normPath re-export） |
| 调用链（importFile） | `frontend/src/menus/library-actions.ts` | 635–701（importFileByPath / importFile） |
| 调用链（错误反馈） | `frontend/src/core/status-helpers.ts` / `feedback.ts` | 80–99 / 70–81 |
| Mock 共享工厂 | `frontend/src/__tests__/library-core-mocks.ts` | 1–236（全量） |
| 对照基线 | `base_export/frontend/src/__tests__/library-core.*.test.ts`（合并前 6 文件快照） | 全量 |

**与历史审核的关系（如实记录）：**
- **round-11**（`docs/audit/2026-08-05-validation-library-core.md`）审过 library-core：P3×2 panel 泄漏（renderGridMode :714 / 全屏 onSelect :657）→ **当前源码已修复**（:770 `return () => safeDispose(panel)`、:669 `currentPanel = safeDispose(currentPanel)`），由 sibling 回归文件 `library-core.grid-dispose.test.ts`（4 例）+ `library-core.model-meta-concurrency.test.ts`（3 例，守护 ensureModelMeta 并发合并修复）守护。本 1205 行文件是 library-core **主测试**（合并 6 文件），与两个 sibling 互补不重叠。
- **round-30**（`docs/audit/2026-08-15-round30-library-thumbnail-streaming.md`）审过 library-core.ts:239–322 流式缩略图（独立测试文件 11 例）；本测试仅覆盖 `thumbnailKeyForModel`（:194–200，键格式 3 例），流式行为不在本文件范围内。
- 合并历史：`5a81ac0c` 拆 6 文件（99 例守恒）→ `bade41cd` 6→1 合并（import 累加 201→154s）→ `ab79934e`（文件夹逆序修复用例）/ `2d15d6be` / `274247cf`（补契约 +21 例）。

**验证记录：** `cd frontend && npm run test -- src/__tests__/library-core.test.ts` → **119/119 通过**，14.63s（transform 4.86s + import 11.30s + tests 132ms，环境 2.06s）。单文件 import 11.3s 达成合并绩效目标（原 6 文件累加 201s）。`cd frontend && npm run check`（tsc + i18n 一致性）→ **exit 0 通过**（本次只读审核未改任何文件；测试文件为 `@ts-nocheck`，tsc 主要验证源码侧）。

## 总体结论

⚠️ **有条件通过**（0 项 P1 / 0 项 P2；3 项 P3 测试质量问题，条件见下）

- **源码侧健康**：library-core.ts 全文件 0 处 `as any`/`@ts-ignore`（唯一两处 `as LibraryModel` 为类型化断言，其一 :637 带形状校验、其一 :733 裸 as——round-11 已记 P4，仍遗留）；资源释放链完整（grid dispose 返回、全屏 onSelect/onBack safeDispose、ensureModelMeta guard finally 必放锁）；异常处理无静默吞错（SetUIState.catch→logWarn、ensureModelMeta try/catch/finally、流式 per-key catch）；魔法数值全部具名常量（META_BATCH_SIZE=50 / THUMB_STREAM_CONCURRENCY=4 / RAF_BATCH_THRESHOLD=100 / RAF_BATCH_SIZE=50）。
- **测试侧**：119 例全绿、断言真实、合并干净、无跳过无 `.only`；但 importFile 描述块存在 3 项测试质量问题（错误分支断言薄弱 + `mockLoad` 陈旧 rejection 跨用例泄漏 + toast 未 mock 的脆弱依赖），属测试自身的正确性/可维护性缺陷，修复后即可全绿放行。

## 亮点

- **合并工程化可验证**（test:1–14）：头部注释逐条记录 6→1 合并决策（mockState 合并共享、status-bar 统一委托版并说明其余 5 文件不依赖其行为、uiHelpersFactory capture 版、beforeEach 组合为顶层一份、i18n beforeAll 去重）。逐用例比对 base_export 原 6 文件：**原 98 例全部保留**（model-to-resource 的 name_en/name_jp 两例折叠为 `it.each`，等价双跑），后续审核轮补契约 +21 例，无用例丢失。
- **mock 超集纪律**（library-core-mocks.ts）：scene 复用 `sceneMockSuperset`（前端 AGENTS.md 测试卫生铁律）；`configModuleFactory` 用 **getter 活绑定**（`get allModels()` 等）而非静态 spread——避开 god-barrel 静态超集断活绑定（isolate=true 22 用例回归教训）；LoadingGuard 用真实 `core/async` 实现而非桩（幂等，合理）。
- **断言真实性高**：层级/排序/路径边界均为逐字段真实验证（label/isFolder/icon/target/顺序），非 `toBeTruthy` 式空转；`preserves sorted order for multiple non-leaf subdirs (not reversed)`（test:297、714）锁死 ab79934e 文件夹逆序修复。
- **路径边界覆盖全面**（test:552–614、947–986）：`..` 逃逸段拒绝（中间/结尾）、drive-letter 伪根（`C:` vs `C` 的 `:` 边界，test:313）、字符串前缀伪文件夹（`PMXSub` 不归 `PMX`，test:285）、大小写/反斜杠归一、跨盘拒绝、`normPath` 折叠 `.` 段 + `content://` 去尾斜杠——与 isUnderRoot 组件边界实现（path.ts:68–77）逐例对应。
- **边界与回归保护完整**：空目录/不存在目录/stale 缺 `dir` 条目（test:818）/无文件名回退「未知」/zip_inner 空回退/取消选择/不支持格式/错误捕获/SetUIState 拒绝；importFile 5 分支（cancel/pmx/vmd/zip/unsupported）全路径覆盖，含 zip 解压后自动加载主 PMX（test:1065）。
- **测试确定性**：`vi.waitFor` 替代裸 `setTimeout(10)` 防负载抖动（test:1098）；buildModelRootItems 缓存双键失效测试（test:1191，regSize+focus 任一变化即重建）；用例内显式清理 `modelRegistry` 防跨用例污染（test:1188/1203）。
- **修复回归闭环**：round-11 两处 P3 panel 泄漏的修复由 sibling 回归文件守护，本主测试全绿确认无回归。

## 风险表

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|--------|------|------|------|----------|
| 🔴 P1 | — | — | 无 | — |
| 🟠 P2 | — | — | 无 | — |
| 🟡 P3 | library-core.test.ts | 1042 → 1065–1075 | `mockLoad.mockRejectedValue`（1042 行）**跨用例泄漏**：importFile describe 的 beforeEach 用 `vi.clearAllMocks()`（只清调用记录、不清实现），「zip import with returned file_path triggers loadManager.load」用例（1065）触发 `loadManager.load` 时仍命中上一用例的 stale rejection——测试因仅断言调用参数而「侥幸」通过，但实际走了**非预期的错误路径**（stderr 可见 `[library.loadingModel] Error: corrupt file` + 真实 toast + logWarn 噪音），未来若自动加载逻辑依赖 load 结果将被掩盖 | beforeEach 改用 `vi.resetAllMocks()`（或对 `mockLoad` 显式 `mockReset()` / 逐用例重设实现），使每个用例都在干净实现上运行 |
| 🟡 P3 | library-core.test.ts | 1039–1046、1048–1055 | 「catches loadManager error on pmx load」/「catches ImportZip error」**断言未覆盖错误分支**：断言 `setStatus(stringContaining('加载模型'/'导入压缩包'), true)` 命中的是加载态 `feedbackStatus`（⏳ 前缀、ok=true），该调用在**成功与失败路径都会发生**；错误反馈 `feedbackError` → `showErrorToast`（✗ 失败键）既未 mock 也未断言——测试无法验证「错误被正确反馈给用户」，与用例名承诺不符 | mock `../core/toast`，断言错误分支 toast 标题（`library.loadingModelFailed` / `library.importingZipFailed`），使成功/失败路径可区分 |
| 🟡 P3 | library-core.test.ts | 989–1076（importFile 全组） | **toast 模块未 mock**：错误路径运行真实 `showErrorToast/showInfoToast`（feedback.ts → toast.ts，写 jsdom DOM + 真实 `t()` 翻译 + translateGoError），测试隐式依赖未 mock 真实模块的 DOM 安全性——若 toast 未来引入 Wails 绑定依赖，本组用例将因无关原因崩坏 | 与上一条合并处理：统一 mock `../core/toast`（`showErrorToast`/`showInfoToast` 桩），隔离 SUT 与真实反馈链 |
| 🟢 P4 | library-core.ts | 733 | `renderGridMode` onSelect 裸 `item.data as LibraryModel \| undefined`，与 :633–639 `resourceItemAsModel`（带形状校验）两条取回路径不一致（round-11 已记，仍遗留） | 统一走 `resourceItemAsModel`，消除裸 as |
| 🟢 P4 | library-core.ts | 928–938 | `buildModelRootItems` 缓存键仅 regSize+focusId：角色**改名**（名称变、size 不变）时返回陈旧项 | 缓存键纳入名称摘要，或改名路径显式失效缓存 |
| 🟢 P4 | library-core.ts | 604–628 | `renderItemsWithRAF` rAF 批次无取消标志：面板 dispose 后批次仍继续渲染进游离 card（仅 >100 项触发，影响低） | 引入 generation/abort 标志，dispose 时停止派发 |
| 🟢 P4 | library-core.ts | 374–375 | `'16/9'`/`'2/3'` 魔法字符串字面量，与 thumbnail-key 构造同源建议提常量 | 提 `THUMB_ASPECT_*` 常量或复用 thumbnail-key 定义 |
| 🟢 P4 | library-core.test.ts | 1105–1111 | 「does not throw when SetUIState rejects」为同步 `not.toThrow` 断言，rejection 由生产 `.catch` 异步消化，本地状态断言即刻成立 | 可 `await` 一个微任务/`vi.waitFor` 再断言，强化「拒绝后不抛」的验证语义 |
| 🟢 P4 | library-core.test.ts | 385–396 | `it.each(['name_en','name_jp'])` 将两个具名用例折叠为参数化，报告粒度略降（等价双跑，可接受） | 无需处理，仅记录 |

## 测试质量评价（含合并质量）

**合并质量：干净，无用例丢失。** 证据链完整：
1. **用例守恒**：base_export 原 6 文件 98 例逐条比对，全部保留于合并版对应 describe（buildLevel 14→15、modelToResource 10→11、modelToRow 15→16、path-boundary 14、resource-items 25、subdir-file 20→22 等，新增均来自后续补契约 commit）；合并版 119 例 = 117 个 `it(` + 1 个 `it.each`×2。
2. **唯一改名是名实纠偏**：原「falls back to cached metadata when available」实际断言 `label === 'a.pmx'`（缓存存在仍用文件名，与用例名矛盾），合并版改为「cached metadata does not affect label」并保留原断言——非语义反转，与 commit fbcfc1b7（统一显示名为文件名）一致。
3. **mock 超集无缺口**：原 model-to-resource 的 `vi.mock('../library/library-path')` 旧路径已同步更新为 `@/core/library-path`（与 de-barreling 一致）；status-bar 委托版与其余 5 文件原独立版行为兼容（用例不依赖其内部状态）；顶层 beforeEach 组合清理覆盖原各文件全部重置字段。
4. **断言有效性**：buildLevel 14 场景与 `buildPopupRows` 逐行吻合（isRoot 判定、leaf flatten、multi-zip 保留文件夹、extraFolders 前置、name 排序）；路径 14 例与 `isUnderRoot`/`getRelativePathUnderDir`/`normPath`/`splitSubdirSegments` 实现一一对应（含「root 等长时 substring 溢出返回 ''」既有语义锁定，test:576）；`thumbnailKeyForModel` 3 例锁死 `baseKey::res::aspect` 格式（含 zip_inner 追加、stage 16/9）。
5. **mock 合理性**：`@ts-nocheck` 理由成立（vi.mock 运行时替换 + 测试内桩数据 `as any`，与全仓惯例一致）；共享工厂 getter 活绑定正确；`extractLevelRows` helper 通过 renderCustom + slideRow 捕获断言层级内容，单元层级合理。
6. **无跳过测试、无 `.only`**（grep 验证）。

**弱点（3 项 P3，见风险表）**：importFile 错误分支断言薄弱（只验加载态、未验失败反馈）、`mockLoad` 陈旧 rejection 跨用例泄漏（`vi.clearAllMocks` 不清实现的陷阱）、toast 未 mock 的脆弱依赖——三者同源，修复集中在 importFile describe 内，不影响其余 110 例。

---

**审核日期：** 2026-08-15
**审核员：** 子代理 round36-library-core
