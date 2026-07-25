# ADR-180: Web 资源库 FSA 句柄持久化与启动自动重扫

> **状态**: 已完成（代码已落地 + P1 回归已修复，2026-07-25）
> **日期**: 2026-07-25
> **关联**: ADR-176（前端 Backend 适配器双实现）、ADR-177（Web Loader 与主应用统一路径）、ADR-179（更新安装拉起，平台分级）
> **前置**: ADR-177 Phase 2/4（browser-adapter 的 `SelectDir` 全量扫描写 IndexedDB、结构化克隆存储可用）
> **审核记录**: 2026-07-25 首席架构师审核（5 维度）发现 P1 回归（`_clearScannedEntries` 误删 `SelectImportFile` 导入数据）+ 同日应用修复（只清 `dir` 以 `web://selected-dir` 开头的 `entry:`），单测 60/60 通过，见「已知问题」

## 背景

用户报告：GitHub Pages 上的模型资源库正常，但 `http://127.0.0.1:5173`（Vite dev）解析不出文件层级（目录树塌缩）。

诊断结论（非 dev/prod 函数分叉）：

- 两环境后端解析到**同一份 `browserAdapter`**（`resolveBackend()`：web 模式直选、dev 模式 `awaitWailsBridge` 回退）。
- 层级由 `allModels[].dir` 派生，`dir` 是 **FSA 选目录扫描时一次性写入 IndexedDB**，非运行时重算。
- 两个 origin 的 IndexedDB 互不可见、不互相同步。localhost 源里躺着**旧版（HMR 迭代/早期 dev 会话）扫描写出的塌缩 `dir`**，GitHub Pages 源是修复后代码扫的 → 同一份当前源码，localhost 因旧数据塌缩。

核心追问：**「删除数据库后正常了，数据库不会在启动时重建吗？」**

答案（推翻初期误判）：**IndexedDB 不会在启动时自动重建。**

| 事实 | 证据 |
|------|------|
| `_fsaRootHandle` 是模块级**内存变量，不持久化** | `browser-adapter.ts:365`；全仓 grep 无任何 `idbSet` 存句柄 |
| `initLibrary`（`library-setup.ts:42`）启动只 lazy 读 IDB | `GetLibraryIndex`/`ScanModelDir` → `_listModels` 读 `entry:*`，从不调 `_scanDirIntoIDB` |
| 唯一的全量扫描写 IDB 在 `SelectDir` | `browser-adapter.ts`（弹 `showDirectoryPicker` + 重新授权）触发 `_scanDirIntoIDB` |
| 「删库后正常」= 用户删库后**重新选了一次目录** | 重选才会用当前代码覆盖旧 `dir`；启动本身不自愈 |

因此坏数据能长期赖着不走——直到手动重选或删库+重选。

## 决策

为消除「坏数据赖着不走 + 清库必须手动重选」的痛点，做**最小侵入**的持久化 + 启动自愈：

1. `SelectDir` 成功后，把 `_fsaRootHandle` 持久化进 IndexedDB（`idbSet('config','fsaRootHandle', handle)`）。IndexedDB 原生 `store.put` 用结构化克隆，`FileSystemDirectoryHandle` 可直接存（已核实 `idb.ts` 非 JSON 序列化）。
2. 新增 `restoreFsaRootHandle()`：启动时从 IDB 读回句柄，**仅 `queryPermission({mode:'readwrite'})` 恢复授权**；返回 `'granted'` 才返回句柄，否则 `null`。**绝不调用 `requestPermission`**（见约束）。
3. `ScanModelDir` 在无内存句柄时调用 `restoreFsaRootHandle()`；成功则设句柄并 `_scanDirIntoIDB` 重扫，使「已授权源」启动即自愈；失败降级为只读现有 entry（兼容现状）。
4. `_scanDirIntoIDB` 根目录重扫前先清旧（`_clearScannedEntries`，删 `entry:`/`file:`/`dir:` 前缀）。原因：`_listModels` 的 `[bugfix:stale-entry]` 只丢弃**缺字段**的 entry，塌缩但字段齐全的旧平铺 `entry:foo` 不会被清；不清旧则旧平铺项与新嵌套项共存，自愈不彻底。

