# 计划：LibrarySessionStore 状态收敛（P0.1）

> 起草：2026-07-19 23:50
> 状态：执行中
> 关联 ADR：ADR-135（LibrarySessionStore）、ADR-097（资源库恢复汇总）、ADR-131（BrowseOutcome 契约）
> 联邦架构师锐评：2026-07-19，资源库加载系统「状态多核 CPU」

---

## 0. 目标与边界

**做什么**：把 library-core / library-actions / library-browse 三个文件散落的 5 个隐式状态变量，收敛到新建的 `LibrarySessionStore` 单例上。

**不做什么**：
- 不改任何外部行为（函数签名、return 值、UI 反馈零变化）
- 不动 3 个绑定标志位（state.ts 的 motionBindingTargetId / layerBindingTargetId / modelReplaceTargetId，归 ADR-131 后续）
- 不动 load-manager / BrowseOutcome / prepareModelRestore 函数签名
- 不新增单测（既有 22 个用例覆盖作为回归保护）

---

## 1. 状态搬迁清单

| # | 原位置 | 原符号 | 新访问路径 |
|---|--------|--------|-----------|
| 1 | library-core.ts:79 | `pendingAutoExpand: string[] \| null` | `librarySessionStore.getPendingAutoExpand() / setPendingAutoExpand(v)` |
| 2 | library-core.ts:80 | `pendingFocusModel: { dir, rowKey } \| null` | `librarySessionStore.getPendingFocusModel() / setPendingFocusModel(v)` |
| 3 | library-actions.ts:75 | `_isExtracting: boolean` | `librarySessionStore.isExtracting() / setExtracting(v)` |
| 4 | library-actions.ts:77 | `_isReplaceLoading: boolean` | `librarySessionStore.isReplaceLoading() / setReplaceLoading(v)` |
| 5 | library-browse.ts:51 | `_restoreTimer: ReturnType<typeof setTimeout> \| null` | `librarySessionStore.setRestoreTimer(t) / clearRestoreTimer() / getRestoreTimer()` |

---

## 2. 执行步骤

### Step 1：新建 store 文件
- 路径：`frontend/src/menus/library-session-store.ts`
- 内容：`LibrarySessionStore` 类 + `librarySessionStore` 单例导出
- 依赖：零外部依赖（纯数据类，不 import 任何 library-* 模块）

### Step 2：library-core.ts 搬迁 + 兼容门面
- 删除模块级 `let pendingAutoExpand / pendingFocusModel`
- 顶部 `import { librarySessionStore } from './library-session-store'`
- 4 个导出函数 `getPendingAutoExpand / setPendingAutoExpand / getPendingFocusModel / setPendingFocusModel` 保留，内部改为代理 store
- 检查 `LoadingGuard _pendingMetaGuard`（library-core.ts:94）——**不动**，不在本 ADR 范围

### Step 3：library-actions.ts 搬迁
- 删除模块级 `let _isExtracting` 和 `let _isReplaceLoading`
- 所有读写点改为 `librarySessionStore.isExtracting() / setExtracting(v)` / `isReplaceLoading() / setReplaceLoading(v)`
- `_isReplaceLoading` 的 4 处读写点：`onModelRowClick` 内 `_isReplaceLoading = true` / `replaceModel` 内的 `replaceMotion` 内的 `_isReplaceLoading` / `_onModelLoaded` 守卫 / `.finally` 内的 `_isReplaceLoading = false`

### Step 4：library-browse.ts 搬迁
- 删除模块级 `let _restoreTimer`
- `deferRestore` 内所有 `_restoreTimer = setTimeout(...)` / `clearTimeout(_restoreTimer)` / `_restoreTimer = null` 改为 `librarySessionStore.setRestoreTimer(t)` / `clearRestoreTimer()`

### Step 5：showModelPopup 调用 reset()
- 在 `library-browse.ts:317-323` 的 `stackRegistry.modelStack = makeModelMenu(wrapper)` 之前，调用 `librarySessionStore.reset()` 清理 restore 残留态
- **行为变化**：原代码不清理（这是 bug），P0.1 顺手修。loading 状态不在 reset 范围（解压/替换可能跨弹窗重置进行）

### Step 6：验证
- `cd frontend && npm run check` —— 零新增 tsc 错误
- `cd frontend && npm run test -- library-core` —— 22 个用例全绿
- `cd frontend && npm run build` —— 通过

