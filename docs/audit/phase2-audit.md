# ADR-105 Phase 2 P2 函数代码审核报告

**审核日期**: 2026-07-14
**审核范围**: `loadProp`、`loadOutfits`、`handlePlazaDownload`
**审核标准**: AGENTS.md §代码审核维度标准

---

## [loadProp] — 审核结果

**总体结论：通过**

**亮点：**

| 代码模式 | 文件:行号 |
|---------|----------|
| AbortSignal 合并（外部 signal + 内部 AbortController） | `props.ts:51-58` |
| 每个 await 点前取消检查 | `props.ts:75`、`props.ts:95` |
| 取消后 `meshes.forEach(m.dispose())` 资源清理 | `props.ts:96-103` |
| `catch` 中 `AbortError` 静默（不打印 console.error） | `props.ts:155-156` |
| `finally` 中 `abortCtrl?.abort()` 清理 | `props.ts:171` |
| `onProgress` 回调内 `effectiveSignal.aborted` 检查 | `props.ts:86` |
| 类型守卫 `isValidPosition`/`isValidScaling` | `props.ts:28-34` |
| `removeProp` 中 `removeShadowCaster` 配对 | `props.ts:189-196` |

**风险：**

| 文件 | 观察 | 建议 |
|------|------|------|
| 🟢 P4 | `props.ts:171` `abortCtrl?.abort()` 在 `finally` 中调用，若 `abortCtrl` 为外部传入的 signal（不为内部创建），调用 `abort()` 会触发外部 `onabort` 处理器 | 文档说明：外部 signal 的 `abort()` 调用是预期行为（清理内部状态），非 bug |
| 🟢 P4 | `props.ts:98-100` `m.dispose()` 在 `try` 内，`catch` 中再次 `m.dispose()` 可能重复释放 | 风险极低（Babylon.js `dispose()` 幂等），可接受 |

**类型安全**: ✅ 无 `as any` / `@ts-ignore`
**资源管理**: ✅ 每个 `new Mesh` / `new TransformNode` 有对应 `dispose()`
**并发安全**: ✅ `_loadingOutfitsGuard`（`loadProp` 无此守卫，但 `propRegistry` 查找是同步的，无竞态）

---

## [loadOutfits] — 审核结果

**总体结论：有条件通过（🟠 P2 风险 1 处）**

**亮点：**

| 代码模式 | 文件:行号 |
|---------|----------|
| `LoadingGuard` 并发控制（`_loadingOutfitsGuard`） | `outfit.ts:110-112` |
| AbortSignal 合并（外部 + 内部） | `outfit.ts:115-122` |
| HEAD 请求透传 `signal: effectiveSignal` | `outfit.ts:224-227` |
| `withLimit` 信号量限流（`HEAD_CONCURRENCY = 6`） | `outfit.ts:194-207` |
| `Promise.all` 内每个子任务取消检查 | `outfit.ts:210`、`outfit.ts:216` |
| `finally` 中 `abortCtrl?.abort()` + `_loadingOutfitsGuard.leave()` | `outfit.ts:261-262` |

**风险：**

| 文件 | 观察 | 建议 |
|------|------|------|
| 🟠 P2 | `outfit.ts:139` `LoadOutfitFile` 是 Wails binding，**不支持 AbortSignal**，无法被取消 | 已在 ADR-105 文档中豁免，但用户快速切换模型时旧 `LoadOutfitFile` 仍在后台执行（无危害，仅资源占用） |
| 🟢 P4 | `outfit.ts:147-149` 内层 `try/catch` 静默吞掉 JSON 解析错误 | 合理（回退到自动发现逻辑），有注释 |
| 🟢 P4 | `outfit.ts:229-231` HEAD 请求 `catch` 返回 `false`（不抛异常） | 合理：文件不存在不是错误，是正常流程 |

**类型安全**: ✅ 无 `as any` / `@ts-ignore`
**资源管理**: ✅ 纹理加载超时后有 `trySwap`/`newTex.dispose()` 清理路径
**并发安全**: ✅ `LoadingGuard` + `effectiveSignal.aborted` 双重保障

---

## [handlePlazaDownload] — 审核结果

**总体结论：通过**

**亮点：**

| 代码模式 | 文件:行号 |
|---------|----------|
| AbortSignal 合并（外部 + 内部） | `plaza.ts:770-777` |
| 动态 import 前取消检查 | `plaza.ts:783-785` |
| `DownloadFromPlaza` 调用后取消检查 | `plaza.ts:792-794` |
| 完整 `try/catch/finally` + 用户状态提示 | `plaza.ts:779-807` |
| 文档豁免说明（`[adr-105] 注意`） | `plaza.ts:789-790` |

**风险：**

| 文件 | 观察 | 建议 |
|------|------|------|
| 🟢 P4 | `plaza.ts:791` `DownloadFromPlaza` 不支持 AbortSignal（已在文档豁免） | 无需修改 |

**类型安全**: ✅ 无 `as any` / `@ts-ignore`
**资源管理**: ✅ Wails binding 内部管理文件，无额外资源
**并发安全**: ✅ 无并发场景（单次下载）

---

## 汇总

| 函数 | 结论 | P2 风险 | P3/P4 风险 |
|------|------|---------|-----------|
| `loadProp` | ✅ 通过 | 0 | 2（可接受） |
| `loadOutfits` | ⚠️ 有条件通过 | 1（Wails binding 限制，文档豁免） | 2（可接受） |
| `handlePlazaDownload` | ✅ 通过 | 0 | 1（文档豁免） |

**无类型安全问题。无新增 `as any` / `@ts-ignore`。**