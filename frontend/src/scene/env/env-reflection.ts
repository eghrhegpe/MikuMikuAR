// env-reflection.ts — 反射子系统统一入口（ADR-151）
//
// 参考天空子系统（env-sky.ts）的 applySky 模式：
//   - 统一入口 applyReflection(state)
//   - 模式互斥（或 hybrid 分层混合）
//   - 全量清理确保旧资源纯净
//   - reflectionTexture 所有权声明 + save/restore
//
// 关键设计决策（审查后调整）：
//   1. reflectionMode（新增字段）控制反射模式，reflectionQuality 保持原有语义（Planar 分辨率）
//   2. 互斥粒度为"材质槽位级"而非"系统级"：SSR + Planar 可共存，Probe 不写地面/水面材质
//   3. save/restore 在绑定前逐个保存，新模型加载时自动补绑

import { ReflectionProbe } from '@babylonjs/core/Probes/reflectionProbe';
import { Scene } from '@babylonjs/core/scene';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { BaseTexture } from '@babylonjs/core/Materials/Textures/baseTexture';
import type { Color3 } from '@babylonjs/core/Maths/math.color';
import { observe, type ObserverHandle } from '@/core/observer-handle';
import { safeDispose } from '@/core/dispose-helpers';
import { logWarn } from '@/core/logger';
import type { EnvState } from '@/core/config';
import { envState } from '@/core/config';
import { getScene } from './env-context';
import { registerEnvCallback } from './env-dispatcher';
import { getEnvKeys } from '@/core/env-state-schema';
import { setSSRFromReflection, isSSRActive } from '../render/renderer';

// ======== 类型定义 ========

export type ReflectionMode = 'none' | 'planar' | 'ssr' | 'probe' | 'hybrid';

export type ResolvedReflectionMode = ReflectionMode;

/** 合法反射模式白名单：用于防御旧版持久化存档残留的非法枚举值（如 ADR-151 修订前 schema 曾含 'auto'） */
const VALID_REFLECTION_MODES: readonly ResolvedReflectionMode[] = [
    'none',
    'planar',
    'ssr',
    'probe',
    'hybrid',
];

// ======== 质量等级参数预设 ========

interface ReflectionQualityPreset {
    ssr: { step: number; strength: number; thickness: number } | null;
    probe: { resolution: number; strength: number } | null;
}

const QUALITY_PRESETS: Record<string, ReflectionQualityPreset> = {
    off: {
        ssr: null,
        probe: null,
    },
    low: {
        ssr: null,
        probe: { resolution: 256, strength: 0.3 },
    },
    medium: {
        ssr: null,
        probe: { resolution: 256, strength: 0.5 },
    },
    high: {
        ssr: { step: 16, strength: 0.7, thickness: 0.5 },
        probe: { resolution: 256, strength: 0.3 },
    },
};

// ======== 模块状态 ========

let _reflectionProbe: ReflectionProbe | null = null;
let _probeRefreshObserver: ObserverHandle | null = null;
let _lastProbeRefresh = 0;
let _currentMode: ResolvedReflectionMode = 'none';

/** AR 模式激活时挂起全部反射（纯派生覆盖，退出 AR 后恢复用户 reflectionMode） */
let _arSuspended = false;

/** Probe 创建失败标记：GPU 资源不足等场景下不再无限重试 */
let _probeCreateFailed = false;

/** Probe 自动刷新的最低 FPS 守卫：帧率低于此值时跳过本次刷新，避免 cubemap 渲染造成帧 spike */
const PROBE_REFRESH_MIN_FPS = 24;

/** 上次 Probe renderList 重建时的场景网格数量（增量优化：仅数量变化时重建） */
let _lastProbeMeshCount = 0;

/**
 * 保存材质原始 reflectionTexture 的映射（material.uniqueId → 原始纹理）。
 * Probe 绑定前逐个保存，退出时逐个恢复，消除悬空指针。
 */
const _savedReflectionTextures = new Map<number, BaseTexture | null>();
/** 保存材质原始 reflectionColor（与 _savedReflectionTextures 对称，P4 修复） */
const _savedReflectionColors = new Map<number, Color3 | null>();

/**
 * 已绑定 Probe 的材质映射（uniqueId → 材质引用）。
 * dispose 时直接遍历值恢复，避免网格被移出场景（模型卸载）后
 * 遍历 scene.meshes 漏掉其材质导致悬空指针。
 */
