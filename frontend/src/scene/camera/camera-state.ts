// camera-state.ts — 相机纯状态管理（getter/setter，无 scene 依赖）
// 从 camera.ts 拆分，切断 camera ↔ scene 循环依赖
// 本模块只读写模块级变量，不涉及 Babylon.js 相机对象或 scene 操作

import { triggerAutoSave } from '@/core/config';
import { debounce } from '@/core/utils';
import type { Camera } from '@babylonjs/core/Cameras/camera';

// ======== Types ========

export type CameraMode = 'orbit' | 'freefly' | 'surround' | 'concert' | 'oneshot' | 'vmd' | 'ar' | 'beatcut';
export type CameraControl = 'orbit' | 'freefly' | 'ar';
export type CameraBehavior = 'none' | 'turntable' | 'concert' | 'beatcut' | 'scripted';
export type ScriptedSubMode = 'loop' | 'oneshot';

export interface OrbitParams {
    targetHeight: number;
    distance: number;
    beta: number;
}

export interface FreeflyParams {
    speed: number;
    angularSensibility: number;
}

export interface SurroundParams {
    radius: number;
    height: number;
    speed: number;
}

export interface ConcertParams {
    radius: number;
    height: number;
    sweepAngle: number;
    sweepSpeed: number;
    baseBeta: number;
    bobAmplitude: number;
    bobSpeed: number;
}

export interface CameraPreset {
    mode: CameraMode;
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
let _autoCameraBeatsPerSwitch = 4;
let _autoCameraBeatCount = 0;
let _autoCameraPresetIdx = 0;

// ======== Defaults ========

export function defaultCameraPreset(): CameraPreset {
    return {
        mode: 'orbit',
        orbit: { targetHeight: 0, distance: 16, beta: Math.PI / 3 },
        freefly: { speed: 0.5, angularSensibility: 2000 },
        surround: { radius: 16, height: 8, speed: 0.3 },
        concert: { radius: 8, height: 6, sweepAngle: 0.5, sweepSpeed: 0.6, baseBeta: Math.PI / 3, bobAmplitude: 12, bobSpeed: 0.7 },
    };
}

// ======== Preset State ========

export function getCameraPreset(): CameraPreset {
    return _currentPreset;
}

export function setCameraPreset(p: CameraPreset): void {
    _currentPreset = p;
}

// ======== Camera Persist (拖拽结束后自动保存) ========

const _scheduleCameraPersist = debounce((): void => {
    triggerAutoSave();
}, 500);

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

// ======== Sub-preset Setters (persist on change) ========

export function setOrbitParams(p: Partial<OrbitParams>): void {
    Object.assign(_currentPreset.orbit, p);
    _scheduleCameraPersist();
}

export function setFreeflyParams(p: Partial<FreeflyParams>): void {
    Object.assign(_currentPreset.freefly, p);
    _scheduleCameraPersist();
}

export function setConcertParams(p: Partial<ConcertParams>): void {
    Object.assign(_currentPreset.concert, p);
    _scheduleCameraPersist();
}

export function setSurroundParams(p: Partial<SurroundParams>): void {
    Object.assign(_currentPreset.surround, p);
    _scheduleCameraPersist();
}

/** 用于缩放等场景的 alpha 只读查询 */
export function logCameraAlpha(): number {
    return _currentPreset.orbit.beta;
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

export function getAutoCameraBeatsPerSwitch(): number {
    return _autoCameraBeatsPerSwitch;
}

export function setAutoCameraBeatsPerSwitch(v: number): void {
    _autoCameraBeatsPerSwitch = v;
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