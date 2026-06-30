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
    bloomWeight: number; // 0-1, default 0.3
    bloomThreshold: number; // 0-1, default 0.5
    bloomKernel: number; // 0-512, default 64
    outlineEnabled: boolean;
    outlineColor: [number, number, number]; // RGB 0-1
    fxaaEnabled: boolean;
    // Stage / imageProcessing
    toneMapping: number; // 0=OFF 1=ACES 2=Reinhard 3=Cineon 4=Neutral
    exposure: number; // 0-4, default 1
    contrast: number; // 0-4, default 1
    fov: number; // 0.1-3 rad, default 0.8
    bgColor: [number, number, number]; // 0-1
    // Phase 8 — DOF + Vignette
    dofEnabled: boolean;
    dofAperture: number;
    vignetteEnabled: boolean;
    vignetteDarkness: number;
}

// ======== Renderer State (module-level) ========

let _scene: import('@babylonjs/core/scene').Scene | null = null;
export let pipeline: DefaultRenderingPipeline;
let _outlineEnabled = false;
let _outlineColor: [number, number, number] = [0, 0, 0];
let _pipelineCamera: Camera | null = null;
let _modelRegistry: Map<string, import('../core/config').ModelInstance> | null = null;
let _triggerAutoSave: (() => void) | null = null;

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

export function getRenderState(): RenderState {
    if (!_scene || !pipeline) {
        return _defaultRenderState();
    }
    const cam = _scene.activeCamera;
    return {
        bloomEnabled: pipeline.bloomEnabled,
        bloomWeight: pipeline.bloomWeight ?? 0.3,
        bloomThreshold: pipeline.bloomThreshold ?? 0.5,
        bloomKernel: pipeline.bloomKernel ?? 64,
        outlineEnabled: _outlineEnabled,
        outlineColor: _outlineColor,
        fxaaEnabled: pipeline.fxaaEnabled,
        toneMapping: pipeline.imageProcessing.toneMappingType ?? 0,
        exposure: pipeline.imageProcessing.exposure ?? 1,
        contrast: pipeline.imageProcessing.contrast ?? 1,
        fov: cam ? ((cam as any).fov ?? 0.8) : 0.8,
        bgColor: [_scene.clearColor.r, _scene.clearColor.g, _scene.clearColor.b],
        dofEnabled: pipeline.depthOfFieldEnabled,
        dofAperture: pipeline.depthOfField.fStop ?? 0.5,
        vignetteEnabled: pipeline.imageProcessing.vignetteEnabled ?? false,
        vignetteDarkness: pipeline.imageProcessing.vignetteWeight ?? 0.5,
    };
}

function _defaultRenderState(): RenderState {
    return {
        bloomEnabled: false,
        bloomWeight: 0.3,
        bloomThreshold: 0.5,
        bloomKernel: 64,
        outlineEnabled: false,
        outlineColor: [0, 0, 0],
        fxaaEnabled: false,
        toneMapping: 0,
        exposure: 1,
        contrast: 1,
        fov: 0.8,
        bgColor: [0.12, 0.12, 0.16],
        dofEnabled: false,
        dofAperture: 0.5,
        vignetteEnabled: false,
        vignetteDarkness: 0.5,
    };
}