const _probeBoundMaterials = new Map<number, MaterialWithReflection>();

/** Probe 当前强度（hybrid 模式下按 _getHybridProbeFactor 衰减） */
let _probeStrength = 1;

/** Hybrid 模式下 Probe 强度衰减系数：按 reflectionQuality 分级，低画质更依赖 SSR */
function _getHybridProbeFactor(state: EnvState): number {
    const quality = state.reflectionQuality ?? 'high';
    switch (quality) {
        case 'low':
            return 0.3;
        case 'medium':
            return 0.4;
        case 'high':
            return 0.5;
        default:
            return 0.5;
    }
}

// ======== 模式推导 ========

export function resolveReflectionMode(state: EnvState): ResolvedReflectionMode {
    // AR 场景无背景平面，角色倒影/环境反射无意义且浪费 GPU：纯派生覆盖为 'none'
    if (_arSuspended) {
        return 'none';
    }
    const mode = state.reflectionMode;
    // 防御旧版持久化存档残留的非法枚举（如 ADR-151 修订前 schema 曾含 'auto'），
    // 避免落入 applyReflection 的 switch 无匹配分支导致零反射静默 no-op。
    if (!mode || !VALID_REFLECTION_MODES.includes(mode)) {
        return 'planar';
    }
    return mode;
}

/**
 * AR 模式联动：挂起/恢复反射子系统。
 * 由 ar-scene.ts 的 setARMode 在 AR 激活成功时挂起、退出时恢复。
 * 采用派生覆盖（不改写用户 reflectionMode），避免状态泄漏与回滚遗漏。
 */
export function setReflectionARSuspended(suspended: boolean): void {
    if (_arSuspended === suspended) {
        return;
    }
    _arSuspended = suspended;
    // 立即重算反射（envState 为当前态），使进入/退出 AR 反射即时开关。
    // scene 未初始化（模块加载期/测试环境）时 applyReflection 会抛，安全跳过：
    // 派生标志 _arSuspended 已更新，待下次反射状态变化重算时生效。
    try {
        applyReflection(envState);
    } catch (err) {
        logWarn(
            'env-reflection',
            'setReflectionARSuspended: applyReflection 跳过（scene 未就绪）:',
            err
        );
    }
}

/**
 * 获取当前质量等级对应的参数预设。
 */
export function getQualityPreset(state: EnvState): ReflectionQualityPreset {
    const quality = state.reflectionQuality ?? 'off';
    return QUALITY_PRESETS[quality] ?? QUALITY_PRESETS['off'];
}

/**
 * ADR-151: 平面反射质量全局覆盖（供 env-ground / env-water 的 getQuality 检查）。
 * - reflectionMode='none'  → 强制 'off'（关闭全部反射，含平面反射）
 * - reflectionMode='planar' → 固定 'low'（控制平面倒影成本）
 * - 其他模式且 reflectionQuality='off' → 'low'（保底，避免已选反射模式却零倒影）
 * - 其他模式且 reflectionQuality≠'off' → null（平面倒影遵循用户 reflectionQuality 设置）
 * 纯函数于 state，与 dispatcher 回调执行顺序无关，保证任意时序下结论一致。
 */
export function getPlanarQualityOverride(state: EnvState): 'off' | 'low' | null {
    const mode = resolveReflectionMode(state);
    if (mode === 'none') {
        return 'off';
    }
    // planar 模式固定 low（控制平面倒影成本）；
    // ssr/probe/hybrid 模式下 reflectionQuality='off' 仅关 SSR/Probe 层，
    // 不应连带关闭地面/水面平面倒影（尤其 hybrid=最高画质预期）。
    if (mode === 'planar') {
        return 'low';
    }
    const quality = state.reflectionQuality ?? 'off';
    if (quality === 'off') {
        return 'low';
    }
    return null;
}

// ======== 所有权管理 ========

interface MaterialWithReflection {
    uniqueId: number;
    reflectionTexture: BaseTexture | null;
    reflectionColor?: Color3 | null;
    isDisposed?: boolean;
}

/**
 * 保存材质原始 reflectionTexture（绑定前调用）。
 * 仅首次保存，避免 Probe 的 cubeTexture 被当作"原始值"误存。
 */
function _saveOriginalTexture(mat: MaterialWithReflection): void {
    if (!_savedReflectionTextures.has(mat.uniqueId)) {
        _savedReflectionTextures.set(mat.uniqueId, mat.reflectionTexture);
        // P4 修复：克隆原始 reflectionColor，避免后续 .set() 原地修改污染保存值
        _savedReflectionColors.set(
            mat.uniqueId,
            mat.reflectionColor ? mat.reflectionColor.clone() : null
        );
    }
}

