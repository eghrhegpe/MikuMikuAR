// camera-state.ts — 相机纯状态管理（getter/setter，无 scene 依赖）
// 从 camera.ts 拆分，切断 camera ↔ scene 循环依赖
// 本模块只读写模块级变量，不涉及 Babylon.js 相机对象或 scene 操作

import type { Camera } from '@babylonjs/core/Cameras/camera';

// ======== Types (单源定义，camera.ts 通过 re-export 复用) ========

/**
 * @deprecated ADR-100：单枚举混淆「控制方案 × 运动行为」两轴，保留为兼容别名。
 * 新代码请用 {@link CameraControl} × {@link CameraBehavior}。双写于 `core/types.ts`。
 */
export type CameraMode =
    'orbit' | 'freefly' | 'surround' | 'concert' | 'oneshot' | 'vmd' | 'ar' | 'beatcut';

/** ADR-100 轴 A — 控制方案（相机类 + 输入）。双写于 `core/types.ts`。 */
export type CameraControl = 'orbit' | 'freefly' | 'ar';

/** ADR-100 轴 B — 运动行为（仅对 orbit/ArcRotate 生效，初版互斥）。双写于 `core/types.ts`。 */
export type CameraBehavior = 'none' | 'turntable' | 'concert' | 'beatcut' | 'scripted';

/** ADR-100 §6.4 — scripted 行为子态。 */
export type ScriptedSubMode = 'loop' | 'oneshot';

/**
 * Orbit camera parameters.
 * targetHeight: 相对当前聚焦模型中心的垂直偏移（0 = 正中，正 = 抬高，负 = 压低）。
 *   旧版本为绝对世界 Y；现改为相对偏移，使换不同中心高度的模型时无需反复手调。
 */
export interface OrbitParams {
    targetHeight: number;
    distance: number;
    beta: number;
}

/** Freefly camera parameters. */
export interface FreeflyParams {
    speed: number;
    angularSensibility: number;
}

/** Surround (turntable) camera parameters — automatic full-circle orbit around target. */
export interface SurroundParams {
    radius: number;
    height: number;
    speed: number;
}

/** Concert (fan-cam) camera parameters — limited horizontal sweep + sinusoidal vertical bob. */
export interface ConcertParams {
    radius: number; // distance to target
    height: number; // target Y
    sweepAngle: number; // total horizontal sweep in degrees (default 120 → ±60°)
    sweepSpeed: number; // horizontal sweep frequency multiplier
    baseBeta: number; // center pitch in radians (default PI/3)
    bobAmplitude: number; // vertical oscillation amplitude in degrees
    bobSpeed: number; // vertical oscillation frequency multiplier
}

/** Per-mode parameter bundle, persisted with scene files. */
export interface CameraPreset {
    mode?: CameraMode;
    orbit: OrbitParams;
    freefly: FreeflyParams;
    surround: SurroundParams;
    concert: ConcertParams;
}

// ======== Runtime Preset State ========

let _currentPreset: CameraPreset = defaultCameraPreset();
let _fov = 0.8;
let _cameraMode: CameraMode = 'orbit';
let _cameraControl: CameraControl = 'orbit';
let _cameraBehavior: CameraBehavior = 'none';
let _scriptedSubMode: ScriptedSubMode = 'loop';
let _currentCamera: Camera | null = null;
let _focusCenterY = 8;
let _concertPaused = false;
let _surroundPaused = false;
let _cameraVmdName = '';
let _cameraVmdPath = '';
let _autoCameraEnabled = false;
let _autoCameraBeatCount = 0;
let _autoCameraPresetIdx = 0;

// ======== Defaults ========

export function defaultCameraPreset(): CameraPreset {
    return {
        mode: 'orbit',
        orbit: { targetHeight: 0, distance: 16, beta: Math.PI / 3 },
        freefly: { speed: 0.5, angularSensibility: 2000 },
        surround: { radius: 12, height: 8, speed: 0.3 },
        concert: {
            radius: 12,
            height: 8,
            sweepAngle: 120,
            sweepSpeed: 0.6,
            baseBeta: Math.PI / 3,
            bobAmplitude: 12,
            bobSpeed: 0.7,
        },
    };
}

