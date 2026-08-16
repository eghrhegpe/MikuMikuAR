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
// ADR-151: ReflectionProbe 已迁移至 env-reflection.ts 统一管理
// [audit:round17 P4] observeOnce 已无调用点（P1 修复后 :889 全部改用 observe）
import { observe, type ObserverHandle } from '@/core/observer-handle';
import { safeDispose } from '@/core/dispose-helpers';
import { scheduleRefresh } from '@/core/reactivity';
import { resetPerformanceSnapshot, isSnapshotResetSuppressed } from './performance';
import { clamp, clamp01, lerp, lerpArray } from '@/core/clamp';
import { setKey } from '@/core/set-key';
import { logWarn } from '@/core/logger';
import { clearTextureLRU } from '../shared/texture-lru';

// ======== Tone Mapping Modes ========

// 对齐 Babylon ImageProcessingConfiguration.toneMappingType 官方枚举：
// 0=STANDARD 1=ACES 2=KHR_PBR_NEUTRAL（官方仅此 3 值，无 Reinhard/Cineon）
export const ToneMappingMode = {
    OFF: 0,
    ACES: 1,
    NEUTRAL: 2,
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
    toneMapping: number; // 0=OFF(标准) 1=ACES 2=Neutral(KHR PBR)，官方仅 0-2
    exposure: number; // 0-4, default 1
    contrast: number; // 0-4, default 1
    // Phase 8 — DOF + Vignette
    dofEnabled: boolean;
    dofAperture: number; // 0-1, default 0（内部映射到 fStop 0.5~10）
    dofFocusDistance: number; // 对焦距离（场景单位，默认 22 ≈ 模型距离）
    dofFocalLength: number; // 焦距（mm，默认 50）
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
    // Phase 11 — SSAO（ADR-151 收口：SSR/反射探针已迁至 env-reflection.ts，由 reflectionMode/reflectionQuality 统一控制）
    ssaoEnabled: boolean;
    ssaoStrength: number; // 0-1, default 0（SSAO2RenderingPipeline.totalStrength 0~2）
    ssaoRadius: number; // 0-1, default 0（SSAO2RenderingPipeline.radius 0~4）
    ssaoSamples: number; // 4-32, default 8（SSAO2RenderingPipeline.samples）
    // Phase 12 — 卡通化渲染预设（后处理风格化）
    celShadingMode: boolean;
    // Phase 12 — 真 cel-shading 后处理参数（posterize + Sobel，挂管线末尾）
    celColorLevels: number; // 色阶量化级数 2-8, default 4
    celEdgeThreshold: number; // Sobel 边缘灵敏度 0-1, default 0.2
    celEdgeStrength: number; // 边缘描边强度 0-1, default 0.6
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
// ADR-151: ReflectionProbe 已迁移至 env-reflection.ts
// 卡通化渲染预设状态
let _celShadingMode = false;
let _originalRenderState: RenderState | null = null;
// ADR-076 方向 2：真 cel-shading 后处理（posterize + Sobel）状态
let _celPP: PostProcess | null = null;
let _celHandle: ObserverHandle | null = null;
let _celColorLevels = 4;
let _celEdgeThreshold = 0.2;
let _celEdgeStrength = 0.6;

// cel 激活时强制地面哑光（关 PBR 镜面），避免「cel 角色踩镜面地板」割裂。
// 通过注册回调解耦（renderer 不反向依赖 env-bridge，避免循环依赖）。
type CelGroundCoupling = (celActive: boolean) => void;
let _celGroundCoupling: CelGroundCoupling | null = null;
export function registerCelGroundCoupling(fn: CelGroundCoupling): void {
    _celGroundCoupling = fn;
}
/** 当前渲染过渡动画 observer（用于去重） */
let _renderTransitionObserver: ObserverHandle | null = null;

// ======== 初始化与释放 ========

export function initRenderer(
    scene: import('@babylonjs/core/scene').Scene,
    modelRegistry: Map<string, import('../../core/config').ModelInstance>,
    triggerAutoSave: () => void
): void {
    _scene = scene;
    _modelRegistry = modelRegistry;
    _triggerAutoSave = triggerAutoSave;

    // [audit:round13 P3] activeCamera 可能为 null（防御）：DefaultRenderingPipeline
    // cameras 参数可选，无 activeCamera 时传空数组，避免 `scene.activeCamera!` 断言抛错
    const activeCam = scene.activeCamera;
    pipeline = new DefaultRenderingPipeline(
        'default',
        true,
        scene,
        activeCam ? [activeCam] : []
    );
    pipeline.samples = 1; // MSAA off (performance)
    pipeline.fxaaEnabled = false;
    pipeline.bloomEnabled = false;
    pipeline.imageProcessingEnabled = true;

    // ADR-151: ReflectionProbe 自动刷新已迁移至 env-reflection.ts
}

/** 检查渲染器是否已初始化。外部代码在调用 setRenderState 前可先检查。 */
export function isRendererReady(): boolean {
    return pipeline !== undefined && _scene !== null && _modelRegistry !== null;
}

/** 释放渲染管线及相关资源。在场景销毁时调用。 */
export function disposeRenderer(): void {
    // [audit:round13 P3] try/finally 异常隔离：任一 dispose 抛错不中断后续级联释放，
    // 且模块状态复位（_scene=null 等）在 finally 中必达，避免 HMR 重入时残留陈旧引用。
    try {
        // ADR-151: ReflectionProbe 已迁移至 env-reflection.ts，由 disposeReflection() 释放
        _glowLayer = safeDispose(_glowLayer);
        _ssrPipeline = safeDispose(_ssrPipeline);
        _ssaoPipeline = safeDispose(_ssaoPipeline);
        if (_celPP) {
            _celPP = safeDispose(_celPP);
            _celHandle = null;
        }
        if (pipeline) {
            pipeline.dispose();
            pipeline = undefined;
        }
        // [doc:adr-189] Phase 1.3: 清空纹理 LRU 缓存，释放 ArrayBuffer 避免泄漏
        clearTextureLRU();
    } catch (err) {
        console.warn('[renderer] disposeRenderer 部分资源释放失败（继续复位状态）:', err);
    } finally {
        _scene = null;
        _modelRegistry = null;
        _triggerAutoSave = null;
        _pipelineCamera = null;
        _outlineEnabled = false;
        _outlineColor = [0, 0, 0];
        // P2-fix: 补全 cel 状态与渲染过渡的释放，避免 HMR 重入时残留
        _cancelRenderTransition();
        _originalRenderState = null;
        _celGroundCoupling = null;
        _celShadingMode = false;
        _celColorLevels = 4;
        _celEdgeThreshold = 0.2;
        _celEdgeStrength = 0.6;
    }
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
        // 防御性拷贝：返回全新数组，避免调用方修改返回值时污染模块级 _outlineColor 状态
        // （此前直接返回 _outlineColor 引用，与 defaultRenderState() 返回全新数组不一致）
        outlineColor: [..._outlineColor],
        fxaaEnabled: pipeline.fxaaEnabled,
        msaaSamples: pipeline.samples ?? 1,
        toneMapping: clamp(pipeline.imageProcessing.toneMappingType ?? 0, 0, 2),
        exposure: pipeline.imageProcessing.exposure ?? 1,
        contrast: pipeline.imageProcessing.contrast ?? 1,
        dofEnabled: pipeline.depthOfFieldEnabled,
        // fStop 0.5~10 → 归一化 0~1（0=无虚化 fStop=10, 1=最大虚化 fStop=0.5）
        dofAperture: pipeline.depthOfField
            ? clamp((10 - pipeline.depthOfField.fStop) / 9.5, 0, 1)
            : 0,
        dofFocusDistance: pipeline.depthOfField ? pipeline.depthOfField.focusDistance : 22,
        dofFocalLength: pipeline.depthOfField ? pipeline.depthOfField.focalLength : 50,
        vignetteEnabled: pipeline.imageProcessing.vignetteEnabled ?? false,
        // 官方默认 vignetteWeight=1.5，归一化 0~1.5 → 0~1
        vignetteDarkness: clamp((pipeline.imageProcessing.vignetteWeight ?? 0) / 1.5, 0, 1),
        chromaticAberrationEnabled: pipeline.chromaticAberrationEnabled ?? false,
        chromaticAberrationAmount: pipeline.chromaticAberration
            ? clamp(pipeline.chromaticAberration.aberrationAmount / 30, 0, 1)
            : 0,
        grainEnabled: pipeline.grainEnabled ?? false,
        grainIntensity: pipeline.grain ? clamp(pipeline.grain.intensity / 50, 0, 1) : 0,
        sharpenAmount: pipeline.sharpen ? clamp(pipeline.sharpen.edgeAmount, 0, 1) : 0,
        glowEnabled: _glowLayer !== null,
        glowIntensity: _glowLayer ? clamp(_glowLayer.intensity, 0, 1) : 0,
        ssaoEnabled: _ssaoPipeline !== null,
        ssaoStrength: _ssaoPipeline ? clamp(_ssaoPipeline.totalStrength / 2, 0, 1) : 0,
        ssaoRadius: _ssaoPipeline ? clamp(_ssaoPipeline.radius / 4, 0, 1) : 0,
        ssaoSamples: _ssaoPipeline ? clamp(_ssaoPipeline.samples, 4, 32) : 8,
        celShadingMode: _celShadingMode,
        celColorLevels: _celColorLevels,
        celEdgeThreshold: _celEdgeThreshold,
        celEdgeStrength: _celEdgeStrength,
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
        dofFocusDistance: 22,
        dofFocalLength: 50,
        vignetteEnabled: false,
        vignetteDarkness: 0,
        chromaticAberrationEnabled: false,
        chromaticAberrationAmount: 0,
        grainEnabled: false,
        grainIntensity: 0,
        sharpenAmount: 0,
        glowEnabled: false,
        glowIntensity: 0,
        ssaoEnabled: false,
        ssaoStrength: 0,
        ssaoRadius: 0,
        ssaoSamples: 8,
        celShadingMode: false,
        celColorLevels: 4,
        celEdgeThreshold: 0.2,
        celEdgeStrength: 0.6,
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

    // [doc:adr-076-rev1] 动态快照同步：卡通化开启期间，用户手动调 6 个卡通管控字段时
    // (s.celShadingMode === undefined 排除开关自身的预设应用调用)，
    // 实时同步到 _originalRenderState，关闭时恢复的就是用户调过的最新意图，
    // 而非开启前的旧快照。修掉原限制 #3「手动调参被丢弃」。
    if (_celShadingMode && s.celShadingMode === undefined && _originalRenderState) {
        if (s.exposure !== undefined) {
            _originalRenderState.exposure = s.exposure;
        }
        if (s.contrast !== undefined) {
            _originalRenderState.contrast = s.contrast;
        }
        if (s.toneMapping !== undefined) {
            _originalRenderState.toneMapping = s.toneMapping;
        }
        if (s.bloomEnabled !== undefined) {
            _originalRenderState.bloomEnabled = s.bloomEnabled;
        }
        if (s.bloomWeight !== undefined) {
            _originalRenderState.bloomWeight = s.bloomWeight;
        }
        if (s.fxaaEnabled !== undefined) {
            _originalRenderState.fxaaEnabled = s.fxaaEnabled;
        }
    }

    // 数值钳制（全部 0-1 归一化范围）
    const w = s.bloomWeight !== undefined ? clamp(s.bloomWeight, 0, 1) : undefined;
    const th = s.bloomThreshold !== undefined ? clamp(s.bloomThreshold, 0, 1) : undefined;
    const k = s.bloomKernel !== undefined ? clamp(s.bloomKernel, 16, 256) : undefined;
    const e = s.exposure !== undefined ? clamp(s.exposure, 0, 4) : undefined;
    const c = s.contrast !== undefined ? clamp(s.contrast, 0, 4) : undefined;
    const da = s.dofAperture !== undefined ? clamp(s.dofAperture, 0, 1) : undefined;
    const dfd = s.dofFocusDistance !== undefined ? clamp(s.dofFocusDistance, 1, 300) : undefined;
    const dfl = s.dofFocalLength !== undefined ? clamp(s.dofFocalLength, 20, 200) : undefined;
    const vd = s.vignetteDarkness !== undefined ? clamp(s.vignetteDarkness, 0, 1) : undefined;
    const ca =
        s.chromaticAberrationAmount !== undefined
            ? clamp(s.chromaticAberrationAmount, 0, 1)
            : undefined;
    const gi = s.grainIntensity !== undefined ? clamp(s.grainIntensity, 0, 1) : undefined;
    const sa = s.sharpenAmount !== undefined ? clamp(s.sharpenAmount, 0, 1) : undefined;
    const gl = s.glowIntensity !== undefined ? clamp(s.glowIntensity, 0, 1) : undefined;
    const cl = s.celColorLevels !== undefined ? clamp(s.celColorLevels, 2, 8) : undefined;
    const cet = s.celEdgeThreshold !== undefined ? clamp(s.celEdgeThreshold, 0, 1) : undefined;
    const ces = s.celEdgeStrength !== undefined ? clamp(s.celEdgeStrength, 0, 1) : undefined;

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

    // Outline — 仅在状态/颜色实际变化时重建（复用 rebuildOutlineState，避免重复遍历逻辑）
    const outlineChanged = s.outlineEnabled !== undefined;
    const outlineColorChanged = s.outlineColor !== undefined;

    if (outlineChanged) {
        _outlineEnabled = s.outlineEnabled!;
    }
    if (outlineColorChanged) {
        _outlineColor = s.outlineColor;
    }
    if (outlineChanged || outlineColorChanged) {
        // _outlineEnabled/_outlineColor 已更新为新值，rebuildOutlineState 应用完整当前状态
        rebuildOutlineState();
    }

    // DOF — 可选链保护（0-1 → fStop 0.5~10）
    if (s.dofEnabled !== undefined) {
        pipeline.depthOfFieldEnabled = s.dofEnabled;
    }
    if (da !== undefined && pipeline.depthOfField) {
        pipeline.depthOfField.fStop = 10 - da * 9.5; // 0→清晰(f10), 1→虚化(f0.5)
    }
    // 对焦距离 / 焦距 — 直接写入 DepthOfFieldEffect（场景单位 / mm）
    if (dfd !== undefined && pipeline.depthOfField) {
        pipeline.depthOfField.focusDistance = dfd;
    }
    if (dfl !== undefined && pipeline.depthOfField) {
        pipeline.depthOfField.focalLength = dfl;
    }

    // Vignette
    if (s.vignetteEnabled !== undefined && pipeline.imageProcessing) {
        pipeline.imageProcessing.vignetteEnabled = s.vignetteEnabled;
    }
    if (vd !== undefined && pipeline.imageProcessing) {
        pipeline.imageProcessing.vignetteWeight = vd * 1.5;
    }

    // Chromatic Aberration（0-1 → 0~30，对齐官方默认 aberrationAmount=30）
    if (s.chromaticAberrationEnabled !== undefined) {
        pipeline.chromaticAberrationEnabled = s.chromaticAberrationEnabled;
    }
    if (ca !== undefined && pipeline.chromaticAberration) {
        pipeline.chromaticAberration.aberrationAmount = ca * 30;
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
                _glowLayer = safeDispose(_glowLayer);
            }
        }
        if (_glowLayer && gl !== undefined) {
            _glowLayer.intensity = adjustedGlow;
        }
    }

    // ADR-151 收口：SSR + 反射探针已迁至 env-reflection.ts 统一管理（setSSRFromReflection）。
    // render 状态不再持有反射字段；旧存档的反射设置由 env.reflectionMode/reflectionQuality 恢复。

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
                _ssaoPipeline = safeDispose(_ssaoPipeline);
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
            pipeline.imageProcessing.toneMappingType = clamp(s.toneMapping, 0, 2);
        }
        if (e !== undefined) {
            pipeline.imageProcessing.exposure = e;
        }
        if (c !== undefined) {
            pipeline.imageProcessing.contrast = c;
        }
    }

    // 真 cel-shading 参数（posterize/Sobel）：模块变量由 cel PP onApply handler 读取。
    // 无条件更新（UI 仅在 cel 激活时暴露滑块；过渡中间帧亦会更新，PP 创建时即取最新值）。
    if (cl !== undefined) {
        _celColorLevels = cl;
    }
    if (cet !== undefined) {
        _celEdgeThreshold = cet;
    }
    if (ces !== undefined) {
        _celEdgeStrength = ces;
    }

    // 卡通化渲染预设：快照/恢复
    if (s.celShadingMode !== undefined) {
        // [audit:round13 P2] 幂等守卫：已处于 cel 模式时重复收到 celShadingMode:true 是
        // 真正的 no-op（不覆盖 _originalRenderState 也不误关 cel）；只有显式 false 才走关闭分支。
        if (s.celShadingMode && !_celShadingMode) {
            // 保存当前状态 → 切换到预设
            _originalRenderState = getRenderState();
            _celShadingMode = true;
            // [doc:adr-076] 修复缺口#1：尊重调用方已提供的字段（如保存的 cel 预设携带自定义
            // exposure/contrast 等），仅对未提供的字段回填默认 cel 观感。否则保存的 cel 观感
            // 会被硬编码覆盖，无法忠实还原（违反预设系统"保存当前观感→精确还原"契约）。
            _applyRenderState({
                exposure: s.exposure ?? 0.7,
                contrast: s.contrast ?? 1.4,
                toneMapping: s.toneMapping ?? ToneMappingMode.ACES,
                bloomEnabled: s.bloomEnabled ?? true,
                bloomWeight: s.bloomWeight ?? 0.25,
                fxaaEnabled: s.fxaaEnabled ?? true,
            });
            // 真 cel-shading：开启时创建并挂接 cel 后处理（posterize + Sobel）
            _ensureCelPostProcess(true);
            // cel 激活：强制地面哑光（关 PBR 镜面），消除与 PBR 镜面地板的视觉割裂
            try {
                _celGroundCoupling?.(true);
            } catch (e) {
                logWarn('renderer', 'celGroundCoupling(on) 失败:', e);
            }
        } else if (!s.celShadingMode && _celShadingMode) {
            // 恢复到快照状态
            _celShadingMode = false;
            // cel 关闭：恢复地面 PBR 到 cel 开启前状态
            try {
                _celGroundCoupling?.(false);
            } catch (e) {
                logWarn('renderer', 'celGroundCoupling(off) 失败:', e);
            }
            // 真 cel-shading：关闭时销毁 cel 后处理
            _ensureCelPostProcess(false);
            if (_originalRenderState) {
                // 先清空快照引用，并从快照中剥离 celShadingMode 字段后再递归：
                // 快照里的 celShadingMode===false 会再次进入本分支 (s.celShadingMode !== undefined)，
                // 而 _originalRenderState 仍非空 → 无限递归 → 栈溢出 → setRenderState 抛错、
                // _triggerAutoSave/scheduleRefresh 不执行，UI 显示与 pipeline 实际值脱节，
                // 表现为「色调映射之类的菜单被重置为默认值」。
                const snapshot = _originalRenderState;
                _originalRenderState = null;
                const { celShadingMode: _ignored, ...rest } = snapshot;
                _applyRenderState(rest);
            }
        }
        // 其余组合（已激活 + true / 未激活 + false）为 no-op，保持当前状态。
    }
}

