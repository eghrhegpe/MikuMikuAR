// footstep.ts — 脚步声控制器（ADR-088 Phase A + B）
//
// [doc:adr-088] 消费 feet-adjustment 的落地事件（FootLandEvent）→ 程序化合成音效 → SFX 总线发声。
// 状态为全局配置（uiState），非 per-model：一套脚步声配置作用于所有模型。
// 落地事件天然要求脚部跟随（ADR-085）开启；未开脚部跟随时有独立降级检测（Phase B）。
//
// 程序化合成（Phase A 决策）：零音频资源，用噪声脉冲 + 低频 thump + 衰减包络 + 一阶低通合成，
// 按地面材质微调音色。每个 kind 生成 3 个变体（不同种子），播放时随机选，叠加 detune 音高随机化。
// 云资源/Promise 不引入。

import { getAudioContext, getSfxEnabled, getFootstepVolume, playSfx } from '@/core/audio-bus';
import { uiState, envState } from '@/core/state';
import { setOnFootLand, isFeetAdjustmentRunning, type FootLandEvent } from './feet-adjustment';
import {
    startFallbackDetection,
    stopFallbackDetection,
} from './footstep-detect-fallback';

type GroundSfxKind = 'concrete' | 'grass' | 'wood' | 'water' | 'default';

// 合成 buffer 缓存（按音色 kind → 多个变体，避免每步重建）
const VARIANT_COUNT = 3;
const _synthCache = new Map<GroundSfxKind, AudioBuffer[]>();

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

/** 简单种子随机数生成器（mulberry32），用于合成变体确定性随机。 */
function _seededRandom(seed: number): () => number {
    let s = seed | 0;
    return () => {
        s = (s + 0x6d2b79f5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** 依据当前地面类型推断脚步音色。 */
export function resolveGroundSfxKind(): GroundSfxKind {
    if (envState.waterEnabled) {
        return 'water';
    }
    if (envState.groundType === 'terrain') {
        return 'concrete';
    }
    switch (envState.groundStyle) {
        case 'texture': {
            const t = (envState.groundTexture ?? '').toLowerCase();
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

/** 程序化合成一个变体（固定种子 → 确定性波形）。无 AudioContext 支持环境返回 null（静默降级）。 */
function _synthVariant(kind: GroundSfxKind, seed: number): AudioBuffer | null {
    const ctx = getAudioContext();
    // [audit:round13 P3] getAudioContext 现可返回 null（旧 WebView 无 AudioContext 支持），
    // 此时无法合成 buffer，返回 null 让 _getVariants 过滤 → 脚步声静默降级（不抛错）。
    if (!ctx) {
        return null;
    }
    const dur = 0.18;
    const sr = ctx.sampleRate;
    const len = Math.max(1, Math.floor(sr * dur));
    const buf = ctx.createBuffer(1, len, sr);
    const data = buf.getChannelData(0);
    const cfg = SYNTH_CFG[kind];
    const rng = _seededRandom(seed);

    // 1) 噪声脉冲 + 低频 thump（不同种子 → 不同噪声 + 不同 thump 相位）
    for (let i = 0; i < len; i++) {
        const tNorm = i / len;
        const env = Math.pow(1 - tNorm, 2.2);
        const noise = (rng() * 2 - 1) * cfg.noiseAmt;
        // 种子偏移 thump 相位，避免每个变体同一时刻峰值
        const phaseOffset = (seed * 0.37) % 1;
        const thump =
            Math.sin(2 * Math.PI * 70 * (tNorm + phaseOffset)) * cfg.thump * Math.exp(-tNorm * 18);
        data[i] = (noise * 0.6 + thump) * env;
    }
    // 2) 一阶低通（指数滑动平均）近似
    let prev = 0;
    const a = Math.max(0.001, Math.min(1, cfg.cutoff));
    for (let i = 0; i < len; i++) {
        prev = prev + a * (data[i] - prev);
        data[i] = prev;
    }

    return buf;
}

/** 获取某音色的所有变体（惰性生成，缓存复用）。无 AudioContext 支持时返回空数组（静默降级）。 */
function _getVariants(kind: GroundSfxKind): AudioBuffer[] {
    let variants = _synthCache.get(kind);
    if (!variants) {
        variants = [];
        for (let s = 0; s < VARIANT_COUNT; s++) {
            // [audit:round13 P3] _synthVariant 可返回 null（无 AudioContext 支持），过滤掉
            const v = _synthVariant(kind, s);
            if (v) {
                variants.push(v);
            }
        }
        _synthCache.set(kind, variants);
    }
    return variants;
}

/**
 * 启动脚步声系统：注入落地事件回调。
 * 若脚部跟随未开启，自动启动独立 IK 骨骼 Y 轴降级检测。
 * @param scene 场景引用（用于注册 fallback observer 和声像计算）
 */
export function startFootstep(scene: import('@babylonjs/core/scene').Scene): void {
    const callback = (e: FootLandEvent) => {
        if (!uiState.footstepEnabled) {
            return;
        }
        if (!getSfxEnabled()) {
            return;
        }
        const kind = resolveGroundSfxKind();
        const variants = _getVariants(kind);
        if (variants.length === 0) return;
        const buf = variants[Math.floor(Math.random() * variants.length)];
        // [audit] 防御 NaN/Infinity impactSpeed（检测算法偶发异常值）→ 视为 0（钳制到下限 0.2）
        const impact = Number.isFinite(e.impactSpeed) ? e.impactSpeed : 0;
        const impactVol = Math.max(0.2, Math.min(1, impact / REF_IMPACT_SPEED));
        const footstepVol = getFootstepVolume();
        const vol = impactVol * footstepVol;
        const detune = Math.random() * 160 - 80;

        // B2: 左右声像 — 由落点相对相机位置计算
        const cam = scene.activeCamera;
        const pan = cam ? Math.max(-1, Math.min(1, (e.worldX - cam.position.x) / 5)) : 0;

        // [ADR-248] 热路径静默降级：AudioContext 被关闭/设备切走时播放可能抛错，不冒泡到落地回调
        try {
            playSfx(buf, { volume: vol, detune, pan });
        } catch {
            /* 静默降级：单步脚步声音量丢失可接受 */
        }
    };

    setOnFootLand(callback);

    // 若脚部跟随未开启，启动独立降级检测
    if (!isFeetAdjustmentRunning()) {
        startFallbackDetection(scene, callback);
    }
}

/** 停止脚步声系统并清空合成缓存。 */
export function stopFootstep(): void {
    setOnFootLand(null);
    stopFallbackDetection();
    _synthCache.clear();
}
