// @vitest-environment node
// @ts-nocheck — mock 类运行时替换（camera 拆分测试用）
// [doc:adr-204] camera.adr100.test.ts 拆分：P1 VMD + P2 auto camera
import { describe, it, expect, vi, beforeEach, beforeAll, afterEach } from 'vitest';
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
    installCameraSUT,
} from './camera-adr100-mocks';
import {
    setCameraScene,
    setCameraMode,
    setCameraCanvas,
    setCameraControl,
    setCameraBehavior,
    setScriptedSubMode,
} from '../scene/camera/camera-state';
import { setSwitchCameraModeCallback, createVmdCamera } from '../scene/camera/camera-vmd';

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

// MockMmdCam 是共享 mock，但缺少真实 MmdCamera/Babylon Node 的 isDisposed()。
// 在测试内局部补齐，用于覆盖 vmd→orbit→clear/load 的“已 dispose 相机不得二次释放”回归。
if (!(MockMmdCam.prototype as any).isDisposed) {
    Object.defineProperty(MockMmdCam.prototype, 'isDisposed', {
        configurable: true,
        value(this: any) {
            return this.__disposed === true;
        },
    });
    const origDispose = MockMmdCam.prototype.dispose;
    MockMmdCam.prototype.dispose = function (this: any) {
        this.__disposed = true;
        origDispose.call(this);
    };
}
let cam: any;
installCameraSUT((c) => {
    cam = c;
});