// ======== ADR-076 方向 2: 真 cel-shading 后处理（posterize + Sobel，挂管线末尾）========

/**
 * 真 cel-shading 后处理：
 * - posterize：色阶量化 `floor(color * colorLevels) / colorLevels`，制造色块感
 * - Sobel：基于亮度的屏幕空间边缘检测，边缘处压暗形成黑描边
 * 零材质改动，符合 ADR-076「不触碰材质类型」边界。挂相机 PostProcess 链末尾，
 * 运行于色调映射 + bloom 之后，对最终图像做量化与描边。
 */
Effect.ShadersStore['celShadingFragmentShader'] = `
uniform sampler2D textureSampler;
uniform vec2 resolution;
uniform float colorLevels;
uniform float edgeThreshold;
uniform float edgeStrength;

varying vec2 vUV;

float luma(vec3 c) {
    return dot(c, vec3(0.299, 0.587, 0.114));
}

void main(void) {
    vec3 base = texture2D(textureSampler, vUV).rgb;

    // 色阶量化（posterize）
    vec3 posterized = floor(base * colorLevels) / colorLevels;

    // Sobel 边缘检测（基于亮度）
    vec2 texel = 1.0 / resolution;
    float tl = luma(texture2D(textureSampler, vUV + vec2(-texel.x,  texel.y)).rgb);
    float  t = luma(texture2D(textureSampler, vUV + vec2( 0.0,      texel.y)).rgb);
    float tr = luma(texture2D(textureSampler, vUV + vec2( texel.x,  texel.y)).rgb);
    float  l = luma(texture2D(textureSampler, vUV + vec2(-texel.x,  0.0)).rgb);
    float  r = luma(texture2D(textureSampler, vUV + vec2( texel.x,  0.0)).rgb);
    float bl = luma(texture2D(textureSampler, vUV + vec2(-texel.x, -texel.y)).rgb);
    float  b = luma(texture2D(textureSampler, vUV + vec2( 0.0,     -texel.y)).rgb);
    float br = luma(texture2D(textureSampler, vUV + vec2( texel.x, -texel.y)).rgb);

    float gx = -tl - 2.0 * l - bl + tr + 2.0 * r + br;
    float gy =  tl + 2.0 * t + tr - bl - 2.0 * b - br;
    float edge = sqrt(gx * gx + gy * gy);

    // 边缘处压暗（黑描边）
    float edgeFactor = 1.0 - clamp(edge - edgeThreshold, 0.0, 1.0) * edgeStrength;

    gl_FragColor = vec4(posterized * edgeFactor, 1.0);
}
`;

