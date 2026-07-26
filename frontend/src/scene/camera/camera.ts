// [doc:architecture] Camera — 相机模式管理系统（核心调度）
// 规范文档: docs/architecture.md §渲染环节
// 职责: 相机模式切换调度、双轴派生、setEnvState 入口、CameraState 序列化、子模块回调注入
// 拆分历史（ADR-148 阶段 3）：
//   - 纯状态 → camera-state.ts（含 scene/canvas 引用等运行时上下文）
//   - VMD 动画 → camera-vmd.ts
//   - 相机工厂 → camera-factory.ts
//   - 行为循环 → camera-behaviors.ts
//   - 骨骼锁定 → camera-bone-lock.ts
//   - 节拍自动运镜 → camera-auto.ts
// camera.ts 保留：switchCameraMode 主调度 + setCameraControl/setCameraBehavior 双轴写入 +
//   CameraState 序列化结构 + LEGACY_MODE_MAP/deriveLegacyMode 兼容映射

import { Camera } from '@babylonjs/core/Cameras/camera';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Scene } from '@babylonjs/core/scene';

import { focusedModelId, modelRegistry, triggerAutoSave, uiState } from '@/core/config';
import { feedbackStatus } from '@/core/feedback';
import { clamp, debounce, deepClone } from '@/core/utils';
import { logWarn } from '@/core/logger';
import { focusModel, reattachPipeline, setARMode } from '../scene';

import {
    defaultCameraPreset,
    getCameraPreset,
    setCameraPreset,
    getCameraMode,
    setCameraMode,
    getCameraControl,
    setCameraControl as _setCameraControlState,
    getCameraBehavior,
    setCameraBehavior as _setCameraBehaviorState,
    getScriptedSubMode,
    setScriptedSubMode,
    getCurrentCamera,
    setCurrentCamera,
    getFocusCenterY,
    setFocusCenterY,
    getConcertPaused,
    setCameraVmdState,
    clearCameraVmdState,
    setAutoCameraEnabledFlag,
    setAutoCameraBeatCount as _setAutoCameraBeatCount,
    setAutoCameraPresetIdx as _setAutoCameraPresetIdx,
    isTouchDevice,
    getFov as getFovState,
    setFov as setFovState,
    setCameraScene,
    setCameraCanvas,
    getCameraScene,
    getCameraCanvas,
    getPreviousMode,
    setPreviousMode,
} from './camera-state';
import type {
    CameraMode,
    CameraControl,
    CameraBehavior,
    ScriptedSubMode,
    OrbitParams,
    FreeflyParams,
    SurroundParams,
    ConcertParams,
    CameraPreset,
} from './camera-state';
import {
    loadCameraVmd,
    clearCameraVmd,
    animateCameraVmd,
    createVmdCamera,
    hasCameraAnimationHandle,
    setSwitchCameraModeCallback,
} from './camera-vmd';
import {
    createOrbitCamera,
    createFreeflyCamera,
    createSurroundCamera,
    createConcertCamera,
    createOneshotCamera,
    applyCameraUserSettings,
    refreshCameraUserSettings,
    disposeViewMatrixHandle,
    setSchedulePersistCallback,
} from './camera-factory';
import {
    initFreeflyUpdate,
    initFreeflyTouch,
    stopFreefly,
    startSurround,
    stopSurround,
    startConcert,
    stopConcert,
} from './camera-behaviors';
import {
    setOrbitBoneLock,
    getOrbitBoneLock,
    setBoneLockDamping,
    getBoneLockDamping,
    getFocusedModelBoneNames,
    stopBoneLock,
    restoreBoneLockIfEnabled,
} from './camera-bone-lock';
import {
    setAutoCameraEnabled,
    isAutoCameraEnabled,
    setAutoCameraBeatsPerSwitch,
    getAutoCameraBeatsPerSwitch,
    restoreAutoCameraState,
    setSyncAxesCallback,
} from './camera-auto';

