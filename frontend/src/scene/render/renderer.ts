// [doc:architecture] Scene Renderer — 渲染管线、后处理、渲染状态
// 职责: DefaultRenderingPipeline 管理、后处理开关、场景背景色、边缘高亮
// 注意: 从 scene.ts 静态导入但仅在函数体内访问，ES module live binding 保证安全。

import { DefaultRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline';
import { Color4 } from '@babylonjs/core/Maths/math.color';
import type { Camera } from '@babylonjs/core/Cameras/camera';

// ======== Tone Mapping Modes ========

export const ToneMappingMode = {
    OFF: 0,
    ACES: 1,
    REINHARD: 2,
    CINEON: 3,
    NEUTRAL: 4,
} as const;

// ======== Render State ========

export interface RenderState {
    // Post-processing
    bloomEnabled: boolean;
    bloomWeight: number; // 0-1, default 0
    bloomThreshold: number; // 0-1, default 0.5
    bloomKernel: number; // 16-256, default 64
    outlineEnabled: boolean;
    outlineColor: [number, number, number]; // RGB 0-1
    fxaaEnabled: boolean;
    msaaSamples: number; // MSAA 采样数（1=关闭，2/4/8=开启）
    // Stage / imageProcessing
    toneMapping: number; // 0=OFF 1=ACES 2=Reinhard 3=Cineon 4=Neutral
    exposure: number; // 0-4, default 1
    contrast: number; // 0-4, default 1
    fov: number; // 0.1-3 rad, default 0.8
    bgColor: [number, number, number]; // 0-1
    // Phase 8 — DOF + Vignette
    dofEnabled: boolean;
    dofAperture: number; // 0-1, default 0（内部映射到 fStop 0.5~10）
    vignetteEnabled: boolean;
    vignetteDarkness: number; // 0-1, default 0
    // Phase 9 — 色差 + 颗粒
    chromaticAberrationEnabled: boolean;
    chromaticAberrationAmount: number; // 0-1, default 0（内部映射到 0~8）
    grainEnabled: boolean;
    grainIntensity: number; // 0-1, default 0（内部映射到 0~50）
}

// ======== Renderer State (module-level) ========

let _scene: import('@babylonjs/core/scene').Scene | null = null;
export let pipeline: DefaultRenderingPipeline | undefined;
let _outlineEnabled = false;
let _outlineColor: [number, number, number] = [0, 0, 0];
let _pipelineCamera: Camera | null = null;
let _modelRegistry: Map<string, import('../core/config').ModelInstance> | null = null;
let _triggerAutoSave: (() => void) | null = null;

// ======== 数值钳制工具 ========

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function clampColorChannel(v: number): number {
    return clamp(v, 0, 1);
}

function setKey<T extends object, K extends keyof T>(obj: T, key: K, value: T[K]): void {
    obj[key] = value;
}

// ======== 初始化与释放 ========

export function initRenderer(
    scene: import('@babylonjs/core/scene').Scene,
    modelRegistry: Map<string, import('../core/config').ModelInstance>,
    triggerAutoSave: () => void
): void {
    _scene = scene;
    _modelRegistry = modelRegistry;
    _triggerAutoSave = triggerAutoSave;

    pipeline = new DefaultRenderingPipeline('default', true, scene, [scene.activeCamera!]);
    pipeline.samples = 1; // MSAA off (performance)
    pipeline.fxaaEnabled = false;
    pipeline.bloomEnabled = false;
    pipeline.imageProcessingEnabled = true;
}

/** 检查渲染器是否已初始化。外部代码在调用 setRenderState 前可先检查。 */
export function isRendererReady(): boolean {
    return pipeline !== undefined && _scene !== null && _modelRegistry !== null;
}

/** 释放渲染管线及相关资源。在场景销毁时调用。 */
export function disposeRenderer(): void {
    if (pipeline) {
        pipeline.dispose();
        pipeline = undefined;
    }
    _scene = null;
    _modelRegistry = null;
    _triggerAutoSave = null;
    _pipelineCamera = null;
    _outlineEnabled = false;
    _outlineColor = [0, 0, 0];
}

// ======== 状态读取 ========

export function getRenderState(): RenderState {
    if (!_scene || !pipeline) {
        return _defaultRenderState();
    }
    const cam = _scene.activeCamera;
    return {
        bloomEnabled: pipeline.bloomEnabled,
        bloomWeight: pipeline.bloomWeight ?? 0,
        bloomThreshold: pipeline.bloomThreshold ?? 0.5,
        bloomKernel: pipeline.bloomKernel ?? 64,
        outlineEnabled: _outlineEnabled,
        outlineColor: _outlineColor,
        fxaaEnabled: pipeline.fxaaEnabled,
        msaaSamples: pipeline.samples ?? 1,
        toneMapping: pipeline.imageProcessing.toneMappingType ?? 0,
        exposure: pipeline.imageProcessing.exposure ?? 1,
        contrast: pipeline.imageProcessing.contrast ?? 1,
        fov: cam ? (cam.fov ?? 0.8) : 0.8,
        bgColor: [_scene.clearColor.r, _scene.clearColor.g, _scene.clearColor.b],
        dofEnabled: pipeline.depthOfFieldEnabled,
        // fStop 0.5~10 → 归一化 0~1（0=最大虚化 fStop=0.5, 1=无虚化 fStop=10）
        dofAperture: pipeline.depthOfField ? clamp((pipeline.depthOfField.fStop - 0.5) / 9.5, 0, 1) : 0,
        vignetteEnabled: pipeline.imageProcessing.vignetteEnabled ?? false,
        vignetteDarkness: pipeline.imageProcessing.vignetteWeight ?? 0,
        chromaticAberrationEnabled: pipeline.chromaticAberrationEnabled ?? false,
        chromaticAberrationAmount: pipeline.chromaticAberration ? clamp(pipeline.chromaticAberration.aberrationAmount / 8, 0, 1) : 0,
        grainEnabled: pipeline.grainEnabled ?? false,
        grainIntensity: pipeline.grain ? clamp(pipeline.grain.intensity / 50, 0, 1) : 0,
    };
}

function _defaultRenderState(): RenderState {
    return {
        bloomEnabled: false,
        bloomWeight: 0,
        bloomThreshold: 0.5,
        bloomKernel: 64,
        outlineEnabled: false,
        outlineColor: [0, 0, 0],
        fxaaEnabled: false,
        msaaSamples: 1,
        toneMapping: 0,
        exposure: 1,
        contrast: 1,
        fov: 0.8,
        bgColor: [0.12, 0.12, 0.16],
        dofEnabled: false,
        dofAperture: 0,
        vignetteEnabled: false,
        vignetteDarkness: 0,
        chromaticAberrationEnabled: false,
        chromaticAberrationAmount: 0,
        grainEnabled: false,
        grainIntensity: 0,
    };
}

// ======== 内部状态应用（无自动保存） ========

/**
 * 内部版 setRenderState，不触发自动保存。
 * 供 transitionRenderState 在中间帧调用，避免每帧触发保存 I/O。
 */
function _applyRenderState(s: Partial<RenderState>): void {
    if (!pipeline || !_scene || !_modelRegistry) {
        console.warn('[renderer] _applyRenderState: pipeline/scene 未初始化，状态更新被忽略');
        return;
    }

    // 数值钳制（全部 0-1 归一化范围）
    const w = s.bloomWeight !== undefined ? clamp(s.bloomWeight, 0, 1) : undefined;
    const th = s.bloomThreshold !== undefined ? clamp(s.bloomThreshold, 0, 1) : undefined;
    const k = s.bloomKernel !== undefined ? clamp(s.bloomKernel, 16, 256) : undefined;
    const e = s.exposure !== undefined ? clamp(s.exposure, 0, 4) : undefined;
    const c = s.contrast !== undefined ? clamp(s.contrast, 0, 4) : undefined;
    const f = s.fov !== undefined ? clamp(s.fov, 0.1, 3) : undefined;
    const da = s.dofAperture !== undefined ? clamp(s.dofAperture, 0, 1) : undefined;
    const vd = s.vignetteDarkness !== undefined ? clamp(s.vignetteDarkness, 0, 1) : undefined;
    const ca = s.chromaticAberrationAmount !== undefined ? clamp(s.chromaticAberrationAmount, 0, 1) : undefined;
    const gi = s.grainIntensity !== undefined ? clamp(s.grainIntensity, 0, 1) : undefined;

    // Post-processing
    if (s.bloomEnabled !== undefined) {
        pipeline.bloomEnabled = s.bloomEnabled;
    }
    if (w !== undefined) {
        pipeline.bloomWeight = w;
    }
    if (th !== undefined) {
        pipeline.bloomThreshold = th;
    }
    if (k !== undefined) {
        pipeline.bloomKernel = k;
    }
    if (s.fxaaEnabled !== undefined) {
        pipeline.fxaaEnabled = s.fxaaEnabled;
    }
    if (s.msaaSamples !== undefined) {
        pipeline.samples = clamp(s.msaaSamples, 1, 8);
    }

    // Outline — 仅在状态/颜色实际变化时遍历模型
    const outlineChanged = s.outlineEnabled !== undefined;
    const outlineColorChanged = s.outlineColor !== undefined;

    if (outlineChanged) {
        _outlineEnabled = s.outlineEnabled!;
    }
    if (outlineColorChanged) {
        _outlineColor = s.outlineColor;
    }
    if (outlineChanged || outlineColorChanged) {
        for (const inst of _modelRegistry.values()) {
            for (const m of inst.meshes) {
                if (outlineChanged) {
                    if (_outlineEnabled) {
                        m.enableEdgesRendering();
                    } else {
                        m.disableEdgesRendering();
                    }
                }
                if (m.edgesRenderer && outlineColorChanged) {
                    m.edgesColor = new Color4(
                        clampColorChannel(_outlineColor[0]),
                        clampColorChannel(_outlineColor[1]),
                        clampColorChannel(_outlineColor[2]),
                        1
                    );
                }
            }
        }
    }

    // DOF — 可选链保护（0-1 → fStop 0.5~10）
    if (s.dofEnabled !== undefined) {
        pipeline.depthOfFieldEnabled = s.dofEnabled;
    }
    if (da !== undefined && pipeline.depthOfField) {
        pipeline.depthOfField.fStop = 0.5 + da * 9.5;
    }

    // Vignette
    if (s.vignetteEnabled !== undefined && pipeline.imageProcessing) {
        pipeline.imageProcessing.vignetteEnabled = s.vignetteEnabled;
    }
    if (vd !== undefined && pipeline.imageProcessing) {
        pipeline.imageProcessing.vignetteWeight = vd;
    }

    // Chromatic Aberration（0-1 → 0~8）
    if (s.chromaticAberrationEnabled !== undefined) {
        pipeline.chromaticAberrationEnabled = s.chromaticAberrationEnabled;
    }
    if (ca !== undefined && pipeline.chromaticAberration) {
        pipeline.chromaticAberration.aberrationAmount = ca * 8;
    }

    // Grain（0-1 → 0~50）
    if (s.grainEnabled !== undefined) {
        pipeline.grainEnabled = s.grainEnabled;
    }
    if (gi !== undefined && pipeline.grain) {
        pipeline.grain.intensity = gi * 50;
    }

    // Stage / imageProcessing
    if (pipeline.imageProcessing) {
        if (s.toneMapping !== undefined) {
            pipeline.imageProcessing.toneMappingType = s.toneMapping;
        }
        if (e !== undefined) {
            pipeline.imageProcessing.exposure = e;
        }
        if (c !== undefined) {
            pipeline.imageProcessing.contrast = c;
        }
    }
    if (f !== undefined && _scene.activeCamera) {
        _scene.activeCamera.fov = f;
    }
    if (s.bgColor !== undefined) {
        _scene.clearColor = new Color4(
            clampColorChannel(s.bgColor[0]),
            clampColorChannel(s.bgColor[1]),
            clampColorChannel(s.bgColor[2]),
            1.0
        );
    }
}

// ======== 对外状态设置（含自动保存） ========

export function setRenderState(s: Partial<RenderState>): void {
    if (!pipeline || !_scene || !_modelRegistry || !_triggerAutoSave) {
        console.warn('[renderer] setRenderState: pipeline/scene 未初始化，状态更新被忽略');
        return;
    }

    _applyRenderState(s);

    _triggerAutoSave();
}

// ======== 平滑过渡 ========

/**
 * 平滑过渡渲染状态到目标值，默认 2 秒。
 * 数值/颜色字段做 lerp 插值；布尔字段按阈值提前启用；枚举字段在动画结束时切换。
 * 中间帧不触发自动保存，仅最终帧保存一次。
 */
export function transitionRenderState(
    target: Partial<RenderState>,
    duration: number = 2000,
    onComplete?: () => void
): void {
    if (!pipeline || !_scene || !_triggerAutoSave) {
        return;
    }

    const source = getRenderState();
    const startTime = performance.now();

    // 数值字段列表（需要 lerp）
    const numericKeys: (keyof RenderState)[] = [
        'bloomWeight',
        'bloomThreshold',
        'bloomKernel',
        'exposure',
        'contrast',
        'fov',
        'dofAperture',
        'vignetteDarkness',
        'chromaticAberrationAmount',
        'grainIntensity',
    ];
    // 颜色字段列表（逐通道 lerp）
    const colorKeys: (keyof RenderState)[] = ['outlineColor', 'bgColor'];
    // 布尔字段列表（按阈值提前启用/禁用以减少视觉跳跃）
    const boolKeys: (keyof RenderState)[] = [
        'bloomEnabled',
        'outlineEnabled',
        'fxaaEnabled',
        'dofEnabled',
        'vignetteEnabled',
        'chromaticAberrationEnabled',
        'grainEnabled',
    ];
    // 枚举字段（动画结束时切换）
    const enumKeys: (keyof RenderState)[] = ['toneMapping'];

    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

    /**
     * 判断布尔字段是否应在当前插值进度 t 时切换。
     * 对于启用（false→true）：当关联数值字段超过阈值时提前启用，减少跳跃感。
     * 对于禁用（true→false）：在动画结束时切换。
     */
    function shouldActivateBool(key: keyof RenderState, t: number): boolean {
        const targetVal = target[key] as boolean | undefined;
        if (targetVal === undefined) {
            return source[key] as boolean;
        }

        if (targetVal) {
            // 从 false → true：当关联数值超过半程时提前启用
            if (key === 'bloomEnabled') {
                const b =
                    target.bloomWeight !== undefined ? target.bloomWeight : source.bloomWeight;
                return t >= 0.3 || (b > 0 && source.bloomWeight > 0);
            }
            if (key === 'dofEnabled') {
                return t >= 0.3;
            }
            if (key === 'vignetteEnabled') {
                return t >= 0.3;
            }
            if (key === 'chromaticAberrationEnabled' || key === 'grainEnabled') {
                return t >= 0.3;
            }
            // outline / fxaa 无关联数值，延迟到 80%
            if (key === 'outlineEnabled' || key === 'fxaaEnabled') {
                return t >= 0.8;
            }
            return t >= 1;
        } else {
            // 从 true → false：动画结束时再禁用
            return t >= 1 ? false : (source[key] as boolean);
        }
    }

    const animLoop = () => {
        const elapsed = performance.now() - startTime;
        const t = Math.min(elapsed / duration, 1.0);
        const interp: Partial<RenderState> = {};

        // 数值字段插值
        for (const key of numericKeys) {
            if (target[key] !== undefined) {
                const a = source[key] as number;
                const b = target[key] as number;
                setKey(interp, key, lerp(a, b, t) as RenderState[typeof key]);
            }
        }
        // 颜色字段插值（逐通道）
        for (const key of colorKeys) {
            if (target[key] !== undefined) {
                const a = source[key] as number[];
                const b = target[key] as number[];
                setKey(interp, key, a.map((v, i) => lerp(v, b[i], t)) as RenderState[typeof key]);
            }
        }
        // 布尔字段：按阈值提前切换
        for (const key of boolKeys) {
            if (target[key] !== undefined) {
                setKey(interp, key, shouldActivateBool(key, t) as RenderState[typeof key]);
            }
        }
        // 枚举字段：t >= 1 时切换到目标值，否则保持当前值
        for (const key of enumKeys) {
            if (target[key] !== undefined) {
                setKey(interp, key, (t >= 1 ? target[key] : source[key]) as RenderState[typeof key]);
            }
        }

        // 中间帧调用 _applyRenderState（不触发自动保存），最终帧用 setRenderState（触发一次保存）
        if (t >= 1) {
            setRenderState(interp);
            if (onComplete) {
                onComplete();
            }
        } else {
            _applyRenderState(interp);
            requestAnimationFrame(animLoop);
        }
    };
    requestAnimationFrame(animLoop);
}

// ======== 相机重挂接 ========

/** Re-attach the rendering pipeline to the current active camera (call after camera switch). */
export function reattachPipeline(): void {
    if (!_scene || !pipeline) {
        return;
    }
    if (_scene.activeCamera) {
        // 先清除 pipeline 中所有已注册的相机，再添加当前相机
        const existingCameras = pipeline.cameras;
        if (existingCameras) {
            for (const cam of existingCameras) {
                try {
                    pipeline.removeCamera(cam);
                } catch {
                    // Intentionally empty — 移除已有相机失败，继续添加新相机即可
                }
            }
        }
        pipeline.addCamera(_scene.activeCamera);
        _pipelineCamera = _scene.activeCamera;
    }
}

// ======== 边缘高亮重建 ========

/** 当模型注册表更新时，重新应用边缘高亮状态。 */
export function rebuildOutlineState(): void {
    if (!_modelRegistry) {
        return;
    }
    for (const inst of _modelRegistry.values()) {
        for (const m of inst.meshes) {
            if (_outlineEnabled) {
                m.enableEdgesRendering();
                if (m.edgesRenderer) {
                    m.edgesColor = new Color4(
                        clampColorChannel(_outlineColor[0]),
                        clampColorChannel(_outlineColor[1]),
                        clampColorChannel(_outlineColor[2]),
                        1
                    );
                }
            } else {
                m.disableEdgesRendering();
            }
        }
    }
}
