// @vitest-environment node
// @ts-nocheck — mock 类运行时替换（camera 拆分测试用）
// [doc:adr-204] camera.adr100.test.ts 拆分：P3 serialization
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
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
    mockCameraModule,
} from './camera-adr100-mocks';

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
vi.mock('../scene/camera/camera', () => mockCameraModule());

let cam: any;
beforeAll(async () => {
    const m = await vi.importActual('../scene/camera/camera');
    cam = m as any;
    (cam as any).setSyncAxesCallback(() =>
        (cam as any)._syncAxesFromMode((cam as any).getCameraMode())
    );
});
beforeEach(() => {
    cam.setCameraPreset(cam.defaultCameraPreset());
    cam.setFov(0.8);
});

describe('P3 serialization', () => {
    beforeEach(() => {
        cam.setAutoCameraEnabled(false);
        mockUiState.autoCameraEnabled = false;
        mockPBD.mockReturnValue(null);
        vi.clearAllMocks();
    });
    it('getCameraState dual-write', () => {
        const s = cam.getCameraState();
        expect(s.control).toBe('orbit');
        expect(s.behavior).toBe('none');
        expect(s.mode).toBe('orbit');
    });
    it('getCameraState beatcut mode=beatcut', () => {
        const d = { onBeat: vi.fn(() => vi.fn()) };
        cam.setAutoCameraEnabled(true, d);
        const s = cam.getCameraState();
        expect(s.behavior).toBe('beatcut');
        expect(s.mode).toBe('beatcut');
    });
    it('setCameraState new format', () => {
        cam.setCameraState({
            mode: 'orbit',
            control: 'orbit',
            behavior: 'turntable',
            preset: cam.defaultCameraPreset(),
            alpha: 0,
            beta: 1,
            radius: 16,
            targetX: 0,
            targetY: 8,
            targetZ: 0,
        });
        expect(cam.getCameraBehavior()).toBe('turntable');
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
        expect(cam.isAutoCameraEnabled()).toBe(true);
    });
    it('roundtrip setCameraState(getCameraState())', () => {
        const d = { onBeat: vi.fn(() => vi.fn()) };
        cam.setAutoCameraEnabled(true, d);
        const s = cam.getCameraState();
        cam.setAutoCameraEnabled(false);
        cam.setCameraState(s);
        expect(cam.getCameraBehavior()).toBe('beatcut');
    });
});
