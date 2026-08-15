// [doc:adr-079] 感知层 — Lip-sync（口型同步，从 lipsync-bridge.ts 迁移）

import { getProcBeatDetector } from './proc-motion-bridge';
// [doc:adr-238] 音频操作经 scene-action-bridge（core/audio 注册）
import { getSceneAction } from '@/core/scene-action-bridge';
import { findLipMorph, findAllLipMorphs, amplitudeToWeight } from '@/motion-algos/lipsync';
import type { PerceptionState, MmdModelLike, PerceptionTier } from './perception-shared';

/** 人声频段范围（与 lipsync-bridge.ts 一致） */
const VOICE_BIN_START = 10;
const VOICE_BIN_END = 50;
const HIGH_BIN_START = 25;
const HIGH_BIN_END = 50;

/** BeatDetector 能量仅接受有限非负值；NaN/Infinity/负数视为 0，避免污染低通平滑状态 */
function _finiteLevel(value: number): number {
    return Number.isFinite(value) && value > 0 ? value : 0;
}

/** 单模型 lip-sync 运行时状态（per-model 隔离：全员感知多模型互不污染 morph 缓存/平滑值/关闭复位） */
interface LipSyncRuntimeState {
    morphName: string | null;
    morphSet: {
        open: string | null;
        close: string | null;
        pucker: string | null;
        smile: string | null;
    } | null;
    morphNames: string[];
    morphNameSet: Set<string>;
    smoothLow: number;
    smoothHigh: number;
    audioPath: string;
}

function _createLipSyncRuntime(): LipSyncRuntimeState {
    return {
        morphName: null,
        morphSet: null,
        morphNames: [],
        morphNameSet: new Set<string>(),
        smoothLow: 0,
        smoothHigh: 0,
        audioPath: '',
    };
}

/** lip-sync 状态机（从 lipsync-bridge.ts 搬运：音源切换重置 + 静音指数衰减 + 低通滤波 + morph 缓存）。
 *  [doc:adr-164] per-model 隔离：多模型全员感知下避免 morph 缓存每帧重建 / 平滑值串扰 / 关闭时 morph 残留。 */
const _lipSyncRuntimes = new Map<string, LipSyncRuntimeState>();

/** 释放指定模型的 lip-sync 运行时（模型移除时调用，防 Map 泄漏） */
export function _disposeLipSyncRuntime(modelId: string): void {
    _lipSyncRuntimes.delete(modelId);
}

