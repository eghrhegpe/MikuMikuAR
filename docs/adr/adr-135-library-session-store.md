# ADR-135 LibrarySessionStore — 资源库状态收敛基座

- **状态**：实施中（P0.1 ✅ / P0.3 ✅ / P2 ✅ 已完成；P0.2 loadId trace 独立于本 store）
- **日期**：2026-07-19
- **相关**：ADR-097（资源库恢复汇总）、ADR-131（BrowseOutcome 契约）、ADR-106（时序审计与异步生命周期）、ADR-105（AbortSignal 与异步错误处理）

## 背景与问题

资源库加载系统（`frontend/src/menus/library-*.ts`）在长期演化中累积出**8 个模块级隐式状态变量**，散落在 4 个文件里，彼此通过 import 互相读写。联邦架构师锐评（2026-07-19）指出其结构性缺陷：

| 状态变量 | 物理位置 | 写入点 | 读取点 | 问题 |
|---------|---------|--------|--------|------|
| `pendingAutoExpand` | library-core.ts:79 | `prepareModelRestore` / `onLevelEnter` / `deferRestore` | `onLevelEnter` / `deferRestore` | 写入点 3 处，无单一权威源；6 秒轮询超时静默丢弃 |
| `pendingFocusModel` | library-core.ts:80 | `prepareModelRestore` | `onLevelEnter` | 与 `pendingAutoExpand` 强耦合但分别 set，可能错位 |
| `_isExtracting` | library-actions.ts:75 | `onModelRowClick` 两处 zip 分支 | `onModelRowClick` / `replaceMotion` 守卫 | 一刀切布尔：解压 A 时阻塞 B 加载，且无关联模型 id |
| `_isReplaceLoading` | library-actions.ts:77 | `onModelRowClick` / `replaceMotion` | `_onModelLoaded` 事件守卫 | 与 `_isExtracting` 语义重叠，二者叠加时行为不可推理 |
| `_restoreTimer` | library-browse.ts:51 | `deferRestore` 启动 / 清理 | `deferRestore` 轮询 | 单一 timer 句柄，并发触发 `deferRestore` 时只能保留最后一个，前者被 `clearTimeout` 静默取消 |

**后果**：
1. 状态变更点不可追踪，AGENTS.md 审核准则的「隐式状态写入」反模式活体标本
2. `_isExtracting` 一刀切导致 zip 解压期间非 zip 模型点击被静默 return，UI 闪一下但什么都没发生
3. `deferRestore` 6 秒静默放弃，用户感知"程序卡死开始乱点"→ 触发 `prepareModelRestore` 改写 `pendingAutoExpand` → 校验失败静默 return，**用户层无任何反馈**
4. 任何后续改造（loadId trace、错误结构化、可见化 LoadingState）都缺乏单一订阅源

> **不在本 ADR 范围内**：`motionBindingTargetId` / `layerBindingTargetId` / `modelReplaceTargetId` 三个绑定标志位。ADR-131「后续」已明确"绑定手势全部迁移到 bindLayer / bindMotion 契约后移除"，归 ADR-131 后续清理，本 ADR 不接管。

## 决策

**新建 `LibrarySessionStore` 单例**作为 library 子系统内部隐式状态的**唯一权威源**，把上述 5 个散落变量收敛到一个类实例上。所有读写通过 store 的 getter / mutator 方法，禁止外部直接赋值。

### 范围划定

| 状态 | 收敛策略 |
|------|---------|
| `pendingAutoExpand` | 收敛为 `store.restore.pendingAutoExpand` 读写对 |
| `pendingFocusModel` | 收敛为 `store.restore.pendingFocusModel` 读写对 |
| `_isExtracting` | 收敛为 `store.loading.extraction` 读写对（**P0.1 不改语义**，仍为全局布尔；per-model 守卫归 P1.2） |
| `_isReplaceLoading` | 收敛为 `store.loading.replaceLoading` 读写对 |
| `_restoreTimer` | 收敛为 `store.restore.timer` 句柄，由 `store.restore.setTimer / clearTimer` 管理 |

### 不动的部分

