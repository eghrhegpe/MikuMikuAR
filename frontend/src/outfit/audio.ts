// audio.ts — 音乐播放系统（基于 babylon-mmd StreamAudioPlayer）
// 使用 babylon-mmd 内置 StreamAudioPlayer 替代自建 HTMLAudioElement 管线，
// 保留自建 BeatDetector（节拍检测）桥接。
//
// VMD 同步：syncAudioPlayback 仍通过 playback.ts 每帧调用，主要处理 audioOffset 偏移。
// 后续 phase 可接入 MmdRuntime.setAudioPlayer() 实现原生音画同步。
//
// Phase C: 播放列表 + 淡入淡出 + 循环模式（none/one/all/shuffle）

import { StreamAudioPlayer } from 'babylon-mmd/esm/Runtime/Audio/streamAudioPlayer';
import { resolveFileUrl } from '../core/fileservice';
import { triggerAutoSave, setUIState } from '../core/config';
import { clamp01, logWarn } from '@/core/utils';
import type { BeatDetector } from '../motion-algos/beat-detector';
import { uiState } from '../core/state';

let streamPlayer: StreamAudioPlayer | null = null;
let audioName = '';
let audioPath = '';
let beatDetector: BeatDetector | null = null;
let beatDetectorAttached = false;

// ======== Phase C: 播放列表 + 循环模式 ========

/** 播放列表（URL 数组）。模块级，不持久化到 uiState。 */
let _playlist: string[] = [];
/** 播放列表当前索引（-1 = 无选中）。 */
let _playlistIndex = -1;
/** 跨淡入淡出用的 GainNode（串联在 StreamAudioPlayer 的 _audio 之后）。 */
let _fadeGain: GainNode | null = null;
/** 上次 _attachEndedListener 注册的 ended 回调，用于清理。 */
let _lastEndedHandler: (() => void) | null = null;

/** 获取或创建 StreamAudioPlayer 单例。 */
function ensurePlayer(): StreamAudioPlayer {
    if (!streamPlayer) {
        streamPlayer = new StreamAudioPlayer(null, { pool: false });
        streamPlayer.volume = getVolume(); // 应用存储音量
        _ensureFadeGain();
    }
    return streamPlayer;
}

/**
 * 确保 fade GainNode 已创建并串联到 StreamAudioPlayer 的 _audio。
 * 每次 source 变化后 _audio 可能被重建，需重新 attach。
 */
