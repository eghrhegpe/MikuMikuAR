// [doc:architecture] Load Manager — 统一资源加载入口
// 规范文档: docs/adr/adr-045-unified-loading-and-resource.md
// 职责: 跨资源类型串行排队、统一 LoadRequest/ResourceHandle 类型
// 现状: 菜单层已全部迁移至 loadManager.load()，底层加载器内部锁（isLoadingModel/isLoadingVmd/_propLoadQueue/_loadId）已随 ADR-046 移除，串行化由本队列统一保障。
// [doc:adr-135] P0.2: loadId trace 链路 — 每次加载分配 loadId + phase 追踪，错误包装为 LibraryLoadError
// 后续: 为 LoadManager 补并发排队/反序列化恢复（跳过队列）的单元测试覆盖（当前仅靠手动验证）。

export type ResourceKind = 'actor' | 'stage' | 'prop' | 'vmd' | 'audio' | 'camera-vmd' | 'light';

/**
 * [doc:adr-135] P0.2 加载阶段标签。dispatch 内部按 phase 更新，
 * 错误时包装进 LibraryLoadError，便于 formatError 加 [loadId/phase] 前缀。
 *
 * - `'parse'`：解析文件 / 调底层加载器（loadPMXFile / loadVMDFromPath 等）
 * - `'register'`：写入 modelRegistry / propRegistry
 * - `'refresh'`：刷新依赖菜单（motion-popup 等）
 * - `'unknown'`：兜底，理论上 dispatch 内不会出现
 *
 * 不含 `'extract'`：zip 解压走 ExtractZip 不经 loadManager，归 P1.2 处理。
 * 不含 `'apply'`：预留给未来应用阶段，当前无消费方。
 */
export type LoadPhase = 'parse' | 'register' | 'apply' | 'refresh' | 'unknown';

/**
 * [doc:adr-135] P0.2 加载错误结构化对象。
 *
 * dispatch 内捕获任何原始错误后包装为本类型抛出。formatError 通过 name 字段识别，
 * 自动加 `[loadId/phase]` 前缀，让 library-actions 的 6 处 catch 零侵入获得 trace 能力。
 *
 * 不继承 Error 类：避免堆栈丢失 + 跨 realm 问题；用 plain object + name 标记。
 */
export interface LibraryLoadError {
    readonly name: 'LibraryLoadError';
    readonly loadId: string;
    readonly phase: LoadPhase;
    readonly cause: unknown;
    readonly req: LoadRequest;
    readonly message: string;
}

export interface LoadRequest {
    kind: ResourceKind;
    path: string;
    /** VMD 关联的模型 id（kind='vmd' 时使用） */
    modelId?: string;
    /** 跳过自动应用（kind='actor'/'stage' 时使用） */
    skipAutoApply?: boolean;
    /**
     * [fix:thumbnail] 库引用路径（zip 模型的 zip 包绝对路径）。
     * 解压加载时 path 是临时解压路径，但缩略图缓存以库引用路径为 key，
     * 故需透传原始 m.file_path，否则 zip 模型缩略图永远 miss。
     */
    libraryPath?: string;
    /**
     * zip 内部相对路径（用于区分同一 zip 内的不同模型变体）。
     * 同一 zip 包内的多个 PMX 模型会共享同一个 libraryPath，
     * 通过 innerPath 可以为每个变体生成独立的缩略图缓存。
     */
    innerPath?: string;
}

export interface ResourceHandle {
    id: string;
    kind: ResourceKind;
    name: string;
    filePath: string;
}

/**
 * LoadManager — 跨资源类型串行队列。
 *
 * 现有 loadPMXFile/loadVMDFromPath/loadProp/loadAudioFile 各有内部锁，
 * LoadManager 在其之上提供统一入口，确保「道具加载中点击模型」会排队
 * 而非被底层锁拒绝。后续迁移完成后可移除底层锁。
 *
 * 使用 dynamic import 避免与 scene 模块的循环依赖。
 */
class LoadManager {
    private queue: Promise<void> = Promise.resolve();
    private _current: LoadRequest | null = null;
    // [doc:adr-135] P0.2 trace 字段：与 _current 并行暴露，便于 getCurrentLoad() 返回结构化快照
    private _loadId: string | null = null;
    private _phase: LoadPhase | null = null;

    /** 入队一个加载请求，返回 ResourceHandle（所有 kind 均返回 handle，失败返回 null）。 */
    load(req: LoadRequest): Promise<ResourceHandle | null> {
        // [doc:adr-135] P0.2: 每次 load 生成 loadId，贯穿 dispatch 全链路；enqueue onRejected 重试复用同一 loadId（合理：重试同一加载）
        const loadId = this._generateLoadId();
        return this.enqueue(() => this.dispatch(req, loadId));
    }

    /** 当前正在执行的加载请求（保留向后兼容，仅返回 req）。 */
    get current(): LoadRequest | null {
        return this._current;
    }

    /**
     * [doc:adr-135] P0.2 当前加载的结构化快照（含 loadId + phase）。
     * 供 UI 显示「正在解析 X 模型…」等状态；空载返回 null。
     */
    getCurrentLoad(): { loadId: string; phase: LoadPhase; req: LoadRequest } | null {
        if (!this._current || !this._loadId) {
            return null;
        }
        return {
            loadId: this._loadId,
            phase: this._phase ?? 'unknown',
            req: this._current,
        };
    }