/**
 * 恢复材质原始 reflectionTexture（Probe 退出时调用）。
 * 校验材质是否仍存活，已 dispose 的材质跳过并清理映射。
 */
function _restoreOriginalTexture(mat: MaterialWithReflection): void {
    if (mat.isDisposed) {
        _savedReflectionTextures.delete(mat.uniqueId);
        _probeBoundMaterials.delete(mat.uniqueId);
        return;
    }
    const saved = _savedReflectionTextures.get(mat.uniqueId);
    mat.reflectionTexture = saved ?? null;
    _savedReflectionTextures.delete(mat.uniqueId);

    // P4 修复：同步还原 reflectionColor，消除 Probe 退出后残留强度色
    const savedColor = _savedReflectionColors.get(mat.uniqueId);
    if (mat.reflectionColor) {
        if (savedColor) {
            mat.reflectionColor.copyFrom(savedColor);
        } else {
            mat.reflectionColor.set(1, 1, 1);
        }
    }
    _savedReflectionColors.delete(mat.uniqueId);

    _probeBoundMaterials.delete(mat.uniqueId);
}

// ======== Probe 管理 ========

/**
 * 创建 ReflectionProbe 并绑定到场景环境网格。
 * @param resolution cubemap 分辨率（默认 256）
 */
function _createProbe(scene: Scene, resolution = 256): void {
    if (_reflectionProbe || _probeCreateFailed) {
        return;
    }
    try {
        _reflectionProbe = new ReflectionProbe('envProbe', resolution, scene);
        _reflectionProbe.renderList = scene.meshes.filter(
            (m) =>
                m.name.includes('sky') ||
                m.name.includes('env') ||
                m.name.includes('ground') ||
                m.name.includes('water')
        );
        _reflectionProbe.refreshRate = 0; // 静态环境，仅渲染一次
        _lastProbeMeshCount = scene.meshes.length; // 记录初始网格数量
    } catch (err) {
        logWarn('env-reflection', 'ReflectionProbe 创建失败（本次会话不再重试）:', err);
        _reflectionProbe = null;
        _probeCreateFailed = true;
        return;
    }

    // 自动刷新 observer：每 10 秒检查环境变化
    _lastProbeRefresh = performance.now();
    _probeRefreshObserver = observe(scene.onBeforeRenderObservable, () => {
        if (!_reflectionProbe || !scene || scene.isDisposed) {
            return;
        }
        const now = performance.now();
        if (now - _lastProbeRefresh < 10000) {
            return;
        }
        // FPS 守卫：帧率过低时跳过本次刷新，避免 cubemap 渲染造成帧 spike
        if (scene.getEngine().getFps() < PROBE_REFRESH_MIN_FPS) {
            return;
        }
        _lastProbeRefresh = now;
        try {
            // 增量优化：仅当场景网格数量变化时才重建 renderList，避免每 10 秒全量 filter
            const currentMeshCount = scene.meshes.length;
            if (currentMeshCount !== _lastProbeMeshCount) {
                _lastProbeMeshCount = currentMeshCount;
                _reflectionProbe!.renderList = scene.meshes.filter(
                    (m) =>
                        m.name.includes('sky') ||
                        m.name.includes('env') ||
                        m.name.includes('ground') ||
                        m.name.includes('water')
                );
            }
            _reflectionProbe!.cubeTexture.render();
        } catch (err) {
            logWarn('env-reflection', 'ReflectionProbe 自动刷新失败:', err);
        }
    });
}

/**
 * 将 Probe cubemap 绑定到指定网格的材质（含 save 原始纹理）。
 * 仅绑定模型网格（排除 env 前缀的环境网格，避免与 PlanarReflection 槽位冲突）。
 */
