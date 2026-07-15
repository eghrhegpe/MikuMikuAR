# 第⑤轮审核 — scene/manager 模块修复记录

**日期**: 2026-07-16
**发现方式**: 代码审核（第⑤轮）

---

## 修复 1: loadPMXFile abort 后尽早返回路径跳过资源清理（🟡 P3）

**文件**: `frontend/src/scene/manager/model-loader.ts:357-358, 430-431`

**问题**: `loadPMXFile` 中两处 `if (effectiveSignal.aborted) return null;` 尽早返回时，`wasmModel` 已通过 `_mmdRuntime.createMmdModel` 创建、`inst` 已通过 `_modelManager.register` 注册。返回 null 后这些资源残留在运行时和注册表中，无法被回收。

**根因**: 这两个检查点位于 `_modelManager.register(inst)` 之后的同步代码段（无 `await`），JS 单线程保证外部信号无法在此窗口内 abort，所以当前实际不可达。但未来若在此处插入 `await` 则变成泄漏，属于潜伏债。

**修复**: 两个尽早返回前均调用 `_modelManager.remove(registeredId)` + `_mmdRuntime.destroyMmdModel(wasmModel)`，与 catch 块的清理逻辑一致。

**教训**: `effectiveSignal.aborted` 尽早返回是防御性写法，但必须与 catch 块保持相同的资源清理契约。推荐在 `finally` 块中统一处理资源清理，避免遗漏。

## 修复 2: model-ops.ts import 位置混乱（🟢 P4）

**文件**: `frontend/src/scene/manager/model-ops.ts:254-255`

**问题**: `import { Quaternion }` 和 `import type { VPDBoneData, VPDMorphData }` 出现在文件中部（函数定义之后），违反 import 集中的惯例。

**修复**: 将 `Quaternion` 合入已有的 `import { Vector3 }` 行，`VPDBoneData`/`VPDMorphData` 类型导入移至文件顶部，删除中部重复的 import 行。