    private _generateLoadId(): string {
        // 短 ID：l_ + 时间戳 base36 + 4 位随机。同一会话内冲突概率极低；
        // 仅用于日志关联与 UI 显示，不做哈希唯一性保证。
        return 'l_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
    }

    private enqueue<T>(task: () => Promise<T>): Promise<T> {
        const result = this.queue.then(task, (err) => {
            // D2: onRejected 必须显式处理，不得隐式依赖 task 忽略参数
            // [doc:adr-135] P0.2 注意：onRejected 重试复用同一 loadId（在 load() 入口生成）
            // P1.1 将改造此处：不再吞错，直接上抛并标记 queue failed
            console.warn('[loadManager] 上一任务失败，继续:', err);
            return task(); // 显式重跑，不传 err
        });
        this.queue = result.then(
            () => {},
            (err) => console.warn('[loadManager] 队列清理失败:', err)
        );
        return result;
    }

    private async dispatch(req: LoadRequest, loadId: string): Promise<ResourceHandle | null> {
        this._current = req;
        this._loadId = loadId;
        try {
            this._phase = 'parse';
            switch (req.kind) {
                case 'actor':
                case 'stage': {
                    const { loadPMXFile } = await import('../scene/manager/model-loader');
                    const id = await loadPMXFile(
                        req.path,
                        req.kind === 'stage',
                        req.skipAutoApply,
                        req.libraryPath,
                        req.innerPath
                    );
                    if (!id) {
                        return null;
                    }
                    this._phase = 'register';
                    const { modelRegistry } = await import('./config');
                    const inst = modelRegistry.get(id);
                    this._phase = 'refresh';
                    this._refreshMenus();
                    return { id, kind: req.kind, name: inst?.name ?? '', filePath: req.path };
                }
                case 'prop': {
                    const { loadProp } = await import('../scene/env/props');
                    const id = await loadProp(req.path);
                    if (!id) {
                        return null;
                    }
                    this._phase = 'register';
                    const { propRegistry } = await import('./config');
                    const inst = propRegistry.get(id);
                    return { id, kind: 'prop', name: inst?.name ?? '', filePath: req.path };
                }
                case 'vmd': {
                    const { loadVMDFromPath } = await import('../scene/motion/vmd-loader');
                    await loadVMDFromPath(req.path, req.modelId);
                    // [fix] 对齐 actor/stage：VMD 加载成功后刷新 motion-popup，
                    // 使常驻打开的菜单在加载完成后立即反映当前动作（getActiveMotion 已由 loadVMDFromPath 内 setActiveMotion 更新）。
                    this._phase = 'refresh';
                    this._refreshMenus();
                    const fileName = req.path.split(/[\\/]/).pop() || '';
                    return {
                        id: '',
                        kind: 'vmd',
                        name: fileName.replace(/\.vmd$/i, ''),
                        filePath: req.path,
                    };
                }
                case 'camera-vmd': {
                    const { loadCameraVmdFromPath } = await import('../scene/motion/vmd-loader');
                    await loadCameraVmdFromPath(req.path);
                    this._phase = 'refresh';
                    this._refreshMenus();
                    const fileName = req.path.split(/[\\/]/).pop() || '';
                    return {
                        id: '',
                        kind: 'camera-vmd',
                        name: fileName.replace(/\.vmd$/i, ''),
                        filePath: req.path,
                    };
                }
                case 'audio': {
                    const { loadAudioFile } = await import('../outfit/audio');
                    await loadAudioFile(req.path);
                    this._phase = 'refresh';
                    this._refreshMenus();
                    const fileName = req.path.split(/[\\/]/).pop() || '';
                    return {
                        id: '',
                        kind: 'audio',
                        name: fileName.replace(/\.(mp3|wav|ogg|flac)$/i, ''),
                        filePath: req.path,
                    };
                }
                default:
                    return null;
            }
        } catch (err) {
            // [doc:adr-135] P0.2: 包装为结构化 LibraryLoadError，让 formatError 自动加 [loadId/phase] 前缀。
            // 不继承 Error：避免堆栈丢失 + 跨 realm 问题；plain object + name 标记即可被 formatError 识别。
            const wrapped: LibraryLoadError = {
                name: 'LibraryLoadError',
                loadId,
                phase: this._phase ?? 'unknown',
                cause: err,
                req,
                message: err instanceof Error ? err.message : String(err),
            };
            throw wrapped;
        } finally {
            this._current = null;
            this._loadId = null;
            this._phase = null;
        }
    }

    /** 模型加载成功后刷新依赖模型列表的菜单。 */
    private _refreshMenus(): void {
        import('../menus/motion-popup')
            .then(({ refreshMotionRoot, getMotionMenu }) => {
                // 菜单已 dispose 则跳过，避免对销毁的 popup 执行刷新（refreshRoot 内部亦有 !menu 守卫，此处为显式生命周期守卫）
                if (!getMotionMenu()) {
                    return;
                }
                refreshMotionRoot();
            })
            .catch(() => {
                // motion-popup 可能未注册，静默忽略
            });
    }
}

/** 单例。 */
export const loadManager = new LoadManager();
