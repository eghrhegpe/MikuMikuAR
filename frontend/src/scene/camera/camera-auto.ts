// [doc:architecture] Camera Auto — 节拍驱动自动运镜（beatcut）
// 从 camera.ts 拆出（ADR-148 阶段 3：camera.ts 瘦身）
// 职责: AUTO_CAMERA_PRESETS 预设池、beat 订阅/取消、节拍切换镜头 + 平滑过渡
// 依赖: camera-state（camera 引用/scene 引用/auto 状态）+ proc-motion-bridge（getProcBeatDetector）
//
// 循环依赖处理：setAutoCameraEnabled/restoreAutoCameraState 需要调用 _syncAxesFromMode
// 派生双轴状态（beatcut 叠加/移除），该函数在 camera.ts 内部。通过 setSyncAxesCallback 注入。

import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';

import { uiState } from '@/core/config';
import { schedulePersistUI } from '../env/_bridge/env-persist';
import { observe } from '@/core/observer-handle';
import { getProcBeatDetector } from '../scene';
import {
    getAutoCameraBeatCount,
    getAutoCameraPresetIdx,
    getCameraBehavior,
    getCameraScene,
    getCurrentCamera,
    isAutoCameraEnabled as isAutoCameraEnabledFlag,
    setAutoCameraBeatCount as _setAutoCameraBeatCount,
    setAutoCameraEnabledFlag,
    setAutoCameraPresetIdx as _setAutoCameraPresetIdx,
} from './camera-state';

interface AutoCameraPreset {
    alpha: number; // 水平角度 (rad)
    beta: number; // 垂直角度 (rad)
    radius: number; // 距离
}

const AUTO_CAMERA_PRESETS: AutoCameraPreset[] = [
    { alpha: -Math.PI / 2, beta: Math.PI / 3, radius: 16 }, // 正面标准
    { alpha: -Math.PI / 4, beta: Math.PI / 3.5, radius: 14 }, // 右前 45°
    { alpha: (-Math.PI * 3) / 4, beta: Math.PI / 3.5, radius: 14 }, // 左前 45°
    { alpha: -Math.PI / 2, beta: Math.PI / 6, radius: 18 }, // 高角度俯拍
    { alpha: -Math.PI / 2, beta: Math.PI / 2.5, radius: 10 }, // 近距离正面
    { alpha: 0, beta: Math.PI / 3, radius: 16 }, // 右侧 90°
    { alpha: -Math.PI, beta: Math.PI / 3, radius: 16 }, // 左侧 90°
    { alpha: -Math.PI / 2, beta: Math.PI / 4, radius: 22 }, // 远景
];

let _autoCameraBeatsPerSwitch = 4; // 每 4 拍切换一次
let _autoCameraUnsub: (() => void) | null = null;

/**
 * 当前过渡动画的 observer 句柄。模块级追踪以支持显式释放：
 * - 新 beat 触发时 dispose 旧过渡（避免多个过渡并行互相覆盖）
 * - 关闭自动运镜 / 切换相机模式时 dispose 过渡（避免操作已释放的相机）
 * - 过渡自然完成时由回调内部 dispose 并置 null
 */
let _transitionHandle: { dispose(): void } | null = null;

/** camera.ts 注入：派生双轴状态的回调（_syncAxesFromMode）。 */
let _syncAxesCallback: (() => void) | null = null;

/** camera.ts 启动时注入 _syncAxesFromMode 回调。 */
export function setSyncAxesCallback(cb: () => void): void {
    _syncAxesCallback = cb;
}

/**
 * ADR-100 P2 — 集中订阅 beat 回调。
 * 优先用调用方传入的 detector（兼容旧签名），否则回退到内部全局 procBeatDetector。
 * 覆盖开关路径与 restore 路径，消除 restore 后不订阅导致的「饥饿」（beat 永不触发）。
 */
function _subscribeAutoCameraBeat(
    detector?: { onBeat: (cb: () => void) => () => void } | null
): void {
    _unsubscribeAutoCameraBeat();
    const bd = detector ?? getProcBeatDetector();
    if (bd) {
        _autoCameraUnsub = bd.onBeat(_onAutoCameraBeat);
    }
}

function _unsubscribeAutoCameraBeat(): void {
    if (_autoCameraUnsub) {
        _autoCameraUnsub();
        _autoCameraUnsub = null;
    }
    // 同时释放进行中的过渡动画：退订后 beat 不再触发，
    // 但已启动的过渡会继续修改 cam.alpha/beta/radius，可能操作已切换/释放的相机。
    if (_transitionHandle) {
        _transitionHandle.dispose();
        _transitionHandle = null;
    }
}

