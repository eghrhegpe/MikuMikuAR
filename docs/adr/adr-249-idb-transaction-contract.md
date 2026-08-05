# ADR-249: IndexedDB 事务异常契约 —— complete/error/abort 三事件必须全部接线

> **日期**: 2026-08-06
> **状态**: ✅ 已立（2026-08-06 立项；`core/backend/idb.ts` 的 `idbSet` / `idbDelete` / `idbBatchSet` 已补 `tx.onabort`，Promise 不再因 QuotaExceeded 等 abort 场景永不 settle）
> **编号**: 249
>
> **关联**: [ADR-176](adr-176-frontend-backend-adapter.md)（后端适配层，idb.ts 是其浏览器实现底座）、[ADR-195](adr-195-download-folder-unification.md)（下载文件夹统一，批量写入走 `idbBatchSet`）、[ADR-137](adr-137-envstate-single-source-schema.md)（EnvState 单源，防抖持久化依赖 idb）
>
> **来源**: 2026-08-05 第 14 轮代码审核（`docs/audit/`）P2：`idb.ts` 三个写入函数（`idbSet` L72-80 / `idbDelete` L82-90 / `idbBatchSet` L94-103）均只接 `tx.oncomplete` + `tx.onerror`，**未接 `tx.onabort`**。IndexedDB 规范：`QuotaExceededError` 等触发事务 `onabort` 而非 `onerror`，缺该处理器时 Promise 既不 resolve 也不 reject，调用方挂起。

**决策者**: AtomCode（联邦首席架构师 AI）、Jieling（人类侧首席架构师）

---

## 背景

### 触发证据：Promise 永不 settle（idb.ts）

```ts
// 修复前：只接 complete + error，缺 abort
const tx = db.transaction(store, 'readwrite');
tx.objectStore(store).put(value, key);
tx.oncomplete = () => resolve();
tx.onerror = () => reject(tx.error);
// 缺 tx.onabort —— QuotaExceededError 触发 onabort，Promise 挂起
```

IndexedDB 事务生命周期：`complete`（成功）→ `error`（单请求失败）→ `abort`（事务被中止，常见于 `QuotaExceededError` / 显式 `abort()`）。`onabort` 是独立事件，**不保证伴随 `onerror`**。

后果：浏览器端（web 模式）存储配额满时，`idbSet` 的调用方（防抖持久化、模型缓存、预设保存）await 挂起 → 相关功能无响应且无报错，是最难排查的静默卡死类缺陷。

### 同族风险

- `idbGet`（readonly 事务）理论上也会被 abort，但只读事务 abort 概率极低（当前未接 onabort，风险低，规范上仍建议补齐）。
- 未来新增的 IDB 封装函数若只接部分事件，复发同型缺陷。

## 决策

1. **所有 IDB 写事务必须接齐三事件**：`tx.oncomplete`（resolve）、`tx.onerror`（reject tx.error）、`tx.onabort`（reject tx.error）。三缺一即视为缺陷。
2. **只读事务（idbGet）同样补齐**：abort 概率低但契约应完整，避免「写了不读、读了不查」的不对称。
3. **reject 携带 `tx.error`**：调用方据错误类型（`QuotaExceededError` → 提示清理缓存）区分处理；不吞错、不静默。
4. **新封装函数走同一模板**：未来新增任何 `idbXxx` 封装，一律复制三事件模板（或抽取共享的 `withTx()` 辅助），禁止手写缺事件的变体。
5. **批量写入事务边界**：`idbBatchSet` 单事务包裹整批（ADR-195 约束），abort 时整批回滚——reject 语义即「整批失败」，调用方不得把部分成功当成功。

## 影响

- **修改文件**：`core/backend/idb.ts`（`idbSet` / `idbDelete` / `idbBatchSet` 补 `tx.onabort = () => reject(tx.error)`）。
- **测试**：`backend-mocks.ts` 内存桩模拟事务事件；建议补 abort 场景用例（P3 建议）。
- **验证**：backend 相关测试 120/120 通过；无行为回归（新增事件处理器仅覆盖此前挂起的分支）。

## 回滚

若浏览器实现确认某事件永不触发（如只读事务 abort），可注释说明依据后省略——但默认一律补齐，避免「以为不触发」的误判。

## 检查清单（供 code review / 子代理审核复用）

- [ ] `core/backend/idb.ts` 每个 `db.transaction(...)` 后三事件齐全（complete/error/abort）
- [ ] reject 携带 `tx.error`，不吞错
- [ ] 新封装函数复用三事件模板或 `withTx()` 辅助
- [ ] abort 场景（QuotaExceeded）有测试或至少手动验证 Promise reject
