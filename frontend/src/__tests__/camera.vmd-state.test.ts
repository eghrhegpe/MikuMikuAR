// @vitest-environment node
// @ts-nocheck — mock 类运行时替换（camera 拆分测试用）
// [doc:adr-204] camera.adr100.test.ts 拆分：P1 VMD + P2 auto camera
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
import { setCameraScene } from '../scene/camera/camera-state';

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

describe('VMD', () => {
    beforeEach(() => {
        // 注入真实 scene，使 loadCameraVmd/clearCameraVmd 触达真实清理分支
        // （此前无 scene 时函数体直接跳过，断言是 no-op 假覆盖）
        setCameraScene(new MockScene() as any);
    });
    afterEach(() => {
        setCameraScene(null);
    });
    it('hasCameraVmd false default', () => {
        expect(cam.hasCameraVmd()).toBe(false);
    });
    it('loadCameraVmd 后 hasCameraVmd true / 名称路径可读', () => {
        cam.loadCameraVmd({} as any, 'D:/vmd/test.vmd', 'test.vmd');
        expect(cam.hasCameraVmd()).toBe(true);
        expect(cam.getCameraVmdName()).toBe('test.vmd');
        expect(cam.getCameraVmdPath()).toBe('D:/vmd/test.vmd');
    });
    it('clearCameraVmd 释放相机并清空状态', () => {
        cam.loadCameraVmd({} as any, 'D:/vmd/test.vmd', 'test.vmd');
        expect(cam.hasCameraVmd()).toBe(true);
        cam.clearCameraVmd();
        expect(cam.hasCameraVmd()).toBe(false);
        expect(cam.getCameraVmdName()).toBe('');
        expect(cam.getCameraVmdPath()).toBe('');
    });
    it('getCameraVmdName empty', () => {
        expect(cam.getCameraVmdName()).toBe('');
    });
    it('getCameraVmdPath empty', () => {
        expect(cam.getCameraVmdPath()).toBe('');
    });
});
describe('ConcertPaused', () => {
    it('default false', () => {
        expect(cam.getConcertPaused()).toBe(false);
    });
    it('set true', () => {
        cam.setConcertPaused(true);
        expect(cam.getConcertPaused()).toBe(true);
    });
    it('toggle back', () => {
        cam.setConcertPaused(true);
        cam.setConcertPaused(false);
        expect(cam.getConcertPaused()).toBe(false);
    });
    it('false->false', () => {
        cam.setConcertPaused(false);
        expect(cam.getConcertPaused()).toBe(false);
    });
});
describe('CameraMode type', () => {
    it('valid', () => {
        expect(['orbit', 'freefly', 'surround', 'concert', 'oneshot', 'vmd']).toContain(
            cam.getCameraMode()
        );
    });
});
describe('P1', () => {
    it('LEGACY_MODE_MAP 8 keys', () => {
        expect(Object.keys(cam.LEGACY_MODE_MAP).sort()).toEqual([
            'ar',
            'beatcut',
            'concert',
            'freefly',
            'oneshot',
            'orbit',
            'surround',
            'vmd',
        ]);
    });
    it('orbit → {orbit,none}', () => {
        expect(cam.LEGACY_MODE_MAP.orbit).toEqual({ control: 'orbit', behavior: 'none' });
    });
    it('surround→turntable concert→concert', () => {
        expect(cam.LEGACY_MODE_MAP.surround.behavior).toBe('turntable');
        expect(cam.LEGACY_MODE_MAP.concert.behavior).toBe('concert');
    });
    it('vmd/oneshot', () => {
        expect(cam.LEGACY_MODE_MAP.vmd).toEqual({
            control: 'orbit',
            behavior: 'scripted',
            scripted: 'loop',
        });
        expect(cam.LEGACY_MODE_MAP.oneshot).toEqual({
            control: 'orbit',
            behavior: 'scripted',
            scripted: 'oneshot',
        });
    });
    it('deriveLegacyMode roundtrip', () => {
        for (const [m, axes] of Object.entries(cam.LEGACY_MODE_MAP)) {
            expect(cam.deriveLegacyMode(axes.control, axes.behavior, axes.scripted)).toBe(m);
        }
    });
    it('deriveLegacyMode beatcut', () => {
        expect(cam.deriveLegacyMode('orbit', 'beatcut')).toBe('beatcut');
    });
});
describe('P2', () => {
    beforeEach(() => {
        cam.setAutoCameraEnabled(false);
        mockUiState.autoCameraEnabled = false;
        mockPBD.mockReturnValue(null);
        vi.clearAllMocks();
    });
    it('default orbit/none/!auto', () => {
        expect(cam.getCameraControl()).toBe('orbit');
        expect(cam.getCameraBehavior()).toBe('none');
        expect(cam.isAutoCameraEnabled()).toBe(false);
    });
    it('enable → beatcut+subscribe', () => {
        const unsub = vi.fn();
        const d = { onBeat: vi.fn(() => unsub) };
        cam.setAutoCameraEnabled(true, d);
        expect(cam.getCameraBehavior()).toBe('beatcut');
        expect(d.onBeat).toHaveBeenCalledTimes(1);
    });
    it('disable → none+unsubscribe', () => {
        const unsub = vi.fn();
        const d = { onBeat: vi.fn(() => unsub) };
        cam.setAutoCameraEnabled(true, d);
        cam.setAutoCameraEnabled(false);
        expect(cam.getCameraBehavior()).toBe('none');
        expect(unsub).toHaveBeenCalledTimes(1);
    });
    it('fallback to procBeatDetector', () => {
        const unsub = vi.fn();
        const d = { onBeat: vi.fn(() => unsub) };
        mockPBD.mockReturnValue(d);
        cam.setAutoCameraEnabled(true);
        expect(mockPBD).toHaveBeenCalled();
        expect(d.onBeat).toHaveBeenCalledTimes(1);
    });
    it('restoreAutoCameraState re-subscribes', () => {
        const unsub = vi.fn();
        const d = { onBeat: vi.fn(() => unsub) };
        mockPBD.mockReturnValue(d);
        mockUiState.autoCameraEnabled = true;
        mockUiState.autoCameraBeatsPerSwitch = 4;
        cam.restoreAutoCameraState();
        expect(cam.isAutoCameraEnabled()).toBe(true);
        expect(d.onBeat).toHaveBeenCalledTimes(1);
    });
});
