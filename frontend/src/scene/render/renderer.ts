// [doc:architecture] Scene Renderer — 渲染管线、后处理、渲染状态
// 职责: DefaultRenderingPipeline 管理、后处理开关、场景背景色、边缘高亮
// 注意: 从 scene.ts 静态导入但仅在函数体内访问，ES module live binding 保证安全。

import { DefaultRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline';
import { SSRRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/ssrRenderingPipeline';
import { SSAO2RenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/ssao2RenderingPipeline';
import { PostProcess } from '@babylonjs/core/PostProcesses/postProcess';
import { Effect } from '@babylonjs/core/Materials/effect';
import { Color4 } from '@babylonjs/core/Maths/math.color';
import type { Camera } from '@babylonjs/core/Cameras/camera';
import { GlowLayer } from '@babylonjs/core/Layers/glowLayer';
import { ReflectionProbe } from '@babylonjs/core/Probes/reflectionProbe';
import type { Observer } from '@babylonjs/core/Misc/observable';
import { scheduleRefresh } from '@/core/reactivity';
import { resetPerformanceSnapshot, isSnapshotResetSuppressed } from './performance';
import { clamp, clamp01, lerp, lerpArray, setKey, logWarn } from '@/core/utils';
import type { EnvState } from '@/core/config';
import { dirLight } from './lighting';

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
    // Phase 10 — 锐化 + 辉光
    sharpenAmount: number; // 0-1, default 0（内部映射到 sharpen.edgeAmount）
    glowEnabled: boolean;
    glowIntensity: number; // 0-1, default 0（GlowLayer.intensity）
    // Phase 11 — SSR + Reflection Probe
    ssrEnabled: boolean;
    ssrStrength: number; // 0-1, default 0（SSRRenderingPipeline.strength）
    ssrFalloff: number; // 0-1, default 0（映射到 reflectionSpecularFalloffExponent 1~8）
    ssrStep: number; // 1-32, default 1（SSRRenderingPipeline.step）
    ssrThickness: number; // 0-2, default 0.5（SSRRenderingPipeline.thickness）
    reflectionProbeEnabled: boolean;
    reflectionIntensity: number; // 0-1, default 0
    // Phase 11 — SSAO
    ssaoEnabled: boolean;
    ssaoStrength: number; // 0-1, default 0（SSAO2RenderingPipeline.totalStrength 0~2）
    ssaoRadius: number; // 0-1, default 0（SSAO2RenderingPipeline.radius 0~4）
    ssaoSamples: number; // 4-32, default 8（SSAO2RenderingPipeline.samples）
    // Phase 12 — 卡通化渲染预设（后处理风格化）
    celShadingMode: boolean;
}

// ======== Renderer State (module-level) ========

let _scene: import('@babylonjs/core/scene').Scene | null = null;
export let pipeline: DefaultRenderingPipeline | undefined;
let _outlineEnabled = false;
let _outlineColor: [number, number, number] = [0, 0, 0];
let _pipelineCamera: Camera | null = null;
let _modelRegistry: Map<string, import('../../core/config').ModelInstance> | null = null;
let _triggerAutoSave: (() => void) | null = null;
let _glowLayer: GlowLayer | null = null;
let _ssrPipeline: SSRRenderingPipeline | null = null;
let _ssaoPipeline: SSAO2RenderingPipeline | null = null;
let _reflectionProbe: ReflectionProbe | null = null;
let _probeRefreshObserver: Observer<import('@babylonjs/core/scene').Scene> | null = null;
let _lastProbeRefresh = 0;
// ADR-114 Phase 3: 接触阴影后处理（屏幕空间 ray marching）
let _contactShadowPP: PostProcess | null = null;
// 卡通化渲染预设状态
let _celShadingMode = false;
let _originalRenderState: RenderState | null = null;
/** 当前渲染过渡动画 observer（用于去重） */
let _renderTransitionObserver: Observer<import('@babylonjs/core/scene').Scene> | null = null;

// ======== 初始化与释放 ========

export function initRenderer(
    scene: import('@babylonjs/core/scene').Scene,
    modelRegistry: Map<string, import('../../core/config').ModelInstance>,
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

    // Reflection Probe 自动刷新 — 每 10 秒检查一次环境变化
    _probeRefreshObserver = scene.onBeforeRenderObservable.add(() => {
        if (!_reflectionProbe || !scene) {
            return;
        }
        const now = performance.now();
        if (now - _lastProbeRefresh < 10000) {
            return;
        }
        _lastProbeRefresh = now;
        try {
            _reflectionProbe!.renderList = scene.meshes.filter(
                (m) =>
                    m.name.includes('sky') ||
                    m.name.includes('env') ||
                    m.name.includes('ground') ||
                    m.name.includes('water')
            );
            // 强制刷新：直接渲染探针 cubeTexture 的 6 个面（语义明确，替代 refreshRate 1→0 双写黑魔法）
            _reflectionProbe!.cubeTexture.render();
        } catch (err) {
            logWarn('renderer', 'ReflectionProbe 自动刷新失败:', err);
        }
    });
}

/** 检查渲染器是否已初始化。外部代码在调用 setRenderState 前可先检查。 */
export function isRendererReady(): boolean {
    return pipeline !== undefined && _scene !== null && _modelRegistry !== null;
}

/** 释放渲染管线及相关资源。在场景销毁时调用。 */
export function disposeRenderer(): void {
    if (_probeRefreshObserver && _scene) {
        _scene.onBeforeRenderObservable.remove(_probeRefreshObserver);
        _probeRefreshObserver = null;
    }
    // HMR 重入时清零时间戳，避免旧值导致下一次 probe refresh 提前触发
    _lastProbeRefresh = 0;
    if (_glowLayer) {
        _glowLayer.dispose();
        _glowLayer = null;
    }
    if (_ssrPipeline) {
        _ssrPipeline.dispose();
        _ssrPipeline = null;
    }
    if (_ssaoPipeline) {
        _ssaoPipeline.dispose();
        _ssaoPipeline = null;
    }
    if (_contactShadowPP) {
        _contactShadowPP.dispose();
        _contactShadowPP = null;
    }
    if (_reflectionProbe) {
        _reflectionProbe.dispose();
        _reflectionProbe = null;
    }
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
        return defaultRenderState();
    }
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
        dofEnabled: pipeline.depthOfFieldEnabled,
        // fStop 0.5~10 → 归一化 0~1（0=无虚化 fStop=10, 1=最大虚化 fStop=0.5）
        dofAperture: pipeline.depthOfField
            ? clamp((10 - pipeline.depthOfField.fStop) / 9.5, 0, 1)
            : 0,
        vignetteEnabled: pipeline.imageProcessing.vignetteEnabled ?? false,
        vignetteDarkness: pipeline.imageProcessing.vignetteWeight ?? 0,
        chromaticAberrationEnabled: pipeline.chromaticAberrationEnabled ?? false,
        chromaticAberrationAmount: pipeline.chromaticAberration
            ? clamp(pipeline.chromaticAberration.aberrationAmount / 8, 0, 1)
            : 0,
        grainEnabled: pipeline.grainEnabled ?? false,
        grainIntensity: pipeline.grain ? clamp(pipeline.grain.intensity / 50, 0, 1) : 0,
        sharpenAmount: pipeline.sharpen ? clamp(pipeline.sharpen.edgeAmount, 0, 1) : 0,
        glowEnabled: _glowLayer !== null && _glowLayer.intensity > 0,
        glowIntensity: _glowLayer ? clamp(_glowLayer.intensity, 0, 1) : 0,
        ssrEnabled: _ssrPipeline !== null && _ssrPipeline.isEnabled,
        ssrStrength: _ssrPipeline ? clamp(_ssrPipeline.strength, 0, 1) : 0,
        ssrFalloff: _ssrPipeline
            ? clamp((_ssrPipeline.reflectionSpecularFalloffExponent - 1) / 7, 0, 1)
            : 0,
        ssrStep: _ssrPipeline ? clamp(_ssrPipeline.step, 1, 32) : 1,
        ssrThickness: _ssrPipeline ? clamp(_ssrPipeline.thickness, 0, 2) : 0.5,
        reflectionProbeEnabled: _reflectionProbe !== null,
        reflectionIntensity: _reflectionProbe ? 1 : 0,
        ssaoEnabled: _ssaoPipeline !== null,
        ssaoStrength: _ssaoPipeline ? clamp(_ssaoPipeline.totalStrength / 2, 0, 1) : 0,
        ssaoRadius: _ssaoPipeline ? clamp(_ssaoPipeline.radius / 4, 0, 1) : 0,
        ssaoSamples: _ssaoPipeline ? clamp(_ssaoPipeline.samples, 4, 32) : 8,
        celShadingMode: _celShadingMode,
    };
}

