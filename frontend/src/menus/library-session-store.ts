// [doc:adr-135] LibrarySessionStore — 资源库会话状态单例
//
// 收敛 library-core / library-actions / library-browse 三个模块散落的隐式状态变量，
// 提供唯一权威读写入口。
//
// P0.1：状态搬迁，不改行为语义
// P0.2：load-manager trace 链路（独立于本 store）
// P0.3：deferRestore 可见化 LoadingState（restore.status / targetSeg / startedAt）

/**
 * [doc:adr-135] P0.3 deferRestore 状态机。
 * - `'idle'`：无延迟恢复在跑
 * - `'polling'`：正在轮询等待 allModels 就绪
 * - `'ready'`：数据就绪，已补做 push（瞬态，下一 tick 回 idle）
 * - `'timeout'`：6 秒上限达到，数据仍未就绪（用户应感知到）
 */
export type LibraryRestoreStatus = 'idle' | 'polling' | 'ready' | 'timeout';

/**
 * 资源库会话状态：恢复链路（上次浏览位置 + 高亮模型）。
 *
 * 原散落位置：
 * - `pendingAutoExpand`：library-core.ts:79
 * - `pendingFocusModel`：library-core.ts:80
 * - `timer`（原 `_restoreTimer`）：library-browse.ts:51
 *
 * P0.3 新增字段：
 * - `status`：deferRestore 状态机，UI 据此显示「正在扫描 X…」
 * - `targetSeg`：当前轮询的文件夹段名（status === 'polling' 时有值）
 * - `startedAt`：轮询开始时间戳，用于计算「已等待 Xs」
 */
export interface LibraryRestoreState {
    pendingAutoExpand: string[] | null;
    pendingFocusModel: { dir: string; rowKey: string } | null;
    timer: ReturnType<typeof setTimeout> | null;
    status: LibraryRestoreStatus;
    targetSeg: string | null;
    startedAt: number | null;
}

/**
 * 资源库会话状态：加载守卫。
 *
 * 原散落位置：
 * - `extraction`（原 `_isExtracting`）：library-actions.ts:75（一刀切布尔，per-model 守卫归 P1.2）
 * - `replaceLoading`（原 `_isReplaceLoading`）：library-actions.ts:77
 */
export interface LibraryLoadingState {
    extraction: boolean;
    replaceLoading: boolean;
}

/**
 * LibrarySessionStore — 资源库会话状态唯一权威源。
 *
 * 使用规约（对齐 AGENTS.md 状态访问规约）：
 * - 外部禁止直接赋值 store 字段，必须通过 accessor 方法
 * - store 不持有任何 DOM / Babylon 引用，纯数据
 * - 跨文件共享同一单例，HMR 行为与原模块级变量一致
 */
class LibrarySessionStore {
    /** 恢复链路状态：上次浏览位置 + 高亮模型 + 延迟恢复计时器。 */
    readonly restore: LibraryRestoreState = {
        pendingAutoExpand: null,
        pendingFocusModel: null,
        timer: null,
        status: 'idle',
        targetSeg: null,
        startedAt: null,
    };

    /** 加载守卫状态：解压 / 替换进行中标记。 */
    readonly loading: LibraryLoadingState = {
        extraction: false,
        replaceLoading: false,
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

    getRestoreTimer(): ReturnType<typeof setTimeout> | null {
        return this.restore.timer;
    }
    setRestoreTimer(t: ReturnType<typeof setTimeout> | null): void {
        // 设置新 timer 前先清理旧 timer，保证同一时刻只有一个恢复轮询在跑
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

    // ===== Restore Status (P0.3) =====

    /**
     * 当前延迟恢复状态（idle/polling/ready/timeout）。
     * UI 通过此字段决定是否显示「正在扫描 X…」提示。
     */
    getRestoreStatus(): LibraryRestoreStatus {
        return this.restore.status;
    }

    /** 当前轮询的文件夹段名（status === 'polling' 时有值）。 */
    getRestoreTargetSeg(): string | null {
        return this.restore.targetSeg;
    }

    /** 轮询开始时间戳（status === 'polling' 时有值），用于计算「已等待 Xs」。 */
    getRestoreStartedAt(): number | null {
        return this.restore.startedAt;
    }

    /**
     * 标记进入 polling 状态。
     * @param seg 当前轮询的文件夹段名，用于 UI 显示
     */
    markRestorePolling(seg: string): void {
        this.restore.status = 'polling';
        this.restore.targetSeg = seg;
        this.restore.startedAt = Date.now();
    }

    /** 标记数据就绪（瞬态，下一 tick 回 idle）。 */
    markRestoreReady(): void {
        this.restore.status = 'ready';
        this.restore.targetSeg = null;
        this.restore.startedAt = null;
    }

    /**
     * 标记轮询超时（6 秒上限达到，数据仍未就绪）。
     * UI 应显示「扫描超时，请手动点击文件夹展开」。
     */
    markRestoreTimeout(): void {
        this.restore.status = 'timeout';
        this.restore.targetSeg = null;
        this.restore.startedAt = null;
    }

    /** 回到 idle 状态（清空 targetSeg / startedAt，不影响 timer）。 */
    clearRestoreStatus(): void {
        this.restore.status = 'idle';
        this.restore.targetSeg = null;
        this.restore.startedAt = null;
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

    /**
     * 重置恢复链路状态（仅在 showModelPopup 重置菜单时调用）。
     *
     * 不重置 loading：解压/替换可能在弹窗重置期间进行，跨弹窗重置是合理场景。
     * 修复原 bug：原代码不清理 restore 残留态，重开弹窗时会误触发上次的 autoExpand。
     */
    reset(): void {
        this.clearRestoreTimer();
        this.clearRestoreStatus();
        this.restore.pendingAutoExpand = null;
        this.restore.pendingFocusModel = null;
    }
}

/** 单例。 */
export const librarySessionStore = new LibrarySessionStore();
