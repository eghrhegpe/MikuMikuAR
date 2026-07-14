// audio.ts — 音乐播放系统（基于 babylon-mmd StreamAudioPlayer）
// 使用 babylon-mmd 内置 StreamAudioPlayer 替代自建 HTMLAudioElement 管线，
// 保留自建 BeatDetector（节拍检测）桥接。
//
// VMD 同步：syncAudioPlayback 仍通过 playback.ts 每帧调用，主要处理 audioOffset 偏移。
// 后续 phase 可接入 MmdRuntime.setAudioPlayer() 实现原生音画同步。

import { StreamAudioPlayer } from 'babylon-mmd/esm/Runtime/Audio/streamAudioPlayer';
import { resolveFileUrl } from '../core/fileservice';
import { triggerAutoSave, setUIState } from '../core/config';
import { clamp01, logWarn } from '@/core/utils';
import type { BeatDetector } from '../motion-algos/beat-detector';
import { uiState } from '../core/state';

let streamPlayer: StreamAudioPlayer | null = null;
let audioName = '';
let audioPath = '';

/** 获取或创建 StreamAudioPlayer 单例。 */
function ensurePlayer(): StreamAudioPlayer {
    if (!streamPlayer) {
        streamPlayer = new StreamAudioPlayer(null, { pool: false });
        streamPlayer.volume = getVolume(); // 应用存储音量
    }
    return streamPlayer;
}

/** 从 StreamAudioPlayer 内部取出 HTMLAudioElement，供 BeatDetector 附着。 */
function _tryAttachBeatDetector(player: StreamAudioPlayer): void {
    if (beatDetectorAttached || !beatDetector) {
        return;
    }
    const el = (player as unknown as { _audio?: HTMLAudioElement })._audio;
    if (el) {
        beatDetectorAttached = beatDetector.attach(el);
    }
}

// ======== 播放控制 ========

export async function playAudio(url: string, name: string): Promise<void> {
    const player = ensurePlayer();
    player.source = url;
    // _audio 在 source 设置后创建，此时桥接 BeatDetector
    if (beatDetector && !beatDetectorAttached) {
        _tryAttachBeatDetector(player);
    }
    audioName = name;
    audioPath = '';
    try {
        await player.play();
    } catch (err) {
        logWarn('audio', 'playAudio', err);
    }
}

export async function loadAudioFile(filePath: string): Promise<void> {
    const { url } = await resolveFileUrl(filePath);
    const fileName = filePath.split(/[\\/]/).pop() || '';
    const player = ensurePlayer();
    player.source = url;
    // _audio 在 source 设置后创建，此时桥接 BeatDetector
    if (beatDetector && !beatDetectorAttached) {
        _tryAttachBeatDetector(player);
    }
    audioName = fileName;
    audioPath = filePath;
    // StreamAudioPlayer 内部自动流式加载，无需手动 load()
    try {
        await player.play();
    } catch (_) {
        /* 自动播放被浏览器拦截 — StreamAudioPlayer 内部有静音先行→unmute 渐进策略 */
    }
    notifyBeatDetectorReset();
    triggerAutoSave();
}

export function getAudioPath(): string {
    return audioPath;
}

export function pauseAudio(): void {
    streamPlayer?.pause();
}

export function resumeAudio(): void {
    if (!streamPlayer) {
        return;
    }
    streamPlayer.play().catch((err) => logWarn('audio', 'resumeAudio', err));
}

export function stopAudio(): void {
    if (!streamPlayer) {
        return;
    }
    streamPlayer.pause();
    streamPlayer.currentTime = 0;
}

export function clearAudio(): void {
    if (!streamPlayer) {
        return;
    }
    streamPlayer.pause();
    streamPlayer.source = '';
    audioName = '';
    audioPath = '';
    triggerAutoSave();
}

export function disposeAudio(): void {
    if (streamPlayer) {
        streamPlayer.pause();
        streamPlayer.source = '';
        streamPlayer.dispose();
        streamPlayer = null;
    }
    audioName = '';
    audioPath = '';

    if (beatDetector) {
        beatDetector.dispose();
        beatDetector = null;
        beatDetectorAttached = false;
    }
}

// ======== 音量 / 偏移 ========

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

let lastVmdTime = 0;
let lastVmdDuration = 0;
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

    lastVmdTime = vmdTime;
    lastVmdDuration = vmdDuration;
}

// ======== Beat Detector 桥接 ========

let beatDetector: BeatDetector | null = null;
let beatDetectorAttached = false;

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