// ======== Preset State ========

export function getCameraPreset(): CameraPreset {
    return _currentPreset;
}

export function setCameraPreset(p: CameraPreset): void {
    _currentPreset = p;
}

// ======== Sub-preset Getters ========

export function getOrbitParams(): OrbitParams {
    return _currentPreset.orbit;
}

export function getFreeflyParams(): FreeflyParams {
    return _currentPreset.freefly;
}

export function getConcertParams(): ConcertParams {
    return _currentPreset.concert;
}

export function getSurroundParams(): SurroundParams {
    return _currentPreset.surround;
}

// ======== Sub-preset Setters (纯状态变更，持久化由 camera.ts 的 viewMatrix observer 驱动) ========

export function setOrbitParams(p: Partial<OrbitParams>): void {
    Object.assign(_currentPreset.orbit, p);
}

export function setFreeflyParams(p: Partial<FreeflyParams>): void {
    Object.assign(_currentPreset.freefly, p);
}

export function setConcertParams(p: Partial<ConcertParams>): void {
    Object.assign(_currentPreset.concert, p);
}

export function setSurroundParams(p: Partial<SurroundParams>): void {
    Object.assign(_currentPreset.surround, p);
}

// ======== Mode getters/setters ========

export function getCameraMode(): CameraMode {
    return _cameraMode;
}

export function getCameraControl(): CameraControl {
    return _cameraControl;
}

export function getCameraBehavior(): CameraBehavior {
    return _cameraBehavior;
}

export function getScriptedSubMode(): ScriptedSubMode {
    return _scriptedSubMode;
}

export function setCameraMode(mode: CameraMode): void {
    _cameraMode = mode;
}

export function setCameraControl(control: CameraControl): void {
    _cameraControl = control;
}

export function setCameraBehavior(behavior: CameraBehavior): void {
    _cameraBehavior = behavior;
}

export function setScriptedSubMode(sub: ScriptedSubMode): void {
    _scriptedSubMode = sub;
}

// ======== FOV ========

export function getFov(): number {
    return _fov;
}

export function setFov(v: number): void {
    _fov = v;
}

// ======== Current Camera 引用 ========

export function getCurrentCamera(): Camera | null {
    return _currentCamera;
}

export function setCurrentCamera(cam: Camera | null): void {
    _currentCamera = cam;
}

// ======== Focus Center Y ========

export function getFocusCenterY(): number {
    return _focusCenterY;
}

export function setFocusCenterY(y: number): void {
    _focusCenterY = y;
}

// ======== Paused State ========

export function getConcertPaused(): boolean {
    return _concertPaused;
}

export function setConcertPaused(v: boolean): void {
    _concertPaused = v;
}

export function getSurroundPaused(): boolean {
    return _surroundPaused;
}

export function setSurroundPaused(v: boolean): void {
    _surroundPaused = v;
}

// ======== VMD Camera State ========

export function getCameraVmdName(): string {
    return _cameraVmdName;
}

export function getCameraVmdPath(): string {
    return _cameraVmdPath;
}

export function hasCameraVmd(): boolean {
    return !!_cameraVmdName;
}

export function setCameraVmdState(name: string, path: string): void {
    _cameraVmdName = name;
    _cameraVmdPath = path;
}

export function clearCameraVmdState(): void {
    _cameraVmdName = '';
    _cameraVmdPath = '';
}

// ======== Auto Camera State ========

export function isAutoCameraEnabled(): boolean {
    return _autoCameraEnabled;
}

export function setAutoCameraEnabledFlag(v: boolean): void {
    _autoCameraEnabled = v;
}

export function getAutoCameraBeatCount(): number {
    return _autoCameraBeatCount;
}

export function setAutoCameraBeatCount(v: number): void {
    _autoCameraBeatCount = v;
}

export function getAutoCameraPresetIdx(): number {
    return _autoCameraPresetIdx;
}

export function setAutoCameraPresetIdx(v: number): void {
    _autoCameraPresetIdx = v;
}

// ======== Pure Utility ========

export function isTouchDevice(): boolean {
    return (
        'ontouchstart' in window ||
        navigator.maxTouchPoints > 0 ||
        window.matchMedia('(pointer: coarse)').matches
    );
}