describe('VMD', () => {
    beforeEach(() => {
        // 注入真实 scene，使 loadCameraVmd/clearCameraVmd 触达真实清理分支
        // （此前无 scene 时函数体直接跳过，断言是 no-op 假覆盖）
        setCameraScene(new MockScene() as any);
        setCameraCanvas({} as any);
        setCameraMode('orbit');
        setSwitchCameraModeCallback(null);
        // 复位 VMD 状态，消除用例间顺序耦合（与 serialization beforeEach 对齐）
        cam.clearCameraVmd();
    });
    afterEach(() => {
        setCameraScene(null);
        setCameraCanvas(null);
        setCameraMode('orbit');
        setCameraControl('orbit');
        setCameraBehavior('none');
        setScriptedSubMode('loop');
        setSwitchCameraModeCallback(null);
        vi.restoreAllMocks();
    });
    it('hasCameraVmd false default', () => {
        expect(cam.hasCameraVmd()).toBe(false);
    });
    it('loadCameraVmd 后 hasCameraVmd true / 名称路径可读 / 动画句柄创建并绑定', () => {
        const createSpy = vi.spyOn(MockMmdCam.prototype, 'createRuntimeAnimation');
        const setRuntimeSpy = vi.spyOn(MockMmdCam.prototype, 'setRuntimeAnimation');
        cam.loadCameraVmd({} as any, 'D:/vmd/test.vmd', 'test.vmd');
        expect(cam.hasCameraVmd()).toBe(true);
        expect(cam.getCameraVmdName()).toBe('test.vmd');
        expect(cam.getCameraVmdPath()).toBe('D:/vmd/test.vmd');
        expect(createSpy).toHaveBeenCalledTimes(1);
        expect(setRuntimeSpy).toHaveBeenCalledWith(0);
    });
    it('clearCameraVmd 非 vmd 模式释放相机并清空状态（恰好一次）', () => {
        const scene = new MockScene();
        setCameraScene(scene as any);
        const removeSpy = vi.spyOn(scene, 'removeCamera');
        const disposeSpy = vi.spyOn(MockMmdCam.prototype, 'dispose');
        cam.loadCameraVmd({} as any, 'D:/vmd/test.vmd', 'test.vmd');
        expect(cam.hasCameraVmd()).toBe(true);
        cam.clearCameraVmd();
        expect(removeSpy).toHaveBeenCalledTimes(1);
        expect(disposeSpy).toHaveBeenCalledTimes(1);
        expect(cam.hasCameraVmd()).toBe(false);
        expect(cam.getCameraVmdName()).toBe('');
        expect(cam.getCameraVmdPath()).toBe('');
    });
    it('clearCameraVmd vmd 模式走 switchCameraMode 回调，不重复手动释放', () => {
        const switchCb = vi.fn();
        setSwitchCameraModeCallback(switchCb);
        setCameraMode('vmd');
        const scene = new MockScene();
        setCameraScene(scene as any);
        const removeSpy = vi.spyOn(scene, 'removeCamera');
        const disposeSpy = vi.spyOn(MockMmdCam.prototype, 'dispose');
        cam.loadCameraVmd({} as any, 'D:/vmd/test.vmd', 'test.vmd');
        cam.clearCameraVmd();
        expect(switchCb).toHaveBeenCalledWith('orbit');
        expect(removeSpy).not.toHaveBeenCalled();
        expect(disposeSpy).not.toHaveBeenCalled();
        expect(cam.hasCameraVmd()).toBe(false);
        expect(cam.getCameraVmdName()).toBe('');
        expect(cam.getCameraVmdPath()).toBe('');
    });
    it('clearCameraVmd 对已 dispose 的 MmdCamera 不重复释放', () => {
        const scene = new MockScene();
        setCameraScene(scene as any);
        const removeSpy = vi.spyOn(scene, 'removeCamera');
        const disposeSpy = vi.spyOn(MockMmdCam.prototype, 'dispose');
        cam.loadCameraVmd({} as any, 'D:/vmd/test.vmd', 'test.vmd');
        const mmd = createVmdCamera();
        // 模拟 vmd→orbit 切换后 switchCameraMode 已 dispose 该相机，但 camera-vmd
        // 模块级 _mmdCamera 仍保留旧引用（这是 createVmdCamera 可重建的设计前提）。
        mmd.dispose();
        expect(disposeSpy).toHaveBeenCalledTimes(1);
        cam.clearCameraVmd();
        expect(removeSpy).not.toHaveBeenCalled();
        expect(disposeSpy).toHaveBeenCalledTimes(1);
        expect(cam.hasCameraVmd()).toBe(false);
        expect(cam.getCameraVmdName()).toBe('');
        expect(cam.getCameraVmdPath()).toBe('');
    });
    it('loadCameraVmd 重载对已 dispose 的 MmdCamera 不重复释放', () => {
        const scene = new MockScene();
        setCameraScene(scene as any);
        const removeSpy = vi.spyOn(scene, 'removeCamera');
        const disposeSpy = vi.spyOn(MockMmdCam.prototype, 'dispose');
        cam.loadCameraVmd({} as any, 'D:/vmd/a.vmd', 'a.vmd');
        const mmd = createVmdCamera();
        mmd.dispose();
        expect(disposeSpy).toHaveBeenCalledTimes(1);
        cam.loadCameraVmd({} as any, 'D:/vmd/b.vmd', 'b.vmd');
        expect(removeSpy).not.toHaveBeenCalled();
        expect(disposeSpy).toHaveBeenCalledTimes(1);
        expect(cam.hasCameraVmd()).toBe(true);
        expect(cam.getCameraVmdName()).toBe('b.vmd');
        expect(cam.getCameraVmdPath()).toBe('D:/vmd/b.vmd');
    });
    it('animateCameraVmd 仅 vmd 模式驱动 MmdCamera.animate', () => {
        const animateSpy = vi.spyOn(MockMmdCam.prototype, 'animate');
        cam.loadCameraVmd({} as any, 'D:/vmd/test.vmd', 'test.vmd');
        cam.animateCameraVmd(1.5);
        expect(animateSpy).not.toHaveBeenCalled();
        setCameraMode('vmd');
        cam.animateCameraVmd(2.5);
        expect(animateSpy).toHaveBeenCalledWith(2.5);
    });
    it('getCameraVmdName empty', () => {
        expect(cam.getCameraVmdName()).toBe('');
    });
    it('getCameraVmdPath empty', () => {
        expect(cam.getCameraVmdPath()).toBe('');
    });
});
describe('ConcertPaused', () => {
    beforeEach(() => {
        cam.setConcertPaused(false);
    });
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
    afterEach(() => {
        cam.setAutoCameraEnabled(false);
        mockUiState.autoCameraEnabled = false;
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