- 所有**外部行为零变化**：函数签名、调用时序、return 值、UI 反馈完全保持原状
- `loadThumbnailsStreaming` / `loadManager` / `BrowseOutcome` / `prepareModelRestore` 函数签名不变
- 单测 `library-core.test.ts` 不需新增用例（store 是纯搬迁，既有用例覆盖即回归保护）

## 方案

### 1. 新文件 `frontend/src/menus/library-session-store.ts`

```ts
/**
 * [doc:adr-135] LibrarySessionStore — 资源库会话状态单例。
 *
 * 收敛 library-core / library-actions / library-browse 三个模块散落的
 * 隐式状态变量，提供唯一权威读写入口。
 *
 * P0.1 仅做状态搬迁，不改任何行为语义。
 * 后续 P0.2 / P0.3 在此基座上叠加 loadId trace 与可见化 LoadingState。
 */
class LibrarySessionStore {
    // ===== Restore State（恢复链路：上次浏览位置 + 高亮模型）=====
    restore = {
        pendingAutoExpand: null as string[] | null,
        pendingFocusModel: null as { dir: string; rowKey: string } | null,
        timer: null as ReturnType<typeof setTimeout> | null,
    };

    // ===== Loading State（加载守卫）=====
    loading = {
        extraction: false,         // 原 _isExtracting
        replaceLoading: false,     // 原 _isReplaceLoading
    };

    // ===== Restore Accessors =====
    getPendingAutoExpand(): string[] | null {
        return this.restore.pendingAutoExpand;
    }
    setPendingAutoExpand(v: string[] | null): void {
        this.restore.pendingAutoExpand = v;
    }
    getPendingFocusModel(): { dir: string; rowKey: string } | null {
        return this.restore.pendingFocusModel;
    }
    setPendingFocusModel(v: { dir: string; rowKey: string } | null): void {
        this.restore.pendingFocusModel = v;
    }
    setRestoreTimer(t: ReturnType<typeof setTimeout> | null): void {
        if (this.restore.timer) {
            clearTimeout(this.restore.timer);
        }
        this.restore.timer = t;
    }
    clearRestoreTimer(): void {
        if (this.restore.timer) {
            clearTimeout(this.restore.timer);
            this.restore.timer = null;
        }
    }
    getRestoreTimer(): ReturnType<typeof setTimeout> | null {
        return this.restore.timer;
    }

    // ===== Loading Accessors =====
    isExtracting(): boolean {
        return this.loading.extraction;
    }
    setExtracting(v: boolean): void {
        this.loading.extraction = v;
    }
    isReplaceLoading(): boolean {
        return this.loading.replaceLoading;
    }
    setReplaceLoading(v: boolean): void {
        this.loading.replaceLoading = v;
    }

    // ===== Lifecycle =====
    /** 重置全部状态（仅在 showModelPopup 重置菜单时调用）。 */
    reset(): void {
        this.clearRestoreTimer();
        this.restore.pendingAutoExpand = null;
        this.restore.pendingFocusModel = null;
        // loading 不重置：解压/替换可能在弹窗重置期间进行
    }
}

export const librarySessionStore = new LibrarySessionStore();
```

### 2. 状态搬迁映射

| 原位置 | 原符号 | 新访问 |
|--------|--------|--------|
| library-core.ts:79 | `pendingAutoExpand` | `librarySessionStore.getPendingAutoExpand() / setPendingAutoExpand()` |
| library-core.ts:80 | `pendingFocusModel` | `librarySessionStore.getPendingFocusModel() / setPendingFocusModel()` |
| library-core.ts:81-92 | `getPendingAutoExpand / setPendingAutoExpand / getPendingFocusModel / setPendingFocusModel` 导出函数 | **保留导出函数**作为兼容门面，内部改为代理 store |
| library-actions.ts:75 | `_isExtracting` | `librarySessionStore.isExtracting() / setExtracting()` |
| library-actions.ts:77 | `_isReplaceLoading` | `librarySessionStore.isReplaceLoading() / setReplaceLoading()` |
| library-browse.ts:51 | `_restoreTimer` | `librarySessionStore.setRestoreTimer() / clearRestoreTimer() / getRestoreTimer()` |

### 3. 兼容门面

`library-core.ts` 保留 `getPendingAutoExpand / setPendingAutoExpand / getPendingFocusModel / setPendingFocusModel` 4 个导出函数，内部改为代理 store：

