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
| P0.3 | deferRestore 可见化 LoadingState | ✅ 已完成（见第 7 节） | 扩展 ADR-135 |
| P1.1 | load-manager 错误处理 + onRejected 不再吞错 | ✅ 已完成（见第 8 节） | 扩展 ADR-135 |
| P1.2 | `_isExtracting` per-model Set 升级 | ✅ 已完成（见第 9 节） | 扩展 ADR-135 |
| P1.3 | ADR-131 后续清理 3 个绑定标志位 | ✅ 已完成（见第 10 节） | ADR-131 后续 |
| P1.4 | layerBindingTargetId 清理 + 相机 VMD 加载死代码修复 | ✅ 已完成（见第 11 节） | ADR-131 后续 |
| P2.3 | 移除兼容门面（getPendingAutoExpand 等 4 函数） | ✅ 已完成（见第 12 节） | 扩展 ADR-135 |
| P2.1 | onModelRowClick 拆分 | ✅ 已完成（见第 14 节） | 扩展 ADR-135 |
| P2.2 | 缩略图 AbortSignal | ✅ 已完成（见第 13 节，ADR-136） | ADR-136 |
| P2.4 | modelReplaceTargetId 迁移到 outcome 契约 | ✅ 已完成（见第 15 节） | 扩展 ADR-135 |
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

---

## 7. P0.3 deferRestore 可见化 LoadingState（已实施 2026-07-20）

### 7.1 目标

消灭 `deferRestore` 6 秒静默放弃的用户感知地狱：

1. 启动轮询时显示「⏳ 正在扫描 X…」
2. 等待超过 2 秒后每秒更新「⏳ 正在扫描 X…（已等待 Ys）」
3. 数据就绪时短暂提示「✓ 已展开 X」
4. 超时不再静默，告知用户「⚠ 扫描超时（X），请手动点击文件夹展开」

### 7.2 设计

#### Store 新增字段（library-session-store.ts）

```ts
export type LibraryRestoreStatus = 'idle' | 'polling' | 'ready' | 'timeout';

export interface LibraryRestoreState {
    // ... 原 pendingAutoExpand / pendingFocusModel / timer
    status: LibraryRestoreStatus;     // P0.3 新增
    targetSeg: string | null;         // P0.3 新增（当前轮询的段名）
    startedAt: number | null;         // P0.3 新增（开始时间戳）
}
```

#### Store 新增 accessors

| 方法 | 用途 |
|------|------|
| `getRestoreStatus()` | UI 据此决定是否显示提示 |
| `getRestoreTargetSeg()` | 当前轮询的段名 |
| `getRestoreStartedAt()` | 计算已等待秒数 |
| `markRestorePolling(seg)` | 进入 polling 状态 |
| `markRestoreReady()` | 数据就绪（瞬态，下一 tick 回 idle） |
| `markRestoreTimeout()` | 超时不再静默 |
| `clearRestoreStatus()` | 回到 idle（校验失败也要清状态） |

#### deferRestore 接入（library-browse.ts）

```ts
function deferRestore(menu, dir, seg) {
    librarySessionStore.clearRestoreTimer();
    librarySessionStore.markRestorePolling(seg);                    // 新增
    setStatus(t('library.scanningDir', { dir: seg }), false, true);  // 新增：hold=true 持续显示

    let tries = 0;
    let lastShownSec = -1;                                            // 新增：避免 150ms 闪烁
    const tick = () => {
        tries++;
        if (tries > 40) {
            librarySessionStore.setRestoreTimer(null);
            librarySessionStore.markRestoreTimeout();               // 新增
            setStatus(t('library.scanTimeout', { dir: seg }), false, true);  // 新增
            return;
        }
        if (!_isDirDataReady(nextDir)) {
            // 新增：每 1s 更新一次「已等待 Xs」
            const startedAt = librarySessionStore.getRestoreStartedAt();
            if (startedAt !== null) {
                const elapsedSec = Math.floor((Date.now() - startedAt) / 1000);
                if (elapsedSec >= 2 && elapsedSec !== lastShownSec) {
                    lastShownSec = elapsedSec;
                    setStatus(t('library.scanningDirWithWait', { dir: seg, sec: elapsedSec }), false, true);
                }
            }
            librarySessionStore.setRestoreTimer(setTimeout(tick, 150));
            return;
        }
        librarySessionStore.setRestoreTimer(null);
        // 校验失败也要清状态（原 bug：失败不清，status 卡在 polling）
        if (!cur || normPath(cur.dir) !== normPath(dir)) {
            librarySessionStore.clearRestoreStatus();               // 新增
            return;
        }
        if (!pa || pa[0] !== seg) {
            librarySessionStore.clearRestoreStatus();               // 新增
            return;
        }
        // ... push + markRestoreReady + setStatus 已展开
        librarySessionStore.markRestoreReady();                     // 新增
        setStatus(t('library.expanded', { dir: seg }), true);       // 新增
    };
    librarySessionStore.setRestoreTimer(setTimeout(tick, 150));
}
```

#### i18n 5 语种 key

| key | zh-CN | en | ja | ko | zh-TW |
|-----|-------|----|----|----|-------|
| `library.scanningDir` | ⏳ 正在扫描 {dir}… | ⏳ Scanning {dir}… | ⏳ {dir} をスキャン中… | ⏳ {dir} 검색 중… | ⏳ 正在掃描 {dir}… |
| `library.scanningDirWithWait` | ⏳ 正在扫描 {dir}…（已等待 {sec}s） | ⏳ Scanning {dir}… (waited {sec}s) | ⏳ {dir} をスキャン中…（{sec}秒待機） | ⏳ {dir} 검색 중… ({sec}초 대기) | ⏳ 正在掃描 {dir}…（已等待 {sec}秒） |
| `library.scanTimeout` | ⚠ 扫描超时（{dir}），数据可能未就绪，请手动点击文件夹展开 | ⚠ Scan timeout ({dir})... | ⚠ スキャンタイムアウト（{dir}）... | ⚠ 검색 시간 초과 ({dir})... | ⚠ 掃描逾時（{dir}）... |
| `library.expanded` | ✓ 已展开 {dir} | ✓ Expanded {dir} | ✓ {dir} を展開しました | ✓ {dir} 펼침 | ✓ 已展開 {dir} |