// ======== Types (单源定义在 camera-state.ts，此处 re-export) ========
// LEGACY_MODE_MAP / deriveLegacyMode 含场景逻辑，保留本地定义

/** ADR-100 §6.1 — 旧模式 → 双轴映射（迁移 / shim 共用）。 */
export const LEGACY_MODE_MAP: Record<
    CameraMode,
    { control: CameraControl; behavior: CameraBehavior; scripted?: ScriptedSubMode }
> = {
    orbit: { control: 'orbit', behavior: 'none' },
    surround: { control: 'orbit', behavior: 'turntable' },
    concert: { control: 'orbit', behavior: 'concert' },
    vmd: { control: 'orbit', behavior: 'scripted', scripted: 'loop' },
    oneshot: { control: 'orbit', behavior: 'scripted', scripted: 'oneshot' },
    freefly: { control: 'freefly', behavior: 'none' },
    ar: { control: 'ar', behavior: 'none' },
    beatcut: { control: 'orbit', behavior: 'beatcut' },
};

/**
 * ADR-100 §6.2 — 双轴 → 旧模式反查（getCameraState 降级双写 / shim 内部路由）。
 * beatcut 为独立模式，直接返回（不再降级为 orbit）。
 */
export function deriveLegacyMode(
    control: CameraControl,
    behavior: CameraBehavior,
    scripted: ScriptedSubMode = 'loop'
): CameraMode {
    if (control === 'freefly') {
        return 'freefly';
    }
    if (control === 'ar') {
        return 'ar';
    }
    // control === 'orbit'
    switch (behavior) {
        case 'turntable':
            return 'surround';
        case 'concert':
            return 'concert';
        case 'scripted':
            return scripted === 'oneshot' ? 'oneshot' : 'vmd';
        case 'beatcut':
            return 'beatcut';
        case 'none':
        default:
            return 'orbit';
    }
}

// ======== Camera Persist (拖拽结束后自动保存) ========
const _scheduleCameraPersistDebounced = debounce((): void => {
    triggerAutoSave();
}, 500);

/**
 * 相机视角变化时延迟触发保存（500ms 防抖）
 * 当用户拖拽结束时，视角变化停止，500ms 后自动保存
 */
function scheduleCameraPersist(): void {
    _scheduleCameraPersistDebounced();
}

// ======== Sub-preset Param Setters（同步到 live camera）========

export function setOrbitParams(p: Partial<OrbitParams>): void {
    Object.assign(getCameraPreset().orbit, p);
    // camera-state.ts 已更新 _currentPreset.orbit，此处仅同步到 live camera
    if (getCameraMode() === 'orbit' && getCurrentCamera() instanceof ArcRotateCamera) {
        const cam = getCurrentCamera() as ArcRotateCamera;
        if (p.distance !== undefined) {
            cam.radius = p.distance;
        }
        if (p.beta !== undefined) {
            cam.beta = p.beta;
        }
        if (p.targetHeight !== undefined) {
            cam.target.y = getFocusCenterY() + p.targetHeight;
        }
    }
}

/** Log current camera alpha for diagnostics. */
export function logCameraAlpha(): void {
    if (getCameraMode() === 'orbit' && getCurrentCamera() instanceof ArcRotateCamera) {
        console.info(
            '[camera] current alpha:',
            (getCurrentCamera() as ArcRotateCamera).alpha.toFixed(3)
        );
    }
}

export function setFreeflyParams(p: Partial<FreeflyParams>): void {
    Object.assign(getCameraPreset().freefly, p);
    if (getCameraMode() === 'freefly' && getCurrentCamera() instanceof UniversalCamera) {
        const cam = getCurrentCamera() as UniversalCamera;
        if (p.speed !== undefined) {
            cam.speed = p.speed;
        }
        if (p.angularSensibility !== undefined) {
            cam.angularSensibility = p.angularSensibility;
        }
    }
}

export function setConcertParams(p: Partial<ConcertParams>): void {
    Object.assign(getCameraPreset().concert, p);
}