### Step 7：本地缓存提交
```bash
git add frontend/src/menus/library-session-store.ts \
        frontend/src/menus/library-core.ts \
        frontend/src/menus/library-actions.ts \
        frontend/src/menus/library-browse.ts \
        docs/adr/adr-135-library-session-store.md \
        docs/superpowers/plans/2026-07-19-library-session-store.md
git commit -m "feat: ADR-135 P0.1 LibrarySessionStore 状态收敛"
```

---

## 3. 风险与缓解

| 风险 | 缓解 |
|------|------|
| HMR 重载时模块级变量被重置，store 单例也会重置 | Vite HMR 默认保留 ES 模块状态，store 单例与原模块级变量行为一致 |
| `_isReplaceLoading` 的 `_onModelLoaded` 事件守卫跨文件读 | store 单例跨文件共享，行为一致 |
| `deferRestore` 内 `_restoreTimer` 的两个并发实例可能互相覆盖 | 原 bug，P0.1 保留语义，per-restore 守卫归 P0.3 |
| `reset()` 调用清理 restore 但保留 loading | 这是 P0.1 的设计决定，loading 跨弹窗重置是合理场景（解压进行中重开弹窗） |

---

## 4. 验收清单

- [ ] `library-session-store.ts` 创建并通过 tsc
- [ ] 5 个原变量在 3 个文件中删除
- [ ] 4 个兼容门面函数保留
- [ ] `showModelPopup` 调用 `reset()`
- [ ] `npm run check` 零新增错误
- [ ] `npm run test -- library-core` 全绿
- [ ] `npm run build` 通过

---

## 5. 后续阶段

| 阶段 | 内容 | 状态 | ADR |
|------|------|------|-----|
| P0.2 | loadId trace 链路 | ✅ 已完成（见第 6 节） | 扩展 ADR-135 |
| P0.3 | deferRestore 可见化 LoadingState | 待启动 | 新 ADR |
| P1.1 | load-manager 错误处理 + onRejected 不再吞错 | 待启动 | 扩展 ADR-105 |
| P1.2 | `_isExtracting` per-model Set 升级 | 待启动 | 扩展 ADR-135 |
| P1.3 | ADR-131 后续清理 3 个绑定标志位 | 待启动 | ADR-131 后续 |
| P2 | onModelRowClick 拆分 + 缩略图 AbortSignal + 移除兼容门面 | 待启动 | 新 ADR |
| P3 | PopupRow discriminated union | 待启动 | 新 ADR |

---

## 6. P0.2 loadId trace 链路（已实施 2026-07-20）

### 6.1 目标

为每次 `loadManager.load()` 请求分配 `loadId`，在 `dispatch` 内部追踪 `phase`，错误发生时包装为 `LibraryLoadError` 结构化对象，让：

1. `formatError(err)` 自动识别并返回 `[loadId/phase] cause` 字符串
2. `library-actions.ts` 的 6 处 `.catch` 不需改一行代码，用户看到的错误信息自动带 trace ID
3. `getCurrentLoad()` 暴露当前加载的 `{ loadId, phase, req }`，为 P0.3 可见化 LoadingState 铺路

### 6.2 设计

#### 类型（load-manager.ts）

```ts
export type LoadPhase = 'parse' | 'register' | 'apply' | 'refresh' | 'unknown';

export interface LibraryLoadError {
    readonly name: 'LibraryLoadError';
    readonly loadId: string;
    readonly phase: LoadPhase;
    readonly cause: unknown;
    readonly req: LoadRequest;
    readonly message: string;
}
```

> **phase 列表精简为 4 个**：`'parse'`（解析文件 / 调底层加载器）/ `'register'`（写 registry）/ `'apply'`（应用到场景，预留给未来）/ `'refresh'`（刷新菜单）/ `'unknown'`（兜底）。
>
> **不包含 `'extract'`**：zip 解压走 `ExtractZip` 不经过 loadManager，归 P1.2 处理。

#### LoadManager 字段扩展