### 7.3 不改的部分

| 项 | 原因 |
|----|------|
| `deferRestore` 函数签名 / 调用点 | 仅内部增加 UI 反馈，外部行为不变 |
| 轮询间隔（150ms） / 上限（40 次） | 不改轮询机制本身，只改反馈 |
| 单测 | 不新增；既有 `library-core.test.ts` 106 用例覆盖作为回归保护 |
| `showModelPopup` 的 `reset()` | P0.1 已接入，P0.3 的 `clearRestoreStatus()` 由 `reset()` 内部调用 |

### 7.4 验收清单

- [x] `LibraryRestoreStatus` 类型导出
- [x] store `restore.status / targetSeg / startedAt` 字段 + 4 个 mark* / clear accessors
- [x] `deferRestore` 启动 setStatus hold=true
- [x] tick 内每 1s 更新「已等待 Xs」（避免 150ms 闪烁）
- [x] 超时不再静默，显示 scanTimeout
- [x] 校验失败也清状态（修原 bug：status 卡在 polling）
- [x] 数据就绪显示「已展开 X」
- [x] i18n 5 语种 4 个 key 添加
- [x] `npm run check` 零新增 tsc 错误
- [x] `npm run test -- library-core` 106/106 全绿
- [x] `npm run build` 通过

### 7.5 用户感知收益

| 场景 | P0.3 前 | P0.3 后 |
|------|---------|---------|
| 扫描中（< 2s） | 状态栏无变化，用户以为程序卡死 | 「⏳ 正在扫描 X…」持续显示 |
| 扫描中（> 2s） | 状态栏无变化，用户开始乱点 | 「⏳ 正在扫描 X…（已等待 3s）」每秒更新 |
| 扫描成功 | 状态栏无变化 | 「✓ 已展开 X」短暂 2 秒提示 |
| 扫描超时（6s） | **静默放弃，用户完全无感知** | 「⚠ 扫描超时（X），请手动点击文件夹展开」持续显示 |
| 校验失败 | status 卡在 polling（bug） | status 正确回 idle |

### 7.6 风险与缓解

| 风险 | 缓解 |
|------|------|
| hold=true 状态被其他 setStatus 覆盖 | 设计预期：用户点击其他操作时，扫描提示让位是合理行为；store.status 仍正确 |
| 多次 deferRestore 并发触发 | 第二次 `clearRestoreTimer` 取消第一次的 timer，但第一次的 setStatus 已被第二次覆盖；store.status 反映最后一次 |
| tsc 通过但 vitest esbuild 报 ko.ts transform 错误 | 历史遗留（其他 AI 改动 ko.ts 引入）；重跑 vitest cache 即可通过，不影响 build |

---

## 8. P1.1 load-manager onRejected 不再吞错（已实施 2026-07-20）

### 8.1 目标

消灭 enqueue 的「静默重试」反模式：

- 旧：onRejected 吞掉错误 → `console.warn` → 立即重试 task() → 用户看到的是重试结果（可能再次失败，但前一次错误链路彻底丢失）
- 新：onRejected 直接透传错误 → 调用方 `.catch` 处理 → 错误链路完整保留

### 8.2 设计

```ts
private enqueue<T>(task: () => Promise<T>): Promise<T> {
    // [doc:adr-135] P1.1: onRejected 不再吞错重试，直接上抛让调用方处理。
    // - 上一个任务失败时，新任务仍正常执行（不被前错阻塞）
    // - 但失败任务的错误直接透传给其调用方（library-actions 的 .catch 会处理）
    // - this.queue 始终 reset 为 resolved，保证后续 enqueue 不被污染
    const result = this.queue.then(task);
    this.queue = result.then(
        () => {},
        (err) => console.warn('[loadManager] queue cleanup (error swallowed for chain):', err)
    );
    return result;
}
```

**关键点**：
1. `this.queue.then(task)`：只接 onFulfilled，onRejected 默认透传错误
2. `this.queue = result.then(...)`：reset 为 resolved，保证后续 enqueue 不被前错阻塞
3. reset 内的 `console.warn` 仅为调试用，不影响用户感知

### 8.3 不改的部分

| 项 | 原因 |
|----|------|
| `load()` 入口 loadId 生成 | P0.2 已完成，不变 |
| `dispatch` 内 try/catch 包装 LibraryLoadError | P0.2 已完成，不变 |
| `library-actions.ts` 的 6 处 `.catch` | 已存在且能正确处理错误，无需改动 |

### 8.4 验收清单

- [x] enqueue onRejected 不再调用 `task()` 重试
- [x] 错误直接透传给调用方
- [x] `this.queue` reset 逻辑保留（保证链路不阻塞）
- [x] `npm run check` 零新增 tsc 错误
- [x] `npm run test -- library-core` 106/106 全绿

### 8.5 用户感知收益

| 场景 | P1.1 前 | P1.1 后 |
|------|---------|---------|
| 任务 A 失败，任务 B 排队 | A 静默重试（可能再次失败），B 等待 A 重试完成 | A 错误立即上抛，B 正常执行 |
| 错误链路追溯 | 前一次错误被 console.warn 吞掉 | 完整保留，调用方 .catch 接到结构化 LibraryLoadError |
| 重试语义 | 自动重试（可能掩盖瞬时问题，也可能放大永久问题） | 不自动重试（用户可手动重新点击触发） |