export function setSurroundParams(p: Partial<SurroundParams>): void {
    Object.assign(getCameraPreset().surround, p);
}

// ======== Dual-Axis Resolution (ADR-100) ========

/**
 * ADR-100 §6.3 — 行为轴派生（含 beatcut 叠加与互斥）。
 * beatcut 是运行时叠加行为：仅当自动运镜开启、且基底行为为 none(orbit) 时生效；
 * 与 concert/turntable/scripted 互斥（这些基底行为存在时 beatcut 被抑制）。
 */
function _resolveBehavior(mode: CameraMode): CameraBehavior {
    const m = LEGACY_MODE_MAP[mode];
    if (isAutoCameraEnabled() && m.control === 'orbit' && m.behavior === 'none') {
        return 'beatcut';
    }
    return m.behavior;
}

/**
 * ADR-100：由旧 mode 派生双轴状态。switchCameraMode 提交 _cameraMode 时同步调用，作为唯一写入点。
 *
 * 命名约定：保留前导下划线表示"内部协调 API"——非下游消费者使用的公开接口，
 * 但允许子模块（camera-auto.ts）通过 setSyncAxesCallback 注入后回调，
 * 也允许测试在不调用完整 initCameraSystem 的前提下手动派生双轴。
 */
export function _syncAxesFromMode(mode: CameraMode): void {
    const m = LEGACY_MODE_MAP[mode];
    _setCameraControlState(m.control);
    _setCameraBehaviorState(_resolveBehavior(mode));
    if (m.scripted) {
        setScriptedSubMode(m.scripted);
    }
}

function clampFov(v: number): number {
    return clamp(v, 0.1, 3);
}

// ======== Dual-Axis Accessors (ADR-100) ========
// getCameraControl/getCameraBehavior/getScriptedSubMode 已迁移至 camera-state.ts

/**
 * ADR-100 P4 — 直接设置控制方案轴（轴 A）。
 * freefly/ar 非 ArcRotate，行为轴强制 none 并关闭自动运镜；
 * orbit 下保留当前行为（含 beatcut 叠加语义，由 _resolveBehavior 派生）。
 */
export function setCameraControl(control: CameraControl): void {
    if (control === getCameraControl()) {
        return; // 已是该控制方案，无需重建相机
    }
    const baseBehavior: CameraBehavior =
        getCameraBehavior() === 'beatcut' ? 'none' : getCameraBehavior();
    const legacy = deriveLegacyMode(control, baseBehavior, getScriptedSubMode());
    switchCameraMode(legacy);
    // ADR-100 P4：headless 下 switchCameraMode 因缺 _scene/_canvas 早退、不提交 _cameraMode 亦不派生双轴；
    // 此处补提交并直接派生，使双轴出口对 scene 无关（与 setCameraState 一致），production 下为幂等重同步。
    setCameraMode(legacy);
    _syncAxesFromMode(legacy);
    if (control !== 'orbit') {
        setAutoCameraEnabled(false); // 非 orbit：行为轴强制 none，自动运镜无意义
    }
}

/**
 * ADR-100 P4 — 直接设置运动行为轴（轴 B，仅 orbit 有效）。
 * 'beatcut' 开启自动运镜（_resolveBehavior 派生为 beatcut）；其余行为关闭自动运镜。
 * 非 orbit 控制下调用非 none 行为将被忽略（行为轴对 Universal/AR 不适用）。
 */
export function setCameraBehavior(behavior: CameraBehavior): void {
    if (behavior === getCameraBehavior()) {
        return;
    }
    if (getCameraControl() !== 'orbit' && behavior !== 'none') {
        return; // 行为轴仅对 orbit 生效，非 orbit 强制 none
    }
    if (behavior === 'beatcut') {
        // 确保控制为 orbit，再开启自动运镜（_resolveBehavior 派生 beatcut）
        const legacy = deriveLegacyMode(getCameraControl(), 'none', getScriptedSubMode());
        switchCameraMode(legacy);
        setCameraMode(legacy);
        _syncAxesFromMode(legacy); // 同 setCameraControl：headless 下补派生，production 幂等
        setAutoCameraEnabled(true);
        return;
    }
    setAutoCameraEnabled(false);
    const legacy = deriveLegacyMode(getCameraControl(), behavior, getScriptedSubMode());
    switchCameraMode(legacy);
    setCameraMode(legacy);
    _syncAxesFromMode(legacy); // 同 setCameraControl：headless 下补派生，production 幂等
}