/**
 * 创建/销毁 cel-shading 后处理（由 celShadingMode 开关驱动）。
 * 挂相机 PostProcess 链末尾，
 * 运行于 DefaultRenderingPipeline（色调映射 + bloom 等）之后。
 */
function _ensureCelPostProcess(enabled: boolean): void {
    if (!_scene) {
        return;
    }
    const camera = _pipelineCamera ?? _scene.activeCamera;
    if (!camera) {
        return;
    }
    if (enabled) {
        if (!_celPP) {
            try {
                _celPP = new PostProcess(
                    'celShading',
                    'celShading',
                    ['resolution', 'colorLevels', 'edgeThreshold', 'edgeStrength'],
                    null,
                    1.0,
                    null,
                    0,
                    _scene.getEngine()
                );
                _celHandle = observe(_celPP.onApplyObservable, (effect: Effect) => {
                    effect.setVector2('resolution', {
                        x: _scene!.getEngine().getRenderWidth(),
                        y: _scene!.getEngine().getRenderHeight(),
                    });
                    effect.setFloat('colorLevels', _celColorLevels);
                    effect.setFloat('edgeThreshold', _celEdgeThreshold);
                    effect.setFloat('edgeStrength', _celEdgeStrength);
                });
                camera.attachPostProcess(_celPP);
            } catch (err) {
                logWarn('renderer', 'CelShading PostProcess 创建失败:', err);
                _celPP = null;
                _celHandle = null;
            }
        }
    } else {
        if (_celPP) {
            camera.detachPostProcess(_celPP);
            _celPP = safeDispose(_celPP);
            _celHandle = null;
        }
    }
}