```ts
export function getPendingAutoExpand(): string[] | null {
    return librarySessionStore.getPendingAutoExpand();
}
export function setPendingAutoExpand(v: string[] | null): void {
    librarySessionStore.setPendingAutoExpand(v);
}
// ... 同理
```

**理由**：`library-actions.ts` 和 `library-browse.ts` 都从 `library-core` import 这些函数。保留门面避免一次改 5 个文件的 import 路径，**P0.1 改动半径最小**。P0.2 / P0.3 直接用 `librarySessionStore` 实例，门面可在后续 ADR 移除。

### 4. `reset()` 调用点

`showModelPopup`（library-browse.ts:300-324）在 `resetToRoot` 后调用 `librarySessionStore.reset()`。原代码**不清理** `_restoreTimer` / `pendingAutoExpand` / `pendingFocusModel`——这是潜在 bug（重开弹窗时残留上次恢复态）。P0.1 顺手修掉这一处遗留，因为新 store 的 `reset()` 行为更明确。**其他调用点不动**。

## 影响与风险

| 项 | 说明 | 缓解 |
|----|------|------|
| 行为兼容 | P0.1 是纯状态搬迁，函数签名、return 值、UI 反馈零变化 | `library-core.test.ts` 既有用例覆盖作为回归保护 |
| 兼容门面 | `library-core.ts` 4 个 getter/setter 导出函数保留，内部代理 store | 后续 P0.2/P0.3 直接用 store 实例，门面在 P2 阶段移除 |
| `reset()` 行为变化 | `showModelPopup` 现在会清理 restore 状态，原代码不清理 | 这是修 bug 不是破行为：原残留态会导致重开弹窗时误触发 autoExpand |
| 循环依赖 | store 文件不 import 任何 library-* 模块，纯数据类 | store 只导出单例 + 类型，零依赖 |
| 测试覆盖 | 新增 `library-session-store.test.ts` | 既有 `library-core.test.ts` 107 个用例仅覆盖 `modelToRow`/`buildLevel`/`computeRestoreSegments` 等纯函数，**状态化 restore 链路（deferRestore / pendingAutoExpand / showModelPopup.reset()）此前零覆盖**；新增 store 单测守护 `reset()` 清理 + P0.3 状态机流转 + `setRestoreTimer` 并发清理 |

## 验收标准

- [ ] `frontend/src/menus/library-session-store.ts` 创建并通过 `tsc --noEmit`
- [ ] `library-core.ts` / `library-actions.ts` / `library-browse.ts` 中 5 个原变量删除，全部改为 store 访问
- [ ] `library-core.ts` 的 4 个 getter/setter 导出函数保留，内部代理 store
- [ ] `showModelPopup` 调用 `librarySessionStore.reset()`
- [ ] `npm run test -- library-core` 既有用例全绿
- [ ] `npm run test -- library-session-store` 新增 14 个用例全绿（reset 清理 / P0.3 状态机 / 并发 timer 清理）
- [ ] `npm run check` 零新增 tsc 错误
- [ ] `npm run build` 通过

## 后续

- **P0.2 loadId trace**：在 store 上加 `currentLoadId` 字段，贯穿 scan → extract → parse → registry 链路，错误带 `{ loadId, phase, cause }` 结构化上抛
- **P0.3 deferRestore 可见化**：store 加 `restore.status` 字段（`'idle' | 'polling' | 'timeout' | 'ready'`），`deferRestore` 内部更新该字段，UI 通过 store getter 显示「正在扫描 X 目录…（已等待 3s）」
- **P1.2 per-model 守卫**：`loading.extraction` 从 `boolean` 升级为 `Set<string>`（按模型 id 守卫），非 zip 模型直接放行
- **P1.3 ADR-131 后续清理**：3 个绑定标志位从 state.ts 移到 store 的 `binding` 命名空间，最终由 ADR-131 契约彻底移除
- **P2 移除兼容门面**：`library-core.ts` 的 4 个导出函数移除，所有调用方直接用 `librarySessionStore` ✅ 已完成（P0.1/P0.3 实施时顺带完成，经 grep 确认无残留引用）