export function setFov(v: number): void {
    setFovState(clampFov(v));
    if (getCurrentCamera()) {
        getCurrentCamera()!.fov = getFovState();
    }
}

// ======== Initialization ========

/** Initialise the camera system and create the default Orbit camera. */
export function initCameraSystem(scene: Scene, canvas: HTMLCanvasElement): Camera {
    setCameraScene(scene);
    setCameraCanvas(canvas);
    // 注入回调给子模块（破除循环依赖）
    setSwitchCameraModeCallback(switchCameraMode);
    setSchedulePersistCallback(scheduleCameraPersist);
    setSyncAxesCallback(() => _syncAxesFromMode(getCameraMode()));

    const cam = createOrbitCamera(scene, canvas);
    setCurrentCamera(cam);
    setCameraMode('orbit');
    _syncAxesFromMode('orbit');
    scene.activeCamera = cam;
    return cam;
}

// ======== Mode Switch ========

/** Switch to a different camera mode, preserving position as much as possible. */
export function switchCameraMode(mode: CameraMode): void {
    if (mode === getCameraMode() && getCurrentCamera()) {
        return;
    }
    const scene = getCameraScene();
    const canvas = getCameraCanvas();
    if (!scene || !canvas) {
        return;
    }

    // 停止当前模式的 side-effect（覆盖所有切换，含进出 AR）。
    // 原实现在 `mode==='ar'` 早退分支跳过了此块，导致 orbit 骨骼锁、
    // freefly/concert/surround 的 onBeforeRender 回调在切到 AR 时残留注册
    // （仅靠各回调内部的 _cameraMode 守卫变 no-op，属轻微泄漏，AR 审查 #5）。
    if (getCameraMode() === 'ar') {
        setARMode(false);
    } else {
        if (getCameraMode() === 'freefly') {
            stopFreefly();
        }
        if (getCameraMode() === 'concert') {
            stopConcert();
        }
        if (getCameraMode() === 'surround') {
            stopSurround();
        }
        if (getCameraMode() === 'orbit') {
            stopBoneLock();
        }
    }

    if (mode === 'ar') {
        if (getCameraMode() !== 'ar') {
            setPreviousMode(getCameraMode());
        }
        // 乐观提交 _cameraMode='ar'，保证"进入 AR 期间用户切走"时下方
        // `if (_cameraMode === 'ar')` 离开检测能命中并正确注销摄像头。
        // 真正的视频激活由 setARMode(true) 异步完成；若失败，仅还原模式标记，
        // 不重建相机（进入 AR 时从未切换/重建 Babylon 相机）。
        setCameraMode('ar');
        _syncAxesFromMode('ar');
        getCameraPreset().mode = 'ar';
        const prevMode = getPreviousMode();
        // 注意：不使用 safeCallAsync 包裹——reject 时需执行状态恢复副作用，
        // safeCallAsync 仅 logWarn 不传播 rejection 但也不执行恢复逻辑。
        // 显式 .then(ok) + .catch(err) 双路径处理：
        //   - resolve(false)：摄像头拒绝授权，恢复模式标记
        //   - reject：摄像头 API 抛错，同样恢复模式标记
        //   - resolve(true) 但用户已切走：立即 setARMode(false) 释放摄像头流（竞态修复）
        setARMode(true)
            .then((ok) => {
                if (!ok) {
                    // 显式失败：若模式仍在 ar，提示并还原标记。
                    if (getCameraMode() === 'ar') {
                        feedbackStatus('scene.camera.arFailed', undefined, false);
                        setCameraMode(prevMode);
                        _syncAxesFromMode(prevMode);
                        getCameraPreset().mode = prevMode;
                    }
                    return;
                }
                // 成功：但若 pending 期间用户已切走（_cameraMode 不再是 'ar'），
                // 立即释放摄像头流避免泄漏（switchCameraMode 切走时已调用 setARMode(false)，
                // 但此次 setARMode(true) 是后到的，会重新激活摄像头）。
                if (getCameraMode() !== 'ar') {
                    setARMode(false).catch((err) =>
                        logWarn('camera', 'setARMode(false) cleanup after race:', err)
                    );
                }
            })
            .catch((err) => {
                // reject（非 resolve false）：摄像头 API 抛错，恢复模式标记。
                // safeCallAsync 原本会吞错但状态停留 'ar'，导致用户看到 AR 模式但摄像头未激活。
                logWarn('camera', 'setARMode failed:', err);
                if (getCameraMode() === 'ar') {
                    setCameraMode(prevMode);
                    _syncAxesFromMode(prevMode);
                    getCameraPreset().mode = prevMode;
                }
            });
        return;
    }

    // Save old camera state
    const oldCam = getCurrentCamera();
    let oldPos: Vector3 | null = null;
    let oldTarget: Vector3 | null = null;

    if (oldCam) {
        oldPos = oldCam.position.clone();
        if (oldCam instanceof ArcRotateCamera) {
            oldTarget = oldCam.target.clone();
        } else {
            // Derive a look-at target from the forward direction
            const dir = oldCam.getDirection(new Vector3(0, 0, 1));
            oldTarget = oldPos.add(dir);
        }
        oldCam.detachControl();
        scene.removeCamera(oldCam);
        // 旧相机的视角变化 observer 显式解绑（统一走 ObserverHandle；cam.dispose 亦会清理，双保险）
        disposeViewMatrixHandle();
        oldCam.dispose();
    }

    // Create new camera
    let newCam: Camera;
    switch (mode) {
        case 'orbit':
            newCam = createOrbitCamera(scene, canvas);
            break;
        case 'freefly':
            newCam = createFreeflyCamera(scene, canvas);
            break;
        case 'concert':
            newCam = createConcertCamera(scene);
            break;
        case 'surround':
            newCam = createSurroundCamera(scene);
            break;
        case 'oneshot':
            newCam = createOneshotCamera(scene, canvas);
            break;
        case 'vmd':
            // Pre-check: refuse switch if no camera VMD is loaded
            if (!hasCameraAnimationHandle()) {
                logWarn(
                    'camera',
                    'Cannot switch to VMD mode: no camera VMD loaded, falling back to orbit'
                );
                mode = 'orbit';
                newCam = createOrbitCamera(scene, canvas);
                break;
            }
            newCam = createVmdCamera();
            break;
        default:
            newCam = createOrbitCamera(scene, canvas);
            break;
    }

    // Restore position (best-effort)
    if (oldPos) {
        newCam.position = oldPos;
        if (newCam instanceof ArcRotateCamera && oldTarget) {
            newCam.setTarget(oldTarget);
        } else if (newCam instanceof UniversalCamera && oldTarget) {
            newCam.setTarget(oldTarget);
        }
    }

    scene.activeCamera = newCam;
    setCurrentCamera(newCam);
    setCameraMode(mode);
    _syncAxesFromMode(mode);
    // Persist camera mode for scene auto-save (skip oneshot — it's a transient action)
    if (mode !== 'oneshot') {
        getCameraPreset().mode = mode;
    }

    // Start new mode's side-effects
    if (mode === 'freefly') {
        initFreeflyUpdate(scene);
        initFreeflyTouch(canvas);
    }
    if (mode === 'concert') {
        startConcert(scene);
    }
    if (mode === 'surround') {
        startSurround(scene);
    }
    // 切回 orbit 时，若骨骼锁仍处于启用状态（用户未显式关闭），
    // 重启每帧跟随 observer。修复"切出 orbit → stopBoneLock dispose observer →
    // 切回 orbit → observer 未重建"导致的假启用缺陷。
    if (mode === 'orbit') {
        restoreBoneLockIfEnabled();
    }

    // Auto-frame on focused model when switching to orbit
    if (mode === 'orbit' && focusedModelId) {
        const inst = modelRegistry.get(focusedModelId);
        if (inst) {
            focusModel(focusedModelId);
        }
    }

    // Re-attach post-processing pipeline to the new camera
    reattachPipeline();
    // Apply FOV to the new camera
    newCam.fov = clampFov(getFovState());
}

