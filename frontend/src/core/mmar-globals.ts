// [doc:architecture] __mmar — 运行时结构化状态暴露
// 挂载到 window.__mmar，供外置 AI（LLM）直接读取快照。
// 轻量架子，无外部依赖，不引入新架构范式。

export interface MmarStatus {
    phase: 'idle' | 'scanning' | 'loading' | 'playing' | 'error';
    text: string;
    detail?: string;
    updatedAt: number;
}

export interface MmarSceneSnapshot {
    fps: number;
    modelCount: number;
    activeModel?: string;
    activeMotion?: string;
    gpu: string;
    ktxSupported: boolean;
    qualityTier: string;
    meshCount: number;
}

export interface MmarGlobal {
    status: MmarStatus;
    scene: MmarSceneSnapshot;
}

declare global {
    interface Window {
        __mmar: MmarGlobal;
    }
}

// ======== 初始化（幂等，模块加载时自动执行） ========

function createInitialStatus(): MmarStatus {
    return {
        phase: 'idle',
        text: '',
        updatedAt: Date.now(),
    };
}

function createInitialSceneSnapshot(): MmarSceneSnapshot {
    return {
        fps: 0,
        modelCount: 0,
        gpu: '',
        ktxSupported: false,
        qualityTier: 'medium',
        meshCount: 0,
    };
}

function ensureMmar(): void {
    if (window.__mmar) return;
    window.__mmar = {
        status: createInitialStatus(),
        scene: createInitialSceneSnapshot(),
    };
}

// ======== 状态更新（由 setStatus / setLoadingStatus 内部串联） ========

export function updateMmarStatus(
    phase: MmarStatus['phase'],
    text: string,
    detail?: string,
): void {
    ensureMmar();
    window.__mmar.status = {
        phase,
        text: text || '',
        detail,
        updatedAt: Date.now(),
    };
}

// ======== 场景快照（由外部或定时器按需刷新） ========

/**
 * 刷新 window.__mmar.scene 快照。
 * 使用动态 import 避免与 scene/ 模块的循环依赖。
 * 引擎未就绪时静默跳过。
 */
export async function refreshSceneSnapshot(): Promise<void> {
    ensureMmar();

    let engine: any;
    let scene: any;
    try {
        const m = await import('../scene/scene');
        engine = m.engine;
        scene = m.scene;
    } catch {
        return; // 引擎未初始化
    }
    if (!engine || !scene) return;

    const snapshot: MmarSceneSnapshot = {
        fps: Math.round(engine.getFps()),
        meshCount: scene.meshes?.length ?? 0,
        modelCount: 0,
        gpu: '',
        ktxSupported: false,
        qualityTier: 'medium',
    };

    // GPU 渲染器信息（从底层 WebGL context 读取）
    try {
        const gl = (engine as any)._gl;
        if (gl) {
            const vendor = gl.getParameter(gl.VENDOR);
            const renderer = gl.getParameter(gl.RENDERER);
            snapshot.gpu = `${vendor} ${renderer}`;
        }
    } catch {
        // 非 WebGL 环境（WebGPU / 引擎未初始化）
    }

    // KTX2 压缩纹理支持
    try {
        const { detectKtx2Support } = await import('./gpu-capabilities');
        const ktx = detectKtx2Support();
        snapshot.ktxSupported = ktx.supported;
    } catch {
        // 探测失败（无 canvas / 浏览器不支持）
    }

    // 质量档位
    try {
        const { envState } = await import('./config');
        const qp = (envState as any).qualityProfile;
        if (qp === 'high' || qp === 'medium' || qp === 'low') {
            snapshot.qualityTier = qp;
        }
    } catch {
        // config 未就绪
    }

    // 活跃模型
    try {
        const { focusedModel } = await import('../scene/manager/model-ops');
        const model = focusedModel();
        if (model) {
            snapshot.modelCount = 1;
            snapshot.activeModel = model.name;
        }
    } catch {
        // model-ops 未初始化
    }

    // 活跃动作
    try {
        const { getActiveMotion } = await import('../scene/motion/motion-intent');
        const motion = getActiveMotion();
        if (motion) {
            snapshot.activeMotion = motion.vmdName;
        }
    } catch {
        // motion-intent 未初始化
    }

    window.__mmar.scene = snapshot;
}