export function setRenderState(s: Partial<RenderState>): void {
    if (!pipeline || !_scene || !_modelRegistry || !_triggerAutoSave) {
        return;
    }

    // Post-processing
    if (s.bloomEnabled !== undefined) {
        pipeline.bloomEnabled = s.bloomEnabled;
    }
    if (s.bloomWeight !== undefined) {
        pipeline.bloomWeight = s.bloomWeight;
    }
    if (s.bloomThreshold !== undefined) {
        pipeline.bloomThreshold = s.bloomThreshold;
    }
    if (s.bloomKernel !== undefined) {
        pipeline.bloomKernel = s.bloomKernel;
    }
    if (s.fxaaEnabled !== undefined) {
        pipeline.fxaaEnabled = s.fxaaEnabled;
    }

    // Outline — toggle edges rendering on all loaded meshes
    if (s.outlineEnabled !== undefined) {
        _outlineEnabled = s.outlineEnabled;
        for (const inst of _modelRegistry.values()) {
            for (const m of inst.meshes) {
                if (s.outlineEnabled) {
                    m.enableEdgesRendering();
                } else {
                    m.disableEdgesRendering();
                }
            }
        }
    }
    // Apply outline color (separate from toggle so color can change independently)
    if (s.outlineColor !== undefined) {
        _outlineColor = s.outlineColor;
        for (const inst of _modelRegistry.values()) {
            for (const m of inst.meshes) {
                if (m.edgesRenderer) {
                    m.edgesColor = new Color4(
                        s.outlineColor[0],
                        s.outlineColor[1],
                        s.outlineColor[2],
                        1
                    );
                }
            }
        }
    }

    // DOF — via pipeline.depthOfField
    if (s.dofEnabled !== undefined) {
        pipeline.depthOfFieldEnabled = s.dofEnabled;
    }
    if (s.dofAperture !== undefined && pipeline.depthOfField) {
        pipeline.depthOfField.fStop = s.dofAperture;
    }

    // Vignette — via pipeline.imageProcessing
    if (s.vignetteEnabled !== undefined && pipeline.imageProcessing) {
        pipeline.imageProcessing.vignetteEnabled = s.vignetteEnabled;
    }
    if (s.vignetteDarkness !== undefined && pipeline.imageProcessing) {
        pipeline.imageProcessing.vignetteWeight = s.vignetteDarkness;
    }

    // Stage / imageProcessing
    if (pipeline.imageProcessing) {
        if (s.toneMapping !== undefined) {
            pipeline.imageProcessing.toneMappingType = s.toneMapping;
        }
        if (s.exposure !== undefined) {
            pipeline.imageProcessing.exposure = s.exposure;
        }
        if (s.contrast !== undefined) {
            pipeline.imageProcessing.contrast = s.contrast;
        }
    }
    if (s.fov !== undefined && _scene.activeCamera) {
        (_scene.activeCamera as any).fov = s.fov;
    }
    if (s.bgColor !== undefined) {
        _scene.clearColor = new Color4(s.bgColor[0], s.bgColor[1], s.bgColor[2], 1.0);
    }

    _triggerAutoSave();
}

/**
 * 平滑过渡渲染状态到目标值，默认 2 秒。
 * 数值/颜色字段做 lerp 插值；布尔/枚举字段在动画结束时切换。
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
    ];
    // 颜色字段列表（逐通道 lerp）
    const colorKeys: (keyof RenderState)[] = ['outlineColor', 'bgColor'];
    // 布尔字段列表（动画结束时切换）
    const boolKeys: (keyof RenderState)[] = [
        'bloomEnabled',
        'outlineEnabled',
        'fxaaEnabled',
        'dofEnabled',
        'vignetteEnabled',
    ];
    // 枚举字段（瞬间切换）
    const enumKeys: (keyof RenderState)[] = ['toneMapping'];

    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

    const animLoop = () => {
        const elapsed = performance.now() - startTime;
        const t = Math.min(elapsed / duration, 1.0);
        const interp: Partial<RenderState> = {};

        // 数值字段插值
        for (const key of numericKeys) {
            if (target[key] !== undefined) {
                const a = source[key] as number;
                const b = target[key] as number;
                (interp as any)[key] = lerp(a, b, t);
            }
        }
        // 颜色字段插值（逐通道）
        for (const key of colorKeys) {
            if (target[key] !== undefined) {
                const a = source[key] as number[];
                const b = target[key] as number[];
                (interp as any)[key] = a.map((v, i) => lerp(v, b[i], t));
            }
        }
        // 布尔/枚举字段：t >= 1 时切换到目标值，否则保持当前值
        const allSwitchKeys = [...boolKeys, ...enumKeys];
        for (const key of allSwitchKeys) {
            if (target[key] !== undefined) {
                (interp as any)[key] = t >= 1 ? target[key] : source[key];
            }
        }

        setRenderState(interp);

        if (t >= 1) {
            if (onComplete) {
                onComplete();
            }
        } else {
            requestAnimationFrame(animLoop);
        }
    };
    requestAnimationFrame(animLoop);
}

/** Re-attach the rendering pipeline to the current active camera (call after camera switch). */
export function reattachPipeline(): void {
    if (!_scene || !pipeline) {
        return;
    }
    if (_scene.activeCamera) {
        // Remove previously attached camera if still in pipeline
        if (_pipelineCamera && _pipelineCamera !== _scene.activeCamera) {
            try {
                pipeline.removeCamera(_pipelineCamera);
            } catch (_) {}
        }
        pipeline.addCamera(_scene.activeCamera);
        _pipelineCamera = _scene.activeCamera;
    }
}

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
                        _outlineColor[0],
                        _outlineColor[1],
                        _outlineColor[2],
                        1
                    );
                }
            } else {
                m.disableEdgesRendering();
            }
        }
    }
}