// ======== Auto Frame ========

/** Auto-frame the camera to centre on a bounding box. */
export function autoFrame(center: Vector3, extent: number): void {
    const cam = getCurrentCamera();
    if (!cam) {
        return;
    }

    // 记录聚焦模型中心 Y，使 targetHeight 表现为相对中心的偏移
    setFocusCenterY(center.y);
    if (cam instanceof ArcRotateCamera) {
        cam.setTarget(center);
        // 叠加用户偏移偏好（相对模型中心的垂直偏移，0 = 正中）
        cam.target.y = center.y + getCameraPreset().orbit.targetHeight;
        cam.radius = extent * 0.75 + 2;
        cam.alpha = -Math.PI / 2;
        cam.beta = Math.PI / 2.2;
    } else if (cam instanceof UniversalCamera) {
        const dist = extent * 0.75 + 2;
        cam.position = new Vector3(center.x - dist, center.y + dist * 0.5, center.z);
        cam.setTarget(center);
    }
}

// ======== Camera State Serialization ========

export interface CameraState {
    mode: CameraMode; // 保留兼容别名（旧存档 / 旧版本识别）；新存档仍写入等价值供降级
    control?: CameraControl; // ADR-100 轴 A（新）
    behavior?: CameraBehavior; // ADR-100 轴 B（新）
    scriptedSubMode?: ScriptedSubMode; // ADR-100 §6.4（新，仅 scripted 行为有意义）
    preset: CameraPreset;
    fov?: number; // FOV in radians, default 0.8 (migrated from RenderState in Phase 9)
    alpha: number;
    beta: number;
    radius: number;
    targetX: number;
    targetY: number;
    targetZ: number;
    positionX?: number;
    positionY?: number;
    positionZ?: number;
    /** 保存时的聚焦模型中心 Y。用于 setCameraState 正确反算 targetHeight，
     *  防止因模型加载顺序导致 _focusCenterY 与实际聚焦模型不匹配。 */
    focusCenterY?: number;
}

