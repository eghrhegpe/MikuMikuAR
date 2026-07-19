// [doc:adr-135] LibrarySessionStore — 资源库会话状态单例
//
// 收敛 library-core / library-actions / library-browse 三个模块散落的隐式状态变量，
// 提供唯一权威读写入口。
//
// P0.1 仅做状态搬迁，不改任何行为语义。
// 后续 P0.2 / P0.3 在此基座上叠加 loadId trace 与可见化 LoadingState。

/**
 * 资源库会话状态：恢复链路（上次浏览位置 + 高亮模型）。
 *
 * 原散落位置：
 * - `pendingAutoExpand`：library-core.ts:79
 * - `pendingFocusModel`：library-core.ts:80
 * - `timer`（原 `_restoreTimer`）：library-browse.ts:51
 */
export interface LibraryRestoreState {
    pendingAutoExpand: string[] | null;
    pendingFocusModel: { dir: string; rowKey: string } | null;
    timer: ReturnType<typeof setTimeout> | null;
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
        this.restore.pendingAutoExpand = null;
        this.restore.pendingFocusModel = null;
    }
}

/** 单例。 */
export const librarySessionStore = new LibrarySessionStore();
