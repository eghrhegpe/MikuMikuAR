// audio.ts — 音乐播放系统
// 支持 MP3/WAV/OGG，与 VMD 动画同步，含音量、进度、音频偏移控制

import { resolveFileUrl } from '../core/fileservice';
import { triggerAutoSave, setUIState } from '../core/config';
import { clamp01 } from '@/core/utils';
import type { BeatDetector } from '../motion-algos/beat-detector';
import { SettingsStore, SETTINGS_UPDATED } from '../lib/settings-store';

let audioElement: HTMLAudioElement | null = null;
let audioName = '';
let audioPath = '';
let isSeeking = false;
function ensureAudio(): HTMLAudioElement {
    if (!audioElement) {
        audioElement = new Audio();
        audioElement.crossOrigin = 'anonymous';
        audioElement.volume = getVolume();
    }
    // Re-attach beat detector when audio element is (re)created
    if (beatDetector && !beatDetectorAttached) {
        beatDetectorAttached = beatDetector.attach(audioElement);
    }
    return audioElement;
}

export async function playAudio(url: string, name: string): Promise<void> {
    const audio = ensureAudio();
    audio.src = url;
    audioName = name;
    audioPath = '';
    try {
        await audio.play();
    } catch (err) {
        console.warn('playAudio:', err);
    }
}

export async function loadAudioFile(filePath: string): Promise<void> {
    const { url } = await resolveFileUrl(filePath);
    const fileName = filePath.split(/[\\/]/).pop() || '';
    const audio = ensureAudio();
    audio.src = url;
    audioName = fileName;
    audioPath = filePath;
    audio.load();
    try {
        await audio.play();
    } catch (_) {
        /* browser may block autoplay */
    }
    notifyBeatDetectorReset();
    triggerAutoSave();
}

export function getAudioPath(): string {
    return audioPath;
}

export function pauseAudio(): void {
    if (!audioElement) {
        return;
    }
    audioElement.pause();
}

export function resumeAudio(): void {
    if (!audioElement) {
        return;
    }
    audioElement.play().catch((err) => console.warn('resumeAudio:', err));
}

export function stopAudio(): void {
    if (!audioElement) {
        return;
    }
    audioElement.pause();
    audioElement.currentTime = 0;
}

export function clearAudio(): void {
    if (!audioElement) {
        return;
    }
    audioElement.pause();
    audioElement.src = '';
    audioName = '';
    audioPath = '';
    triggerAutoSave();
}

/** 释放音频系统所有资源（AudioContext / AnalyserNode）。 */
export function disposeAudio(): void {
    if (audioElement) {
        audioElement.pause();
        audioElement.src = '';
        audioElement = null;
    }
    audioName = '';
    audioPath = '';

    if (beatDetector) {
        beatDetector.dispose();
        beatDetector = null;
        beatDetectorAttached = false;
    }
}

export function setVolume(v: number): void {
    SettingsStore.get().set('volume', clamp01(v));
    setUIState({ volume: clamp01(v) });
    applyGain(); // sync beatDetector + audioElement immediately
}

export function getVolume(): number {
    return SettingsStore.get().get('volume') as number;
}

export function setAudioOffset(seconds: number): void {
    // 拒绝 NaN / Infinity：写入 SettingsStore 后会污染同步逻辑（syncAudioPlayback 的算术运算）
    if (!Number.isFinite(seconds)) {
        return;
    }
    SettingsStore.get().set('audioOffset', seconds);
    setUIState({ audioOffset: seconds });
}

export function getAudioOffset(): number {
    return SettingsStore.get().get('audioOffset') as number;
}

export function getCurrentTime(): number {
    if (!audioElement) {
        return 0;
    }
    return audioElement.currentTime;
}

export function getDuration(): number {
    if (!audioElement || isNaN(audioElement.duration)) {
        return 0;
    }
    return audioElement.duration;
}

export function seekAudio(seconds: number): void {
    if (!audioElement) {
        return;
    }
    const clamped = Math.max(0, Math.min(getDuration(), seconds));
    if (!isNaN(clamped)) {
        isSeeking = true;
        audioElement.currentTime = clamped;
        // 使用 seeked 事件精确重置，避免固定超时的不可靠性
        const onSeeked = () => {
            isSeeking = false;
            audioElement?.removeEventListener('seeked', onSeeked);
        };
        audioElement.addEventListener('seeked', onSeeked);
    }
}