export function bindProbeToMeshes(meshes: AbstractMesh[]): void {
    if (!_reflectionProbe) {
        return;
    }
    const rt = _reflectionProbe.cubeTexture;
    if (!rt) {
        return;
    }
    for (const mesh of meshes) {
        // 排除环境网格（地面/水面/天空），它们的 reflectionTexture 由 PlanarReflection 管理
        // （'env' 前缀已覆盖 envGround/envWater/envSkySphere 等，无需冗余判断）
        if (mesh.name.startsWith('env')) {
            continue;
        }
        try {
            const m = mesh.material as unknown as MaterialWithReflection | null;
            if (m && !m.isDisposed && 'reflectionTexture' in m) {
                _saveOriginalTexture(m);
                m.reflectionTexture = rt;
                _probeBoundMaterials.set(m.uniqueId, m);
                // 设置反射强度
                if ('reflectionColor' in m) {
                    const intensity = _probeStrength;
                    (
                        m as unknown as {
                            reflectionColor: { set: (r: number, g: number, b: number) => void };
                        }
                    ).reflectionColor.set(intensity, intensity, intensity);
                }
            }
        } catch (err) {
            // 单个网格绑定失败（如 MultiMaterial 等特殊结构）不中断其他网格
            logWarn('env-reflection', `Probe 绑定网格 ${mesh.name} 失败:`, err);
        }
    }
}

/**
 * 从所有已绑定材质恢复原始 reflectionTexture，然后销毁 Probe。
 */
function _disposeProbe(_scene: Scene): void {
    if (!_reflectionProbe) {
        return;
    }

    // 恢复所有已绑定材质的原始纹理。
    // 直接遍历材质引用映射（而非 scene.meshes），确保已被移出场景的
    // 网格（模型卸载）其材质也能被正确恢复，消除悬空指针。
    for (const m of _probeBoundMaterials.values()) {
        _restoreOriginalTexture(m);
    }
    _probeBoundMaterials.clear();
    _savedReflectionTextures.clear();
    _savedReflectionColors.clear();

    // 释放 observer + probe
    _probeRefreshObserver = safeDispose(_probeRefreshObserver);
    _reflectionProbe = safeDispose(_reflectionProbe);
    _lastProbeRefresh = 0;
}

// ======== SSR 控制（委托 renderer.ts） ========

/**
 * 通过 renderer.setRenderState 控制 SSR 管线。
 * SSR pipeline 对象仍在 renderer.ts 维护（渲染管线资源），控制权由本模块行使。
 */
function _applySSR(params: {
    enabled: boolean;
    step?: number;
    strength?: number;
    thickness?: number;
}): void {
    setSSRFromReflection(params);
}

// ======== 统一入口 ========

/**
 * 反射子系统统一入口。参考 applySky 模式：
 * 1. 推导模式
 * 2. 模式切换时全量清理旧资源
 * 3. 按模式激活对应子系统
 */
export function applyReflection(state: EnvState): void {
    const scene = getScene();
    if (!scene || scene.isDisposed) {
        return;
    }

    const mode = resolveReflectionMode(state);
    const preset = getQualityPreset(state);

    // 模式未变化 → 仅更新参数（避免无谓重建）
    if (mode === _currentMode && mode !== 'none') {
        if ((mode === 'probe' || mode === 'hybrid') && _reflectionProbe) {
            const factor = mode === 'hybrid' ? _getHybridProbeFactor(state) : 1.0;
            _updateProbeStrength(preset, factor);
        }
        // 同步更新 SSR 参数（仅在 SSR 当前激活时，尊重用户手动关闭）
        if ((mode === 'ssr' || mode === 'hybrid') && isSSRActive()) {
            _applySSR({
                enabled: true,
                step: preset.ssr?.step ?? 16,
                strength: preset.ssr?.strength ?? 0.7,
                thickness: preset.ssr?.thickness ?? 0.5,
            });
        }
        return;
    }

    // 模式切换：全量清理旧状态
    if (mode !== _currentMode) {
        _disableCurrentMode(scene);
    }

    _currentMode = mode;

    switch (mode) {
        case 'none':
            // 全关（已在 _disableCurrentMode 中处理）
            break;

        case 'probe':
            _enableProbe(scene, preset, mode);
            break;

        case 'ssr':
            _enableSSR(preset);
            break;

        case 'planar':
            // PlanarReflection 仍由 env-ground / env-water 各自管理（SSR 与 Probe 已关闭）。
            // 最低质量保证通过 getPlanarQualityOverride 在二者 getQuality 内完成
            // （reflectionMode='planar' 时拔高到至少 low）。
            break;

        case 'hybrid':
            _enableHybrid(scene, preset, state);
            break;
    }
}

/**
 * 关闭当前激活的反射模式，释放资源。
 */
function _disableCurrentMode(scene: Scene): void {
    // 关闭 Probe
    if (_reflectionProbe) {
        _disposeProbe(scene);
    }
    // 关闭 SSR
    if (_currentMode === 'ssr' || _currentMode === 'hybrid') {
        _applySSR({ enabled: false });
    }
}