export function defaultRenderState(): RenderState {
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
        dofEnabled: false,
        dofAperture: 0,
        vignetteEnabled: false,
        vignetteDarkness: 0,
        chromaticAberrationEnabled: false,
        chromaticAberrationAmount: 0,
        grainEnabled: false,
        grainIntensity: 0,
        sharpenAmount: 0,
        glowEnabled: false,
        glowIntensity: 0,
        ssrEnabled: false,
        ssrStrength: 0,
        ssrFalloff: 0,
        ssrStep: 1,
        ssrThickness: 0.5,
        reflectionProbeEnabled: false,
        reflectionIntensity: 0,
        ssaoEnabled: false,
        ssaoStrength: 0,
        ssaoRadius: 0,
        ssaoSamples: 8,
        celShadingMode: false,
    };
}

// ======== 内部状态应用（无自动保存） ========

/**
 * 内部版 setRenderState，不触发自动保存。
 * 供 transitionRenderState 在中间帧调用，避免每帧触发保存 I/O。
 */
function _applyRenderState(s: Partial<RenderState>): void {
    if (!pipeline || !_scene || !_modelRegistry) {
        logWarn('renderer', '_applyRenderState: pipeline/scene 未初始化，状态更新被忽略');
        return;
    }

    // 数值钳制（全部 0-1 归一化范围）
    const w = s.bloomWeight !== undefined ? clamp(s.bloomWeight, 0, 1) : undefined;
    const th = s.bloomThreshold !== undefined ? clamp(s.bloomThreshold, 0, 1) : undefined;
    const k = s.bloomKernel !== undefined ? clamp(s.bloomKernel, 16, 256) : undefined;
    const e = s.exposure !== undefined ? clamp(s.exposure, 0, 4) : undefined;
    const c = s.contrast !== undefined ? clamp(s.contrast, 0, 4) : undefined;
    const da = s.dofAperture !== undefined ? clamp(s.dofAperture, 0, 1) : undefined;
    const vd = s.vignetteDarkness !== undefined ? clamp(s.vignetteDarkness, 0, 1) : undefined;
    const ca =
        s.chromaticAberrationAmount !== undefined
            ? clamp(s.chromaticAberrationAmount, 0, 1)
            : undefined;
    const gi = s.grainIntensity !== undefined ? clamp(s.grainIntensity, 0, 1) : undefined;
    const sa = s.sharpenAmount !== undefined ? clamp(s.sharpenAmount, 0, 1) : undefined;
    const gl = s.glowIntensity !== undefined ? clamp(s.glowIntensity, 0, 1) : undefined;
    const ssrStr = s.ssrStrength !== undefined ? clamp(s.ssrStrength, 0, 1) : undefined;
    const ssrFal = s.ssrFalloff !== undefined ? clamp(s.ssrFalloff, 0, 1) : undefined;
    const ssrStp = s.ssrStep !== undefined ? clamp(s.ssrStep, 1, 32) : undefined;
    const ssrThk = s.ssrThickness !== undefined ? clamp(s.ssrThickness, 0, 2) : undefined;

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
                        clamp01(_outlineColor[0]),
                        clamp01(_outlineColor[1]),
                        clamp01(_outlineColor[2]),
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
        pipeline.depthOfField.fStop = 10 - da * 9.5; // 0→清晰(f10), 1→虚化(f0.5)
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

    // Sharpen
    if (sa !== undefined && pipeline.sharpen) {
        pipeline.sharpenEnabled = sa > 0;
        pipeline.sharpen.edgeAmount = sa;
    }

    // GlowLayer + Bloom 互斥：Bloom weight > 0.5 时自动降低 Glow 强度防止白出
    if (s.glowEnabled !== undefined || gl !== undefined) {
        const targetGlow = gl ?? (_glowLayer ? _glowLayer.intensity : 0);
        const bloomW = s.bloomWeight !== undefined ? s.bloomWeight : (pipeline.bloomWeight ?? 0);
        const adjustedGlow = bloomW > 0.5 ? targetGlow * (1 - (bloomW - 0.5)) : targetGlow;
        if (s.glowEnabled !== undefined) {
            if (s.glowEnabled && !_glowLayer && _scene) {
                _glowLayer = new GlowLayer('glow', _scene, { blurKernelSize: 32 });
                _glowLayer.intensity = adjustedGlow;
            } else if (!s.glowEnabled && _glowLayer) {
                _glowLayer.dispose();
                _glowLayer = null;
            }
        }
        if (_glowLayer && gl !== undefined) {
            _glowLayer.intensity = adjustedGlow;
        }
    }

    // SSR (Screen-Space Reflections) — 独立 pipeline，不走 DefaultRenderingPipeline
    if (
        s.ssrEnabled !== undefined ||
        ssrStr !== undefined ||
        ssrFal !== undefined ||
        ssrStp !== undefined ||
        ssrThk !== undefined
    ) {
        if (s.ssrEnabled !== undefined) {
            const ssrCamera = _pipelineCamera ?? _scene.activeCamera;
            if (s.ssrEnabled && !_ssrPipeline && _scene && ssrCamera) {
                try {
                    _ssrPipeline = new SSRRenderingPipeline('ssr', _scene, [ssrCamera]);
                    _ssrPipeline.maxDistance = 50;
                    _ssrPipeline.step = 1;
                    _ssrPipeline.thickness = 0.5;
                    _ssrPipeline.strength = 1;
                    _ssrPipeline.reflectionSpecularFalloffExponent = 1;
                    _ssrPipeline.samples = 1;
                    _ssrPipeline.isEnabled = true;
                } catch (err) {
                    logWarn('renderer', 'SSR pipeline 创建失败:', err);
                    _ssrPipeline = null;
                }
            } else if (!s.ssrEnabled && _ssrPipeline) {
                _ssrPipeline.dispose();
                _ssrPipeline = null;
            }
        }
        if (_ssrPipeline) {
            if (ssrStr !== undefined) {
                _ssrPipeline.strength = ssrStr;
            }
            if (ssrFal !== undefined) {
                _ssrPipeline.reflectionSpecularFalloffExponent = 1 + ssrFal * 7;
            } // 0→1, 1→8
            if (ssrStp !== undefined) {
                _ssrPipeline.step = Math.round(ssrStp);
            }
            if (ssrThk !== undefined) {
                _ssrPipeline.thickness = ssrThk;
            }
            // SSR + Bloom 互斥：Bloom weight > 0.5 时自动降低 SSR 强度防止白出
            // 基于当前 pipeline 强度（已更新）而非传入值，避免覆盖用户设置
            const bloomW = pipeline.bloomWeight ?? 0;
            if (bloomW > 0.5) {
                _ssrPipeline.strength *= 1 - (bloomW - 0.5);
            }
        }
    }

    // Reflection Probe — 环境反射
    if (s.reflectionProbeEnabled !== undefined || s.reflectionIntensity !== undefined) {
        if (s.reflectionProbeEnabled !== undefined) {
            if (s.reflectionProbeEnabled && !_reflectionProbe && _scene) {
                try {
                    _reflectionProbe = new ReflectionProbe('envProbe', 256, _scene);
                    _reflectionProbe.renderList = _scene.meshes.filter(
                        (m) =>
                            m.name.includes('sky') ||
                            m.name.includes('env') ||
                            m.name.includes('ground') ||
                            m.name.includes('water')
                    );
                    _reflectionProbe.refreshRate = 0; // 静态环境，仅渲染一次
                } catch (err) {
                    logWarn('renderer', 'ReflectionProbe 创建失败:', err);
                    _reflectionProbe = null;
                }
            } else if (!s.reflectionProbeEnabled && _reflectionProbe) {
                // 清除所有模型材质的 reflectionTexture
                if (_modelRegistry) {
                    for (const inst of _modelRegistry.values()) {
                        for (const mesh of inst.meshes) {
                            const m = mesh.material;
                            if (m && 'reflectionTexture' in m) {
                                (m as { reflectionTexture: unknown }).reflectionTexture = null;
                            }
                        }
                    }
                }
                _reflectionProbe.dispose();
                _reflectionProbe = null;
            }
        }
        // 绑定反射探针到模型材质
        if (_reflectionProbe && s.reflectionProbeEnabled) {
            const rt = _reflectionProbe.cubeTexture;
            if (rt && _modelRegistry) {
                for (const inst of _modelRegistry.values()) {
                    for (const mesh of inst.meshes) {
                        const m = mesh.material;
                        if (m && 'reflectionTexture' in m) {
                            (
                                m as {
                                    reflectionTexture: import('@babylonjs/core/Materials/Textures/texture').Texture;
                                }
                            ).reflectionTexture = rt;
                            // 设置反射强度
                            if (s.reflectionIntensity !== undefined && 'reflectionColor' in m) {
                                const intensity = s.reflectionIntensity;
                                (
                                    m as {
                                        reflectionColor: import('@babylonjs/core/Maths/math.color').Color3;
                                    }
                                ).reflectionColor.set(intensity, intensity, intensity);
                            }
                        }
                    }
                }
            }
        }
    }

    // SSAO (Screen-Space Ambient Occlusion) — 独立 pipeline
    if (
        s.ssaoEnabled !== undefined ||
        s.ssaoStrength !== undefined ||
        s.ssaoRadius !== undefined ||
        s.ssaoSamples !== undefined
    ) {
        if (s.ssaoEnabled !== undefined) {
            const ssaoCamera = _pipelineCamera ?? _scene.activeCamera;
            if (s.ssaoEnabled && !_ssaoPipeline && _scene && ssaoCamera) {
                try {
                    _ssaoPipeline = new SSAO2RenderingPipeline('ssao', _scene, 0.5, [ssaoCamera]);
                    _ssaoPipeline.totalStrength = 1.0;
                    _ssaoPipeline.radius = 2.0;
                    _ssaoPipeline.samples = 8;
                    _ssaoPipeline.epsilon = 0.02;
                    _ssaoPipeline.expensiveBlur = true;
                    _ssaoPipeline.bilateralSamples = 16;
                    _ssaoPipeline.bilateralSoften = 0.5;
                } catch (err) {
                    logWarn('renderer', 'SSAO pipeline 创建失败:', err);
                    _ssaoPipeline = null;
                }
            } else if (!s.ssaoEnabled && _ssaoPipeline) {
                _ssaoPipeline.dispose();
                _ssaoPipeline = null;
            }
        }
        if (_ssaoPipeline) {
            if (s.ssaoStrength !== undefined) {
                _ssaoPipeline.totalStrength = clamp(s.ssaoStrength * 2, 0, 2);
            }
            if (s.ssaoRadius !== undefined) {
                _ssaoPipeline.radius = clamp(s.ssaoRadius * 4, 0, 4);
            }
            if (s.ssaoSamples !== undefined) {
                _ssaoPipeline.samples = Math.round(clamp(s.ssaoSamples, 4, 32));
            }
        }
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

    // 卡通化渲染预设：快照/恢复
    if (s.celShadingMode !== undefined) {
        if (s.celShadingMode) {
            // 保存当前状态 → 切换到预设
            _originalRenderState = getRenderState();
            _celShadingMode = true;
            _applyRenderState({
                exposure: 0.7,
                contrast: 1.4,
                toneMapping: ToneMappingMode.ACES,
                bloomEnabled: true,
                bloomWeight: 0.25,
                fxaaEnabled: true,
            });
        } else {
            // 恢复到快照状态
            _celShadingMode = false;
            if (_originalRenderState) {
                _applyRenderState(_originalRenderState);
            }
        }
    }
}

// ======== ADR-114 Phase 3: 接触阴影（屏幕空间 ray marching 后处理）========

/**
 * 接触阴影后处理：从每个像素出发，沿方向光反向在屏幕空间做有限步长 ray marching，
 * 检查深度缓冲是否有遮挡物，填补方向光阴影贴图分辨率不足导致的「悬浮感」。
 *
 * 约束：
 * - 仅在 groundContactShadowEnabled 且 groundReflectionQuality ≥ medium 时启用
 * - 输出与方向光阴影相乘（darken 现有颜色）
 * - 16 步 ray marching + 深度采样，性能预算 <3% FPS
 */
// 注册接触阴影 fragment shader
Effect.ShadersStore['contactShadowFragmentShader'] = `
uniform sampler2D depthSampler;
uniform vec2 resolution;
uniform vec3 lightDirVS;      // 视图空间光线方向（方向光反向）
uniform float shadowDistance; // 光线步进最大距离（视图空间）
uniform float intensity;      // 阴影强度 0-1
uniform float nearZ;
uniform float farZ;

varying vec2 vUV;

// 非线性深度 → 线性深度（视图空间 z 正值）
float linearizeDepth(float d) {
    return (2.0 * nearZ * farZ) / (farZ + nearZ - (2.0 * d - 1.0) * (farZ - nearZ));
}

// 屏幕空间 UV → 视图空间位置
vec3 viewPosFromDepth(vec2 uv, float depth) {
    float z = linearizeDepth(depth);
    vec2 ndc = uv * 2.0 - 1.0;
    // 假设透视投影：x/y 由 ndc 与 z 恢复（~45° fov 兜底）
    float tanHalfFov = tan(0.5 * 0.785398);
    float aspect = resolution.x / resolution.y;
    vec3 pos;
    pos.x = ndc.x * z * tanHalfFov * aspect;
    pos.y = ndc.y * z * tanHalfFov;
    pos.z = -z;
    return pos;
}

float contactShadow(vec2 uv, float depth) {
    vec3 viewPos = viewPosFromDepth(uv, depth);

    // 光线步进方向与步长
    float stepLen = shadowDistance / 16.0;
    vec3 rayStep = normalize(lightDirVS) * stepLen;
    vec3 rayPos = viewPos;
    float shadow = 0.0;
    float aspect = resolution.x / resolution.y;
    float tanHalfFov = tan(0.5 * 0.785398);

    for (int i = 0; i < 16; i++) {
        rayPos += rayStep;
        // 投影回屏幕空间（透视投影）
        vec2 screenUV = vec2(
            (rayPos.x / -rayPos.z) / (tanHalfFov * aspect) * 0.5 + 0.5,
            (rayPos.y / -rayPos.z) / tanHalfFov * 0.5 + 0.5
        );

        if (screenUV.x < 0.0 || screenUV.x > 1.0 ||
            screenUV.y < 0.0 || screenUV.y > 1.0) break;

        float sampleDepth = texture2D(depthSampler, screenUV).r;
        float rayDepth = -rayPos.z;
        float sampleDepthLinear = linearizeDepth(sampleDepth);

        // 采样深度比光线深度小（更靠近相机），且差值在范围内 → 被遮挡
        float diff = rayDepth - sampleDepthLinear;
        if (diff > 0.0 && diff < shadowDistance) {
            shadow += 1.0 / 16.0;
        }
    }
    return 1.0 - shadow * intensity;
}

void main(void) {
    vec4 baseColor = texture2D(textureSampler, vUV);
    float depth = texture2D(depthSampler, vUV).r;
    float shadow = contactShadow(vUV, depth);
    // 阴影因子 darken 现有颜色
    gl_FragColor = vec4(baseColor.rgb * shadow, baseColor.a);
}
`;

/**
 * 应用接触阴影后处理（由 env-bridge 转发 envState 变化调用）。
 * - enabled 且质量 ≥ medium：创建/更新 PostProcess
 * - 否则：销毁 PostProcess
 */
export function setContactShadow(state: EnvState): void {
    if (!_scene) {
        return;
    }

    // 中/高质量守卫：low/off 时自动关闭
    const qualityOk = state.groundReflectionQuality === 'medium' || state.groundReflectionQuality === 'high';
    const shouldEnable = state.groundContactShadowEnabled && qualityOk;

    if (shouldEnable) {
        const camera = _pipelineCamera ?? _scene.activeCamera;
        if (!camera) {
            logWarn('renderer', 'setContactShadow: 无可用相机，跳过创建');
            return;
        }

        if (!_contactShadowPP) {
            // 创建 PostProcess
            try {
                _contactShadowPP = new PostProcess(
                    'contactShadow',
                    'contactShadow', // shader name
                    ['resolution', 'lightDirVS', 'shadowDistance', 'intensity', 'nearZ', 'farZ'],
                    ['depthSampler'],
                    1.0, // scaling
                    null, // sampler
                    0, // texture type
                    _scene.getEngine()
                );
                _contactShadowPP.onApplyObservable.add((effect) => {
                    effect.setTexture('depthSampler', _scene!.enableDepthRenderer(_scene!.activeCamera).getDepthMap());
                    effect.setVector2('resolution', { x: _scene!.getEngine().getRenderWidth(), y: _scene!.getEngine().getRenderHeight() } as any);
                    // 方向光反向作为光线方向；转换到视图空间
                    const lightDir = dirLight ? dirLight.direction : { x: 0, y: -1, z: 0 };
                    // 方向光 direction 是世界空间，需转到视图空间
                    const viewMat = camera.getViewMatrix();
                    // 简化：用方向光方向的视图空间表示
                    const lx = lightDir.x, ly = lightDir.y, lz = lightDir.z;
                    // 视图空间 = viewMatrix * worldDir（仅方向，忽略平移）
                    const vlx = viewMat.m[0] * lx + viewMat.m[4] * ly + viewMat.m[8] * lz;
                    const vly = viewMat.m[1] * lx + viewMat.m[5] * ly + viewMat.m[9] * lz;
                    const vlz = viewMat.m[2] * lx + viewMat.m[6] * ly + viewMat.m[10] * lz;
                    effect.setVector3('lightDirVS', { x: vlx, y: vly, z: vlz } as any);
                    effect.setFloat('shadowDistance', state.groundContactShadowDistance);
                    effect.setFloat('intensity', state.groundContactShadowIntensity);
                    effect.setFloat('nearZ', camera.minZ);
                    effect.setFloat('farZ', camera.maxZ);
                });
                camera.attachPostProcess(_contactShadowPP);
            } catch (err) {
                logWarn('renderer', 'ContactShadow PostProcess 创建失败:', err);
                _contactShadowPP = null;
            }
        } else {
            // 更新参数
            _contactShadowPP.onApplyObservable.clear();
            _contactShadowPP.onApplyObservable.add((effect) => {
                effect.setTexture('depthSampler', _scene!.enableDepthRenderer(_scene!.activeCamera).getDepthMap());
                effect.setVector2('resolution', { x: _scene!.getEngine().getRenderWidth(), y: _scene!.getEngine().getRenderHeight() } as any);
                const lightDir = dirLight ? dirLight.direction : { x: 0, y: -1, z: 0 };
                const viewMat = camera.getViewMatrix();
                const lx = lightDir.x, ly = lightDir.y, lz = lightDir.z;
                const vlx = viewMat.m[0] * lx + viewMat.m[4] * ly + viewMat.m[8] * lz;
                const vly = viewMat.m[1] * lx + viewMat.m[5] * ly + viewMat.m[9] * lz;
                const vlz = viewMat.m[2] * lx + viewMat.m[6] * ly + viewMat.m[10] * lz;
                effect.setVector3('lightDirVS', { x: vlx, y: vly, z: vlz } as any);
                effect.setFloat('shadowDistance', state.groundContactShadowDistance);
                effect.setFloat('intensity', state.groundContactShadowIntensity);
                effect.setFloat('nearZ', camera.minZ);
                effect.setFloat('farZ', camera.maxZ);
            });
        }
    } else {
        // 销毁
        if (_contactShadowPP) {
            const cam = _pipelineCamera ?? _scene.activeCamera;
            if (cam) {
                cam.detachPostProcess(_contactShadowPP);
            }
            _contactShadowPP.dispose();
            _contactShadowPP = null;
        }
    }
}

// ======== 对外状态设置（含自动保存） ========

export function setRenderState(s: Partial<RenderState>): void {
    if (!pipeline || !_scene || !_modelRegistry || !_triggerAutoSave) {
        logWarn('renderer', 'setRenderState: pipeline/scene 未初始化，状态更新被忽略');
        return;
    }

    _applyRenderState(s);

    _triggerAutoSave();
    scheduleRefresh();
    // 用户手动修改渲染设置：清除自动降级快照，避免 auto 模式后续降级覆盖用户意图。
    // applyDegrade 触发的 setRenderState 通过 _suppressSnapshotReset 跳过，防止降级→恢复→再降级循环。
    if (!isSnapshotResetSuppressed()) {
        resetPerformanceSnapshot();
    }
}

// ======== 平滑过渡 ========

/** 取消当前渲染过渡动画（若有）。 */
function _cancelRenderTransition(): void {
    if (_renderTransitionObserver && _scene) {
        _scene.onBeforeRenderObservable.remove(_renderTransitionObserver);
        _renderTransitionObserver = null;
    }
}

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

    // 取消上一次过渡动画，避免多个动画循环互相覆盖
    _cancelRenderTransition();

    const source = getRenderState();
    const startTime = performance.now();

    // 数值字段列表（需要 lerp）
    const numericKeys: (keyof RenderState)[] = [
        'bloomWeight',
        'bloomThreshold',
        'bloomKernel',
        'exposure',
        'contrast',
        'dofAperture',
        'vignetteDarkness',
        'chromaticAberrationAmount',
        'grainIntensity',
        'sharpenAmount',
        'glowIntensity',
        'ssrStrength',
        'ssrFalloff',
        'ssrStep',
        'ssrThickness',
        'reflectionIntensity',
        'ssaoStrength',
        'ssaoRadius',
        'ssaoSamples',
    ];
    // 颜色字段列表（逐通道 lerp）
    const colorKeys: (keyof RenderState)[] = ['outlineColor'];
    // 布尔字段列表（按阈值提前启用/禁用以减少视觉跳跃）
    const boolKeys: (keyof RenderState)[] = [
        'bloomEnabled',
        'outlineEnabled',
        'fxaaEnabled',
        'dofEnabled',
        'vignetteEnabled',
        'chromaticAberrationEnabled',
        'grainEnabled',
        'glowEnabled',
        'ssrEnabled',
        'reflectionProbeEnabled',
        'ssaoEnabled',
        'celShadingMode',
    ];
    // 枚举字段（动画结束时切换）
    const enumKeys: (keyof RenderState)[] = ['toneMapping'];

    // lerp / lerpArray 已收敛至 @/core/utils

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
            if (key === 'glowEnabled') {
                return t >= 0.3;
            }
            if (key === 'ssrEnabled' || key === 'reflectionProbeEnabled' || key === 'ssaoEnabled') {
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
                setKey(interp, key, lerpArray(a, b, t) as RenderState[typeof key]);
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
                setKey(
                    interp,
                    key,
                    (t >= 1 ? target[key] : source[key]) as RenderState[typeof key]
                );
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
        }
    };

    _renderTransitionObserver = _scene.onBeforeRenderObservable.addOnce(animLoop);
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
        // SSR pipeline 也需要重新挂接相机
        if (_ssrPipeline) {
            try {
                _ssrPipeline.dispose();
                _ssrPipeline = null;
                // 下次 _applyRenderState 时会重建
            } catch {
                // Intentionally empty — SSR pipeline dispose 失败不影响主流程
            }
        }
        // SSAO pipeline 也需要重新挂接相机
        if (_ssaoPipeline) {
            try {
                _ssaoPipeline.dispose();
                _ssaoPipeline = null;
                // 下次 _applyRenderState 时会重建
            } catch {
                // Intentionally empty — SSAO pipeline dispose 失败不影响主流程
            }
        }
    }
}

