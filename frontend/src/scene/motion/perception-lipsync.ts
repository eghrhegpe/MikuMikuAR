// [doc:adr-079] 感知层 — Lip-sync（口型同步，从 lipsync-bridge.ts 迁移）

import { getProcBeatDetector } from './proc-motion-bridge';
import { isAudioPlaying, getAudioPath } from '@/outfit/audio';
import { findLipMorph, findAllLipMorphs, amplitudeToWeight } from '@/motion-algos/lipsync';
import type { PerceptionState } from './perception-shared';

/** 人声频段范围（与 lipsync-bridge.ts 一致） */
const VOICE_BIN_START = 10;
const VOICE_BIN_END = 50;
const HIGH_BIN_START = 25;
const HIGH_BIN_END = 50;

/** lip-sync 状态机（从 lipsync-bridge.ts 搬运：音源切换重置 + 静音指数衰减 + 低通滤波 + morph 缓存） */
let _lipSyncMorphName: string | null = null;
let _lipSyncMorphSet: {
    open: string | null;
    close: string | null;
    pucker: string | null;
    smile: string | null;
} | null = null;
let _lastLipSyncModelId: string | null = null;
let _lastLipSyncMorphNames: string[] = [];
let _lastLipSyncMorphNameSet = new Set<string>();
let _smoothLow = 0;
let _smoothHigh = 0;
let _lastLipSyncAudioPath = '';

export function _applyLipSync(
    mmdModel: any,
    time: number,
    enabled: boolean,
    perceptionModelId: string | null,
    perceptionState: PerceptionState
): void {
    const morphManager = mmdModel.mesh?.morphTargetManager;
    if (!morphManager) {
        return;
    }

    // 关闭时复位 morph influence（防残留冻结，与 _applyMicroExpression 同款）
    if (!enabled) {
        if (_lipSyncMorphName) {
            const old = morphManager.getMorphTargetByName?.(_lipSyncMorphName);
            if (old) {
                old.influence = 0;
            }
        }
        if (_lipSyncMorphSet?.smile) {
            const oldSmile = morphManager.getMorphTargetByName?.(_lipSyncMorphSet.smile);
            if (oldSmile) {
                oldSmile.influence = 0;
            }
        }
        _lipSyncMorphName = null;
        _lipSyncMorphSet = null;
        _smoothLow = 0;
        _smoothHigh = 0;
        return;
    }

    // #10: 音源切换 → 立即重置状态
    if (getAudioPath() !== _lastLipSyncAudioPath) {
        _lipSyncMorphName = null;
        _lipSyncMorphSet = null;
        _smoothLow = 0;
        _smoothHigh = 0;
        _lastLipSyncAudioPath = getAudioPath();
    }

    // #12: 音频停止时指数衰减（约 20 帧淡出）
    if (!isAudioPlaying()) {
        _smoothLow *= 0.85;
        _smoothHigh *= 0.85;
        if (_smoothLow < 0.005 && _smoothHigh < 0.005) {
            _smoothLow = 0;
            _smoothHigh = 0;
            if (_lipSyncMorphName) {
                const morph = morphManager.getMorphTargetByName?.(_lipSyncMorphName);
                if (morph) {
                    morph.influence = 0;
                }
            }
            return;
        }
        // 仍在衰减期：继续以衰减值应用 morph 权重
    }

    // morph 名缓存：仅 modelId 变化时重建（消除每帧 O(M) 扫描）
    const modelId = perceptionModelId;
    if (modelId !== _lastLipSyncModelId) {
        _lastLipSyncModelId = modelId;
        const morphNames = morphManager.getMorphTargetNames?.() || [];
        _lastLipSyncMorphNames = morphNames;
        _lastLipSyncMorphNameSet = new Set(morphNames);
        _lipSyncMorphName = null;
        _lipSyncMorphSet = null;
    }

    // 查找口型 morph（仅首次或 modelId 变化时）
    if (!_lipSyncMorphName || !_lastLipSyncMorphNameSet.has(_lipSyncMorphName)) {
        _lipSyncMorphName = findLipMorph(_lastLipSyncMorphNames);
        _lipSyncMorphSet = findAllLipMorphs(_lastLipSyncMorphNames);
    }
    if (!_lipSyncMorphName) {
        return;
    }

    // 从 BeatDetector 取频段能量
    const beatDetector = getProcBeatDetector();
    const lowLevel = beatDetector ? beatDetector.getLevel(VOICE_BIN_START, VOICE_BIN_END) : 0;
    const highLevel = beatDetector ? beatDetector.getLevel(HIGH_BIN_START, HIGH_BIN_END) : 0;

    // 低通滤波（音频播放时才平滑，衰减期保留衰减值）
    if (isAudioPlaying()) {
        _smoothLow = _smoothLow * 0.7 + lowLevel * 0.3;
        _smoothHigh = _smoothHigh * 0.7 + highLevel * 0.3;
    }

    // open morph（あ）
    const openWeight = amplitudeToWeight(
        _smoothLow,
        perceptionState.lipSyncSensitivity,
        perceptionState.lipSyncIntensity
    );
    const openMorph = morphManager.getMorphTargetByName?.(_lipSyncMorphName);
    if (openMorph) {
        openMorph.influence = openWeight;
    }

    // 多口型 morph（close 反比 + pucker 高频驱动）
    if (perceptionState.lipSyncMultiMorphEnabled && _lipSyncMorphSet) {
        // close：与 open 反比（嘴开时 close=0，嘴闭时 close=1）
        if (_lipSyncMorphSet.close) {
            const closeWeight = amplitudeToWeight(
                1 - _smoothLow,
                perceptionState.lipSyncSensitivity,
                perceptionState.lipSyncIntensity
            );
            const closeMorph = morphManager.getMorphTargetByName?.(_lipSyncMorphSet.close);
            if (closeMorph) {
                closeMorph.influence = closeWeight;
            }
        }
        // pucker：由高频能量驱动（模拟「う」口型）
        if (_lipSyncMorphSet.pucker) {
            const puckerWeight = amplitudeToWeight(
                _smoothHigh * 0.8,
                perceptionState.lipSyncSensitivity,
                perceptionState.lipSyncIntensity
            );
            const puckerMorph = morphManager.getMorphTargetByName?.(_lipSyncMorphSet.pucker);
            if (puckerMorph) {
                puckerMorph.influence = puckerWeight;
            }
        }
    }

    // smile：高频能量大时轻微微笑（模拟说话表情）
    if (_lipSyncMorphSet?.smile) {
        const smileWeight = Math.max(0, openWeight * 0.3 - 0.1);
        const smileMorph = morphManager.getMorphTargetByName?.(_lipSyncMorphSet.smile);
        if (smileMorph) {
            smileMorph.influence = smileWeight;
        }
    }
}
