// [doc:adr-238] getSceneAction 供 focusedModel 快照读取（scene-action-bridge）
import { getSceneAction } from './scene-action-bridge';
// [doc:architecture] __mmar — 运行时结构化状态暴露
// 挂载到 window.__mmar，供外置 AI（LLM）直接读取快照。
// 轻量叶子模块：仅依赖普通 JS 全局与动态 import，无静态内部模块耦合，不引入新架构范式。

export type MmarPhase = 'idle' | 'scanning' | 'loading' | 'playing' | 'error';

export interface MmarStatus {
    phase: MmarPhase;
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
        /** 可选：模块加载时由 ensureMmar() 自动初始化，读取方无需先判存在性。 */
        __mmar?: MmarGlobal;
    }
}

// ======== 初始化（幂等；模块加载时自动执行，保证 window.__mmar 始终就绪） ========

function createInitialStatus(): MmarStatus {
    return { phase: 'idle', text: '', updatedAt: Date.now() };
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

/** 幂等地确保 window.__mmar 就绪，返回已就绪的实例（消除对 `!` 断言的依赖）。 */
function ensureMmar(): MmarGlobal {
    if (window.__mmar) {
        return window.__mmar;
    }
    window.__mmar = {
        status: createInitialStatus(),
        scene: createInitialSceneSnapshot(),
    };
    return window.__mmar;
}

// 模块加载即初始化：任何读取方（含启动时序更早的模块）都能拿到合法对象。
ensureMmar();

// ======== 状态更新（由 setStatus / setLoadingStatus 内部串联） ========

export function updateMmarStatus(phase: MmarPhase, text: string, detail?: string): void {
    const g = ensureMmar();
    g.status = {
        phase,
        text: text || '',
        detail,
        updatedAt: Date.now(),
    };
}

// ======== 场景快照（caller 驱动；可用 startSceneSnapshotPolling 周期刷新） ========

interface GlLike {
    VENDOR: number;
    RENDERER: number;
    getParameter(p: number): string;
}

/**
 * 刷新 window.__mmar.scene 快照。
 * 使用动态 import 避免与 scene/ 模块的静态循环依赖。
 * 引擎 / 配置 / 能力探测未就绪时，对应字段静默保持零值，不抛错。
 */
export async function refreshSceneSnapshot(): Promise<void> {
    const g = ensureMmar();

    // [doc:adr-238] 惰性加载（Promise 形式，避免 check-circular 静态边）
    // try/catch 覆盖场景模块加载失败：保持快照零值并退出，避免轮询
    // （startSceneSnapshotPolling）下每 tick 抛一次 unhandled rejection 刷屏。
    let snapshot: MmarSceneSnapshot | undefined;
    // engine 供下方 GPU 段复用（WebGL 渲染器信息读取）
    let engine: unknown;
    try {
        const m = await import('../scene/scene');
        engine = m.engine;
        const scene = m.scene;
        const modelManager = m.modelManager;
        if (!engine || !scene) {
            return;
        }

        snapshot = {
            fps: Math.round((engine as { getFps(): number }).getFps()),
            meshCount: scene.meshes?.length ?? 0,
            modelCount: modelManager?.getAll().length ?? 0,
            gpu: '',
            ktxSupported: false,
            qualityTier: 'medium',
        };
    } catch {
        return;
    }

    // 防御：TS 控制流对 try/catch 保守，显式收窄快照非空
    if (!snapshot) {
        return;
    }

    // GPU 渲染器信息（从底层 WebGL context 读取；WebGPU 下 _gl 为 undefined）
    try {
        const gl = (engine as { _gl?: GlLike })._gl;
        if (gl) {
            snapshot.gpu = `${gl.getParameter(gl.VENDOR)} ${gl.getParameter(gl.RENDERER)}`;
        }
    } catch {
        // 非 WebGL 环境（WebGPU / 引擎未初始化）
    }

    // KTX2 压缩纹理支持
    try {
        const { detectKtx2Support } = await import('./gpu-capabilities');
        snapshot.ktxSupported = detectKtx2Support().supported;
    } catch {
        // 探测失败（无 canvas / 浏览器不支持）
    }

    // 质量档位（envState.qualityProfile 为真实字段，无需 as any）
    try {
        const { envState } = await import('./config');
        const qp = envState.qualityProfile;
        if (qp === 'high' || qp === 'medium' || qp === 'low') {
            snapshot.qualityTier = qp;
        }
    } catch {
        // config 未就绪
    }

    // 活跃模型（真实加载数已在上方由 modelManager 填充；此处补全名称）
    try {
        // [doc:adr-238] focusedModel 经 scene-action-bridge（model-ops 注册）
        const model = getSceneAction('focusedModel')?.() as { name?: string } | undefined;
        if (model) {
            snapshot.activeModel = model.name;
        }
    } catch {
        // model-ops 未初始化
    }

    // 活跃动作
    try {
        // [doc:adr-238] getActiveMotion 经 scene-action-bridge（motion-intent 注册）
        const motion = getSceneAction('getActiveMotion')?.();
        if (motion) {
            snapshot.activeMotion = motion.vmdName;
        }
    } catch {
        // motion-intent 未初始化
    }

    g.scene = snapshot;
}

// ======== 周期轮询（幂等；由应用初始化入口启动，HMR 重复注册安全） ========

let _snapshotTimer: ReturnType<typeof setInterval> | null = null;

/** 启动周期快照刷新；重复调用安全（仅注册一个 timer）。 */
export function startSceneSnapshotPolling(intervalMs = 1000): void {
    if (_snapshotTimer !== null) {
        return;
    }
    _snapshotTimer = setInterval(() => {
        void refreshSceneSnapshot();
    }, intervalMs);
}

/** 停止周期快照刷新；未启动或重复调用均安全。 */
export function stopSceneSnapshotPolling(): void {
    if (_snapshotTimer !== null) {
        clearInterval(_snapshotTimer);
        _snapshotTimer = null;
    }
}
