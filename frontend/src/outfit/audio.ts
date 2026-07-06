// audio.ts — 音乐播放系统
// 支持 MP3/WAV/OGG，与 VMD 动画同步，含音量、进度、音频偏移控制

import { resolveFileUrl } from '../core/fileservice';
import { triggerAutoSave } from '../core/config';
import type { BeatDetector } from '../motion-algos/beat-detector';

let audioElement: HTMLAudioElement | null = null;
let audioName = '';
let audioPath = '';
let audioOffset = 0;
let volume = 1;
let isSeeking = false;
function ensureAudio(): HTMLAudioElement {
    if (!audioElement) {
        audioElement = new Audio();
        audioElement.crossOrigin = 'anonymous';
        audioElement.volume = volume;
    }
    // Re-attach beat detector when audio element is (re)created
    if (beatDetector && !beatDetectorAttached) {
        try {
            beatDetector.attach(audioElement);
            beatDetectorAttached = true;
        } catch (err) {
            console.warn('ensureAudio beat detector attach:', err);
        }
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
    audioOffset = 0;
    if (beatDetector) {
        beatDetector.dispose();
        beatDetector = null;
        beatDetectorAttached = false;
    }
}

export function setVolume(v: number): void {
    volume = Math.max(0, Math.min(1, v));
    if (audioElement) {
        audioElement.volume = volume;
    }
    // 若 beatDetector 已接管音频路由，通过 GainNode 控制实际输出音量
    if (beatDetector) {
        beatDetector.setVolume(volume);
    }
}

export function getVolume(): number {
    return volume;
}

export function setAudioOffset(seconds: number): void {
    audioOffset = seconds;
}

export function getAudioOffset(): number {
    return audioOffset;
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

    const audioTargetTime = vmdTime + audioOffset;
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
            seekAudio(audioOffset >= 0 ? audioOffset : 0);
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
        try {
            detector.attach(audioElement);
            beatDetectorAttached = true;
        } catch (err) {
            console.warn('attachBeatDetector:', err);
        }
    }
}

/** 音频加载后通知 beat detector 重置（新曲目 BPM 估计重新开始）。 */
export function notifyBeatDetectorReset(): void {
    if (beatDetector) {
        beatDetector.reset();
    }
}