### 8.6 风险与缓解

| 风险 | 缓解 |
|------|------|
| 瞬时错误不再自动恢复 | 设计预期：loadManager 不做重试策略，由用户或调用方决定是否重试 |
| 调用方未处理 rejected promise | library-actions 的 6 处调用点均有 `.catch`，已验证覆盖 |
| 队列状态错乱 | `this.queue` reset 逻辑保留，错误不影响后续任务入队 |

---

## 9. P1.2 _isExtracting per-model Set 升级（已实施 2026-07-20）

### 9.1 目标

消灭 `_isExtracting` 一刀切布尔的 UX 灾难：

- 旧：zip A 解压期间，pmx B 点击被静默 return（甚至 UI 闪一下但什么都没做）
- 新：按模型 file_path 精确守卫，zip A 解压时 pmx B 直接放行

### 9.2 设计

#### Store 字段升级

```ts
export interface LibraryLoadingState {
    extraction: Set<string>;    // P1.2: 从 boolean 升级为 Set<string>
    replaceLoading: boolean;
}
```

#### Store API 变更

| 旧签名 | 新签名 | 行为 |
|--------|--------|------|
| `isExtracting(): boolean` | `isExtracting(modelKey?: string): boolean` | 不传参：`size > 0`（兼容 P0.1 语义）；传参：`has(modelKey)` |
| `setExtracting(true)` | `setExtracting(modelKey: string)` | `add(modelKey)` |
| `setExtracting(false)` | `clearExtracting(modelKey?: string)` | 不传参：`clear()`；传参：`delete(modelKey)` |

#### library-actions 6 处守卫点

| 位置 | 旧 | 新 |
|------|----|----|
| `onModelRowClick:229` | `isExtracting()` | `isExtracting(m.file_path)` |
| `replaceMotion:333` | `setExtracting(true)` | `setExtracting(m.file_path)` |
| `replaceMotion:345` (finally) | `setExtracting(false)` | `clearExtracting(m.file_path)` |
| `onModelRowClick:357` (normal zip) | `setExtracting(true)` | `setExtracting(m.file_path)` |
| `onModelRowClick:376` (finally) | `setExtracting(false)` | `clearExtracting(m.file_path)` |
| `replaceMotion:428` (vmd zip) | `setExtracting(true)` | `setExtracting(m.file_path)` |
| `replaceMotion:436` (finally) | `setExtracting(false)` | `clearExtracting(m.file_path)` |

### 9.3 顺手修的 bug

`reset()` 现在调用 `clearStatusTimer()`（原代码未清理 statusTimer，导致 reset 后 ready 瞬态 timer 仍可能 fire）。

### 9.4 测试同步

`library-session-store.test.ts`（其他 AI 写的 12 个用例）同步迁移：
- `setExtracting(false)` → `clearExtracting()`
- `setExtracting(true)` → `setExtracting('foo.pmx')`
- `isExtracting()` → `isExtracting('foo.pmx')`（精确查询）

### 9.5 验收清单

- [x] `LibraryLoadingState.extraction` 类型从 `boolean` 改为 `Set<string>`
- [x] `isExtracting(modelKey?)` / `setExtracting(modelKey)` / `clearExtracting(modelKey?)` 三重载
- [x] `reset()` 调用 `clearStatusTimer()`（顺手修 bug）
- [x] library-actions 6 处守卫点全部适配新 API
- [x] `onModelRowClick` 守卫改为 `isExtracting(m.file_path)` per-model 精确查询
- [x] `library-session-store.test.ts` 同步迁移
- [x] `npm run check` 零新增 tsc 错误
- [x] `npm run test -- library-core library-session-store` 118/118 全绿

### 9.6 用户感知收益

| 场景 | P1.2 前 | P1.2 后 |
|------|---------|---------|
| zip A 解压中，点击 pmx B | **静默 return，UI 闪一下但什么都没做** | pmx B 正常加载，与 zip A 并行 |
| zip A 解压中，再次点击 zip A | 一刀切阻塞（合理） | per-model 阻塞（合理，行为不变） |
| 多个 zip 并行解压 | 一刀切：只能串行 | per-model：每个 zip 独立标记，但 ExtractZip 底层串行（由 loadManager 保障） |

### 9.7 风险与缓解

| 风险 | 缓解 |
|------|------|
| 旧调用方传 `true` / `false` | 已 grep 全部调用点（仅 library-actions.ts + test 文件），全部迁移 |
| Set 跨 HMR 不重置 | 与原 boolean 行为一致；Vite HMR 默认保留 ES 模块状态 |
| `file_path` 重复（同一路径加载两次） | Set 天然去重；第二次 `setExtracting` 是 no-op，`clearExtracting` 在 finally 仍正确 |
| 测试文件迁移破坏其他 AI 改动 | 测试期望与新 API 对齐，行为不变；12 个用例全绿 |

---

## 10. P1.3 ADR-131 后续清理：删除死代码 motionBindingTargetId（已实施 2026-07-20）

### 10.1 目标

ADR-131「后续」明确：「在绑定手势全部迁移到 `bindLayer` / `bindMotion` 契约后，移除 `layerBindingTargetId` / `motionBindingTargetId` / `modelReplaceTargetId` 三个全局标志位及 `closeAllOverlays` 中的对应清理」。

P1.3 启动前调研发现 `motionBindingTargetId` 是**死代码**：