// ======== 对外状态设置（含自动保存） ========

/**
 * [fix:P1] 渲染管线是否就绪（@dom/e2e 环境无 pipeline/scene 时返回 false，供 UI/测试预检跳过守卫域）。
 * 与 setRenderState 的守卫条件保持一致。
 */
export function isRenderReady(): boolean {
    return !!pipeline && !!_scene && !!_modelRegistry && !!_triggerAutoSave;
}

// ======== 守卫拒绝日志去重 ========
// [fix:P3] 治理下沉到守卫本身，而非逐个调用点：过渡/预设动画每帧调 setRenderState，
// 未就绪时旧实现每帧刷一条 warn。此处按「函数 + 未就绪组合」为 key 去重，
// 首次仍告警（不丢首发）；守卫通过（就绪）即清空，下一轮未就绪重新可见。
const _guardWarnedKeys = new Set<string>();

function _warnGuardBlocked(key: string, msg: string): void {
    if (_guardWarnedKeys.has(key)) {
        return;
    }
    _guardWarnedKeys.add(key);
    logWarn('renderer', msg);
}

/** 守卫通过时复位去重状态。 */
function _clearGuardWarn(): void {
    if (_guardWarnedKeys.size > 0) {
        _guardWarnedKeys.clear();
    }
}