export function isAudioPlaying(): boolean {
    if (!audioElement) {
        return false;
    }
    return !audioElement.paused && !audioElement.ended;
}

export function getAudioName(): string {
    return audioName;
}

let lastVmdTime = 0;
let lastVmdDuration = 0;
const SYNC_THRESHOLD = 0.1;

export function syncAudioPlayback(vmdTime: number, isPlaying: boolean, vmdDuration: number): void {
    if (!audioElement || !audioName) {
        return;
    }

    const audioTargetTime = vmdTime + getAudioOffset();
    const audioDur = getDuration();

    if (vmdDuration > 0 && audioDur > 0) {
        if (isPlaying && !isAudioPlaying() && !isSeeking) {
            if (audioTargetTime >= 0 && audioTargetTime < audioDur) {
                seekAudio(audioTargetTime);
                resumeAudio();
            } else if (audioTargetTime >= audioDur) {
                seekAudio(0);
                resumeAudio();
            }
        } else if (!isPlaying && isAudioPlaying()) {
            pauseAudio();
        }

        if (isPlaying && isAudioPlaying() && !isSeeking) {
            const currentAudioTime = getCurrentTime();
            const diff = Math.abs(currentAudioTime - audioTargetTime);
            if (diff > SYNC_THRESHOLD) {
                if (audioTargetTime >= 0 && audioTargetTime < audioDur) {
                    seekAudio(audioTargetTime);
                } else if (audioTargetTime >= audioDur) {
                    seekAudio(0);
                }
            }
        }

        if (lastVmdDuration > 0 && lastVmdTime > vmdTime + 0.5 && isPlaying) {
            seekAudio(getAudioOffset() >= 0 ? getAudioOffset() : 0);
        }
    }

    lastVmdTime = vmdTime;
    lastVmdDuration = vmdDuration;
}

// ======== Beat Detector Integration ========

let beatDetector: BeatDetector | null = null;
let beatDetectorAttached = false;

/** 接入节拍检测器到当前音频元素（惰性，仅调用一次）。 */
export function attachBeatDetector(detector: BeatDetector): void {
    beatDetector = detector;
    if (audioElement && !beatDetectorAttached) {
        beatDetectorAttached = detector.attach(audioElement);
    }
}

// AO ✂️ Connect to global settings updates
export function applyGain(): void {
    const vol = getVolume();
    if (audioElement) {
        audioElement.volume = vol;
    }
    if (beatDetector) {
        beatDetector.setVolume(vol);
    }
}

let cleanupSettingsListener: (() => void) | null = null;

function setupSettingsListener(): void {
    if (cleanupSettingsListener) {
        return;
    }
    const handler = () => applyGain();
    globalThis.addEventListener(SETTINGS_UPDATED.description!, handler);
    cleanupSettingsListener = () =>
        globalThis.removeEventListener(SETTINGS_UPDATED.description!, handler);
}

function teardownSettingsListener(): void {
    cleanupSettingsListener?.();
    cleanupSettingsListener = null;
}

// AO ✂️ Patch ensureAudio and disposeAudio to wire settings listener
const origEnsureAudio = ensureAudio as () => HTMLAudioElement;
const origDisposeAudio = disposeAudio as () => void;

function patchedEnsureAudio(): HTMLAudioElement {
    const el = origEnsureAudio();
    setupSettingsListener();
    return el;
}

function patchedDisposeAudio(): void {
    teardownSettingsListener();
    origDisposeAudio();
    if (audioElement) {
        audioElement.pause();
        audioElement.src = '';
        audioElement = null;
    }
    audioName = '';
    audioPath = '';
    if (beatDetector) {
        beatDetector.dispose();
        beatDetector = null;
    }
    beatDetectorAttached = false;
}

// Replace originals with patched versions
// eslint-disable-next-line no-func-assign
(ensureAudio as any) = patchedEnsureAudio;
// eslint-disable-next-line no-func-assign
(disposeAudio as any) = patchedDisposeAudio;

/** 音频加载后通知 beat detector 重置（新曲目 BPM 估计重新开始）。 */
export function notifyBeatDetectorReset(): void {
    if (beatDetector) {
        beatDetector.reset();
    }
}
