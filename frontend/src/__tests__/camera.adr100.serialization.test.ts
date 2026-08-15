// @vitest-environment node
// @ts-nocheck — mock 类运行时替换（camera 拆分测试用）
// [doc:adr-204] camera.adr100.test.ts 拆分：P3 serialization
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    MockCamera,
    MockArcRotateCamera,
    MockUniversalCamera,
    MockV3,
    MockQuat,
    MockMtx,
    MockMmdCam,
    MockC4,
    MockScene,
    mockUiState,
    mockPBD,
    mockConfigModule,
    mockSceneModule,
    mockEnvPersist,
    installCameraSUT,
} from './camera-adr100-mocks';
import {
    setCurrentCamera,
    setCameraScene,
    setFocusCenterY,
    getCameraPreset,
} from '../scene/camera/camera-state';

vi.mock('@babylonjs/core/Cameras/camera', () => ({ Camera: MockCamera }));
vi.mock('@babylonjs/core/Cameras/arcRotateCamera', () => ({
    ArcRotateCamera: MockArcRotateCamera,
}));
vi.mock('@babylonjs/core/Cameras/universalCamera', () => ({
    UniversalCamera: MockUniversalCamera,
}));
vi.mock('@babylonjs/core/Maths/math.vector', () => ({
    Vector3: MockV3,
    Quaternion: MockQuat,
    Matrix: MockMtx,
}));
vi.mock('@babylonjs/core/Maths/math.color', () => ({
    Color3: class {
        r = 0;
        g = 0;
        b = 0;
        set() {}
        clone() {
            return this;
        }
    },
    Color4: MockC4,
}));
vi.mock('@babylonjs/core/Meshes/mesh', () => ({ AbstractMesh: class {}, Mesh: class {} }));
vi.mock('@babylonjs/core/scene', () => ({ Scene: MockScene }));
vi.mock('babylon-mmd/esm/Runtime/mmdCamera', () => ({ MmdCamera: MockMmdCam }));
vi.mock('babylon-mmd/esm/Loader/Animation/mmdAnimation', () => ({}));
vi.mock('@/core/config', () => mockConfigModule());
vi.mock('@/scene/scene', () => mockSceneModule());
vi.mock('../scene/env/_bridge/env-persist', () => mockEnvPersist());

let cam: any;
installCameraSUT((c) => {
    cam = c;
});