/** 从 UIState 恢复自动机位状态。ADR-100 P2：恢复时集中订阅并派生 beatcut 行为，修复饥饿。 */
export function restoreAutoCameraState(): void {
    const s = uiState;
    if (s.autoCameraEnabled) {
        setAutoCameraEnabledFlag(true);
        setAutoCameraBeatsPerSwitch(s.autoCameraBeatsPerSwitch || 4);
        _subscribeAutoCameraBeat();
        _syncAxesCallback?.();
    }
}

/**
 * 设置 Auto Camera（beatcut）开关。ADR-100 P2：启用时集中订阅 beat、派生 beatcut 行为；
 * 禁用时移除订阅并回落基底行为。beatDetector 参数保留兼容旧调用方，缺省时内部回退。
 */
export function setAutoCameraEnabled(
    v: boolean,
    beatDetector?: { onBeat: (cb: () => void) => () => void } | null
): void {
    if (v === isAutoCameraEnabledFlag()) {
        return;
    }
    setAutoCameraEnabledFlag(v);
    uiState.autoCameraEnabled = v;
    schedulePersistUI();
    if (v) {
        _setAutoCameraBeatCount(0);
        _setAutoCameraPresetIdx(0);
        _subscribeAutoCameraBeat(beatDetector);
    } else {
        _unsubscribeAutoCameraBeat();
    }
    // 重新派生行为轴：beatcut 叠加/移除（互斥由 _resolveBehavior 保证）。
    _syncAxesCallback?.();
}

export function isAutoCameraEnabled(): boolean {
    return isAutoCameraEnabledFlag();
}

/** 设置每多少拍切换一次镜头。 */
export function setAutoCameraBeatsPerSwitch(n: number): void {
    _autoCameraBeatsPerSwitch = Math.max(1, Math.min(16, Math.round(n)));
    uiState.autoCameraBeatsPerSwitch = _autoCameraBeatsPerSwitch;
    schedulePersistUI();
}

export function getAutoCameraBeatsPerSwitch(): number {
    return _autoCameraBeatsPerSwitch;
}

function _onAutoCameraBeat(): void {
    // ADR-100 P2：门控改判行为轴。beatcut 与 concert/turntable/scripted 互斥，
    // 后者激活时 _resolveBehavior 不会派生 beatcut，这里直接早退（互斥的运行时体现）。
    // 抑制期不消耗 beat 计数，恢复 orbit 后从当前计数继续。
    if (getCameraBehavior() !== 'beatcut') {
        return;
    }
    _setAutoCameraBeatCount(getAutoCameraBeatCount() + 1);
    if (getAutoCameraBeatCount() < getAutoCameraBeatsPerSwitch()) {
        return;
    }
    _setAutoCameraBeatCount(0);

    const cam = getCurrentCamera();
    if (!cam || !(cam instanceof ArcRotateCamera)) {
        return;
    }

    // 切到下一个预设（避免连续重复）
    let nextIdx =
        (getAutoCameraPresetIdx() +
            1 +
            Math.floor(Math.random() * (AUTO_CAMERA_PRESETS.length - 1))) %
        AUTO_CAMERA_PRESETS.length;
    if (nextIdx === getAutoCameraPresetIdx()) {
        nextIdx = (nextIdx + 1) % AUTO_CAMERA_PRESETS.length;
    }
    _setAutoCameraPresetIdx(nextIdx);

    const preset = AUTO_CAMERA_PRESETS[nextIdx];

    // 平滑过渡到新预设（逐帧插值，~0.5s 完成）
    const startAlpha = cam.alpha;
    const startBeta = cam.beta;
    const startRadius = cam.radius;
    let t = 0;
    const duration = 500;
    const startTime = performance.now();

    const scene = getCameraScene();
    if (!scene) {
        // fallback: no scene reference, complete instantly
        cam.alpha = preset.alpha;
        cam.beta = preset.beta;
        cam.radius = preset.radius;
        return;
    }
    // 新过渡启动前 dispose 旧过渡，避免多个过渡并行互相覆盖。
    if (_transitionHandle) {
        _transitionHandle.dispose();
        _transitionHandle = null;
    }
    _transitionHandle = observe(scene.onBeforeRenderObservable, () => {
        const elapsed = performance.now() - startTime;
        t = Math.min(1, elapsed / duration);
        const ease = t * t * (3 - 2 * t); // smoothstep
        cam.alpha = startAlpha + (preset.alpha - startAlpha) * ease;
        cam.beta = startBeta + (preset.beta - startBeta) * ease;
        cam.radius = startRadius + (preset.radius - startRadius) * ease;
        if (t >= 1) {
            _transitionHandle?.dispose();
            _transitionHandle = null;
        }
    });
}

// [doc:adr-238] 注册自动相机恢复供 core/init 经 scene-action-bridge 调用
import { registerSceneAction } from '@/core/scene-action-bridge';
registerSceneAction('restoreAutoCameraState', () => restoreAutoCameraState());
