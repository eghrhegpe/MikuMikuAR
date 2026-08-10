// @vitest-environment node
// @ts-nocheck — mock 类运行时替换（camera 拆分测试用）
// [doc:adr-204] camera.adr100.test.ts 拆分：P4 guards
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

describe('P4 guards', () => {
    beforeEach(() => {
        cam.setAutoCameraEnabled(false);
        mockUiState.autoCameraEnabled = false;
        mockPBD.mockReturnValue(null);
        vi.clearAllMocks();
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
    });
    it('setCameraBehavior(beatcut) ignored in non-orbit', () => {
        cam.setCameraControl('freefly');
        cam.setCameraBehavior('beatcut');
        expect(cam.getCameraBehavior()).toBe('none');
    });
    it('setCameraControl(freefly) while beatcut→none', () => {
        cam.setCameraBehavior('beatcut');
        cam.setCameraControl('freefly');
        expect(cam.getCameraBehavior()).toBe('none');
        expect(cam.isAutoCameraEnabled()).toBe(false);
    });
    it('setCameraBehavior(concert) works', () => {
        cam.setCameraBehavior('concert');
        expect(cam.getCameraBehavior()).toBe('concert');
        expect(cam.isAutoCameraEnabled()).toBe(false);
    });
    it('scripted+oneshot roundtrip', () => {
        cam.setCameraState({
            mode: 'orbit',
            control: 'orbit',
            behavior: 'scripted',
            scriptedSubMode: 'oneshot',
            preset: cam.defaultCameraPreset(),
            alpha: 0,
            beta: 1,
            radius: 16,
            targetX: 0,
            targetY: 8,
            targetZ: 0,
        });
        expect(cam.getCameraBehavior()).toBe('scripted');
        expect(cam.getScriptedSubMode()).toBe('oneshot');
    });
    it('partial control→behavior fallback', () => {
        cam.setCameraState({
            mode: 'orbit',
            control: 'freefly',
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
    });
    it('partial behavior→control fallback', () => {
        cam.setCameraState({
            mode: 'concert',
            behavior: 'concert',
            preset: cam.defaultCameraPreset(),
            alpha: 0,
            beta: 1,
            radius: 16,
            targetX: 0,
            targetY: 8,
            targetZ: 0,
        });
        expect(cam.getCameraControl()).toBe('orbit');
        expect(cam.getCameraBehavior()).toBe('concert');
    });
    it('explicit behavior:none overrides old autoCameraEnabled', () => {
        mockUiState.autoCameraEnabled = true;
        cam.setCameraState({
            mode: 'orbit',
            behavior: 'none',
            preset: cam.defaultCameraPreset(),
            alpha: 0,
            beta: 1,
            radius: 16,
            targetX: 0,
            targetY: 8,
            targetZ: 0,
        });
        expect(cam.getCameraBehavior()).toBe('none');
        expect(cam.isAutoCameraEnabled()).toBe(false);
    });
});
