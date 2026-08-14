# 审核报告 — drop-import（ADR-177 Phase 2 A4 闭环）— 第 16 轮 · 测试 2

## 审核范围

- **测试文件**：`frontend/src/core/__tests__/drop-import.test.ts`（181 行）
- **被测源码**：`frontend/src/core/drop-import.ts`（113 行，主测目标）
- **契约核对依赖**（测试 mock 的真实实现）：
  - `frontend/src/core/load-manager.ts`（loadManager.load，LoadRequest/ResourceHandle）
  - `frontend/src/core/wails-bindings.ts:66,91`（ExtractZip / ImportZip 代理导出）
  - `frontend/src/core/backend/idb.ts:72,148`（idbSet / saveModel）
  - `frontend/src/core/backend/browser-adapter.ts:1506,2102`（ExtractZip/ImportZip 浏览器实现，可返回 null）
  - `frontend/src/core/status-bar.ts:40`（setStatus）、`frontend/src/core/format.ts:22`（formatError）、`frontend/src/core/i18n/t.ts:54`（t）
  - `frontend/bindings/.../models.ts:360`（ExtractResult.file_path 为必填 string）
- **验证执行**：
  - `npm run test -- src/core/__tests__/drop-import.test.ts` → **13/13 通过**（12ms），但 stderr 暴露 3 处 `ReferenceError: window is not defined`（详见风险 P2-1）
  - `npm run check` → 4 个 tsc 错误全部位于 `src/__tests__/motion-intent-ratio-guards.test.ts`（与本审核无关，疑似并发轮次既有改动）；`drop-import.ts` / `drop-import.test.ts` 本身类型干净，0 新增 `as any`/`@ts-ignore`

## 总体结论：⚠️ 有条件通过

测试断言与生产代码逐条核对一致（桌面/浏览器分支、pmx/vmd/zip 键名、ExtractZip 双参、load 请求形状均符真实契约），错误路径有覆盖，13/13 实测全绿。但存在 **2 处 P2**：① `@vitest-environment node` 与 `drop-import.ts:49` 的 `window.dispatchEvent` 冲突，导致 zip 成功路径（含 ADR-238 `mmar:zip-imported` 库重扫契约）在测试中实际走了被吞错的错误分支、从未被真正验证；② 错误路径用例未断言 catch → setStatus 失败消息，头注释声称的闭环未兑现。另 mock 卫生有 2 处 P3（死 mock、god-barrel 静态替换未 spread importOriginal）。

## 亮点

- **vi.hoisted 用法合规**（drop-import.test.ts:11-19）：mock 对象在工厂执行前初始化，工厂体不引用模块级运行期变量，符合 frontend/AGENTS.md §2.3 ADR-219 铁律。
- **分支语义断言精准**：桌面分支显式断言「不写 IndexedDB」（:62, :74），浏览器分支断言「写 IDB + saveModel + load」三段链路（:93-98），zip 分支断言「ExtractZip 而非 ImportZip」（:72-73, :118）——成功区分两条真实路径，非空转断言。
- **round14 P2 修复已落地**（drop-import.ts:91-93 注释 → :94-112 整体 try/catch）：`file.arrayBuffer()` / `idbSet` / `saveModel` 任一 reject（大 zip QuotaExceededError）都会进入 catch → `setStatus(importFailedDetail + formatError)`，不再未处理 rejection；本测试实测该 catch 生效（stderr 可见吞错路径）。
- **职责与依赖纪律**：drop-import 仅依赖 6 个数据/状态叶子模块，无 menus 反向依赖（ADR-238 注释 :20-21 与源码一致，无幽灵 import）；`handleDropFile`（路径落地）与 `handleDroppedFile`（File 落地）职责单一，状态写入点成对（loadingModel ↔ modelLoadFailed 等，grep setState 无幽灵路径）。
- **错误路径有真实覆盖**：ExtractZip reject（:168-173）、loadManager.load reject（:175-180）均验证「不崩溃、不触发后续 load」。