/**
 * 启用 Probe 模式。
 */
function _enableProbe(
    scene: Scene,
    preset: ReflectionQualityPreset,
    _mode: ResolvedReflectionMode
): void {
    const resolution = preset.probe?.resolution ?? 256;
    _probeStrength = preset.probe?.strength ?? 0.5;
    _createProbe(scene, resolution);
    if (_reflectionProbe) {
        // 绑定到场景中已有的模型网格
        bindProbeToMeshes(scene.meshes);
    }
}

/**
 * 启用 SSR 模式。
 */
function _enableSSR(preset: ReflectionQualityPreset): void {
    _applySSR({
        enabled: true,
        step: preset.ssr?.step ?? 16,
        strength: preset.ssr?.strength ?? 0.7,
        thickness: preset.ssr?.thickness ?? 0.5,
    });
}

/**
 * 启用 hybrid 模式：SSR + Probe 分层混合。
 * Probe 提供基础环境反射底色（强度按 reflectionQuality 分级衰减），SSR 提供动态细节叠加。
 */
function _enableHybrid(scene: Scene, preset: ReflectionQualityPreset, state: EnvState): void {
    // Probe 层：强度衰减避免与 SSR 叠加过亮
    const resolution = preset.probe?.resolution ?? 256;
    _probeStrength = (preset.probe?.strength ?? 0.3) * _getHybridProbeFactor(state);
    _createProbe(scene, resolution);
    if (_reflectionProbe) {
        bindProbeToMeshes(scene.meshes);
    }

    // SSR 层：独立渲染动态反射细节
    _applySSR({
        enabled: true,
        step: preset.ssr?.step ?? 16,
        strength: preset.ssr?.strength ?? 0.7,
        thickness: preset.ssr?.thickness ?? 0.5,
    });
}

/**
 * 更新 Probe 强度（模式未变但参数变化时调用）。
 */
function _updateProbeStrength(preset: ReflectionQualityPreset, factor: number): void {
    const baseStrength = preset.probe?.strength ?? 0.5;
    const newStrength = baseStrength * factor;
    if (Math.abs(newStrength - _probeStrength) < 0.01) {
        return;
    }
    _probeStrength = newStrength;
    // 更新已绑定材质的反射强度（直接遍历材质引用映射，跳过已 dispose 的）
    for (const m of _probeBoundMaterials.values()) {
        if (!m.isDisposed && 'reflectionColor' in m) {
            (
                m as unknown as {
                    reflectionColor: { set: (r: number, g: number, b: number) => void };
                }
            ).reflectionColor.set(_probeStrength, _probeStrength, _probeStrength);
        }
    }
}

// ======== 公共 API ========

/**
 * 获取当前反射模式（供 UI 状态栏 / 调试面板读取）。
 */
export function getCurrentReflectionMode(): ResolvedReflectionMode {
    return _currentMode;
}

/**
 * 获取当前 Probe 是否激活。
 */
export function isReflectionProbeActive(): boolean {
    return _reflectionProbe !== null;
}

/**
 * 模型加载后调用：将 Probe 绑定到新模型的网格。
 * 替代旧 renderer.ts 的 bindReflectionProbeToModel。
 */
export function onModelMeshesReady(meshes: AbstractMesh[]): void {
    if (_reflectionProbe && (_currentMode === 'probe' || _currentMode === 'hybrid')) {
        bindProbeToMeshes(meshes);
    }
}

/**
 * 释放反射子系统全部资源（场景销毁时调用）。
 */
export function disposeReflection(): void {
    const scene = getScene();
    if (scene) {
        _disableCurrentMode(scene);
    } else {
        // scene 已不可用，直接清理引用
        _probeRefreshObserver = safeDispose(_probeRefreshObserver);
        _reflectionProbe = safeDispose(_reflectionProbe);
    }
    _currentMode = 'none';
    _probeStrength = 1;
    _probeCreateFailed = false;
    _savedReflectionTextures.clear();
    _savedReflectionColors.clear();
    _probeBoundMaterials.clear();
}

// ======== env-dispatcher 回调注册 ========

const _REFLECTION_KEYS = getEnvKeys('reflection');

registerEnvCallback((changed, state) => {
    if (!changed || [...changed].some((k) => _REFLECTION_KEYS.includes(k))) {
        applyReflection(state);
    }
});