export function getCameraState(): CameraState {
    const cam = getCurrentCamera();
    const isArc = cam instanceof ArcRotateCamera;
    const alpha = isArc ? cam.alpha : 0;
    const beta = isArc ? cam.beta : 0;
    const radius = isArc ? cam.radius : 16;
    const target = isArc ? cam.target : null;
    return {
        // ADR-100 P3：双写——新双轴字段 + 反查 mode（供旧版本降级读取）
        mode: deriveLegacyMode(getCameraControl(), getCameraBehavior(), getScriptedSubMode()),
        control: getCameraControl(),
        behavior: getCameraBehavior(),
        scriptedSubMode: getScriptedSubMode(),
        preset: deepClone(getCameraPreset()),
        fov: getFovState(),
        alpha,
        beta,
        radius,
        targetX: target?.x ?? 0,
        targetY: target?.y ?? 8,
        targetZ: target?.z ?? 0,
        // 无头环境（未 initCameraSystem）下 _currentCamera 为 null，做 null 安全避免崩溃
        positionX: cam ? cam.position.x : 0,
        positionY: cam ? cam.position.y : 0,
        positionZ: cam ? cam.position.z : 0,
        // 记录当前聚焦模型中心 Y，供 setCameraState 正确反算 targetHeight
        focusCenterY: getFocusCenterY(),
    };
}

