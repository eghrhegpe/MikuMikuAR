// audio.ts — 音乐播放系统（基于 babylon-mmd StreamAudioPlayer）
// 使用 babylon-mmd 内置 StreamAudioPlayer 替代自建 HTMLAudioElement 管线，
// 保留自建 BeatDetector（节拍检测）桥接。
//
// VMD 同步：syncAudioPlayback 仍通过 playback.ts 每帧调用，主要处理 audioOffset 偏移。
// 后续 phase 可接入 MmdRuntime.setAudioPlayer() 实现原生音画同步。
//
// Phase C: 播放列表 + 淡入淡出 + 循环模式（none/one/all/shuffle）

import { StreamAudioPlayer } from 'babylon-mmd/esm/Runtime/Audio/streamAudioPlayer';
import { readFileBytes } from '../core/wails-bindings';
import { triggerAutoSave, setUIState } from '../core/config';
import { clamp01 } from '@/core/clamp';
import { logWarn } from '@/core/logger';
import { t } from '@/core/i18n/t';
import { reportResourceWarning } from '@/core/resource-warning-sink';
import { safeCallAsync, safeCallVoid } from '@/core/safe-call';
import { safeDispose } from '@/core/dispose-helpers';
import type { BeatDetector } from '../motion-algos/beat-detector';
import { getStreamAudio } from '@/core/mmd-adapter';
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
/**
 * 唯一的 AudioContext 与 MediaElementAudioSourceNode。
 * pool:false 下 StreamAudioPlayer 的 _audio 元素稳定，故只需创建一次；
 * 该 source 被淡入链路与节拍检测共享，避免对同一 <audio> 重复 createMediaElementSource。
 */
let _audioCtx: AudioContext | null = null;
let _audioSourceNode: MediaElementAudioSourceNode | null = null;
/** 上次 _attachEndedListener 注册的 ended 回调，用于清理。 */
let _lastEndedHandler: (() => void) | null = null;
/** loadAudioFile 创建的、需在本模块负责回收的 blob: URL。 */
const _ownedBlobUrls = new Set<string>();

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
    const audio = getStreamAudio(streamPlayer);
    if (!audio) {
        return;
    }
    // 已建立过（pool:false 下 _audio 元素稳定，无需重建）：直接复用
    if (_fadeGain && _audioSourceNode && _audioCtx) {
        return;
    }
    try {
        const Ctx =
            window.AudioContext ??
            (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!Ctx) {
            return;
        }
        _audioCtx = new Ctx();
        // 唯一 source：同一 <audio> 只能有一个 MediaElementSource，淡入与节拍检测共享
        _audioSourceNode = _audioCtx.createMediaElementSource(audio);
        _fadeGain = _audioCtx.createGain();
        _fadeGain.gain.value = 1;
        _audioSourceNode.connect(_fadeGain);
        _fadeGain.connect(_audioCtx.destination);
        // 创建 MediaElementSource 后 audio 自动从默认输出断开，经 _fadeGain 重连到 destination。
    } catch {
        // MediaElementSource 对同一 <audio> 只能创建一次；失败时降级为无淡入
        _fadeGain = null;
        _audioSourceNode = null;
        _closeAudioCtx();
    }
}

function _closeAudioCtx(): void {
    if (_audioCtx) {
        safeCallVoid('audio', 'closeCtx', () => {
            void _audioCtx?.close();
        });
        _audioCtx = null;
    }
}

/** 读取当前重复模式（持久化在 uiState）。 */
function getRepeatMode(): 'none' | 'one' | 'all' | 'shuffle' {
    const mode = uiState.audioRepeatMode;
    if (mode === 'none' || mode === 'one' || mode === 'all' || mode === 'shuffle') {
        return mode;
    }
    if (mode !== undefined) {
        logWarn('audio', 'getRepeatMode: unexpected value', mode);
    }
    return 'none';
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
    const audio = getStreamAudio(streamPlayer);
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
            _fadeGain.gain.linearRampToValueAtTime(
                1,
                _fadeGain.context.currentTime + fadeMs / 1000
            );
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
    await safeCallAsync('audio', 'playAudio', () => player.play());
}

export async function loadAudioFile(filePath: string, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
        return;
    }
    const bytes = await readFileBytes(filePath);
    if (!bytes) {
        logWarn('audio', 'loadAudioFile: failed to read', filePath);
        reportResourceWarning(t('resource.audioLoadFailed', { name: filePath }));
        return;
    }
    const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'audio/mpeg' });
    const url = URL.createObjectURL(blob);

    const fileName = filePath.split(/[\\/]/).pop() || '';
    // 回收被替换的旧 blob（已非播放源），避免句柄/内存泄漏
    const prevUrl = _playlist[_playlistIndex];
    if (prevUrl && prevUrl !== url && _ownedBlobUrls.has(prevUrl)) {
        URL.revokeObjectURL(prevUrl);
        _ownedBlobUrls.delete(prevUrl);
    }
    _ownedBlobUrls.add(url);
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

