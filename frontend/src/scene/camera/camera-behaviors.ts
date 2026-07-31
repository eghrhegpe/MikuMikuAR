// [doc:architecture] Camera Behaviors — freefly/surround/concert 行为
// 从 camera.ts 拆出（ADR-148 阶段 3：camera.ts 瘦身）
// 职责: freefly 输入/触控、surround 整圈自转、concert 粉丝机位扫掠
// 依赖: camera-state（preset/camera 引用）+ freeflyInput + observer-handle

import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Scene } from '@babylonjs/core/scene';

import { focusedModelId, modelRegistry } from '@/core/config';
import { freeflyInput } from '@/core/freefly-state';
import { orbitInput } from '@/core/orbit-state';
import { addDisposableListener, type Disposable } from '@/core/dom';
import { observe, type ObserverHandle } from '@/core/observer-handle';
import { safeDispose } from '@/core/dispose-helpers';
import {
    getCameraMode,
    getCameraPreset,
    getConcertPaused,
    getCurrentCamera,
    isTouchDevice,
} from './camera-state';

// 模块级 handle：surround/concert/freefly/orbit 的 onBeforeRender 回调
let _concertUpdateHandle: ObserverHandle | null = null;
let _surroundUpdateHandle: ObserverHandle | null = null;
let _freeflyUpdateHandle: ObserverHandle | null = null;
let _orbitUpdateHandle: ObserverHandle | null = null;
let _concertT = 0;
let _surroundAngle = 0;
// Cached target vector for concert/surround modes (avoids per-frame Vector3 allocation)
const _concertTarget = new Vector3(0, 8, 0);

// 移动速度映射系数：preset.freefly.speed 乘此为每帧位移（@60fps）。
// 旧口径硬编码 0.3/帧 对应默认 speed=0.5，故 0.3/0.5=0.6；freefly 与 orbit 共用，
// 使两种模式的「移动速度」滑块语义一致（默认约 18 unit/s ≈ 1.8 m/s）。
const _FREEFLY_SPEED_SCALE = 0.6;

// ======== Freefly ========

export function initFreeflyUpdate(scene: Scene): void {
    // 释放之前的 observer
    if (_freeflyUpdateHandle) {
        _freeflyUpdateHandle.dispose();
    }

    _freeflyUpdateHandle = observe(scene.onBeforeRenderObservable, () => {
        const cam = getCurrentCamera();
        if (!cam || !(cam instanceof UniversalCamera)) {
            return;
        }
        // preset.freefly.speed 为移动速度的单一真相源（滑块直写入）。
        // 旧口径硬编码 0.3/帧 对应默认 speed=0.5，故映射系数 0.6 保持默认手感不变。
        const speed =
            getCameraPreset().freefly.speed * _FREEFLY_SPEED_SCALE * scene.getAnimationRatio();

        // Read input state set by main.ts keydown/keyup
        // Use explicit temp variable for readability (getDirection returns a new Vector3 each call)
        if (freeflyInput.forward) {
            const dir = cam.getDirection(new Vector3(0, 0, 1)).scaleInPlace(speed);
            cam.position.addInPlace(dir);
        }
        if (freeflyInput.backward) {
            const dir = cam.getDirection(new Vector3(0, 0, -1)).scaleInPlace(speed);
            cam.position.addInPlace(dir);
        }
        if (freeflyInput.left) {
            const dir = cam.getDirection(new Vector3(-1, 0, 0)).scaleInPlace(speed);
            cam.position.addInPlace(dir);
        }
        if (freeflyInput.right) {
            const dir = cam.getDirection(new Vector3(1, 0, 0)).scaleInPlace(speed);
            cam.position.addInPlace(dir);
        }
        if (freeflyInput.up) {
            cam.position.y += speed;
        }
        if (freeflyInput.down) {
            cam.position.y -= speed;
        }
    });
}

// ======== Freefly Touch Controls ========
// 双指滑动：上下 = 前后移动，左右 = 平移
// 双指捏合：前进/后退
let _freeflyTouchHandler: ((e: TouchEvent) => void) | null = null;
let _freeflyTouchEndHandler: (() => void) | null = null;
let _touchPrevDist = 0;
let _touchPrevMidX = 0;
let _touchPrevMidY = 0;
// [doc:adr-102] 持有 touch 监听器的 Disposable，便于在 stopFreeflyTouch 中统一释放
let _touchDisposables: Disposable[] = [];