export function setCameraState(s: CameraState): void {
    // Switch to the saved mode first (creates the right camera type),
    // then restore the preset over the live state.
    let mode = s.mode || s.preset.mode;
    // 存档恢复时跳过 AR：进入 AR 需要用户手势授权摄像头，启动时无手势调 getUserMedia
    // 多数浏览器会直接拒绝；用户可在加载后手动进入 AR。
    if (s.preset) {
        const def = defaultCameraPreset();
        const loaded = deepClone(s.preset) as CameraPreset;
        // 旧存档迁移：concert 曾是「整圈自转」形态（带 speed 字段、无 sweepAngle），
        // 现重定向为 surround（环绕/转台），concert 归位为「粉丝机位」。
        const oldConcert = loaded.concert as unknown as Record<string, unknown> | undefined;
        if (oldConcert && 'speed' in oldConcert && !('sweepAngle' in oldConcert)) {
            loaded.surround = {
                radius: (oldConcert.radius ?? def.surround.radius) as number,
                height: (oldConcert.height ?? def.surround.height) as number,
                speed: (oldConcert.speed ?? def.surround.speed) as number,
            };
            if (mode === 'concert') {
                mode = 'surround';
            }
            delete (loaded as Partial<CameraPreset>).concert;
        }
        // 深合并到默认预设，补齐新增/缺失字段，防止旧存档缺字段导致 NaN。
        setCameraPreset({
            mode: loaded.mode ?? def.mode,
            orbit: { ...def.orbit, ...(loaded.orbit || {}) },
            freefly: { ...def.freefly, ...(loaded.freefly || {}) },
            surround: { ...def.surround, ...(loaded.surround || {}) },
            concert: { ...def.concert, ...(loaded.concert || {}) },
        });
    }

    // ── ADR-100 P3：双轴解析（新字段优先，旧 mode 兜底）──
    let control: CameraControl;
    let behavior: CameraBehavior;
    let sub: ScriptedSubMode = 'loop';
    if (s.control && s.behavior) {
        control = s.control;
        behavior = s.behavior;
        sub = s.scriptedSubMode ?? 'loop';
    } else {
        const m = LEGACY_MODE_MAP[mode];
        // ADR-100 P3 边界加固：部分新字段存档（仅 control 或仅 behavior 其一）逐字段兜底，
        // 避免齐全判定缺失时整段回退 LEGACY_MODE_MAP 导致已提供的字段静默丢失。
        control = s.control ?? m.control;
        behavior = s.behavior ?? m.behavior;
        sub = s.scriptedSubMode ?? m.scripted ?? 'loop';
    }
    // 旧存档仅以 UIState.autoCameraEnabled 标记自动运镜 → 叠加为 beatcut（§6.2 step3）。
    // ADR-100 P3 收紧：仅当 control/behavior 双轴均缺失（纯旧格式）才叠加，
    // 避免部分新字段存档（已显式声明 behavior）被陈旧 autoCameraEnabled 覆盖（P2 权威原则）。
    if (
        !s.control &&
        !s.behavior &&
        uiState.autoCameraEnabled &&
        control === 'orbit' &&
        behavior === 'none'
    ) {
        behavior = 'beatcut';
    }
    if (behavior === 'beatcut') {
        setAutoCameraEnabledFlag(true);
        uiState.autoCameraEnabled = true;
        setAutoCameraBeatsPerSwitch(uiState.autoCameraBeatsPerSwitch || 4);
    } else {
        // ADR-100 P3 边界修复：显式非 beatcut 行为须清除自动运镜标志，
        // 否则陈旧 uiState.autoCameraEnabled（启动期 restoreAutoCameraState 先于 setCameraState 执行）
        // 会覆盖已加载的显式行为（如 none），导致自动运镜意外开启。
        setAutoCameraEnabledFlag(false);
        uiState.autoCameraEnabled = false;
    }
    const finalMode = deriveLegacyMode(control, behavior, sub);

    // 直接派生双轴状态：不依赖 scene，保证无头/测试环境亦可恢复（switchCameraMode 在无 scene 时为 no-op）。
    _syncAxesFromMode(finalMode);

    // 相机生命周期（需 scene；无头环境为 no-op，但状态已就绪）
    if (finalMode && finalMode !== 'ar') {
        switchCameraMode(finalMode);
    }

    // Restore FOV (from new scene files; old scenes store it in render.fov)
    if (s.fov !== undefined) {
        setFov(s.fov);
    }
    const cam = getCurrentCamera();
    if (!cam) {
        // 无实时相机时仍恢复自动运镜订阅（beatcut 行为需要），随后返回。
        if (isAutoCameraEnabled()) {
            restoreAutoCameraState();
        }
        return;
    }
    if (cam instanceof ArcRotateCamera) {
        cam.alpha = s.alpha ?? cam.alpha;
        cam.beta = s.beta ?? cam.beta;
        cam.radius = s.radius ?? cam.radius;
        cam.setTarget(new Vector3(s.targetX, s.targetY, s.targetZ));
    } else if (cam instanceof UniversalCamera) {
        if (s.positionX !== undefined) {
            cam.position = new Vector3(s.positionX, s.positionY ?? 8, s.positionZ ?? 16);
        }
        cam.setTarget(new Vector3(s.targetX, s.targetY, s.targetZ));
    }
    // 反算用户偏移偏好：优先使用存档中的 focusCenterY（保存时的聚焦模型中心 Y），
    // 避免因模型加载顺序导致当前 _focusCenterY 与实际聚焦模型不匹配。
    // 旧存档缺 focusCenterY 时回退到当前 _focusCenterY（可能不准确）。
    if (cam instanceof ArcRotateCamera) {
        const refCenterY = s.focusCenterY ?? getFocusCenterY();
        getCameraPreset().orbit.targetHeight = (s.targetY ?? 8) - refCenterY;
    }
    // ADR-100 P3：订阅 beat（beatcut 行为需要）；restoreAutoCameraState 内部幂等，重复调用安全。
    if (isAutoCameraEnabled()) {
        restoreAutoCameraState();
    }
}

