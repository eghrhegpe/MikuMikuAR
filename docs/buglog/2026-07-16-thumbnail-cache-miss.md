# 缩略图缓存 miss（网格不认图）BUG 追踪

**日期**: 2026-07-16
**发现方式**: GUI 实测 + 运行时 `[thumb-debug]` 日志比对 + 磁盘 PNG 文件名 SHA256 反推

---

## 背景

缩略图「12 轮反弹」的根因此前被定位为**缓存键双源字符串拼接**（`libraryPath`/`filePath` 在写侧 / 读侧各拼各的）。
P0（ADR-119 `thumbnail-key-single-source`）已锁死 `writeKey === readKey`（字符串逐字节相等，并由
`thumbnail-key.contract.test.ts` 熔断丝守护）。

但 P0 落地后 GUI 实测仍「截图（磁盘 PNG）成功，网格图不认」，且**内存层即时 miss**——
加载模型时网格面板从内存 `thumbnailCache` 就查不到，根本没走到磁盘/哈希层。

本次追踪发现：真正残留的运行时根因**不在 key 字符串**，而在**写侧各加载入口传参不对称**
（missing-param → 早退 / baseKey 后缀分叉），属同一家族两个独立缺陷。

---

## BUG-001: actor 分支 `captureThumbnail` 漏传 `inst`（🔴 P0）

actor 模型（最常见角色类型）加载后从不生成缩略图，网格恒 miss。

**根因**: `model-loader.ts:485` 的 actor 分支调用
```ts
swallowError(captureThumbnail(filePath, libraryPath, innerPath));   // ← 漏第 4 参 inst
```
而 `captureThumbnail` 内部：
```ts
const targetInst = inst ?? _modelManager.focused();
if (!targetInst || !targetInst.rootMesh) return;   // ← actor 在此早退
```
actor 分支依赖 `_modelManager.focused()` 竞态兜底。`focused()` 是有状态、时序敏感的取值，
加载时序一波动就返回 `null`/错位实例 → 早退 → **既不写内存 `thumbnailCache`，也不写磁盘**。

对比 stage 分支（`model-loader.ts:327`）显式传了 `inst`，故 stage 模型正常、actor 间歇 miss——
这正好解释了「时隐时现」的反弹表象。

**证据**: `[thumb-debug][WRITE-BASE]` 出现在 actor 加载时、`[WRITE-KEY]` 缺失（早退未落盘）；
对该模型 `tKey` 做 9 种 SHA256 变体，均 ≠ 磁盘目录内任何 PNG 文件名 → 写侧根本没跑完。

**修复**: 与 stage 分支对称，补传 `inst`（`inst` 在该作用域已定义，零新增依赖）：
```diff
- swallowError(captureThumbnail(filePath, libraryPath, innerPath));
+ swallowError(captureThumbnail(filePath, libraryPath, innerPath, inst));
```
commit `52ba99a`。

---

## BUG-002: replace 分支 `doReplace` 漏传 `innerPath`（🔴 P0）

**添加**模型时 ZIP 内模型缩略图正常，但用**替换模型**方式加载同一 ZIP 模型时网格恒 miss。

**根因**: `library-actions.ts` 的
```ts
const doReplace = (path: string, libraryPath?: string): void => {   // ← 无 innerPath 形参
    ...
    .load({ kind: loadKind, path, libraryPath })                     // ← 未传 innerPath
```
ZIP replace 调用点 `doReplace(result.file_path, m.file_path)` 未传 `innerPath` → 写侧
`thumbnailBaseKey({libraryPath, filePath, innerPath})` 中 `innerPath` 为 `undefined` →
baseKey 退化为 `zip路径`（缺 `::素体.pmx` 内嵌名后缀）。而网格读侧 `libraryModelBaseKey(m)`
= `zip路径::素体.pmx`（`m.file_path::m.zip_inner`）→ **写读 base 逐字节分叉** → 内存 + 磁盘双 miss。

对比 normal 模式 ZIP 分支（`library-actions.ts:282` → `:307-312` 现已正确设置 `libraryPath`
+ `innerPath`），唯 replace 分支不对称。

**证据**: `[thumb-debug][REQ]` 显示 replace 加载请求
`{ kind:'actor', path:'<临时解压路径>', libraryPath:'<zip库引用>' }` —— `innerPath` 整个字段缺失；
写侧 `[WRITE-BASE].innerPath === undefined`，读侧 `tKey` 却含 `::素体.pmx`。

**修复**: 让 replace 与 normal 对称，补 `innerPath` 全链路（3 处）：
```diff
- const doReplace = (path: string, libraryPath?: string): void => {
+ const doReplace = (path: string, libraryPath?: string, innerPath?: string): void => {

-     .load({ kind: loadKind, path, libraryPath })
+     .load({ kind: loadKind, path, libraryPath, innerPath })

-     doReplace(result.file_path, m.file_path);
+     doReplace(result.file_path, m.file_path, m.zip_inner);
```
（`library-actions.ts:217 / :233 / :282`）commit `6fe8007`。

---

## 诊断方法论（可复用）

1. **写读 key 并排比对**：在写侧落盘前（`thumbnail-capture.ts`）、读侧查询点（`ui-resource-panel.ts`
   网格视图）、dispatch 入口（`load-manager.ts`）各插 dev-only 日志 `[thumb-debug]`，前缀便于 console 过滤；
   prod 构建不打印，确认修复后剥离。
2. **磁盘文件名反推**：Go 侧以 `SHA256Hex(key)` 作 PNG 文件名。在 Node 侧对推测的 `tKey` 各候变种
   （raw / Go 相对路径 / 去 innerPath / 仅 file_path / 分辨率 256）做 SHA256，与磁盘 PNG 文件名比对——
   若全不匹配，则该 PNG 是孤儿文件，写侧 key 与读侧 key 分叉。
3. **穷举加载入口**：`grep captureThumbnail(` 确认调用点数量与实参；再顺 `dispatch → loadPMXFile →
   captureThumbnail` 链路核形参对齐，定位「构造 req 时遗漏」的具体入口（本案为 `doReplace`）。

---

## 验证

- `tsc --noEmit` → 0 错误
- 完整前端套件 → 1520 测试全过 / 56 文件零失败
- GUI 复测：添加 / 替换 ZIP 角色模型，网格缩略图均正常显示

## 提交

- `52ba99a` — actor 分支补传 `inst`（BUG-001）
- `6fe8007` — replace 分支补传 `innerPath` + 剥离 4 处 `[thumb-debug]` 诊断 log（BUG-002）

## 关联

- ADR-119 `thumbnail-key-single-source`：缓存键单一源（字符串层 P0，本次 buglog 是其运行时收口的上游）