export function initFreeflyTouch(canvas: HTMLCanvasElement): void {
    if (!isTouchDevice()) {
        return;
    }

    _freeflyTouchHandler = (e: TouchEvent) => {
        if (getCameraMode() !== 'freefly') {
            return;
        }
        if (e.touches.length < 2) {
            return;
        }
        e.preventDefault();

        const t0 = e.touches[0];
        const t1 = e.touches[1];
        const midX = (t0.clientX + t1.clientX) / 2;
        const midY = (t0.clientY + t1.clientY) / 2;
        const dx = t1.clientX - t0.clientX;
        const dy = t1.clientY - t0.clientY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (_touchPrevDist > 0) {
            const dDist = dist - _touchPrevDist;
            const dMidX = midX - _touchPrevMidX;
            const dMidY = midY - _touchPrevMidY;

            // 捏合 → 前进/后退（dist 增大 = 后退，减小 = 前进）
            freeflyInput.forward = dDist < -3;
            freeflyInput.backward = dDist > 3;

            // 双指水平滑动 → 左右平移
            freeflyInput.left = dMidX > 4;
            freeflyInput.right = dMidX < -4;

            // 双指垂直滑动 → 上下移动
            freeflyInput.up = dMidY > 4;
            freeflyInput.down = dMidY < -4;
        }

        _touchPrevDist = dist;
        _touchPrevMidX = midX;
        _touchPrevMidY = midY;
    };

    _freeflyTouchEndHandler = () => {
        freeflyInput.forward = false;
        freeflyInput.backward = false;
        freeflyInput.left = false;
        freeflyInput.right = false;
        freeflyInput.up = false;
        freeflyInput.down = false;
        _touchPrevDist = 0;
    };

    _touchDisposables.push(
        addDisposableListener(canvas, 'touchmove', _freeflyTouchHandler, { passive: false })
    );
    _touchDisposables.push(addDisposableListener(canvas, 'touchend', _freeflyTouchEndHandler));
    _touchDisposables.push(addDisposableListener(canvas, 'touchcancel', _freeflyTouchEndHandler));
}

function stopFreeflyTouch(): void {
    for (const d of _touchDisposables) {
        d.dispose();
    }
    _touchDisposables = [];
    _freeflyTouchHandler = null;
    _freeflyTouchEndHandler = null;
    _touchPrevDist = 0;
}

export function stopFreefly(): void {
    // Reset input state
    freeflyInput.forward = false;
    freeflyInput.backward = false;
    freeflyInput.left = false;
    freeflyInput.right = false;
    freeflyInput.up = false;
    freeflyInput.down = false;

    stopFreeflyTouch();

    if (_freeflyUpdateHandle) {
        _freeflyUpdateHandle = safeDispose(_freeflyUpdateHandle);
    }
}

// ======== Orbit 键盘平移 — 渲染循环连续积分（自由飞行式）========
// 仅 orbit 模式生效：读 events.ts 置位的 orbitInput 标记，每帧按帧率归一的
// 速度平移相机注视点（target），相机随 target 整体位移（alpha/beta/radius 不变）。
// W/S = 沿视线水平投影前后，A/D = 沿右轴左右，Q/E = 注视点升降；缩放走鼠标滚轮原生。
// 移动速度与 freefly 共用 preset.freefly.speed（单一真相源），滑块即时生效。
// 每帧复用的临时向量，避免 GC 抖动
const _orbitFwd = new Vector3();
const _orbitRight = new Vector3();
const _orbitMove = new Vector3();

export function initOrbitUpdate(scene: Scene): void {
    if (_orbitUpdateHandle) {
        _orbitUpdateHandle.dispose();
    }
    _orbitUpdateHandle = observe(scene.onBeforeRenderObservable, () => {
        if (getCameraMode() !== 'orbit') {
            return;
        }
        const cam = getCurrentCamera();
        if (!cam || !(cam instanceof ArcRotateCamera)) {
            return;
        }
        // getAnimationRatio() ≈ 当前帧相对 60fps 的时长倍数，保证不同帧率下速度一致
        const step =
            getCameraPreset().freefly.speed * _FREEFLY_SPEED_SCALE * scene.getAnimationRatio();

        // 前进方向 = 相机→target 视线在水平面的投影（y 归零后归一化），
        // 避免俯视时按 W 往地里钻；右轴 = forward × up。
        cam.getDirectionToRef(Vector3.Forward(), _orbitFwd);
        _orbitFwd.y = 0;
        const len = _orbitFwd.length();
        if (len > 1e-4) {
            _orbitFwd.scaleInPlace(1 / len);
            // 左手坐标系右轴 = up × forward；反过来（forward × up）会得到左轴，导致 A/D 反向。
            Vector3.CrossToRef(Vector3.Up(), _orbitFwd, _orbitRight);
            _orbitRight.normalize();
        } else {
            // 近乎正俯视/正仰视时，退回相机右轴的水平投影兜底
            _orbitFwd.set(0, 0, 0);
            _orbitRight.set(1, 0, 0);
        }

        _orbitMove.set(0, 0, 0);
        if (orbitInput.forward) {
            _orbitMove.addInPlace(_orbitFwd);
        }
        if (orbitInput.backward) {
            _orbitMove.subtractInPlace(_orbitFwd);
        }
        if (orbitInput.right) {
            _orbitMove.addInPlace(_orbitRight);
        }
        if (orbitInput.left) {
            _orbitMove.subtractInPlace(_orbitRight);
        }
        if (orbitInput.up) {
            _orbitMove.y += 1;
        }
        if (orbitInput.down) {
            _orbitMove.y -= 1;
        }
        if (_orbitMove.lengthSquared() > 0) {
            _orbitMove.normalize().scaleInPlace(step);
            cam.target.addInPlace(_orbitMove);
        }
    });
}