/** 未就绪组合指纹，用于区分不同失败原因。 */
function _renderGuardKey(fn: string): string {
    return `${fn}:${!!pipeline}${!!_scene}${!!_modelRegistry}${!!_triggerAutoSave}`;
}

export function setRenderState(s: Partial<RenderState>): boolean {
    if (!pipeline || !_scene || !_modelRegistry || !_triggerAutoSave) {
        _warnGuardBlocked(
            _renderGuardKey('setRenderState'),
            'setRenderState: pipeline/scene 未初始化，状态更新被忽略（守卫拦截，返回 false；同组合仅告警一次）'
        );
        return false;
    }
    _clearGuardWarn();

    // [audit:round13 P1] 用户手动修改渲染设置：先清除自动降级快照（恢复到全质量），
    // 再应用用户 patch，避免 _restoreSnapshot 整体回写覆盖刚应用的改动
    // （原顺序导致「改→恢复→再降级」死循环 + 内存与存档发散）。
    // applyDegrade 触发的 setRenderState 通过 _suppressSnapshotReset 跳过，防止降级→恢复→再降级循环。
    if (!isSnapshotResetSuppressed()) {
        resetPerformanceSnapshot();
    }

    _applyRenderState(s);

    _triggerAutoSave();
    scheduleRefresh();
    return true;
}