// ======== Re-exports (backward compat — barrel re-export for downstream consumers) ========
// 各子模块拆分后，旧路径 `'../scene/camera/camera'` 仍是唯一对外入口，
// 所有公开符号在此处统一 re-export，避免下游消费者改动 import 路径。
export type {
    CameraMode,
    CameraControl,
    CameraBehavior,
    ScriptedSubMode,
    OrbitParams,
    FreeflyParams,
    SurroundParams,
    ConcertParams,
    CameraPreset,
} from './camera-state';
export {
    defaultCameraPreset,
    getCameraMode,
    getCameraControl,
    getCameraBehavior,
    getScriptedSubMode,
    getOrbitParams,
    getFreeflyParams,
    getConcertParams,
    getSurroundParams,
    getConcertPaused,
    setConcertPaused,
    getSurroundPaused,
    setSurroundPaused,
    getCameraVmdName,
    getCameraVmdPath,
    hasCameraVmd,
    getFov,
    isTouchDevice,
    getCameraPreset,
    setCameraPreset,
    getCurrentCamera,
    setCurrentCamera,
    getFocusCenterY,
    setFocusCenterY,
} from './camera-state';
export {
    loadCameraVmd,
    clearCameraVmd,
    animateCameraVmd,
} from './camera-vmd';
export {
    applyCameraUserSettings,
    refreshCameraUserSettings,
} from './camera-factory';
export {
    setOrbitBoneLock,
    getOrbitBoneLock,
    setBoneLockDamping,
    getBoneLockDamping,
    getFocusedModelBoneNames,
    restoreBoneLockIfEnabled,
} from './camera-bone-lock';
export {
    setAutoCameraEnabled,
    isAutoCameraEnabled,
    setAutoCameraBeatsPerSwitch,
    getAutoCameraBeatsPerSwitch,
    restoreAutoCameraState,
    setSyncAxesCallback,
} from './camera-auto';