export function stopOrbit(): void {
    orbitInput.forward = false;
    orbitInput.backward = false;
    orbitInput.left = false;
    orbitInput.right = false;
    orbitInput.up = false;
    orbitInput.down = false;
    if (_orbitUpdateHandle) {
        _orbitUpdateHandle = safeDispose(_orbitUpdateHandle);
    }
}

// ======== Surround (turntable) — 整圈匀速自转 =====

export function startSurround(scene: Scene): void {
    _surroundAngle = 0;
    if (_surroundUpdateHandle) {
        _surroundUpdateHandle.dispose();
    }
    _surroundUpdateHandle = observe(scene.onBeforeRenderObservable, () => {
        const cam = getCurrentCamera();
        if (!cam || !(cam instanceof ArcRotateCamera)) {
            return;
        }
        const p = getCameraPreset().surround;
        if (!getConcertPaused()) {
            const delta = scene.getAnimationRatio() * p.speed * (scene.deltaTime / 1000);
            _surroundAngle += delta;
        }
        cam.alpha = -Math.PI / 2 + _surroundAngle;
        cam.radius = p.radius;
        cam.beta = Math.PI / 3;
        const focusedId = focusedModelId;
        if (focusedId) {
            const inst = modelRegistry.get(focusedId);
            if (inst && inst.meshes.length > 0) {
                const root = inst.rootMesh;
                _concertTarget.set(root.position.x, p.height, root.position.z);
            } else {
                _concertTarget.set(0, p.height, 0);
            }
        } else {
            _concertTarget.set(0, p.height, 0);
        }
        cam.setTarget(_concertTarget);
    });
}

export function stopSurround(): void {
    if (_surroundUpdateHandle) {
        _surroundUpdateHandle = safeDispose(_surroundUpdateHandle);
    }
}

// ======== Concert (fan-cam) — 限定水平扫掠 + 正弦上下摆动 =====

export function startConcert(scene: Scene): void {
    _concertT = 0;
    if (_concertUpdateHandle) {
        _concertUpdateHandle.dispose();
    }
    _concertUpdateHandle = observe(scene.onBeforeRenderObservable, () => {
        const cam = getCurrentCamera();
        if (!cam || !(cam instanceof ArcRotateCamera)) {
            return;
        }
        const p = getCameraPreset().concert;
        if (!getConcertPaused()) {
            _concertT += scene.getAnimationRatio() * (scene.deltaTime / 1000);
        }
        const sweepRad = (p.sweepAngle * Math.PI) / 180;
        const bobRad = (p.bobAmplitude * Math.PI) / 180;
        // 水平：在 ±sweepAngle/2 区间内做正弦扫掠（两端自然减速，模拟粉丝机位左右摇摄）
        cam.alpha = -Math.PI / 2 + (sweepRad / 2) * Math.sin(_concertT * p.sweepSpeed);
        // 垂直：以 baseBeta 为中心做正弦上下摆动（模拟手持设备的上下晃动/跟拍升降台）
        cam.beta = p.baseBeta + bobRad * Math.sin(_concertT * p.bobSpeed);
        cam.radius = p.radius;
        const focusedId = focusedModelId;
        if (focusedId) {
            const inst = modelRegistry.get(focusedId);
            if (inst && inst.meshes.length > 0) {
                const root = inst.rootMesh;
                _concertTarget.set(root.position.x, p.height, root.position.z);
            } else {
                _concertTarget.set(0, p.height, 0);
            }
        } else {
            _concertTarget.set(0, p.height, 0);
        }
        cam.setTarget(_concertTarget);
    });
}

export function stopConcert(): void {
    if (_concertUpdateHandle) {
        _concertUpdateHandle = safeDispose(_concertUpdateHandle);
    }
}