describe('P3 serialization', () => {
    beforeEach(() => {
        // 清掉上个用例注入的 live camera / scene / focusCenterY，避免 getCameraState 读到残留状态。
        setCurrentCamera(null);
        setCameraScene(null);
        setFocusCenterY(8);
        cam.setAutoCameraEnabled(false);
        mockUiState.autoCameraEnabled = false;
        mockPBD.mockReturnValue(null);
        // 全量复位 mode/control/behavior，消除用例间顺序耦合（与 guards 一致）
        cam.setCameraState({
            mode: 'orbit',
            control: 'orbit',
            behavior: 'none',
            preset: cam.defaultCameraPreset(),
            alpha: 0,
            beta: 1,
            radius: 16,
            targetX: 0,
            targetY: 8,
            targetZ: 0,
        });
        vi.clearAllMocks();
    });
    afterEach(() => {
        setCurrentCamera(null);
        setCameraScene(null);
    });

    it('getCameraState dual-write', () => {
        const s = cam.getCameraState();
        expect(s.control).toBe('orbit');
        expect(s.behavior).toBe('none');
        expect(s.mode).toBe('orbit');
        expect(s.scriptedSubMode).toBe('loop');
        expect(s.fov).toBe(0.8);
        expect(s.alpha).toBe(0);
        expect(s.radius).toBe(16);
        expect(s.targetY).toBe(8);
        expect(s.positionX).toBe(0);
        expect(s.focusCenterY).toBe(8);
    });

    it('getCameraState ArcRotateCamera full serialization fields', () => {
        const arc = new MockArcRotateCamera();
        arc.alpha = 1;
        arc.beta = 2;
        arc.radius = 10;
        arc.position = { x: 4, y: 5, z: 6 };
        arc.target = { x: 7, y: 8, z: 9 };
        setCurrentCamera(arc);
        setFocusCenterY(3);
        cam.setFov(1.5);

        const s = cam.getCameraState();
        expect(s.alpha).toBe(1);
        expect(s.beta).toBe(2);
        expect(s.radius).toBe(10);
        expect(s.targetX).toBe(7);
        expect(s.targetY).toBe(8);
        expect(s.targetZ).toBe(9);
        expect(s.positionX).toBe(4);
        expect(s.positionY).toBe(5);
        expect(s.positionZ).toBe(6);
        expect(s.fov).toBe(1.5);
        expect(s.focusCenterY).toBe(3);
        expect(s.mode).toBe('orbit');
        expect(s.control).toBe('orbit');
        expect(s.behavior).toBe('none');
        expect(s.preset).toEqual(cam.defaultCameraPreset());
    });

    it('getCameraState UniversalCamera exports position and non-Arc defaults', () => {
        const uni = new MockUniversalCamera();
        uni.position = { x: 1, y: 2, z: 3 };
        setCurrentCamera(uni);
        cam.setCameraState({
            mode: 'freefly',
            control: 'freefly',
            behavior: 'none',
            preset: cam.defaultCameraPreset(),
            alpha: 0,
            beta: 1,
            radius: 16,
            targetX: 0,
            targetY: 8,
            targetZ: 0,
        });

        const s = cam.getCameraState();
        expect(s.mode).toBe('freefly');
        expect(s.control).toBe('freefly');
        expect(s.behavior).toBe('none');
        expect(s.alpha).toBe(0);
        expect(s.beta).toBe(0);
        expect(s.radius).toBe(16);
        expect(s.targetY).toBe(8);
        expect(s.positionX).toBe(1);
        expect(s.positionY).toBe(2);
        expect(s.positionZ).toBe(3);
    });

    it('getCameraState null camera null-safe', () => {
        setCurrentCamera(null);
        const s = cam.getCameraState();
        expect(s.alpha).toBe(0);
        expect(s.beta).toBe(0);
        expect(s.radius).toBe(16);
        expect(s.targetX).toBe(0);
        expect(s.targetY).toBe(8);
        expect(s.targetZ).toBe(0);
        expect(s.positionX).toBe(0);
        expect(s.positionY).toBe(0);
        expect(s.positionZ).toBe(0);
    });

    it('getCameraState beatcut mode=beatcut', () => {
        const d = { onBeat: vi.fn(() => vi.fn()) };
        cam.setAutoCameraEnabled(true, d);
        const s = cam.getCameraState();
        expect(s.behavior).toBe('beatcut');
        expect(s.mode).toBe('beatcut');
        expect(s.control).toBe('orbit');
    });

    it('setCameraState new format', () => {
        cam.setCameraState({
            mode: 'orbit',
            control: 'orbit',
            behavior: 'turntable',
            preset: cam.defaultCameraPreset(),
            fov: 1.2,
            alpha: 0,
            beta: 1,
            radius: 16,
            targetX: 0,
            targetY: 8,
            targetZ: 0,
        });
        expect(cam.getCameraBehavior()).toBe('turntable');
        expect(cam.getCameraControl()).toBe('orbit');
        expect(cam.getCameraMode()).toBe('surround');
        expect(cam.getFov()).toBe(1.2);
    });

    it('setCameraState legacy mode→concert', () => {
        cam.setCameraState({
            mode: 'concert',
            preset: cam.defaultCameraPreset(),
            alpha: 0,
            beta: 1,
            radius: 16,
            targetX: 0,
            targetY: 8,
            targetZ: 0,
        });
        expect(cam.getCameraBehavior()).toBe('concert');
        expect(cam.getCameraControl()).toBe('orbit');
        expect(cam.getCameraMode()).toBe('concert');
    });

    it('setCameraState legacy surround→turntable', () => {
        cam.setCameraState({
            mode: 'surround',
            preset: cam.defaultCameraPreset(),
            alpha: 0,
            beta: 1,
            radius: 16,
            targetX: 0,
            targetY: 8,
            targetZ: 0,
        });
        expect(cam.getCameraBehavior()).toBe('turntable');
        expect(cam.getCameraControl()).toBe('orbit');
        expect(cam.getCameraMode()).toBe('surround');
    });

    it('setCameraState illegal mode fallback to orbit', () => {
        cam.setCameraState({
            mode: 'not-a-mode',
            preset: cam.defaultCameraPreset(),
            alpha: 0,
            beta: 1,
            radius: 16,
            targetX: 0,
            targetY: 8,
            targetZ: 0,
        });
        expect(cam.getCameraMode()).toBe('orbit');
        expect(cam.getCameraControl()).toBe('orbit');
        expect(cam.getCameraBehavior()).toBe('none');
    });

    it('setCameraState old concert→surround migration', () => {
        const preset = cam.defaultCameraPreset();
        preset.concert = { radius: 12, height: 8, speed: 0.3 }; // 旧形态：无 sweepAngle
        cam.setCameraState({
            mode: 'concert',
            preset,
            alpha: 0,
            beta: 1,
            radius: 16,
            targetX: 0,
            targetY: 8,
            targetZ: 0,
        });
        expect(cam.getCameraMode()).toBe('surround');
        expect(cam.getCameraControl()).toBe('orbit');
        expect(cam.getCameraBehavior()).toBe('turntable');
        expect(getCameraPreset().surround).toEqual({ radius: 12, height: 8, speed: 0.3 });
        expect(getCameraPreset().concert).toHaveProperty('sweepAngle');
    });

    it('setCameraState old autoCameraEnabled→beatcut', () => {
        mockUiState.autoCameraEnabled = true;
        cam.setCameraState({
            mode: 'orbit',
            preset: cam.defaultCameraPreset(),
            alpha: 0,
            beta: 1,
            radius: 16,
            targetX: 0,
            targetY: 8,
            targetZ: 0,
        });
        expect(cam.getCameraBehavior()).toBe('beatcut');
        expect(cam.getCameraMode()).toBe('beatcut');
        expect(cam.isAutoCameraEnabled()).toBe(true);
        expect(mockUiState.autoCameraEnabled).toBe(true);
    });

    it('setCameraState explicit non-beatcut unsubscribes old auto camera', () => {
        const unsub = vi.fn();
        const d = { onBeat: vi.fn(() => unsub) };
        cam.setAutoCameraEnabled(true, d);
        expect(cam.getCameraBehavior()).toBe('beatcut');
        expect(d.onBeat).toHaveBeenCalledTimes(1);

        cam.setCameraState({
            mode: 'orbit',
            control: 'orbit',
            behavior: 'none',
            preset: cam.defaultCameraPreset(),
            alpha: 0,
            beta: 1,
            radius: 16,
            targetX: 0,
            targetY: 8,
            targetZ: 0,
        });

        expect(unsub).toHaveBeenCalledTimes(1);
        expect(cam.getCameraBehavior()).toBe('none');
        expect(cam.isAutoCameraEnabled()).toBe(false);
        expect(mockUiState.autoCameraEnabled).toBe(false);
    });

    it('setCameraState non-orbit control ignores beatcut and clears auto flag', () => {
        mockUiState.autoCameraEnabled = true;
        cam.setCameraState({
            mode: 'freefly',
            control: 'freefly',
            behavior: 'beatcut',
            preset: cam.defaultCameraPreset(),
            alpha: 0,
            beta: 1,
            radius: 16,
            targetX: 0,
            targetY: 8,
            targetZ: 0,
        });

        expect(cam.getCameraControl()).toBe('freefly');
        expect(cam.getCameraBehavior()).toBe('none');
        expect(cam.getCameraMode()).toBe('freefly');
        expect(cam.isAutoCameraEnabled()).toBe(false);
        expect(mockUiState.autoCameraEnabled).toBe(false);
    });

    it('setCameraState ArcRotateCamera restores live view and targetHeight', () => {
        const arc = new MockArcRotateCamera();
        setCurrentCamera(arc);
        cam.setCameraState({
            mode: 'orbit',
            control: 'orbit',
            behavior: 'none',
            preset: cam.defaultCameraPreset(),
            fov: 1.2,
            alpha: 1,
            beta: 2,
            radius: 10,
            targetX: 0,
            targetY: 12,
            targetZ: 0,
            focusCenterY: 8,
        });
        expect(arc.alpha).toBe(1);
        expect(arc.beta).toBe(2);
        expect(arc.radius).toBe(10);
        expect(arc.target).toEqual({ x: 0, y: 12, z: 0 });
        expect(cam.getFov()).toBe(1.2);
        expect(getCameraPreset().orbit.targetHeight).toBe(4);
    });

    it('setCameraState UniversalCamera restores live position', () => {
        const uni = new MockUniversalCamera();
        uni.setTarget = vi.fn();
        setCurrentCamera(uni);
        cam.setCameraState({
            mode: 'freefly',
            control: 'freefly',
            behavior: 'none',
            preset: cam.defaultCameraPreset(),
            alpha: 0,
            beta: 1,
            radius: 16,
            positionX: 1,
            positionY: 2,
            positionZ: 3,
            targetX: 4,
            targetY: 5,
            targetZ: 6,
        });
        expect(cam.getCameraMode()).toBe('freefly');
        expect(cam.getCameraControl()).toBe('freefly');
        expect(cam.getCameraBehavior()).toBe('none');
        expect(uni.position).toEqual({ x: 1, y: 2, z: 3 });
        expect(uni.setTarget).toHaveBeenCalledTimes(1);
    });

    it('setCameraState FOV is clamped on restore', () => {
        const arc = new MockArcRotateCamera();
        setCurrentCamera(arc);
        cam.setCameraState({
            mode: 'orbit',
            control: 'orbit',
            behavior: 'none',
            preset: cam.defaultCameraPreset(),
            fov: 5,
            alpha: 0,
            beta: 1,
            radius: 16,
            targetX: 0,
            targetY: 8,
            targetZ: 0,
        });
        expect(cam.getFov()).toBe(3);
        expect(arc.fov).toBe(3);
    });

    it('setCameraState no live camera safe', () => {
        setCurrentCamera(null);
        expect(() =>
            cam.setCameraState({
                mode: 'orbit',
                control: 'orbit',
                behavior: 'none',
                preset: cam.defaultCameraPreset(),
                alpha: 0,
                beta: 1,
                radius: 16,
                targetX: 0,
                targetY: 8,
                targetZ: 0,
            })
        ).not.toThrow();
    });

    it('setCameraState missing preset falls back safely', () => {
        setCurrentCamera(null);
        expect(() =>
            cam.setCameraState({
                mode: 'orbit',
                control: 'orbit',
                behavior: 'none',
                alpha: 0,
                beta: 1,
                radius: 16,
                targetX: 0,
                targetY: 8,
                targetZ: 0,
            })
        ).not.toThrow();
        expect(cam.getCameraControl()).toBe('orbit');
        expect(cam.getCameraBehavior()).toBe('none');
        expect(cam.getCameraMode()).toBe('orbit');
    });

    it('roundtrip setCameraState(getCameraState()) preserves full state', () => {
        const arc = new MockArcRotateCamera();
        setCurrentCamera(arc);
        const original = {
            mode: 'orbit',
            control: 'orbit',
            behavior: 'turntable',
            scriptedSubMode: 'loop',
            preset: cam.defaultCameraPreset(),
            fov: 1.2,
            alpha: 0.5,
            beta: 1.1,
            radius: 9,
            targetX: 1,
            targetY: 12,
            targetZ: 2,
            positionX: 0,
            positionY: 0,
            positionZ: 0,
            focusCenterY: 8,
        };
        cam.setCameraState(original);
        const saved = cam.getCameraState();
        cam.setCameraState({
            mode: 'orbit',
            control: 'orbit',
            behavior: 'none',
            preset: cam.defaultCameraPreset(),
            alpha: 0,
            beta: 1,
            radius: 16,
            targetX: 0,
            targetY: 8,
            targetZ: 0,
        });
        cam.setCameraState(saved);
        expect(cam.getCameraState()).toEqual(saved);
    });

    it('roundtrip setCameraState(getCameraState()) beatcut', () => {
        const d = { onBeat: vi.fn(() => vi.fn()) };
        cam.setAutoCameraEnabled(true, d);
        const s = cam.getCameraState();
        cam.setAutoCameraEnabled(false);
        cam.setCameraState(s);
        expect(cam.getCameraBehavior()).toBe('beatcut');
        expect(cam.getCameraMode()).toBe('beatcut');
        expect(cam.isAutoCameraEnabled()).toBe(true);
    });
});