## 约束（P1，硬限制，不可绕过）

**`requestPermission` 必须由用户手势触发。自动启动没有用户手势，浏览器会拒绝/抛错。** 因此：

- 启动自愈路径**只 `queryPermission`**，非 `'granted'` 则降级为手动 `SelectDir`。
- 已勾选「始终允许」的源 `queryPermission` 返回 `'granted'` → 静默自愈，零交互。
- 未授权 / 隐私模式 / 句柄失效 → 走现状（首次使用提示 / 手动重选），无副作用。

这是浏览器安全模型硬约束，代码无法绕过。

## 精确改法（已落地）

### ① `frontend/src/core/backend/browser-adapter.ts`

- 新增模块级 `_clearScannedEntries()`（`idbKeys('models')` 过滤 `entry:` 前缀，仅删 `dir` 以 `web://selected-dir` 开头的 entry；不动 `file:`/`dir:` 以保护导入/bundle）。
- 新增模块级 `restoreFsaRootHandle()`（读 `config/fsaRootHandle` + `queryPermission` 守卫，无 `as any`）。
- `_scanDirIntoIDB` 根入口（`relPath === ''`）调 `_clearScannedEntries()`。
- `SelectDir`：`_fsaRootHandle = await picker()` 后追加 `await idbSet('config', 'fsaRootHandle', _fsaRootHandle)`。
- `ScanModelDir`：由 `return _listModels()` 改为「无句柄先恢复，成功重扫、失败只读」。

> 注：`restoreFsaRootHandle` 刻意放模块级（不放 `browserAdapter` 对象），因 `browserAdapter: BackendService` 带类型注解（excess property 检查）；对象内 `ScanModelDir` 调用模块级函数不影响 `BackendService` 契约（139 函数不变）。

### ② `frontend/src/core/backend/backend.test.ts`

新增用例：
- `[adr-180] SelectDir 后持久化 fsaRootHandle 到 IndexedDB`。
- `[adr-180] ScanModelDir 在无内存句柄时从持久化句柄自动重扫，覆盖旧塌缩 entry`（用 fresh module import 隔离 `_fsaRootHandle` 状态）。

## 影响面

| 范围 | 影响 |
|------|------|
| 桌面端（Go adapter） | 无。FSA 路径仅 browser-adapter 生效。 |
| GitHub Pages / localhost（已授权源） | 启动自动重扫，资源库自愈；清库后无需手动重选（已勾选始终允许时）。 |
| 未授权源 / 隐私模式 | 降级现状，无副作用。 |
| 主应用 `SelectImportFile` 导入 | ✅ **已修复**（2026-07-25）：`_clearScannedEntries` 改为只清 `dir` 以 `web://selected-dir` 开头的 `entry:`，导入 entry（无 `dir`）与 bundle（dir 以 `web://bundle` 开头）均不命中、保留，导入的模型/纹理不再被重扫误删。 |
| `BackendService` 契约 | 不变（139 函数、FNV-1a method ID 不受影响）。 |

## 风险

| 级别 | 项 | 缓解 |
|------|----|------|
| 🔴 P1 | 启动无手势不能 `requestPermission` | 仅 `queryPermission`；非 granted 降级手动 `SelectDir` |
| ✅ 已修复 P1 | 清旧误删主应用 `SelectImportFile` 导入的模型/纹理（共用命名空间） | 已落 `_clearScannedEntries` 只清 `dir` 以 `web://selected-dir` 开头的 `entry:`（2026-07-25） |
| 🟢 P4 | 启动期 `ScanModelDir` 可能被 `initLibrary` 调两次（GetLibraryIndex + rescanAndSync）导致双重重扫 | 幂等、根目录不大时开销可接受；未加缓存标志以保持简洁 |

## 已知问题（2026-07-25 审核发现 P1，已修复并落地）

**现象**：`_clearScannedEntries()`（`browser-adapter.ts:467`）在根重扫时按前缀 `entry:`/`file:`/`dir:` **全清** models store。但 `_scanDirIntoIDB`（FSA 扫描）与 `SelectImportFile`（主应用「导入模型」入口）**共用同一命名空间，key 不可靠前缀区分**：