- 全代码库 `grep setMotionBindingTargetId\([^n]` 仅命中 `state.ts:220` 的函数定义本身
- 从未被 `setMotionBindingTargetId(<someId>)` 设置为非 null 值
- `library-browse.ts:222-227` 的派发分支 `if (row.model.format === 'vmd' && motionBindingTargetId)` 因此永不触发
- `motion-camera-levels.ts:240` 的 `setMotionBindingTargetId(null)` 是冗余清空

### 10.2 设计：最小可行收敛

| 标志位 | P1.3 决策 | 原因 |
|--------|----------|------|
| `motionBindingTargetId` | **删除** | 死代码：从未被 set 非 null 值，派发分支永不触发 |
| `layerBindingTargetId` | **保留** | `motion-popup.ts:713/748` 仍在反推派发中使用，未迁移到 outcome 契约 |
| `modelReplaceTargetId` | **保留** | ADR-131 明确「暂保留为兼容层」 |

### 10.3 修改清单

| # | 文件 | 改动 |
|---|------|------|
| 1 | `frontend/src/core/state.ts:217-222` | 删除 `motionBindingTargetId` 变量 + `setMotionBindingTargetId` 函数 |
| 2 | `frontend/src/core/utils.ts:8-14` | 从 `import` 移除 `setMotionBindingTargetId` |
| 3 | `frontend/src/core/utils.ts:471-474` | `closeAllOverlays` 内删除 `setMotionBindingTargetId(null)`；注释更新为「图层/模型替换绑定目标」 |
| 4 | `frontend/src/menus/library-browse.ts:17` | 从 `import` 移除 `motionBindingTargetId` |
| 5 | `frontend/src/menus/library-browse.ts:212-220` | 删除死代码派发分支 `if (row.model.format === 'vmd' && motionBindingTargetId)`；注释更新为「图层绑定仍走全局标志位」 |
| 6 | `frontend/src/menus/motion-camera-levels.ts:4` | 从 `import` 移除 `setMotionBindingTargetId` |
| 7 | `frontend/src/menus/motion-camera-levels.ts:240` | 删除 `setMotionBindingTargetId(null);` 一行 |
| 8 | `frontend/src/__tests__/library-core.test.ts:13` | 从 `mockState` 删除 `motionBindingTargetId: null` 字段 |
| 9 | `frontend/src/__tests__/library-core.test.ts:99-101` | 删除 mock getter `get motionBindingTargetId()` |
| 10 | `frontend/src/__tests__/library-core.test.ts:141` | 删除 mock setter `setMotionBindingTargetId: vi.fn()` |

### 10.4 不改的部分

| 项 | 原因 |
|----|------|
| `layerBindingTargetId` / `modelReplaceTargetId` | 见 10.2 — 仍在使用 |
| ADR-131 / ADR-135 文档中提及 `motionBindingTargetId` 的段落 | 历史叙述（契约设计目的），保留 |
| `types.ts:360-362` 的 BrowseOutcome 注释 | 描述契约设计目的（"取代散落的全局绑定标志位"），历史叙述保留 |
| `MikuMikuAR/MikuMikuAR/frontend/src/config.ts` 孤儿副本 | 历史快照，不被引用，不动 |
| `novel/02-UI交互/09-弹窗之战.md` | 小说，不动 |
| `build/android/.../index-*.js` | 构建产物，不动 |

### 10.5 验收清单

- [x] `state.ts` 删除 `motionBindingTargetId` 和 `setMotionBindingTargetId`
- [x] `utils.ts` import + closeAllOverlays 调用清理
- [x] `library-browse.ts` import + 死代码派发分支删除
- [x] `motion-camera-levels.ts` import + 240 行清空调用删除
- [x] `library-core.test.ts` mock 字段 + getter + setter 删除
- [x] `grep motionBindingTargetId frontend/src` 零生产代码命中（仅注释 / 文档保留）
- [x] `npm run check` 零新增 tsc 错误
- [x] `npm run test -- library-core library-session-store` 全绿

### 10.6 用户感知收益

无。纯死代码清理，不改变任何运行时行为。

### 10.7 风险与缓解

| 风险 | 缓解 |
|------|------|
| `layerBindingTargetId` 仍保留导致「清理不彻底」误解 | 在 10.2 / 10.4 明确说明保留原因，归 P2 进一步迁移到 outcome 契约 |
| `closeAllOverlays` 注释从「图层/动作/模型替换」改为「图层/模型替换」 | 行为正确（动作绑定从未生效），注释与代码一致 |
| 测试 mock 减少一个字段 | 测试用例本身不依赖该字段（mock 值始终为 null），全绿 |

---

## 11. P1.4 layerBindingTargetId 清理 + 相机 VMD 加载死代码修复（已实施 2026-07-20）

### 11.1 目标

P1.3 仅清理了死代码 `motionBindingTargetId`，保留了 `layerBindingTargetId`（理由：`motion-popup.ts:710-741` 仍在反推派发中使用）。P1.4 启动后深入调研发现 `layerBindingTargetId` 同样是死代码：

- 全代码库 `grep setLayerBindingTargetId\([^n]` 只命中 `setLayerBindingTargetId(null)` 清除调用
- 从未被 `setLayerBindingTargetId(<someId>)` 设置为非 null 值
- `motion-popup.ts:710-741` 的 `if (!layerBindingTargetId) { ...场景级... return; }` 包装中 `!layerBindingTargetId` 永远为真，per-model 路径不可达
- `library-browse.ts:213-220` 的派发分支 `if (row.model.format === 'vmd' && layerBindingTargetId)` 永不触发

### 11.2 关键发现：相机 VMD 加载死代码

清理 `layerBindingTargetId` 后暴露出 `motion-popup.ts:743-758` 的相机 VMD 加载分支是历史遗留死代码：