export function _applyLipSync(
    mmdModel: MmdModelLike,
    time: number,
    enabled: boolean,
    perceptionModelId: string | null,
    perceptionState: PerceptionState,
    tier?: PerceptionTier
): void {
    // [doc:adr-164] tier 守卫：low 跳过实际口型驱动；
    // 但 low + enabled=false 仍需进入复位路径，避免从高/中档切到低档时 morph 冻结。
    if (tier === 'low' && enabled) {
        return;
    }
    const morphManager = mmdModel.mesh?.morphTargetManager;
    if (!morphManager) {
        return;
    }

    // per-model 运行时：多模型全员感知下各自持有 morph 缓存与平滑值
    const modelId = perceptionModelId ?? '';
    let rt = _lipSyncRuntimes.get(modelId);
    if (!rt) {
        rt = _createLipSyncRuntime();
        _lipSyncRuntimes.set(modelId, rt);
    }

    // 关闭时复位 morph influence（防残留冻结，与 _applyMicroExpression 同款）
    if (!enabled) {
        if (rt.morphName) {
            const old = morphManager.getTargetByName(rt.morphName);
            if (old) {
                old.influence = 0;
            }
        }
        // 复位所有 multiMorph 口型（close/pucker/smile），防止冻结在最后值
        if (rt.morphSet) {
            for (const key of ['close', 'pucker', 'smile'] as const) {
                const name = rt.morphSet[key];
                if (name) {
                    const m = morphManager.getTargetByName(name);
                    if (m) {
                        m.influence = 0;
                    }
                }
            }
        }
        rt.morphName = null;
        rt.morphSet = null;
        rt.smoothLow = 0;
        rt.smoothHigh = 0;
        return;
    }

    // #10: 音源切换 → 立即重置状态
    // NOTE: `??` 优先级低于 `!==`，缺括号会被解析成 `path ?? ('' !== _last)`，
    // 导致有音频路径时每帧恒真 → 平滑值与 morph 缓存被逐帧清空。
    const audioPath = getSceneAction('getAudioPath')?.() ?? '';
    if (audioPath !== rt.audioPath) {
        rt.morphName = null;
        rt.morphSet = null;
        rt.smoothLow = 0;
        rt.smoothHigh = 0;
        rt.audioPath = audioPath;
    }

    // #12: 音频停止时指数衰减（约 20 帧淡出）
    if (!(getSceneAction('isAudioPlaying')?.() ?? false)) {
        rt.smoothLow *= 0.85;
        rt.smoothHigh *= 0.85;
        if (rt.smoothLow < 0.005 && rt.smoothHigh < 0.005) {
            rt.smoothLow = 0;
            rt.smoothHigh = 0;
            // 衰减完成：复位所有口型 morph（open/close/pucker/smile）
            if (rt.morphName) {
                const morph = morphManager.getTargetByName(rt.morphName);
                if (morph) {
                    morph.influence = 0;
                }
            }
            if (rt.morphSet) {
                for (const key of ['close', 'pucker', 'smile'] as const) {
                    const name = rt.morphSet[key];
                    if (name) {
                        const m = morphManager.getTargetByName(name);
                        if (m) {
                            m.influence = 0;
                        }
                    }
                }
            }
            return;
        }
        // 仍在衰减期：继续以衰减值应用 morph 权重
    }

    // morph 名缓存：仅首次（per-model）构建，消除每帧 O(M) 扫描
    if (rt.morphNames.length === 0) {
        for (let i = 0; i < morphManager.numTargets; i++) {
            rt.morphNames.push(morphManager.getTarget(i).name);
        }
        rt.morphNameSet = new Set(rt.morphNames);
    }

    // 查找口型 morph（仅首次或 morph 名失效时）
    if (!rt.morphName || !rt.morphNameSet.has(rt.morphName)) {
        rt.morphName = findLipMorph(rt.morphNames);
        rt.morphSet = findAllLipMorphs(rt.morphNames);
    }
    if (!rt.morphName) {
        return;
    }

    // 从 BeatDetector 取频段能量（NaN/Infinity/负数按 0 处理，防止平滑状态被污染后永久失效）
    const beatDetector = getProcBeatDetector();
    const lowLevel = _finiteLevel(beatDetector ? beatDetector.getLevel(VOICE_BIN_START, VOICE_BIN_END) : 0);
    const highLevel = _finiteLevel(beatDetector ? beatDetector.getLevel(HIGH_BIN_START, HIGH_BIN_END) : 0);

    // 低通滤波（音频播放时才平滑，衰减期保留衰减值）
    if (getSceneAction('isAudioPlaying')?.() ?? false) {
        rt.smoothLow = rt.smoothLow * 0.7 + lowLevel * 0.3;
        rt.smoothHigh = rt.smoothHigh * 0.7 + highLevel * 0.3;
    }

    // open morph（あ）
    const openWeight = amplitudeToWeight(
        rt.smoothLow,
        perceptionState.lipSyncSensitivity,
        perceptionState.lipSyncIntensity
    );
    const openMorph = morphManager.getTargetByName(rt.morphName);
    if (openMorph) {
        openMorph.influence = openWeight;
    }

    // 多口型 morph（close 反比 + pucker 高频驱动 + smile 微笑表情）
    if (perceptionState.lipSyncMultiMorphEnabled && rt.morphSet) {
        // close：与 open 反比（嘴开时 close=0，嘴闭时 close=1）
        if (rt.morphSet.close) {
            const closeWeight = amplitudeToWeight(
                1 - rt.smoothLow,
                perceptionState.lipSyncSensitivity,
                perceptionState.lipSyncIntensity
            );
            const closeMorph = morphManager.getTargetByName(rt.morphSet.close);
            if (closeMorph) {
                closeMorph.influence = closeWeight;
            }
        }
        // pucker：由高频能量驱动（模拟「う」口型）
        if (rt.morphSet.pucker) {
            const puckerWeight = amplitudeToWeight(
                rt.smoothHigh * 0.8,
                perceptionState.lipSyncSensitivity,
                perceptionState.lipSyncIntensity
            );
            const puckerMorph = morphManager.getTargetByName(rt.morphSet.pucker);
            if (puckerMorph) {
                puckerMorph.influence = puckerWeight;
            }
        }
        // smile：高频能量大时轻微微笑（模拟说话表情）
        // [fix P2] 此前 smile 在开关块之外无条件应用——用户关闭「多口型」后
        // smile 仍被写入，与开关语义矛盾；移入 lipSyncMultiMorphEnabled 块内。
        if (rt.morphSet.smile) {
            const smileWeight = Math.max(0, openWeight * 0.3 - 0.1);
            const smileMorph = morphManager.getTargetByName(rt.morphSet.smile);
            if (smileMorph) {
                smileMorph.influence = smileWeight;
            }
        }
    } else if (rt.morphSet) {
        // [fix code_review P3] 开关关闭时不驱动也不残留：清零 multiMorph 口型
        // （close/pucker/smile），避免音频持续播放时冻结在最后值（smile 此前移入
        // 开关块后，关闭开关不再每帧写入，必须显式复位，否则整段音频 smile 残留）。
        for (const key of ['close', 'pucker', 'smile'] as const) {
            const name = rt.morphSet[key];
            if (name) {
                const m = morphManager.getTargetByName(name);
                if (m) {
                    m.influence = 0;
                }
            }
        }
    }
}