| 写入方 | `file:` | `entry:` | `dir:` |
|--------|---------|----------|--------|
| FSA 扫描 `_scanDirIntoIDB` | `file:${relIdStem}`（:573） | `entry:${relIdStem}`（多处） | `dir:${bareStem}:...`（:555-558，纹理） |
| 导入 `SelectImportFile` | `file:${stem}`（:1380/343） | `entry:${stem}`（:1382/311/344） | `dir:${stem}:<filename>`（:1361/357） |

导入 `entry:foo` 与扫描顶层 `entry:foo` 同名，无法靠前缀分辨。后果：**每次启动自动重扫（已授权源，ScanModelDir:1335）或手动重选目录（SelectDir:1352）都会删除用户此前导入的 PMX/纹理**——对已勾选「始终允许」的源是每次启动必现的数据丢失。

首版 ADR 仅注意到 web-loader 原型 drop-import（误判为 P3、可重建），**漏判了主应用 `SelectImportFile` 这条真实导入路径**，此为该回归未被拦截的根因。

**精确修复（`browser-adapter.ts` · `_clearScannedEntries`）**：

```ts
/** [doc:adr-180] 根目录重扫前清旧。只清「FSA 扫描产生」的 entry（dir 以 web://selected-dir 开头），
 * 不得清 file:/dir: 或导入/bundle 的 entry —— 否则每次重扫误删用户导入的模型与纹理（SelectImportFile 写同前缀命名空间）。 */
async function _clearScannedEntries(): Promise<void> {
    const keys = (await idbKeys('models')).filter((k) => k.startsWith('entry:'));
    for (const k of keys) {
        const v = await idbGet<{ dir?: string }>('models', k);
        if (v && typeof v.dir === 'string' && v.dir.startsWith('web://selected-dir')) {
            await idbDelete('models', k);
        }
    }
}
```

**修复正确性**：
- 旧塌缩平铺 `entry:foo`（`dir: web://selected-dir/PMX`）→ 前缀命中 → 仍被清，解决原始塌缩。
- 导入 `entry:${stem}`（无 `dir` 字段，:311/319/344）→ 不命中 → 保留。
- bundle/zip 展开 `entry`（dir `web://bundle/...`，:870）→ 不命中 → 保留。
- 不再动 `file:`/`dir:`：扫描对现存的模型/纹理会**重写成相同 key**（覆盖）；移除文件的孤儿 `file:`/`dir:` 无 entry 引用、永不被读（仅占位存储），无害。
- 测试 `[adr-180] 自动重扫覆盖旧塌缩 entry` 注入的「旧塌缩 entry」须带 `dir: web://selected-dir/...` 才能被新逻辑清除，应用修复时需同步该校验；并补「导入模型在重扫后仍存在」回归用例。

**当前状态**：已应用（2026-07-25）。修复 diff 已落 `browser-adapter.ts`，并新增回归用例「[adr-180] 根重扫不误删用户导入模型」，单测 60/60 通过。本 ADR 状态已翻为 已完成。

## 验证

- `cd frontend && npm run test -- src/core/backend/backend.test.ts`（含 ADR-180 用例）。
- 手动：localhost 选目录 → 刷新页面（不手动重选）→ 资源库层级应自动恢复；DevTools → IndexedDB `config` store 可见 `fsaRootHandle`。
- 2026-07-25 修复回归：`cd frontend && npm run test -- src/core/backend/backend.test.ts` → **60/60 通过**（含新增「根重扫不误删用户导入模型」用例：导入 `entry:importedMiku`/`file:`/`dir:` 在重扫后保留，FSA 新 `entry:m` 共存，旧塌缩 `entry:foo` 被清）。
- `npm run check:docs`（ADR 索引同步，adr-180 状态 已完成）。

## 关联事实

- `idb.ts` 底层：`idbSet` 用原生 `store.put`（结构化克隆），支持存 `FileSystemDirectoryHandle`。
- 旧塌缩根因：旧版 `_scanDirIntoIDB` 写出平铺 `entry:foo`（无嵌套路径），当前代码写出嵌套 `entry:PMX/foo`；因 key 不同，不覆盖，须先清旧。