/** 切换到下一曲。 */
export async function nextTrack(): Promise<void> {
    const idx = _nextIndex();
    if (idx < 0) {
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

/** 从 StreamAudioPlayer 内部取出 HTMLAudioElement，供 BeatDetector 附着。 */
function _tryAttachBeatDetector(player: StreamAudioPlayer): void {
    if (beatDetectorAttached || !beatDetector) {
        return;
    }
    const el = getStreamAudio(player);
    if (el) {
        // 复用 audio.ts 持有的唯一 source 节点（同一 <audio> 只能有一个 MediaElementSource），
        // 并共享同一 AudioContext，避免跨 ctx 连接抛错。
        const shared =
            _audioCtx && _audioSourceNode
                ? { ctx: _audioCtx, sourceNode: _audioSourceNode }
                : undefined;
        beatDetectorAttached = beatDetector.attach(el, shared);
    }
}

// ======== 播放控制 ========

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
    safeCallAsync('audio', 'resumeAudio', () => streamPlayer.play());
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
        streamPlayer = safeDispose(streamPlayer);
    }
    audioName = '';
    audioPath = '';
    _playlist = [];
    _playlistIndex = -1;

    // 先释放 beatDetector（断开其 analyser/gain 与共享 source，但不关闭共享 ctx）
    if (beatDetector) {
        beatDetector = safeDispose(beatDetector);
        beatDetectorAttached = false;
    }
    // 断开淡入链路与共享 source（beatDetector 已断开，此处安全）
    if (_fadeGain) {
        try {
            _fadeGain.disconnect();
        } catch {
            /* cleanup, ignore errors */
        }
        _fadeGain = null;
    }
    if (_audioSourceNode) {
        try {
            _audioSourceNode.disconnect();
        } catch {
            /* cleanup, ignore errors */
        }
        _audioSourceNode = null;
    }
    if (_audioCtx) {
        _closeAudioCtx();
    }
    // 回收本模块持有的 blob: URL，避免句柄/内存泄漏
    for (const url of _ownedBlobUrls) {
        URL.revokeObjectURL(url);
    }
    _ownedBlobUrls.clear();
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

// [doc:adr-238] 注册音频名读取供 core/action-defs 经 scene-action-bridge 调用
import { registerSceneAction } from '@/core/scene-action-bridge';
registerSceneAction('getAudioName', () => getAudioName());

// [doc:adr-238] 注册音频操作供 scene/motion 经 scene-action-bridge 调用（切断 scene/motion→outfit）
registerSceneAction('isAudioPlaying', () => isAudioPlaying());
registerSceneAction('getAudioPath', () => getAudioPath());
registerSceneAction('syncAudioPlayback', (vmdTime: number, isPlaying: boolean, vmdDuration: number) => {
    syncAudioPlayback(vmdTime, isPlaying, vmdDuration);
});

// [doc:adr-238] 补充注册音频加载供 scene/motion 经 scene-action-bridge 调用
registerSceneAction('loadAudioFile', (filePath: string) => loadAudioFile(filePath));

// [doc:adr-238] 注册音频释放供 scene/manager 经 scene-action-bridge 调用
registerSceneAction('disposeAudio', () => disposeAudio());

// [doc:adr-238] 补充注册节拍检测器/流播放器供 scene 经 scene-action-bridge 调用
registerSceneAction('attachBeatDetector', (detector: unknown) =>
    attachBeatDetector(detector as Parameters<typeof attachBeatDetector>[0])
);
registerSceneAction('getStreamPlayer', () => getStreamPlayer());

// [doc:adr-238] 注册音量设置供 scene-serialize 经 scene-action-bridge 调用
registerSceneAction('setVolume', (v: number) => setVolume(v));

// [doc:adr-238] 注册音量/偏移读取供 scene-serialize 经 scene-action-bridge 调用
registerSceneAction('getVolume', () => getVolume());
registerSceneAction('getAudioOffset', () => getAudioOffset());

// [doc:adr-238] 注册音频偏移/恢复供 scene-serialize 经 scene-action-bridge 调用
registerSceneAction('setAudioOffset', (v: number) => setAudioOffset(v));
registerSceneAction('resumeAudio', () => resumeAudio());