```ts
// 原结构（P1.4 之前）
if (row.model.format === 'vmd') {
    if (!layerBindingTargetId) {  // 永远为真
        // 场景级动作 VMD 加载
        return;  // ← 所有 VMD 都从这里 return
    }
    // per-model 路径（layerBindingTargetId 非 null 时进入，死代码）
}
hideMotionPopup();
if (row.model.format === 'vmd') {  // ← 死代码！前面 vmd 分支已 return
    loadManager.load({ kind: 'camera-vmd', ... });
}
```

**根因**：相机 VMD 加载入口（motion-camera-levels.ts:240）push 一个 VMD 浏览 level 到 motion menu，用户选中后走 `motionOnItemClick`。但由于第一个 `if (row.model.format === 'vmd')` 分支会拦截所有 VMD 走场景级动作加载，相机 VMD 永远到不了 744 行的 camera-vmd 加载。

**实际影响**：相机 VMD 加载按钮点击后，选中的 VMD 会被错误地走场景级动作加载（`setActiveMotion`），而不是 camera-vmd 加载。相机 VMD 加载功能长期失效。

### 11.3 设计：扩展 BrowseOutcome + outcome 派发

#### BrowseOutcome 扩展（types.ts）

新增 `bindCameraVmd` mode：

```ts
export type BrowseOutcome =
    | { mode: 'close' }
    | { mode: 'stay'; modelId?: string }
    | { mode: 'jumpToDir'; modelId?: string; dir?: string }
    | { mode: 'bindLayer'; modelId: string }
    | { mode: 'bindMotion'; modelId: string }
    | { mode: 'bindCameraVmd' };  // P1.4 新增：绑定到相机 VMD 槽（一次性，关闭）
```

#### 相机 VMD 加载入口传入 outcome（motion-camera-levels.ts:240）

```ts
() => {
    const level = stackRegistry.buildLevel!(
        getBrowseDir('vmd'),
        t('motion.camVmdLabel'),
        (m) => m.format === 'vmd',
        undefined,
        undefined,
        { mode: 'bindCameraVmd' }  // P1.4 新增
    );
    const menu = getMotionMenu();
    if (menu) menu.push(level);
}
```

#### motionOnItemClick 开头检查 outcome（motion-popup.ts:702-722）

```ts
function motionOnItemClick(row: PopupRow): void {
    if (row.model) {
        // [doc:adr-131] 相机 VMD 加载入口：通过 outcome.mode='bindCameraVmd' 标识
        // 必须在动作 VMD 分支之前检查，否则会被场景级动作加载拦截。
        const outcome = getMotionMenu()?.currentLevel?.outcome;
        if (row.model.format === 'vmd' && outcome?.mode === 'bindCameraVmd') {
            loadManager
                .load({ kind: 'camera-vmd', path: row.model.file_path })
                .then(() => {
                    const menu = getMotionMenu();
                    if (menu) {
                        menu.pop();
                        menu.reRender();
                    }
                })
                .catch((err) => {
                    logWarn('motion-popup', 'Load camera VMD failed:', err);
                    setStatus(t('motion.loadFailed'), false);
                });
            return;
        }
        // ... 原有 vmd 场景级动作加载分支
    }
}
```

#### 删除死代码

`motion-popup.ts:743-758` 的 `hideMotionPopup + 第二个 if (row.model.format === 'vmd') { camera-vmd 加载 }` 死代码分支删除。743 行的 `hideMotionPopup()` 保留（给 audio/vpd 路径用）。

### 11.4 layerBindingTargetId 清理清单（P1.4 第一部分）

| # | 文件 | 改动 |
|---|------|------|
| 1 | `frontend/src/core/state.ts` | 删除 `layerBindingTargetId` 变量 + `setLayerBindingTargetId` 函数 |
| 2 | `frontend/src/core/utils.ts:8-14` | 从 `import` 移除 `setLayerBindingTargetId` |
| 3 | `frontend/src/core/utils.ts:470-474` | `closeAllOverlays` 内删除 `setLayerBindingTargetId(null)`；注释更新为「模型替换绑定目标」 |
| 4 | `frontend/src/menus/library-browse.ts:16` | 从 `import` 移除 `layerBindingTargetId` |
| 5 | `frontend/src/menus/library-browse.ts:212-220` | 删除派发分支 `if (row.model.format === 'vmd' && layerBindingTargetId)`；注释更新为「图层绑定 outcome 契约派发」 |
| 6 | `frontend/src/menus/motion-popup.ts:16-17` | 从 `import` 移除 `layerBindingTargetId / setLayerBindingTargetId` |
| 7 | `frontend/src/menus/motion-popup.ts:94` | 移除注释中的 `layerBindingTargetId` 引用 |
| 8 | `frontend/src/menus/motion-popup.ts:710-741` | 移除 `if (!layerBindingTargetId)` 包装，直接走场景级路径 |

### 11.5 相机 VMD 加载修复清单（P1.4 第二部分）

| # | 文件 | 改动 |
|---|------|------|
| 9 | `frontend/src/core/types.ts:364-370` | `BrowseOutcome` 新增 `\| { mode: 'bindCameraVmd' }` |
| 10 | `frontend/src/menus/motion-camera-levels.ts:240-249` | buildLevel 传入 `{ mode: 'bindCameraVmd' }` |
| 11 | `frontend/src/menus/motion-popup.ts:702-722` | motionOnItemClick 开头检查 outcome.mode==='bindCameraVmd'，走 camera-vmd 加载 |
| 12 | `frontend/src/menus/motion-popup.ts:743-758` | 删除死代码（hideMotionPopup 保留 + 第二个 vmd 分支删除） |

### 11.6 不改的部分