// ======== 平滑过渡 ========

/** 取消当前渲染过渡动画（若有）。 */
function _cancelRenderTransition(): void {
    if (_renderTransitionObserver) {
        _renderTransitionObserver = safeDispose(_renderTransitionObserver);
    }
}

/**
 * 平滑过渡渲染状态到目标值，默认 2 秒。
 * 数值/颜色字段做 lerp 插值；布尔字段按阈值提前启用；枚举字段在动画结束时切换。
 * 中间帧不触发自动保存，仅最终帧保存一次。
 * [fix:P2] 守卫与 setRenderState/isRenderReady 对齐（补 _modelRegistry），拦截时 logWarn + 返回 false。
 */
export function transitionRenderState(
    target: Partial<RenderState>,
    duration: number = 2000,
    onComplete?: () => void
): boolean {
    if (!pipeline || !_scene || !_modelRegistry || !_triggerAutoSave) {
        _warnGuardBlocked(
            _renderGuardKey('transitionRenderState'),
            `transitionRenderState 被守卫拦截：渲染未就绪（pipeline=${!!pipeline}, _scene=${!!_scene}, _modelRegistry=${!!_modelRegistry}, _triggerAutoSave=${!!_triggerAutoSave}），过渡未启动（同组合仅告警一次）`
        );
        return false;
    }
    _clearGuardWarn();

    // 取消上一次过渡动画，避免多个动画循环互相覆盖
    _cancelRenderTransition();

    // [fix:P0] 非正/非有限 duration 直接应用目标值，避免 0/NaN/负数导致
    // elapsed/duration 为 NaN/负数、t 永远到不了 1，observer 泄漏在渲染循环上。
    if (!Number.isFinite(duration) || duration <= 0) {
        setRenderState(target);
        if (onComplete) {
            onComplete();
        }
        return true;
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
        'dofAperture',
        'dofFocusDistance',
        'dofFocalLength',
        'vignetteDarkness',
        'chromaticAberrationAmount',
        'grainIntensity',
        'sharpenAmount',
        'glowIntensity',
        'ssaoStrength',
        'ssaoRadius',
        'ssaoSamples',
        'celColorLevels',
        'celEdgeThreshold',
        'celEdgeStrength',
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
        'ssaoEnabled',
        'celShadingMode',
    ];
    // 枚举字段（动画结束时切换）
    const enumKeys: (keyof RenderState)[] = ['toneMapping'];

    // lerp / lerpArray 已收敛至 @/core/clamp

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
            if (key === 'ssaoEnabled') {
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
        // [fix P1] 过渡进行中若管线/场景已被销毁，立即取消，避免对已释放对象调用
        if (!pipeline || !_scene) {
            _cancelRenderTransition();
            return;
        }
        const elapsed = performance.now() - startTime;
        // [audit] 始终将进度钳制到 [0,1]，杜绝负 elapsed/浮点误差导致 t 越界。
        const t = clamp01(elapsed / duration);
        const interp: Partial<RenderState> = {};

        // 数值字段插值（跳过非有限目标，避免 NaN/Infinity 污染管线状态）
        for (const key of numericKeys) {
            const value = target[key] as number | undefined;
            if (value !== undefined && Number.isFinite(value)) {
                const a = source[key] as number;
                const b = value;
                setKey(interp, key, lerp(a, b, t) as RenderState[typeof key]);
            }
        }
        // 颜色字段插值（逐通道，任一通道非有限则跳过该字段）
        for (const key of colorKeys) {
            const value = target[key] as number[] | undefined;
            if (value !== undefined && value.every((v) => Number.isFinite(v))) {
                const a = source[key] as number[];
                const b = value;
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
            const value = target[key] as number | undefined;
            if (value !== undefined && Number.isFinite(value)) {
                setKey(interp, key, (t >= 1 ? value : source[key]) as RenderState[typeof key]);
            }
        }

        // 中间帧调用 _applyRenderState（不触发自动保存），最终帧用 setRenderState（触发一次保存）
        if (t >= 1) {
            // [audit:round13 P2] try/finally：onComplete 抛错也保证 _cancelRenderTransition 执行，
            // 否则 observer 泄漏且 animLoop 以 t=1 反复 setRenderState（无限自动保存）。
            // [audit] 只取消“当前这个” observer：onComplete 若启动新过渡，不能被旧帧的 finally 误杀。
            const currentObserver = _renderTransitionObserver;
            try {
                setRenderState(interp);
            } finally {
                if (_renderTransitionObserver === currentObserver) {
                    _cancelRenderTransition();
                }
            }
            try {
                onComplete?.();
            } catch (err) {
                logWarn('renderer', 'transitionRenderState onComplete threw:', err);
            }
        } else {
            // [audit] 中间帧应用状态若抛错也要取消 observer，避免每帧重复抛错造成泄漏。
            try {
                _applyRenderState(interp);
            } catch (err) {
                _cancelRenderTransition();
                throw err;
            }
        }
    };

    // [fix P1] observeOnce 只跑首帧，永远到不了 t>=1，导致目标值/onComplete/自动保存全不执行；
    // 改用持续 observe，在 t>=1 分支内自取消（见 _cancelRenderTransition）
    _renderTransitionObserver = observe(_scene.onBeforeRenderObservable, animLoop);
    return true;
}

// ======== 相机重挂接 ========

/** Re-attach the rendering pipeline to the current active camera (call after camera switch). */
export function reattachPipeline(): void {
    if (!_scene || !pipeline) {
        return;
    }
    // [audit:round13 P3] 先记录 SSR/SSAO 启用状态，dispose 后主动重建。
    // 此前 dispose 后仅靠注释声称「下次 _applyRenderState 时会重建」，但 SSR 只由
    // setSSRFromReflection 创建（_applyRenderState 不重建）、SSAO 也仅当后续 patch
    // 含 ssao 字段时才重建 → 切相机后 SSR/SSAO 静默关闭，需重载场景/反射才能恢复。
    const ssrWasActive = _ssrPipeline !== null && _ssrPipeline.isEnabled;
    const ssaoWasActive = _ssaoPipeline !== null;
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
                _ssrPipeline = safeDispose(_ssrPipeline);
            } catch {
                // Intentionally empty — SSR pipeline dispose 失败不影响主流程
            }
        }
        // SSAO pipeline 也需要重新挂接相机
        if (_ssaoPipeline) {
            try {
                _ssaoPipeline = safeDispose(_ssaoPipeline);
            } catch {
                // Intentionally empty — SSAO pipeline dispose 失败不影响主流程
            }
        }
        // [audit:round13 P3] 相机切换后重建 SSR/SSAO（用记录的启用状态与用户自定义参数）。
        if (ssrWasActive && _lastSSRParams) {
            setSSRFromReflection(_lastSSRParams);
        } else if (ssrWasActive) {
            setSSRFromReflection({ enabled: true });
        }
        if (ssaoWasActive) {
            _applyRenderState({ ssaoEnabled: true });
        }
        // 光锥是普通 Mesh，无需相机切换重建（替代 ADR-152 的 PostProcess 方案）
    }
}