// ======== 边缘高亮重建 ========

/** 当环境变化时（天空/地面/水面切换），刷新 Reflection Probe 的 renderList。 */
export function refreshReflectionProbe(): void {
    if (!_reflectionProbe || !_scene) {
        return;
    }
    _reflectionProbe.renderList = _scene.meshes.filter(
        (m) =>
            m.name.includes('sky') ||
            m.name.includes('env') ||
            m.name.includes('ground') ||
            m.name.includes('water')
    );
    // 强制刷新：临时设置 refreshRate 为 1 触发重新渲染
    _reflectionProbe.refreshRate = 1;
    _reflectionProbe.refreshRate = 0;
}

/** 将 Reflection Probe 绑定到指定模型的所有材质（模型加载后调用）。 */
export function bindReflectionProbeToModel(
    meshes: import('@babylonjs/core/Meshes/mesh').Mesh[]
): void {
    if (!_reflectionProbe) {
        return;
    }
    const rt = _reflectionProbe.cubeTexture;
    if (!rt) {
        return;
    }
    for (const mesh of meshes) {
        const m = mesh.material;
        if (m && 'reflectionTexture' in m) {
            (
                m as {
                    reflectionTexture: import('@babylonjs/core/Materials/Textures/texture').Texture;
                }
            ).reflectionTexture = rt;
        }
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
                        clamp01(_outlineColor[0]),
                        clamp01(_outlineColor[1]),
                        clamp01(_outlineColor[2]),
                        1
                    );
                }
            } else {
                m.disableEdgesRendering();
            }
        }
    }
}