```ts
class LoadManager {
    private queue: Promise<void> = Promise.resolve();
    private _current: LoadRequest | null = null;
    private _loadId: string | null = null;     // [adr-135] P0.2
    private _phase: LoadPhase | null = null;    // [adr-135] P0.2

    load(req: LoadRequest): Promise<ResourceHandle | null> {
        const loadId = this._generateLoadId();
        return this.enqueue(() => this.dispatch(req, loadId));
    }

    /** 当前正在执行的加载（含 loadId + phase，供 UI 显示状态）。 */
    getCurrentLoad(): { loadId: string; phase: LoadPhase; req: LoadRequest } | null {
        if (!this._current || !this._loadId) return null;
        return { loadId: this._loadId, phase: this._phase ?? 'unknown', req: this._current };
    }

    private _generateLoadId(): string {
        return 'l_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
    }
}
```

#### dispatch 包装错误

```ts
private async dispatch(req: LoadRequest, loadId: string): Promise<ResourceHandle | null> {
    this._current = req;
    this._loadId = loadId;
    try {
        this._phase = 'parse';
        switch (req.kind) {
            case 'actor':
            case 'stage': {
                const { loadPMXFile } = await import('../scene/manager/model-loader');
                const id = await loadPMXFile(...);   // parse phase
                if (!id) return null;
                this._phase = 'register';
                const { modelRegistry } = await import('./config');
                const inst = modelRegistry.get(id);
                this._phase = 'refresh';
                this._refreshMenus();
                return { id, kind: req.kind, name: inst?.name ?? '', filePath: req.path };
            }
            // ... 其他分支同理
        }
    } catch (err) {
        throw {
            name: 'LibraryLoadError',
            loadId,
            phase: this._phase ?? 'unknown',
            cause: err,
            req,
            message: err instanceof Error ? err.message : String(err),
        } as LibraryLoadError;
    } finally {
        this._current = null;
        this._loadId = null;
        this._phase = null;
    }
}
```

#### formatError 识别

```ts
export function formatError(err: unknown, maxLen = 120): string {
    // [adr-135] P0.2: 识别 LibraryLoadError，加 [loadId/phase] 前缀
    if (err && typeof err === 'object' && (err as { name?: string }).name === 'LibraryLoadError') {
        const e = err as LibraryLoadError;
        const cause = formatError(e.cause, maxLen);
        const prefix = `[${e.loadId}/${e.phase}] `;
        const full = prefix + cause;
        return full.length > maxLen ? full.slice(0, maxLen - 3) + '...' : full;
    }
    // ... 原逻辑保持不变
}
```

> **避免循环依赖**：`formatError` 在 `utils.ts`，`LibraryLoadError` 在 `load-manager.ts`。若 utils 导入 load-manager 类型，会引入 utils → load-manager 依赖。改用 structural type 判断（`name === 'LibraryLoadError'`），不导入类型，零依赖。

### 6.3 不改的部分

| 项 | 原因 |
|----|------|
| `library-actions.ts` 的 6 处 `.catch` | `formatError` 自动识别并加前缀，零侵入 |
| `enqueue` 的 onRejected 立即重试 | 归 P1.1 处理；P0.2 重试复用同一 loadId（合理：重试同一加载） |
| `LoadRequest` 接口 | 不加 `loadId` 字段，避免外部可变 |
| 单测 | 不新增；loadId 是 trace 标签，无新业务逻辑分支。既有 `library-core.test.ts` 22 用例 + `app.contract.test.ts` 17 用例覆盖作为回归保护 |

### 6.4 验收清单

- [ ] `load-manager.ts` 新增 `LoadPhase` / `LibraryLoadError` 类型导出
- [ ] `LoadManager._loadId` / `_phase` 字段 + `getCurrentLoad()` 方法
- [ ] `dispatch(req, loadId)` 内 try/catch 包装 LibraryLoadError
- [ ] `utils.ts formatError` 识别 LibraryLoadError
- [ ] `npm run check` 零新增 tsc 错误
- [ ] `npm run test -- library-core` 106/106 全绿
- [ ] `npm run build` 通过

### 6.5 用户感知收益

| 场景 | P0.2 前 | P0.2 后 |
|------|---------|---------|
| 模型加载失败 | 状态栏：「模型加载失败：[cause message]」 | 状态栏：「模型加载失败：[l_xxx/parse] [cause message]」 |
| 排查时间 | 用户/AI 拿不到 trace ID，只能复现 | 状态栏直接显示 `l_xxx` ID，AI grep 日志即可定位 |
| 多次失败 | 错误互相覆盖，无法区分 | 每次错误带独立 loadId，可对比 |