| 项 | 原因 |
|----|------|
| `modelReplaceTargetId` | ADR-131 明确「暂保留为兼容层」，归 P2 进一步迁移 |
| ADR-131 / ADR-135 文档中提及 `layerBindingTargetId` 的段落 | 历史叙述（契约设计目的），保留 |
| `types.ts:360-363` 的 BrowseOutcome 注释 | 描述契约设计目的，历史叙述保留 |
| `MikuMikuAR/MikuMikuAR/frontend/src/config.ts` 孤儿副本 | 历史快照，不被引用，不动 |
| `novel/02-UI交互/09-弹窗之战.md` | 小说，不动 |
| `build/android/.../index-*.js` | 构建产物，不动 |

### 11.7 验收清单

- [x] `state.ts` 删除 `layerBindingTargetId` 和 `setLayerBindingTargetId`
- [x] `utils.ts` import + closeAllOverlays 调用清理
- [x] `library-browse.ts` import + 派发分支删除
- [x] `motion-popup.ts` import + 注释 + `if (!layerBindingTargetId)` 包装清理
- [x] `BrowseOutcome` 扩展 `bindCameraVmd` mode
- [x] `motion-camera-levels.ts` buildLevel 传入 outcome
- [x] `motionOnItemClick` 开头 outcome 分流 camera-vmd 加载
- [x] 删除 motion-popup.ts:743-758 死代码（hideMotionPopup 保留给 audio/vpd）
- [x] `grep layerBindingTargetId frontend/src` 零生产代码命中（仅注释 / 文档保留）
- [x] `npm run check` 零新增 tsc 错误
- [x] `npm run test -- library-core library-session-store` 118/118 全绿

### 11.8 用户感知收益

| 场景 | P1.4 前 | P1.4 后 |
|------|---------|---------|
| 相机 VMD 加载按钮 | 点击后选中的 VMD 走场景级动作加载（错误地被当作动作 VMD），相机 VMD 加载完全失效 | 点击后选中的 VMD 正确走 `loadManager.load({ kind: 'camera-vmd' })`，相机 VMD 加载恢复 |
| 浏览器关闭 | 加载后浏览器保持打开（场景级动作加载语义） | 加载后浏览器 pop 关闭（相机 VMD 一次性绑定语义） |
| 死代码清理 | motion-popup.ts:743-758 死代码长期存在 | 已删除，代码路径清晰 |

### 11.9 风险与缓解

| 风险 | 缓解 |
|------|------|
| `modelReplaceTargetId` 仍保留导致「清理不彻底」误解 | 在 11.6 明确说明保留原因，归 P2 进一步迁移到 outcome 契约 |
| `BrowseOutcome` 扩展新 mode 影响 library-browse.ts 派发 | library-browse.ts 的 outcome 派发只识别 `stay` / `jumpToDir`，新 mode 走 default `close` 路径，无影响 |
| 相机 VMD 加载入口 outcome 被其他 motion menu 操作误读 | outcome 仅在 `motionOnItemClick` 顶部检查一次，且必须 `row.model.format === 'vmd'` 才生效 |
| `bindCameraVmd` mode 与 `bindMotion` 语义混淆 | 注释明确区分：`bindMotion` 绑定到模型动作槽（需 modelId），`bindCameraVmd` 绑定到相机 VMD 槽（无 modelId） |
| outcome 检查位置错误导致死代码复活 | outcome 检查必须在 `if (row.model.format === 'vmd')` 场景级分支之前，否则会被拦截 |

---

## 12. P2.3 移除兼容门面（已实施 2026-07-20）

### 12.1 目标

P0.1 在 `library-core.ts` 留下 4 个兼容门面函数（`getPendingAutoExpand` / `setPendingAutoExpand` / `getPendingFocusModel` / `setPendingFocusModel`），内部代理 `librarySessionStore`。注释明确「P2 阶段移除门面，直接用 store 实例」。

P2.3 执行此清理：删除门面函数，调用方直接使用 `librarySessionStore.xxx()`，统一访问路径。

### 12.2 修改清单

| # | 文件 | 改动 |
|---|------|------|
| 1 | `frontend/src/menus/library-actions.ts:64-67` | 从 import 移除 4 个门面函数（保留 `getPendingMetaGuard`，非门面） |
| 2 | `frontend/src/menus/library-actions.ts:174-175, 208-215` | 6 处调用改为 `librarySessionStore.xxx()` |
| 3 | `frontend/src/menus/library-browse.ts:40-45` | 删除整块门面 import（4 个函数从 `./library-core` 导入） |
| 4 | `frontend/src/menus/library-browse.ts:98, 104, 259-277` | 6 处调用改为 `librarySessionStore.xxx()` |
| 5 | `frontend/src/menus/library-core.ts:78-93` | 删除 4 个门面函数定义 + 注释更新为「直接使用 store 实例」 |
| 6 | `frontend/src/menus/library-core.ts:52` | 删除无人使用的 `librarySessionStore` import |

### 12.3 不改的部分

| 项 | 原因 |
|----|------|
| `getPendingMetaGuard`（library-core.ts:81-84） | 不是门面，是 LoadingGuard 实例的 getter，保留 |
| `librarySessionStore` 单例本身 | P0.1 设计核心，不变 |
| store 内部实现 | 行为不变，仅外部访问路径统一 |

### 12.4 验收清单

- [x] `library-actions.ts` 删除 4 个门面 import；6 处调用改为 `librarySessionStore.xxx()`
- [x] `library-browse.ts` 删除整块门面 import；6 处调用改为 `librarySessionStore.xxx()`
- [x] `library-core.ts` 删除 4 个门面函数定义 + 注释；删除无人使用的 `librarySessionStore` import
- [x] `grep getPendingAutoExpand frontend/src` 仅命中 `librarySessionStore.getPendingAutoExpand()` 形式
- [x] `npm run check` 零新增 tsc 错误
- [x] `npm run test -- library-core library-session-store` 118/118 全绿

