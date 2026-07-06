// [doc:architecture] Load Manager — 统一资源加载入口
// 规范文档: docs/adr/adr-045-unified-loading-and-resource.md
// 职责: 跨资源类型串行排队、统一 LoadRequest/ResourceHandle 类型
// 现状: 骨架阶段，现有 loadXxx 函数仍保留各自内部锁，LoadManager 为上层调度
// 后续: 逐步将菜单层调用迁移到 loadManager.load()，再考虑移除底层锁

export type ResourceKind = 'actor' | 'stage' | 'prop' | 'vmd' | 'audio' | 'camera-vmd';

export interface LoadRequest {
    kind: ResourceKind;
    path: string;
    /** VMD 关联的模型 id（kind='vmd' 时使用） */
    modelId?: string;
    /** 跳过自动应用（kind='actor'/'stage' 时使用） */
    skipAutoApply?: boolean;
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

    /** 入队一个加载请求，返回 ResourceHandle（VMD/Audio 返回 null）。 */
    load(req: LoadRequest): Promise<ResourceHandle | null> {
        return this.enqueue(() => this.dispatch(req));
    }

    /** 当前正在执行的加载请求（供 UI 显示状态）。 */
    get current(): LoadRequest | null {
        return this._current;
    }

    private enqueue<T>(task: () => Promise<T>): Promise<T> {
        const result = this.queue.then(task, task);
        this.queue = result.then(
            () => {},
            () => {}
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
                    const id = await loadPMXFile(req.path, req.kind === 'stage', req.skipAutoApply);
                    return id ? { id, kind: req.kind, name: '', filePath: req.path } : null;
                }
                case 'prop': {
                    const { loadProp } = await import('../scene/env/props');
                    const id = await loadProp(req.path);
                    return id ? { id, kind: 'prop', name: '', filePath: req.path } : null;
                }
                case 'vmd': {
                    const { loadVMDFromPath } = await import('../scene/motion/vmd-loader');
                    await loadVMDFromPath(req.path, req.modelId);
                    return null;
                }
                case 'camera-vmd': {
                    const { loadCameraVmdFromPath } = await import('../scene/motion/vmd-loader');
                    await loadCameraVmdFromPath(req.path);
                    return null;
                }
                case 'audio': {
                    const { loadAudioFile } = await import('../outfit/audio');
                    await loadAudioFile(req.path);
                    return null;
                }
                default:
                    return null;
            }
        } finally {
            this._current = null;
        }
    }
}

/** 单例。 */
export const loadManager = new LoadManager();