## 风险表

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|------|------|------|------|------|
| 🟠 高 P2 | drop-import.test.ts:1 | `// @vitest-environment node` | 测试强制 node 环境，但被测代码 drop-import.ts:49 调用 `window.dispatchEvent`。实测 stderr 出现 3 次 `ImportZip failed: ReferenceError: window is not defined`（桌面 zip :71、浏览器 zip :116、handleDropFile zip :141），全部被 catch 吞掉。**测试「成功」实为走了错误分支**：`setStatus(zipImported,true)` 与 ADR-238 `mmar:zip-imported` 事件从未真正执行、零断言——库重扫契约完全未验证且被吞错掩盖。 | 二选一：① 删除 node 注释改用默认 happy-dom（有 window/CustomEvent）；② 保留 node 但显式 mock `window.dispatchEvent` 与 `globalThis.CustomEvent`，并在 zip 成功用例断言「事件已派发 + setStatus(zipImported,true)」。 |
| 🟠 高 P2 | drop-import.test.ts:168-180 | 错误路径断言缺口 | 头注释声称覆盖「catch → setStatus 失败消息」，但两个错误用例只断言「不触发 load / load 被调」——从未断言 `setStatus` 被调用及消息为 `importFailedDetail + formatError`。A4 闭环的失败消息路径实际未验证。 | 补充断言：`expect(setStatusMock).toHaveBeenCalledWith(expect.stringContaining('importFailedDetail'), false)`；`config` mock 需捕获 setStatus 实例（当前 `vi.fn()` 无命名引用）。 |
| 🟡 中 P3 | drop-import.ts:19 | 死导入 | `import { safeCallAsync } from './safe-call'` 全文无使用（grep 仅 :19 一处）。测试因此被迫 mock `../safe-call`（:37-39）——生产死代码连带测试死 mock。 | 删除该 import（连带删除测试中 `vi.mock('../safe-call')`）。 |
| 🟡 中 P3 | drop-import.ts:39-46 | ExtractZip 返回 null 仍报成功 | 契约核对：browser-adapter.ts:1522-1532 确认 ExtractZip 可返回 null（zip 缺失 / 超 MAX_ZIP_FILE_SIZE）。`result?.file_path` 为 falsy 时跳过加载，但 :46 仍 `setStatus(zipImported, true)` 并派发库重扫事件——用户看到「导入成功」实则零加载。 | null 结果分支显式区分：`setStatus(importFailedDetail + t('main.zipExtractFailed'...), false)` 或至少 warn，不派发成功事件。 |
| 🟡 中 P3 | drop-import.ts:50-53 | catch 错误标签误导 | zip 分支 catch 恒打 `console.error('ImportZip failed:', err)`，但实际失败可能是 ExtractZip 抛错或 :49 事件派发抛错（实测 stderr 即打印 `ImportZip failed: ReferenceError: window is not defined`），标签与真实失败点不符，误导排查。 | 标签改为中性（如 `'zip import failed:'`）或按失败点区分。 |
| 🟡 中 P3 | drop-import.test.ts:41-43 | 死 mock | `vi.mock('../../menus/library')` 无消费者——drop-import 已按 ADR-238 移除 menus 静态 import（源码 :20-21 注释确认），该 mock 是历史残留。 | 删除；同时移除对 `refreshLibrary` 的 hoisted 引用（:11-19 对象中无此键，实际已悬空）。 |
| 🟡 中 P3 | drop-import.test.ts:30-33, 28 | mock 形状卫生 | `../config`（god-barrel）用静态全替换 `{ setStatus, formatError }`，未按 AGENTS.md §2.3 铁律保留 `...(await importOriginal())` spread——当前侥幸可行（图内唯一真实 config 消费者是 drop-import 且只用这两导出），一旦 drop-import 增加 config 其他消费者即静默断裂；`../backend/idb` 内联 `{ idbSet, saveModel }` 与共享工厂 `makeIdbMock()`（backend-mocks.ts:28-44，缺 saveModel）形状不一致，属共享工厂缺口下的必要特例但未注释说明。 | config mock 改为 `async (importOriginal) => ({ ...(await importOriginal()), setStatus: vi.fn(), formatError: vi.fn() })`；idb mock 处加注释说明「全局 makeIdbMock 缺 saveModel，故文件级覆盖」（或给 makeIdbMock 补 saveModel 后复用）。 |
| 🟢 低 P4 | drop-import.ts:103 vs backend/idb.ts:153 | 扩展名剥离逻辑重复 | `/\.(pmx\|vmd)$/i`（drop-import）与 `/\.(pmx\|zip)$/i`（saveModel）两处近似但集合不同的手写正则，后续扩展名演进易失同步。 | 提取共享叶工具（如 `core/path` 的 `stripModelExt`）统一。 |
| 🟢 低 P4 | drop-import.ts:80-112 | 并发去重缺失 | round14 已记录「同一 File 重复 drop 无去重」：实测安全性可接受（idbSet/saveModel 幂等覆盖 + loadManager 队列串行，browser-adapter:1617 注释确认 ExtractZip 无条件重写幂等），但快速连拖同文件会重复派发库重扫事件与状态翻转。 | 维持现状或加 in-flight 去重键（`file:<stem>` 正在处理则跳过）。 |

## 测试质量评价

**有效断言**：13 个用例全部落在可观察副作用上（idbSet/saveModel/load/ImportZip/ExtractZip 调用形状与参数），与真实契约（ExtractZip 双参、load 请求 `{kind,path}`、`file:` 键规约）逐条核对一致；`file.name` 含路径分隔符边界用例（:127-134）有价值。mock 面控制良好：8 个依赖模块全部 mock 且都经 `vi.hoisted` 提供，无裸删 window，无 `it.skip`，环境注释（node）符合 ADR-255 分流精神——**但选错了环境**（见 P2-1），这是本测试最大问题。

**过度/残留 mock**：`menus/library` 为死 mock（P3-4）；`safe-call` mock 服务生产死导入（P3-1）；config 桶静态替换未守 importOriginal spread 铁律（P3-5）。

**错误路径**：有覆盖但断言深度不足（P2-2），且 zip 成功路径因环境冲突实际测到的是错误分支（P2-1），「成功路径验证」名不副实。

**验证结果**：实测 13/13 通过（12ms）；`npm run check` 的 4 个 tsc 错误全部位于 `motion-intent-ratio-guards.test.ts`（非本审核范围），drop-import 相关文件类型干净。

---

审核日期：2026-08-15
审核员：子代理 round16-drop-import