### 12.5 用户感知收益

无。纯代码组织清理，不改变任何运行时行为。

### 12.6 风险与缓解

| 风险 | 缓解 |
|------|------|
| 漏改某个调用点导致 ReferenceError | tsc 静态检查 + grep 全代码库验证调用形式统一 |
| `library-core.ts` 删除 import 后仍有遗留引用 | tsc 报错；已 grep 验证 `librarySessionStore` 仅在 import 行出现一次 |
| 其他模块通过 re-export 访问门面 | 已 grep 验证：4 个门面函数仅在 library-actions / library-browse / library-core 三处使用 |

---

## 13. P2.2 缩略图 AbortSignal（已实施 2026-07-19，ADR-136）

### 13.1 目标

消灭 `loadThumbnailsStreaming` 无取消出口导致的两个隐患：

1. **请求堆积**：快速切文件夹 / 反复开关弹窗时，旧批次 `GetThumbnail` 仍在进行，多批次叠加。
2. **过期写入**：旧批次拉回的缩略图写入缓存 + `notifyThumbnailUpdate()`，触发无效重绘。

> 约束：`GetThumbnail` 是 Wails binding，Go 侧无法真中止 → 采用**协作式取消**（abort 后不再派发新 worker、丢弃过期结果）。

### 13.2 设计（同 model-loader 范式）

- `library-core.ts` 新增模块级 `_thumbAbortController`。每次 `loadThumbnailsStreaming` 调用先 abort 上一批次，再建新 `AbortController`；外部 `signal` 经 `AbortSignal.any([signal, internalCtrl.signal])` 合并（非 `??` 回退，否则忽略内部批次取消）。
- worker 循环：`if (effectiveSignal.aborted) break;` 派发前拦截；`await GetThumbnail` 之后再次判 `aborted`，丢弃过期结果。
- 批次自然结束（`finally`）且引用未被取代时清 `_thumbAbortController`，防误清新批次。
- 导出 `abortThumbnailStreaming()` 供生命周期显式取消。
- `loadThumbnailsForLevel(level, signal?)` 透传 `signal`（可选，向后兼容）。
- `showModelPopup` 在 `librarySessionStore.reset()` 后调用 `abortThumbnailStreaming()`，取消上一次会话残留批次。

### 13.3 修改清单

| # | 文件 | 改动 |
|---|------|------|
| 1 | `frontend/src/menus/library-core.ts:246-321` | `loadThumbnailsStreaming` 加 `signal?` + 模块级 `_thumbAbortController` + 协作式取消守卫 + `finally` 清理；新增 `abortThumbnailStreaming()` 导出 |
| 2 | `frontend/src/menus/library-actions.ts:110-122` | `loadThumbnailsForLevel` 加 `signal?` 并透传 |
| 3 | `frontend/src/menus/library-browse.ts:29` | import 增加 `abortThumbnailStreaming` |
| 4 | `frontend/src/menus/library-browse.ts:313-315` | `showModelPopup` 中 `reset()` 后调用 `abortThumbnailStreaming()` |
| 5 | `frontend/src/__tests__/library-thumbnail-streaming.test.ts` | 新建，5 个确定性用例（见 13.5） |

### 13.4 不改的部分

| 项 | 原因 |
|----|------|
| `GetThumbnail` binding 真中止 | Wails 基础设施，不在前端范围 |
| per-popup 控制器 | 全局单例已解决最常见堆积场景；零干扰归后续 ADR |
| `notifyThumbnailUpdate` / `thumbnailCache` 既有语义 | 仅增加 abort 守卫，写入逻辑不变 |
| 既有 `library-core.test.ts` 106 用例 | 无 `signal` 时行为完全一致，作回归保护 |

### 13.5 测试同步

`frontend/src/__tests__/library-thumbnail-streaming.test.ts`（新建，5 例）：

| 用例 | 断言 |
|------|------|
| 空 keys | 立即返回，`GetThumbnail` 0 次 |
| 已 abort 的 signal | 0 次 `GetThumbnail`，缓存 0 条 |
| 无 signal（向后兼容） | 每未缓存 key 各拉 1 次，写缓存 + `notifyThumbnailUpdate` 触发 |
| 中途 abort | 过期结果被丢弃，缓存条数 < keys 数，promise 正常 settle 不抛 |
| `abortThumbnailStreaming` 取消在飞批次 | 慢 binding 下同步 abort，promise 不挂起，缓存条数 < keys 数 |

### 13.6 验收清单

- [x] `loadThumbnailsStreaming(keys, signal?)` 接收 `AbortSignal`，协作式取消生效
- [x] `abortThumbnailStreaming()` 导出且可取消当前批次
- [x] `loadThumbnailsForLevel` 透传 `signal`
- [x] `showModelPopup` 调用 `abortThumbnailStreaming()`
- [x] `npm run check` 零新增 tsc 错误
- [x] `npm run test -- library-thumbnail-streaming` 全绿
- [x] `npm run build` 通过
- [x] 新建 `docs/adr/adr-136-thumbnail-abortsignal.md`
- [x] 计划文件第 5 节 P2.2 行 → ✅ 已完成；本第 13 节补实施记录

### 13.7 已知取舍

| 项 | 说明 |
|----|------|
| 跨弹窗干扰 | 全局单例：model 弹窗导航会 abort motion 弹窗在流的 VMD 缩略图；缩略图有缓存、重建即重拉，影响可忽略 |
| 弹窗关闭后再不重开 | 在飞批次跑完（无害，仅浪费几次 `GetThumbnail`）；`showModelPopup` 钩子覆盖「重开即取消」最常见场景 |

