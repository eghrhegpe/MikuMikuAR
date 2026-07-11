// footstep.ts — 脚步声控制器（ADR-088 Phase A）
//
// [doc:adr-088] 消费 feet-adjustment 的落地事件（FootLandEvent）→ 程序化合成音效 → SFX 总线发声。
// 状态为全局配置（SettingsStore），非 per-model：一套脚步声配置作用于所有模型。
// 落地事件天然要求脚部跟随（ADR-085）开启；未开脚部跟随时无落地事件（Phase B 补降级路径）。
//
// 程序化合成（Phase A 决策）：零音频资源，用噪声脉冲 + 低频 thump + 衰减包络 + 一阶低通合成，
// 按地面材质微调音色。云资源/Promise 不引入。

import { getAudioContext, getSfxEnabled, playSfx } from '@/core/audio-bus';
import { SettingsStore } from '@/lib/settings-store';
import { envState } from '@/core/state';
import { setOnFootLand, type FootLandEvent } from './feet-adjustment';

type GroundSfxKind = 'concrete' | 'grass' | 'wood' | 'water' | 'default';

// 合成 buffer 缓存（按音色 kind，避免每步重建）
const _synthCache = new Map<GroundSfxKind, AudioBuffer>();

// 参考落地速度（单位/秒）：用于把 impactSpeed 归一化到 0..1 音量
const REF_IMPACT_SPEED = 6;

interface SynthCfg {
    cutoff: number; // 一阶低通系数（越大越亮）
    noiseAmt: number; // 噪声占比
    thump: number; // 低频 thump 强度
}

const SYNTH_CFG: Record<GroundSfxKind, SynthCfg> = {
    concrete: { cutoff: 0.35, noiseAmt: 0.5, thump: 1.0 },
    grass: { cutoff: 0.18, noiseAmt: 0.9, thump: 0.4 },
    wood: { cutoff: 0.26, noiseAmt: 0.6, thump: 0.7 },
    water: { cutoff: 0.45, noiseAmt: 1.0, thump: 0.3 },
    default: { cutoff: 0.3, noiseAmt: 0.7, thump: 0.6 },
};

/** 依据当前地面类型推断脚步音色。 */
export function resolveGroundSfxKind(): GroundSfxKind {
    if (envState.waterEnabled || envState.planarReflectBlend > 0) {
        return 'water';
    }
    if (envState.groundType === 'terrain') {
        return 'concrete';
    }
    switch (envState.groundStyle) {
        case 'texture': {
            const t = envState.groundTexture.toLowerCase();
            if (/grass|草/.test(t)) {
                return 'grass';
            }
            if (/wood|木/.test(t)) {
                return 'wood';
            }
            return 'default';
        }
        default:
            return 'default';
    }
}

/** 程序化合成一种脚步音色（首次调用后缓存复用）。 */
function synthFootstep(kind: GroundSfxKind): AudioBuffer {
    const cached = _synthCache.get(kind);
    if (cached) {
        return cached;
    }
    const ctx = getAudioContext();
    const dur = 0.18;
    const sr = ctx.sampleRate;
    const len = Math.max(1, Math.floor(sr * dur));
    const buf = ctx.createBuffer(1, len, sr);
    const data = buf.getChannelData(0);
    const cfg = SYNTH_CFG[kind];

    // 1) 噪声脉冲 + 低频 thump，乘快速衰减包络
    for (let i = 0; i < len; i++) {
        const tNorm = i / len;
        const env = Math.pow(1 - tNorm, 2.2);
        const noise = (Math.random() * 2 - 1) * cfg.noiseAmt;
        const thump = Math.sin(2 * Math.PI * 70 * tNorm) * cfg.thump * Math.exp(-tNorm * 18);
        data[i] = (noise * 0.6 + thump) * env;
    }
    // 2) 一阶低通（指数滑动平均）近似
    let prev = 0;
    const a = Math.max(0.001, Math.min(1, cfg.cutoff));
    for (let i = 0; i < len; i++) {
        prev = prev + a * (data[i] - prev);
        data[i] = prev;
    }

    _synthCache.set(kind, buf);
    return buf;
}

/**
 * 启动脚步声系统：注入落地事件回调。
 * @param scene 预留（生命周期与场景绑定；当前通过 feet-adjustment 回调驱动，未直接使用）
 */
export function startFootstep(scene: import('@babylonjs/core/scene').Scene): void {
    void scene;
    setOnFootLand((e: FootLandEvent) => {
        const footstepEnabled = SettingsStore.get().get('footstepEnabled') as boolean;
        if (!footstepEnabled) {
            return;
        }
        if (!getSfxEnabled()) {
            return;
        }
        const kind = resolveGroundSfxKind();
        const buf = synthFootstep(kind);
        const impactVol = Math.max(0.2, Math.min(1, e.impactSpeed / REF_IMPACT_SPEED));
        const footstepVol = SettingsStore.get().get('footstepVolume') as number;
        const vol = impactVol * footstepVol;
        const detune = Math.random() * 160 - 80; // ±80 音分随机化，避免每步同音
        playSfx(buf, { volume: vol, detune });
    });
}

/** 停止脚步声系统并清空合成缓存。 */
export function stopFootstep(): void {
    setOnFootLand(null);
    _synthCache.clear();
}
