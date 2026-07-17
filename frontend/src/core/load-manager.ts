// [doc:architecture] Load Manager — 统一资源加载入口
// 规范文档: docs/adr/adr-045-unified-loading-and-resource.md
// 职责: 跨资源类型串行排队、统一 LoadRequest/ResourceHandle 类型
// 现状: 菜单层已全部迁移至 loadManager.load()，底层加载器内部锁（isLoadingModel/isLoadingVmd/_propLoadQueue/_loadId）已随 ADR-046 移除，串行化由本队列统一保障。
// 后续: 为 LoadManager 补并发排队/反序列化恢复（跳过队列）的单元测试覆盖（当前仅靠手动验证）。

export type ResourceKind = 'actor' | 'stage' | 'prop' | 'vmd' | 'audio' | 'camera-vmd' | 'light';

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

    /** 入队一个加载请求，返回 ResourceHandle（所有 kind 均返回 handle，失败返回 null）。 */
    load(req: LoadRequest): Promise<ResourceHandle | null> {
        return this.enqueue(() => this.dispatch(req));
    }

    /** 当前正在执行的加载请求（供 UI 显示状态）。 */
    get current(): LoadRequest | null {
        return this._current;
    }

    private enqueue<T>(task: () => Promise<T>): Promise<T> {
        const result = this.queue.then(task, (err) => {
            // D2: onRejected 必须显式处理，不得隐式依赖 task 忽略参数
            console.warn('[loadManager] 上一任务失败，继续:', err);
            return task(); // 显式重跑，不传 err
        });
        this.queue = result.then(
            () => {},
            (err) => console.warn('[loadManager] 队列清理失败:', err)
        );
        return result;
    }

    private async dispatch(req: LoadRequest): Promise<ResourceHandle | null> {
        this._current = req;
        try {
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
                    const { modelRegistry } = await import('./config');
                    const inst = modelRegistry.get(id);
                    this._refreshMenus();
                    return { id, kind: req.kind, name: inst?.name ?? '', filePath: req.path };
                }
                case 'prop': {
                    const { loadProp } = await import('../scene/env/props');
                    const id = await loadProp(req.path);
                    if (!id) {
                        return null;
                    }
                    const { propRegistry } = await import('./config');
                    const inst = propRegistry.get(id);
                    return { id, kind: 'prop', name: inst?.name ?? '', filePath: req.path };
                }
                case 'vmd': {
                    const { loadVMDFromPath } = await import('../scene/motion/vmd-loader');
                    await loadVMDFromPath(req.path, req.modelId);
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
        } finally {
            this._current = null;
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