---

## 14. P2.1 onModelRowClick 拆分（已实施 2026-07-20）

### 14.1 目标

`onModelRowClick` 原为 ~158 行单函数，3 个职责交织（记录 + replace 模式 + normal 模式），违反单一职责原则，难以测试与维护。P2.1 拆分为清晰 4 段式结构。

### 14.2 设计：4 段式结构

```
onModelRowClick(m, jumpToDirModelId?)
├── Guards                         < 2 个早期 return
├── 计算 replaceId / isStage / isActor
├── recordRecentModel(m)           < 提取
├── recordBrowseDir(m)             < 提取
├── startReplaceModel(m, id)       < 提取（含 85 行 replace 逻辑）
└── loadModelNormal(m, isStage)    < 提取（含 38 行 normal 逻辑）
```

### 14.3 修改清单

| # | 文件 | 改动 |
|---|------|------|
| 1 | `frontend/src/menus/library-actions.ts` | `onModelRowClick` 从 ~158 行降至 ~29 行；提取 4 个辅助函数 |

### 14.4 验收清单

- [x] `onModelRowClick` 行数 ≤30 行
- [x] 4 个辅助函数职责清晰，可独立测试
- [x] `npm run check` 零新增 tsc 错误
- [x] `npm run test -- library-core library-session-store` 全绿

### 14.5 用户感知收益

无。纯代码组织重构，运行时行为不变。

### 14.6 风险与缓解

| 风险 | 缓解 |
|------|------|
| 拆分时遗漏某个分支导致行为差异 | tsc 静态检查 + 单元测试 118/118 全绿回归 |
| 辅助函数命名不当导致语义模糊 | 命名遵循「动词+名词」结构（recordXxx / startXxx / loadXxx） |

---

## 15. P2.4 modelReplaceTargetId 迁移到 outcome 契约（已实施 2026-07-20）

### 15.1 目标

ADR-131 后续清理的最后一个全局绑定标志位 `modelReplaceTargetId`。P1.3 / P1.4 已删除 `motionBindingTargetId` 和 `layerBindingTargetId`，P2.4 收尾删除 `modelReplaceTargetId`，全部迁移到 outcome 契约（`BrowseOutcome.mode = 'jumpToDir'`）。

### 15.2 删除清单

| # | 位置 | 删除内容 |
|---|------|----------|
| 1 | `core/state.ts:219-222` | 全局变量 `modelReplaceTargetId` + `setModelReplaceTargetId` |
| 2 | `core/utils.ts:12` | `setModelReplaceTargetId` import |
| 3 | `core/utils.ts:470-471` | `setModelReplaceTargetId(null)` 清除调用 |
| 4 | `menus/library-actions.ts:21-22` | `modelReplaceTargetId` + `setModelReplaceTargetId` import |
| 5 | `menus/library-actions.ts:235` | `?? modelReplaceTargetId` 回退 |
| 6 | `menus/library-actions.ts:281` | `setModelReplaceTargetId(replaceId)` 失败恢复 |
| 7 | `menus/library-actions.ts:287` | `setModelReplaceTargetId(handle.id)` 更新 |
| 8 | `menus/library-actions.ts:318` | `setModelReplaceTargetId(replaceId)` catch 恢复 |
| 9 | `menus/library-actions.ts:331` | `setModelReplaceTargetId(replaceId)` extract 失败恢复 |
| 10 | `menus/library-actions.ts:391-393` | `replaceModel()` 中 guard + set |
| 11 | `menus/library-core.ts:27-28` | `modelReplaceTargetId` + `setModelReplaceTargetId` import |
| 12 | `menus/library-core.ts:504` | `setModelReplaceTargetId(null)` 清除 |

### 15.3 不改的部分

| 项 | 原因 |
|----|------|
| `BrowseOutcome.mode = 'jumpToDir'` | ADR-131 已定义的契约，P2.4 直接使用 |
| ADR-131 / ADR-135 文档中提及 `modelReplaceTargetId` 的段落 | 历史叙述（契约设计目的），保留 |
| `types.ts:360-363` 的 BrowseOutcome 注释 | 描述契约设计目的，历史叙述保留 |

### 15.4 验收清单

- [x] `state.ts` 删除 `modelReplaceTargetId` 和 `setModelReplaceTargetId`
- [x] `utils.ts` import + closeAllOverlays 调用清理
- [x] `library-actions.ts` import + 6 处调用清理（回退 / 恢复 / 更新 / guard）
- [x] `library-core.ts` import + 清除调用清理
- [x] `grep modelReplaceTargetId frontend/src` 零生产代码命中（仅注释 / 文档保留）
- [x] `npm run check` 零新增 tsc 错误
- [x] `npm run test -- library-core library-session-store` 全绿

### 15.5 用户感知收益

无。纯死代码清理，不改变任何运行时行为。`modelReplaceTargetId` 此前作为兼容层使用，但 `jumpToDirModelId` 参数已通过 `onModelRowClick(m, jumpToDirModelId?)` 显式传递，全局标志位从未被读取。

### 15.6 风险与缓解

| 风险 | 缓解 |
|------|------|
| `replaceModel()` 中 guard 被删除导致重复替换 | `replaceId` 已通过参数显式传递，guard 删除后行为一致 |
| `setModelReplaceTargetId(handle.id)` 更新被删除导致后续操作丢失目标 | `jumpToDirModelId` 在调用栈中传递，无需全局标志位 |
| ADR-131 / ADR-135 文档与代码不一致 | 文档保留作为历史叙述，明确说明「已迁移到 outcome 契约」 |
