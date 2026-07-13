// audio-bus.ts — SFX 总线（Web Audio 短音效底座）
//
// [doc:adr-088] 脚步声与 SFX 总线基础设施。与 outfit/audio.ts 的音乐播放器解耦：
// 音乐走 HTMLAudioElement（长曲目、流式），音效走 Web Audio BufferSource（短促、多发、低延迟）。
// 本模块提供共享单一 AudioContext + 独立主增益 + 采样/合成缓存 + playSfx 多发。
//
// 自动播放策略：浏览器/WebView2 要求首个用户手势后才能 resume。playSfx 在播放前检测
// ctx.state === 'suspended' 并尝试 resume；若仍 suspended 则静默跳过（不报错、不抛异常）。

import { SettingsStore } from '@/lib/settings-store';
import { setUIState } from '@/core/state';
import { clamp01 } from '@/core/utils';

let _ctx: AudioContext | null = null;
let _master: GainNode | null = null;

/** 惰性创建共享 AudioContext（SFX 总线与未来音效共用）。 */
export function getAudioContext(): AudioContext {
    if (!_ctx) {
        const Ctor: typeof AudioContext =
            window.AudioContext ??
            (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        _ctx = new Ctor();
    }
    return _ctx;
}

/** SFX 主增益（独立于音乐音量）。增益值实时反映 sfxEnabled / sfxVolume。 */
export function getSfxMasterGain(): GainNode {
    const ctx = getAudioContext();
    if (!_master) {
        _master = ctx.createGain();
        _master.connect(ctx.destination);
    }
    const enabled = SettingsStore.get().get('sfxEnabled') as boolean;
    const vol = SettingsStore.get().get('sfxVolume') as number;
    _master.gain.value = enabled ? clamp01(vol) : 0;
    return _master;
}

export function setSfxVolume(v: number): void {
    SettingsStore.get().set('sfxVolume', clamp01(v));
    setUIState({ sfxVolume: clamp01(v) });
}

export function getSfxVolume(): number {
    return SettingsStore.get().get('sfxVolume') as number;
}

export function setSfxEnabled(on: boolean): void {
    SettingsStore.get().set('sfxEnabled', on);
    setUIState({ sfxEnabled: on });
}

export function getSfxEnabled(): boolean {
    return SettingsStore.get().get('sfxEnabled') as boolean;
}

export function setFootstepEnabled(on: boolean): void {
    SettingsStore.get().set('footstepEnabled', on);
    setUIState({ footstepEnabled: on });
}

export function getFootstepEnabled(): boolean {
    return SettingsStore.get().get('footstepEnabled') as boolean;
}

export function setFootstepVolume(v: number): void {
    SettingsStore.get().set('footstepVolume', clamp01(v));
    setUIState({ footstepVolume: clamp01(v) });
}

export function getFootstepVolume(): number {
    return SettingsStore.get().get('footstepVolume') as number;
}

export interface PlaySfxOptions {
    /** 相对音量 0..1（叠加于 master 增益） */
    volume?: number;
    /** playbackRate（音高/速度），默认 1 */
    rate?: number;
    /** 音分偏移（随机化用），默认 0 */
    detune?: number;
}

/**
 * 播放一次短音效。每次 new BufferSource（一次性、可叠加），播完自动断开释放。
 * 总线关闭（sfxEnabled=false 或 sfxVolume=0）时静默跳过。
 */
export function playSfx(buffer: AudioBuffer, opts: PlaySfxOptions = {}): void {
    if (!buffer) {
        return;
    }
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
        // 自动播放策略限制：首个用户手势前无法发声，静默放弃本次触发
        ctx.resume().catch(() => {
            /* noop */
        });
        return;
    }
    const master = getSfxMasterGain();
    if (master.gain.value <= 0) {
        return;
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    if (opts.rate !== undefined) {
        src.playbackRate.value = opts.rate;
    }
    if (opts.detune !== undefined) {
        src.detune.value = opts.detune;
    }
    const g = ctx.createGain();
    g.gain.value = clamp01(opts.volume ?? 1);
    src.connect(g);
    g.connect(master);
    src.start();
    src.onended = () => {
        try {
            src.disconnect();
            g.disconnect();
        } catch {
            /* noop */
        }
    };
}

/** 释放总线资源（context 关闭、缓存清空）。 */
export function disposeAudioBus(): void {
    if (_ctx) {
        _ctx.close().catch(() => {
            /* noop */
        });
        _ctx = null;
        _master = null;
    }
}