// ======== ADR-151: SSR 控制接口（供 env-reflection.ts 调用） ========

/**
 * SSR 管线当前是否激活（供 env-reflection 检查，尊重用户手动关闭）。
 */
export function isSSRActive(): boolean {
    return _ssrPipeline !== null && _ssrPipeline.isEnabled;
}

/** 上次 setSSRFromReflection 传入的参数（reattachPipeline 相机切换后重建用，保留用户自定义值）。 */
let _lastSSRParams: { enabled: boolean; step?: number; strength?: number; thickness?: number } | null =
    null;

/**
 * 反射系统专用 SSR 控制接口（不触发 auto-save）。
 * 由 env-reflection.ts 的 applyReflection 调用，避免循环依赖。
 */
export function setSSRFromReflection(params: {
    enabled: boolean;
    step?: number;
    strength?: number;
    thickness?: number;
}): void {
    // [audit:round13 P3] 记录最近一次参数，供 reattachPipeline 相机切换后重建 SSR 使用
    _lastSSRParams = { ...params };
    if (!_scene || !pipeline) {
        return;
    }
    const ssrCamera = _pipelineCamera ?? _scene.activeCamera;
    if (params.enabled && !_ssrPipeline && ssrCamera) {
        try {
            _ssrPipeline = new SSRRenderingPipeline('ssr', _scene, [ssrCamera], true);
            _ssrPipeline.maxDistance = 50;
            _ssrPipeline.step = params.step ?? 16;
            _ssrPipeline.thickness = params.thickness ?? 0.5;
            _ssrPipeline.strength = params.strength ?? 0.7;
            _ssrPipeline.reflectionSpecularFalloffExponent = 1;
            _ssrPipeline.samples = 1;
            _ssrPipeline.isEnabled = true;
        } catch (err) {
            logWarn('renderer', 'SSR pipeline 创建失败 (env-reflection):', err);
            _ssrPipeline = null;
        }
    } else if (!params.enabled && _ssrPipeline) {
        _ssrPipeline = safeDispose(_ssrPipeline);
    }
    if (_ssrPipeline && params.enabled) {
        if (params.step !== undefined) {
            _ssrPipeline.step = params.step;
        }
        if (params.strength !== undefined) {
            _ssrPipeline.strength = params.strength;
        }
        if (params.thickness !== undefined) {
            _ssrPipeline.thickness = params.thickness;
        }
    }
}

// ======== 边缘高亮重建 ========

// ADR-151: refreshReflectionProbe 和 bindReflectionProbeToModel 已迁移至 env-reflection.ts

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