function _ensureFadeGain(): void {
    if (!streamPlayer) {
        return;
    }
    const audio = (streamPlayer as unknown as { _audio?: HTMLAudioElement })._audio;
    if (!audio) {
        return;
    }
    // 若已有 GainNode 且 audio 已连接，跳过
    // 每次 source 变化后 _audio 是新的，所以需要重新连接
    try {
        const ctx = new (window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
        if (_fadeGain) {
            _fadeGain.disconnect();
            _fadeGain = null;
        }
        const source = ctx.createMediaElementSource(audio);
        _fadeGain = ctx.createGain();
        _fadeGain.gain.value = 1;
        source.connect(_fadeGain);
        _fadeGain.connect(ctx.destination);
        // 关闭 StreamAudioPlayer 内部对 audio 的默认连接（通过 volume 属性控制）
        // 注：StreamAudioPlayer 不直接操作 audio 的 connect，它只设 volume 属性；
        // 创建 MediaElementSource 后 audio 自动从默认输出断开，需手动重连 destination。
        // ctx.destination 已通过 _fadeGain 连接；audio 的默认输出被 MediaElementSource 取代。
    } catch {
        // MediaElementSource 只能创建一次，若已创建则静默跳过
        _fadeGain = null;
    }
}

/** 读取当前重复模式（持久化在 uiState）。 */
function getRepeatMode(): 'none' | 'one' | 'all' | 'shuffle' {
    return uiState.audioRepeatMode ?? 'none';
}

/** 下一曲索引（按 repeatMode 计算）。 */
function _nextIndex(): number {
    const mode = getRepeatMode();
    if (_playlist.length === 0) {
        return -1;
    }
    switch (mode) {
        case 'none':
            return _playlistIndex < _playlist.length - 1 ? _playlistIndex + 1 : -1;
        case 'one':
            return _playlistIndex; // 重复当前
        case 'all':
            return (_playlistIndex + 1) % _playlist.length;
        case 'shuffle':
            return Math.floor(Math.random() * _playlist.length);
    }
}

/** 上一曲索引（shuffle 时回到顺序上一曲，非随机）。 */
function _prevIndex(): number {
    if (_playlist.length === 0) {
        return -1;
    }
    if (_playlistIndex <= 0) {
        return getRepeatMode() === 'all' ? _playlist.length - 1 : -1;
    }
    return _playlistIndex - 1;
}

/**
 * 在底层 _audio 上监听 ended 事件。
 * 每次 source 变化后 _audio 被重建，需重新 attach。
 */
function _attachEndedListener(): void {
    if (!streamPlayer) {
        return;
    }
    const audio = (streamPlayer as unknown as { _audio?: HTMLAudioElement })._audio;
    if (!audio) {
        return;
    }
    // 清理旧 listener
    if (_lastEndedHandler) {
        audio.removeEventListener('ended', _lastEndedHandler);
        _lastEndedHandler = null;
    }
    _lastEndedHandler = () => {
        // 仅在非 VMD 同步模式下自动切下一曲（VMD 同步由 syncAudioPlayback 控制）
        // 检查当前是否有 audioName（表示有音频加载）
        if (!audioName) {
            return;
        }
        const mode = getRepeatMode();
        if (mode === 'none' && _playlistIndex >= _playlist.length - 1) {
            // 播完列表最后一首，不自动切
            return;
        }
        nextTrack();
    };
    audio.addEventListener('ended', _lastEndedHandler);
}

/** 播放列表中的指定索引。 */
async function _playIndex(index: number): Promise<void> {
    if (index < 0 || index >= _playlist.length) {
        return;
    }
    _playlistIndex = index;
    const url = _playlist[index];
    const fileName = url.split('/').pop()?.split('?')[0] || `Track ${index + 1}`;

    const player = ensurePlayer();
    player.source = url;
    audioName = fileName;
    audioPath = '';
    _attachEndedListener();
    // 淡入淡出：渐出当前音量 → 换源 → 渐入
    _crossfadeTo(player);
}

/**
 * 淡入淡出切换。
 * 先快速将 volume 降到 0，换源后渐回原值。
 */
function _crossfadeTo(player: StreamAudioPlayer): void {
    const targetVol = getVolume();
    const fadeMs = 150;
    const steps = 6;
    const intervalMs = fadeMs / steps;

    // 渐出（当前音量 → 0）
    if (_fadeGain) {
        _fadeGain.gain.linearRampToValueAtTime(0, _fadeGain.context.currentTime + fadeMs / 1000);
    } else {
        // 无 GainNode 时直接设 volume=0
        player.volume = 0;
    }

    setTimeout(() => {
        // 切换源（已在 _playIndex 中设了 source，但需确保播放）
        player.play().catch(() => {
            /* autoplay 拦截 */
        });

        // 渐入（0 → targetVol）
        if (_fadeGain) {
            _fadeGain.gain.setValueAtTime(0, _fadeGain.context.currentTime);
            _fadeGain.gain.linearRampToValueAtTime(1, _fadeGain.context.currentTime + fadeMs / 1000);
        } else {
            // 无 GainNode 时逐步渐入
            let step = 0;
            const rampUp = setInterval(() => {
                step++;
                player.volume = (targetVol * step) / steps;
                if (step >= steps) {
                    clearInterval(rampUp);
                }
            }, intervalMs);
        }
    }, fadeMs);
}

// ======== 播放控制 ========

export async function playAudio(url: string, name: string): Promise<void> {
    // 添加到播放列表
    const existingIdx = _playlist.indexOf(url);
    if (existingIdx >= 0) {
        _playlistIndex = existingIdx;
    } else {
        _playlist.push(url);
        _playlistIndex = _playlist.length - 1;
    }
    audioName = name;
    audioPath = '';

    const player = ensurePlayer();
    player.source = url;
    // _audio 在 source 设置后创建，此时桥接 BeatDetector 和 ended 监听
    if (beatDetector && !beatDetectorAttached) {
        _tryAttachBeatDetector(player);
    }
    _attachEndedListener();
    try {
        await player.play();
    } catch (err) {
        logWarn('audio', 'playAudio', err);
    }
}

export async function loadAudioFile(filePath: string): Promise<void> {
    const { url } = await resolveFileUrl(filePath);
    const fileName = filePath.split(/[\\/]/).pop() || '';
    // 添加到播放列表
    const existingIdx = _playlist.indexOf(url);
    if (existingIdx >= 0) {
        _playlistIndex = existingIdx;
    } else {
        _playlist.push(url);
        _playlistIndex = _playlist.length - 1;
    }
    audioName = fileName;
    audioPath = filePath;

    const player = ensurePlayer();
    player.source = url;
    // _audio 在 source 设置后创建
    if (beatDetector && !beatDetectorAttached) {
        _tryAttachBeatDetector(player);
    }
    _attachEndedListener();
    // StreamAudioPlayer 内部自动流式加载，无需手动 load()
    try {
        await player.play();
    } catch (_) {
        /* 自动播放被浏览器拦截 — StreamAudioPlayer 内部有静音先行→unmute 渐进策略 */
    }
    notifyBeatDetectorReset();
    triggerAutoSave();
}

// ======== Phase C: 播放列表控制 ========

/** 设置播放列表（替换当前列表，重置索引）。 */
export function setPlaylist(urls: string[]): void {
    _playlist = [...urls];
    _playlistIndex = _playlist.length > 0 ? 0 : -1;
}

/** 追加到播放列表末尾。 */
export function addToPlaylist(url: string): void {
    _playlist.push(url);
    if (_playlistIndex < 0) {
        _playlistIndex = 0;
    }
}

/** 获取当前播放列表。 */
export function getPlaylist(): string[] {
    return [..._playlist];
}

/** 获取当前播放列表索引（-1 = 无）。 */
export function getPlaylistIndex(): number {
    return _playlistIndex;
}

/** 切换到下一曲。 */
export async function nextTrack(): Promise<void> {
    const idx = _nextIndex();
    if (idx < 0) {
        return;
    }
    await _playIndex(idx);
}

/** 切换到上一曲。 */
export async function prevTrack(): Promise<void> {
    const idx = _prevIndex();
    if (idx < 0) {
        return;
    }
    // 若当前曲目已播放超过 3s，先重播当前曲目
    if (streamPlayer && streamPlayer.currentTime > 3) {
        streamPlayer.currentTime = 0;
        return;
    }
    await _playIndex(idx);
}

/** 设置重复模式（持久化）。 */
export function setRepeatMode(mode: 'none' | 'one' | 'all' | 'shuffle'): void {
    setUIState({ audioRepeatMode: mode });
}

/** 获取当前重复模式。 */
export function getRepeatModeStr(): 'none' | 'one' | 'all' | 'shuffle' {
    return getRepeatMode();
}

// ======== 状态查询 ========

export function setVolume(v: number): void {
    const val = clamp01(v);
    setUIState({ volume: val });
    applyGain();
}

export function getVolume(): number {
    return uiState.volume ?? 0.7;
}

export function setAudioOffset(seconds: number): void {
    if (!Number.isFinite(seconds)) {
        return;
    }
    setUIState({ audioOffset: seconds });
}

export function getAudioOffset(): number {
    return uiState.audioOffset ?? 0;
}

// ======== 状态查询 ========

export function getCurrentTime(): number {
    return streamPlayer?.currentTime ?? 0;
}

export function getDuration(): number {
    const d = streamPlayer?.duration;
    return d != null && !isNaN(d) ? d : 0;
}

export function seekAudio(seconds: number): void {
    if (!streamPlayer) {
        return;
    }
    const clamped = Math.max(0, Math.min(getDuration(), seconds));
    if (!isNaN(clamped)) {
        streamPlayer.currentTime = clamped;
    }
}

export function isAudioPlaying(): boolean {
    return streamPlayer ? !streamPlayer.paused : false;
}

export function getAudioName(): string {
    return audioName;
}

// ======== VMD 同步（含 audioOffset） ========

const SYNC_THRESHOLD = 0.1;

export function syncAudioPlayback(vmdTime: number, isPlaying: boolean, vmdDuration: number): void {
    if (!streamPlayer || !audioName) {
        return;
    }

    const audioTargetTime = vmdTime + getAudioOffset();
    const audioDur = getDuration();

    if (vmdDuration > 0 && audioDur > 0) {
        // 播放状态同步（runtime play/pause → audio）
        if (isPlaying && streamPlayer.paused) {
            if (audioTargetTime >= 0 && audioTargetTime < audioDur) {
                streamPlayer.currentTime = audioTargetTime;
                streamPlayer.play().catch(() => {
                    /* autoplay 拦截 */
                });
            } else if (audioTargetTime >= audioDur) {
                streamPlayer.currentTime = 0;
                streamPlayer.play().catch(() => {});
            }
        } else if (!isPlaying && !streamPlayer.paused) {
            streamPlayer.pause();
        }

        // 偏移纠偏（偏差 > 阈值时 seek 校准）
        if (isPlaying && !streamPlayer.paused) {
            const diff = Math.abs(streamPlayer.currentTime - audioTargetTime);
            if (diff > SYNC_THRESHOLD) {
                if (audioTargetTime >= 0 && audioTargetTime < audioDur) {
                    streamPlayer.currentTime = audioTargetTime;
                } else if (audioTargetTime >= audioDur) {
                    streamPlayer.currentTime = 0;
                }
            }
        }
    }

    }

// ======== Beat Detector 桥接 ========

export function attachBeatDetector(detector: BeatDetector): void {
    beatDetector = detector;
    if (streamPlayer && !beatDetectorAttached) {
        _tryAttachBeatDetector(streamPlayer);
    }
}

export function applyGain(): void {
    const vol = getVolume();
    if (streamPlayer) {
        streamPlayer.volume = vol;
    }
    if (beatDetector) {
        beatDetector.setVolume(vol);
    }
}

export function notifyBeatDetectorReset(): void {
    if (beatDetector) {
        beatDetector.reset();
    }
}

/** 暴露内部 StreamAudioPlayer 供 scene.ts 调用 MmdRuntime.setAudioPlayer()。 */
export function getStreamPlayer(): StreamAudioPlayer | null {
    return streamPlayer;
}
