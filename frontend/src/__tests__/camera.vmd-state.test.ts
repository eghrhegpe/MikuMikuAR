// @ts-nocheck — vi.hoisted mock 类运行时替换（camera 拆分测试用）
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
const MockCamera = vi.hoisted(() => {
    return class {
        fov = 0.8;
        position = { x: 0, y: 0, z: 0 };
        name = '';
        constructor(..._a: any[]) {}
        getClassName() {
            return 'Camera';
        }
        attachControl() {}
        detachControl() {}
        dispose() {}
    } as any;
});
const MockArcRotateCamera = vi.hoisted(() => {
    return class {
        alpha = 0;
        beta = 0;
        radius = 0;
        lowerRadiusLimit = 0;
        upperRadiusLimit = 0;
        panningSensibility = 50;
        inertia = 0;
        angularSensibilityX = 0;
        angularSensibilityY = 0;
        pinchPrecision = 0;
        _panningMouseButton = 0;
        fov = 0.8;
        position = { x: 0, y: 0, z: 0 };
        target = { x: 0, y: 8, z: 0 };
        _scene: any;
        _cameraRotation = { x: 0, y: 0 };
        inputs = { addGamepad: () => {} };
        name = '';
        constructor(..._a: any[]) {}
        getClassName() {
            return 'ArcRotateCamera';
        }
        attachControl() {}
        detachControl() {}
        setTarget(_t: any) {
            this.target.x = _t.x;
            this.target.y = _t.y;
            this.target.z = _t.z;
        }
        dispose() {}
    } as any;
});
const MockUniversalCamera = vi.hoisted(() => {
    return class {
        speed = 0.5;
        angularSensibility = 2000;
        fov = 0.8;
        name = '';
        position = { x: 0, y: 0, z: 0 };
        keysUp: number[] = [];
        keysDown: number[] = [];
        keysLeft: number[] = [];
        keysRight: number[] = [];
        constructor(..._a: any[]) {}
        getClassName() {
            return 'UniversalCamera';
        }
        attachControl() {}
        detachControl() {}
        setTarget() {}
        getDirection(_d: any) {
            return { x: 0, y: 0, z: 1, scaleInPlace: () => {}, addInPlace: () => {} };
        }
        dispose() {}
    } as any;
});
const MockV3 = vi.hoisted(() => {
    const V = class {
        x = 0;
        y = 0;
        z = 0;
        constructor(x = 0, y = 0, z = 0) {
            this.x = x;
            this.y = y;
            this.z = z;
        }
        clone() {
            return new V(this.x, this.y, this.z);
        }
        add(v: any) {
            return new V(this.x + v.x, this.y + v.y, this.z + v.z);
        }
        scale(s: number) {
            return new V(this.x * s, this.y * s, this.z * s);
        }
        length() {
            return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
        }
        normalize() {
            return this;
        }
        set(x: number, y: number, z: number) {
            this.x = x;
            this.y = y;
            this.z = z;
            return this;
        }
        setAll(v: number) {
            this.x = this.y = this.z = v;
            return this;
        }
        static Zero() {
            return new V(0, 0, 0);
        }
        static Right() {
            return new V(1, 0, 0);
        }
        static Up() {
            return new V(0, 1, 0);
        }
        static Forward() {
            return new V(0, 0, 1);
        }
        static One() {
            return new V(1, 1, 1);
        }
    };
    return V as any;
});
const MockQuat = vi.hoisted(() => {
    return class {
        x = 0;
        y = 0;
        z = 0;
        w = 1;
        constructor(x = 0, y = 0, z = 0, w = 1) {
            this.x = x;
            this.y = y;
            this.z = z;
            this.w = w;
        }
        clone() {
            return new (this.constructor as any)(this.x, this.y, this.z, this.w);
        }
        static Identity() {
            return new this(0, 0, 0, 1);
        }
        static RotationYawPitchRoll() {
            return new this(0, 0, 0, 1);
        }
    } as any;
});
const MockMtx = vi.hoisted(() => {
    return class {
        m = new Float32Array(16);
        constructor() {
            this.m.fill(0);
        }
        getClassName() {
            return 'Matrix';
        }
        invertToRef() {}
        multiplyToRef() {}
        getRotationMatrixToRef() {}
        decompose() {
            return {
                translation: { x: 0, y: 0, z: 0 },
                rotation: { x: 0, y: 0, z: 0 },
                scaling: { x: 1, y: 1, z: 1 },
            };
        }
        static Identity() {
            return new this();
        }
        static IdentityToRef() {}
        static RotationYToRef() {}
    } as any;
});
const MockMmdCam = vi.hoisted(() => {
    return class {
        name = '';
        constructor(name: string, ..._a: any[]) {
            this.name = name;
        }
        createRuntimeAnimation() {
            return 0;
        }
        setRuntimeAnimation() {}
        animate(_f: number) {}
        dispose() {}
        getClassName() {
            return 'MmdCamera';
        }
    } as any;
});
const MockC4 = vi.hoisted(() => {
    return class {
        r = 0;
        g = 0;
        b = 0;
        a = 1;
        constructor(r = 0, g = 0, b = 0, a = 1) {
            this.r = r;
            this.g = g;
            this.b = b;
            this.a = a;
        }
        set(r: number, g: number, b: number, a = this.a) {
            this.r = r;
            this.g = g;
            this.b = b;
            this.a = a;
            return this;
        }
        clone() {
            return new (this.constructor as any)(this.r, this.g, this.b, this.a);
        }
        toArray() {
            return [this.r, this.g, this.b, this.a];
        }
    } as any;
});
const MockScene = vi.hoisted(() => {
    return class {
        _uc = 0;
        cc = { r: 0, g: 0, b: 0, a: 1 };
        _e: any = null;
        l: any[] = [];
        m: any[] = [];
        mats: any[] = [];
        ac: any = null;
        obr = { add: () => ({}), remove: () => {} };
        odd = { add: () => ({}), remove: () => {}, notifyObservers: () => {}, hasObservers: false };
        constructor(e?: any) {
            this._e = e ?? null;
        }
        getEngine() {
            return this._e;
        }
        getScene() {
            return this;
        }
        getClassName() {
            return 'Scene';
        }
        getUniqueId() {
            return this._uc++;
        }
        registerBeforeRender() {}
        unregisterBeforeRender() {}
        executeWhenReady() {}
        addCamera() {}
        removeCamera() {}
        attachControl() {}
        detachControl() {}
        getTransformMatrix() {
            return {};
        }
        updateTransformMatrix() {}
        getProjectionMatrix() {
            return { clone: () => ({}) };
        }
        markAllMaterialsAsDirty() {}
    } as any;
});

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
const mockUiState: Record<string, unknown> = {};
vi.mock('@/core/config', () => ({
    focusedModelId: null,
    modelRegistry: new Map(),
    uiState: mockUiState,
    triggerAutoSave: vi.fn(),
    setStatus: vi.fn(),
}));
const mockPBD = vi.fn<() => any>(() => null);
vi.mock('@/scene/scene', () => ({
    focusModel: vi.fn(),
    reattachPipeline: vi.fn(),
    setARMode: vi.fn(),
    getProcBeatDetector: mockPBD,
}));
vi.mock('../scene/env/env-persist', () => ({ schedulePersistUI: vi.fn() }));
vi.mock('../scene/camera/camera', () => ({
    initCameraSystem: vi.fn(),
    autoFrame: vi.fn(),
    getCameraMode: vi.fn(() => 'orbit'),
    getCurrentCamera: vi.fn(() => null),
    getFov: vi.fn(() => 0.8),
    setFov: vi.fn(),
    getOrbitParams: vi.fn(),
    getFreeflyParams: vi.fn(),
    getConcertParams: vi.fn(),
    getSurroundParams: vi.fn(),
    setOrbitParams: vi.fn(),
    setFreeflyParams: vi.fn(),
    setConcertParams: vi.fn(),
    setSurroundParams: vi.fn(),
    hasCameraVmd: vi.fn(() => false),
}));

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
    it('hasCameraVmd false default', () => {
        expect(cam.hasCameraVmd()).toBe(false);
    });
    it('clearCameraVmd no throw', () => {
        expect(() => cam.clearCameraVmd()).not.toThrow();
    });
    it('getCameraVmdName empty', () => {
        expect(cam.getCameraVmdName()).toBe('');
    });
    it('getCameraVmdPath empty', () => {
        expect(cam.getCameraVmdPath()).toBe('');
    });
    it('clearCameraVmd stays false', () => {
        cam.clearCameraVmd();
        expect(cam.hasCameraVmd()).toBe(false);
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
