// [doc:tests] Camera module unit tests
// Tests state management functions in scene/camera/camera.ts
//
// Approach:
// - Mock all Babylon.js imports that camera.ts depends on
// - Mock `../scene` (scene.ts) to avoid circular dependency:
//   camera.ts imports from scene.ts and scene.ts also imports from camera.ts
//   with a top-level side-effect that fails without full Babylon integration
// - Also mock `../scene/camera/camera` itself with placeholders so that if
//   scene.ts is loaded (e.g. during module resolution), its import of
//   `./camera/camera` gets a safe placeholder
// - Use vi.importActual in beforeAll to get the REAL camera module
//   (bypassing the self-mock)
//
// Live camera sync (setOrbitParams → ArcRotateCamera.radius etc.)
// requires _currentCamera to be set, which only happens through
// switchCameraMode/initCameraSystem. Those need full Babylon scene
// integration, so sync is verified indirectly: we confirm the
// preset half of the function works, and that no errors are thrown
// when no live camera is active.

import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

// ── vi.hoisted: mock classes for vi.mock factories ───────────
// These MUST be hoisted so vi.mock factories can reference them.

const MockCamera = vi.hoisted(() => {
    return class {
        fov = 0.8;
        position = { x: 0, y: 0, z: 0 };
        name = '';
        constructor(..._args: any[]) {}
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
        constructor(..._args: any[]) {}
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
        constructor(..._args: any[]) {}
        getClassName() {
            return 'UniversalCamera';
        }
        attachControl() {}
        detachControl() {}
        setTarget() {}
        getDirection(_dir: any) {
            return { x: 0, y: 0, z: 1, scaleInPlace: () => {}, addInPlace: () => {} };
        }
        dispose() {}
    } as any;
});

const MockVector3 = vi.hoisted(() => {
    const V3 = class {
        x = 0;
        y = 0;
        z = 0;
        constructor(x = 0, y = 0, z = 0) {
            this.x = x;
            this.y = y;
            this.z = z;
        }
        clone() {
            return new V3(this.x, this.y, this.z);
        }
        add(v: any) {
            return new V3(this.x + v.x, this.y + v.y, this.z + v.z);
        }
        scale(s: number) {
            return new V3(this.x * s, this.y * s, this.z * s);
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
            this.x = v;
            this.y = v;
            this.z = v;
            return this;
        }
        static Zero() {
            return new V3(0, 0, 0);
        }
        static Right() {
            return new V3(1, 0, 0);
        }
        static Up() {
            return new V3(0, 1, 0);
        }
        static Forward() {
            return new V3(0, 0, 1);
        }
    };
    return V3 as any;
});

const MockQuaternion = vi.hoisted(() => {
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

const MockMatrix = vi.hoisted(() => {
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

const MockMmdCamera = vi.hoisted(() => {
    return class {
        name: string;
        constructor(name: string, ..._args: any[]) {
            this.name = name;
        }
        createRuntimeAnimation() {
            return 0;
        }
        setRuntimeAnimation() {}
        animate(_frameTime: number) {}
        dispose() {}
        getClassName() {
            return 'MmdCamera';
        }
    } as any;
});

const MockScene = vi.hoisted(() => {
    return class {
        _uniqueIdCounter = 0;
        clearColor = { r: 0, g: 0, b: 0, a: 1 };
        _engine: any = null;
        lights: any[] = [];
        meshes: any[] = [];
        materials: any[] = [];
        activeCamera: any = null;
        onBeforeRenderObservable = { add: () => ({}), remove: () => {} };
        onDisposeObservable = {
            add: () => ({}),
            remove: () => {},
            notifyObservers: () => {},
            hasObservers: false,
        };
        constructor(engine?: any) {
            this._engine = engine ?? null;
        }
        getEngine() {
            return this._engine;
        }
        getScene() {
            return this;
        }
        getClassName() {
            return 'Scene';
        }
        getUniqueId() {
            return this._uniqueIdCounter++;
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

// ── Mock Babylon.js and project imports ─────────────────────
// These must be hoisted above the import statements by vitest.

vi.mock('@babylonjs/core/Cameras/camera', () => ({ Camera: MockCamera }));
vi.mock('@babylonjs/core/Cameras/arcRotateCamera', () => ({
    ArcRotateCamera: MockArcRotateCamera,
}));
vi.mock('@babylonjs/core/Cameras/universalCamera', () => ({
    UniversalCamera: MockUniversalCamera,
}));
vi.mock('@babylonjs/core/Maths/math.vector', () => ({
    Vector3: MockVector3,
    Quaternion: MockQuaternion,
    Matrix: MockMatrix,
}));
vi.mock('@babylonjs/core/scene', () => ({ Scene: MockScene }));
vi.mock('babylon-mmd/esm/Runtime/mmdCamera', () => ({ MmdCamera: MockMmdCamera }));
vi.mock('babylon-mmd/esm/Loader/Animation/mmdAnimation', () => ({}));
vi.mock('../../core/config', () => ({
    focusedModelId: null,
    modelRegistry: new Map(),
}));

// Mock the scene module to break the circular import dependency.
// camera.ts imports from '../scene' and scene.ts has top-level side
// effects that call initCameraSystem from camera.ts.
vi.mock('../scene', () => ({
    focusModel: vi.fn(),
    reattachPipeline: vi.fn(),
}));

// Also mock the camera module itself with stubs so that if scene.ts
// manages to load, its import of './camera/camera' won't trigger
// the circular reference error. We'll use vi.importActual to get
// the real module in the test.
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
    clearCameraVmd: vi.fn(),
    getCameraVmdName: vi.fn(() => ''),
    getCameraVmdPath: vi.fn(() => ''),
    getConcertPaused: vi.fn(() => false),
    setConcertPaused: vi.fn(),
    getSurroundPaused: vi.fn(() => false),
    setSurroundPaused: vi.fn(),
    defaultCameraPreset: vi.fn(),
    getCameraPreset: vi.fn(),
    setCameraPreset: vi.fn(),
    getCameraState: vi.fn(),
    setCameraState: vi.fn(),
}));

// ── Load the REAL camera module via vi.importActual ──────────
// This bypasses our self-mock and returns the actual camera module.
// Because `../scene` is still mocked, camera.ts's import of '../scene'
// will resolve to our mock (no circular dependency issue).

let cameraModule: {
    defaultCameraPreset: () => any;
    getCameraPreset: () => any;
    setCameraPreset: (p: any) => void;
    getOrbitParams: () => any;
    getFreeflyParams: () => any;
    getConcertParams: () => any;
    getSurroundParams: () => any;
    setOrbitParams: (p: any) => void;
    setFreeflyParams: (p: any) => void;
    setConcertParams: (p: any) => void;
    setSurroundParams: (p: any) => void;
    getCameraMode: () => string;
    getCurrentCamera: () => any;
    getFov: () => number;
    setFov: (v: number) => void;
    hasCameraVmd: () => boolean;
    clearCameraVmd: () => void;
    getCameraVmdName: () => string;
    getCameraVmdPath: () => string;
    getConcertPaused: () => boolean;
    setConcertPaused: (p: boolean) => void;
    getSurroundPaused: () => boolean;
    setSurroundPaused: (p: boolean) => void;
};

type CameraPreset = ReturnType<typeof cameraModule.defaultCameraPreset>;

beforeAll(async () => {
    const mod = await vi.importActual('../scene/camera/camera');
    cameraModule = mod as any;
});

// ── beforeEach: reset shareable state ────────────────────────

beforeEach(() => {
    // Reset module-level state to defaults through the public API.
    // _currentCamera / _cameraMode / _scene / _canvas are NOT
    // resettable without calling switchCameraMode; they remain
    // at module-load defaults (null / 'orbit' / null / null).
    cameraModule.setCameraPreset(cameraModule.defaultCameraPreset());
    cameraModule.setFov(0.8);
    cameraModule.setConcertPaused(false);
});

// ════════════════════════════════════════════════════════════
// Tests
// ════════════════════════════════════════════════════════════

describe('defaultCameraPreset', () => {
    it('returns an object with the correct structure', () => {
        const p = cameraModule.defaultCameraPreset();
        expect(p).toHaveProperty('mode');
        expect(p).toHaveProperty('orbit');
        expect(p).toHaveProperty('freefly');
        expect(p).toHaveProperty('concert');
        expect(p).toHaveProperty('surround');
        expect(p.orbit).toHaveProperty('targetHeight');
        expect(p.orbit).toHaveProperty('distance');
        expect(p.orbit).toHaveProperty('beta');
        expect(p.freefly).toHaveProperty('speed');
        expect(p.freefly).toHaveProperty('angularSensibility');
        expect(p.concert).toHaveProperty('radius');
        expect(p.concert).toHaveProperty('height');
        expect(p.concert).toHaveProperty('sweepAngle');
        expect(p.concert).toHaveProperty('sweepSpeed');
        expect(p.concert).toHaveProperty('baseBeta');
        expect(p.concert).toHaveProperty('bobAmplitude');
        expect(p.concert).toHaveProperty('bobSpeed');
        expect(p.surround).toHaveProperty('radius');
        expect(p.surround).toHaveProperty('height');
        expect(p.surround).toHaveProperty('speed');
    });

    it('has the documented default values', () => {
        const p = cameraModule.defaultCameraPreset();
        expect(p.mode).toBe('orbit');
        expect(p.orbit.targetHeight).toBe(0);
        expect(p.orbit.distance).toBe(16);
        expect(p.orbit.beta).toBeCloseTo(Math.PI / 3, 6);
        expect(p.freefly.speed).toBe(0.5);
        expect(p.freefly.angularSensibility).toBe(2000);
        expect(p.concert.radius).toBe(12);
        expect(p.concert.height).toBe(8);
        expect(p.concert.sweepAngle).toBe(120);
        expect(p.concert.sweepSpeed).toBeCloseTo(0.6, 6);
        expect(p.concert.baseBeta).toBeCloseTo(Math.PI / 3, 6);
        expect(p.concert.bobAmplitude).toBe(12);
        expect(p.concert.bobSpeed).toBeCloseTo(0.7, 6);
        expect(p.surround.radius).toBe(12);
        expect(p.surround.height).toBe(8);
        expect(p.surround.speed).toBe(0.3);
    });

    it('returns a new object on each call (no shared reference)', () => {
        const a = cameraModule.defaultCameraPreset();
        const b = cameraModule.defaultCameraPreset();
        expect(a).not.toBe(b);
        a.orbit.targetHeight = 99;
        expect(b.orbit.targetHeight).toBe(0);
    });
});

describe('getCameraPreset / setCameraPreset', () => {
    it('setCameraPreset then getCameraPreset returns the same values', () => {
        const custom: CameraPreset = {
            mode: 'freefly',
            orbit: { targetHeight: 5, distance: 10, beta: 1 },
            freefly: { speed: 1, angularSensibility: 1000 },
            concert: { radius: 15, height: 6, sweepAngle: 90, sweepSpeed: 1, baseBeta: 1, bobAmplitude: 10, bobSpeed: 1 },
            surround: { radius: 14, height: 7, speed: 0.4 },
        };
        cameraModule.setCameraPreset(custom);
        const retrieved = cameraModule.getCameraPreset();
        expect(retrieved.mode).toBe('freefly');
        expect(retrieved.orbit.targetHeight).toBe(5);
        expect(retrieved.orbit.distance).toBe(10);
        expect(retrieved.orbit.beta).toBe(1);
        expect(retrieved.freefly.speed).toBe(1);
        expect(retrieved.freefly.angularSensibility).toBe(1000);
        expect(retrieved.concert.radius).toBe(15);
        expect(retrieved.concert.height).toBe(6);
        expect(retrieved.concert.sweepAngle).toBe(90);
        expect(retrieved.concert.baseBeta).toBe(1);
        expect(retrieved.surround.radius).toBe(14);
        expect(retrieved.surround.speed).toBe(0.4);
    });
});

describe('getOrbitParams / getFreeflyParams / getConcertParams', () => {
    it('getOrbitParams returns the orbit sub-object from the current preset', () => {
        const params = cameraModule.getOrbitParams();
        expect(params.targetHeight).toBe(0);
        expect(params.distance).toBe(16);
        expect(params.beta).toBeCloseTo(Math.PI / 3, 6);
    });

    it('getFreeflyParams returns the freefly sub-object', () => {
        const params = cameraModule.getFreeflyParams();
        expect(params.speed).toBe(0.5);
        expect(params.angularSensibility).toBe(2000);
    });

    it('getConcertParams returns the concert sub-object', () => {
        const params = cameraModule.getConcertParams();
        expect(params.radius).toBe(12);
        expect(params.height).toBe(8);
        expect(params.sweepAngle).toBe(120);
        expect(params.bobAmplitude).toBe(12);
    });

    it('getSurroundParams returns the surround sub-object', () => {
        const params = cameraModule.getSurroundParams();
        expect(params.radius).toBe(12);
        expect(params.height).toBe(8);
        expect(params.speed).toBe(0.3);
    });

    it('all getters reflect preset changes via setCameraPreset', () => {
        cameraModule.setCameraPreset({
            mode: 'orbit',
            orbit: { targetHeight: 99, distance: 1, beta: 2 },
            freefly: { speed: 9, angularSensibility: 500 },
            concert: { radius: 3, height: 4, sweepAngle: 30, sweepSpeed: 2, baseBeta: 0.5, bobAmplitude: 5, bobSpeed: 2 },
            surround: { radius: 7, height: 9, speed: 1.5 },
        });
        expect(cameraModule.getOrbitParams().targetHeight).toBe(99);
        expect(cameraModule.getFreeflyParams().speed).toBe(9);
        expect(cameraModule.getConcertParams().radius).toBe(3);
        expect(cameraModule.getSurroundParams().radius).toBe(7);
    });
});

describe('setOrbitParams', () => {
    it('updates the preset with partial params', () => {
        cameraModule.setOrbitParams({ distance: 20 });
        const params = cameraModule.getOrbitParams();
        expect(params.distance).toBe(20);
        expect(params.targetHeight).toBe(0);
        expect(params.beta).toBeCloseTo(Math.PI / 3, 6);
    });

    it('updates all three orbit fields at once', () => {
        cameraModule.setOrbitParams({ targetHeight: 10, distance: 22, beta: 1.2 });
        const params = cameraModule.getOrbitParams();
        expect(params.targetHeight).toBe(10);
        expect(params.distance).toBe(22);
        expect(params.beta).toBe(1.2);
    });

    it('does not throw when no live camera is active (currentCamera is null)', () => {
        expect(() => cameraModule.setOrbitParams({ distance: 5 })).not.toThrow();
    });

    it('preserves other preset sub-objects (freefly and concert)', () => {
        cameraModule.setOrbitParams({ distance: 30 });
        const freefly = cameraModule.getFreeflyParams();
        const concert = cameraModule.getConcertParams();
        expect(freefly.speed).toBe(0.5);
        expect(concert.radius).toBe(12);
    });

    it('multiple sequential calls accumulate', () => {
        cameraModule.setOrbitParams({ distance: 10 });
        cameraModule.setOrbitParams({ beta: 0.5 });
        cameraModule.setOrbitParams({ targetHeight: 3 });
        const params = cameraModule.getOrbitParams();
        expect(params.distance).toBe(10);
        expect(params.beta).toBe(0.5);
        expect(params.targetHeight).toBe(3);
    });
});

describe('setFreeflyParams', () => {
    it('updates the preset with partial params', () => {
        cameraModule.setFreeflyParams({ speed: 2 });
        expect(cameraModule.getFreeflyParams().speed).toBe(2);
        expect(cameraModule.getFreeflyParams().angularSensibility).toBe(2000);
    });

    it('updates angularSensibility independently', () => {
        cameraModule.setFreeflyParams({ angularSensibility: 5000 });
        expect(cameraModule.getFreeflyParams().angularSensibility).toBe(5000);
        expect(cameraModule.getFreeflyParams().speed).toBe(0.5);
    });

    it('does not throw when in orbit mode (no live universal camera)', () => {
        expect(() => cameraModule.setFreeflyParams({ speed: 5 })).not.toThrow();
    });

    it('updates both fields simultaneously', () => {
        cameraModule.setFreeflyParams({ speed: 3, angularSensibility: 800 });
        const p = cameraModule.getFreeflyParams();
        expect(p.speed).toBe(3);
        expect(p.angularSensibility).toBe(800);
    });
});

describe('setConcertParams', () => {
    it('updates all concert fields', () => {
        cameraModule.setConcertParams({ radius: 20, height: 10, sweepAngle: 80, baseBeta: 0.9 });
        const p = cameraModule.getConcertParams();
        expect(p.radius).toBe(20);
        expect(p.height).toBe(10);
        expect(p.sweepAngle).toBe(80);
        expect(p.baseBeta).toBeCloseTo(0.9, 6);
    });

    it('partial update preserves unset fields', () => {
        cameraModule.setConcertParams({ radius: 18 });
        const p = cameraModule.getConcertParams();
        expect(p.radius).toBe(18);
        expect(p.height).toBe(8);
        expect(p.sweepAngle).toBe(120);
    });

    it('does not throw when called in any state', () => {
        expect(() => cameraModule.setConcertParams({ radius: 99 })).not.toThrow();
    });
});

describe('setSurroundParams', () => {
    it('updates all surround fields', () => {
        cameraModule.setSurroundParams({ radius: 20, height: 10, speed: 0.8 });
        const p = cameraModule.getSurroundParams();
        expect(p.radius).toBe(20);
        expect(p.height).toBe(10);
        expect(p.speed).toBe(0.8);
    });

    it('partial update preserves unset fields', () => {
        cameraModule.setSurroundParams({ radius: 18 });
        const p = cameraModule.getSurroundParams();
        expect(p.radius).toBe(18);
        expect(p.height).toBe(8);
        expect(p.speed).toBe(0.3);
    });
});

describe('getCameraMode / getCurrentCamera', () => {
    it('getCameraMode returns orbit by default', () => {
        expect(cameraModule.getCameraMode()).toBe('orbit');
    });

    it('getCurrentCamera returns null when uninitialized', () => {
        expect(cameraModule.getCurrentCamera()).toBeNull();
    });
});

describe('getFov / setFov', () => {
    it('getFov returns the default FOV (0.8)', () => {
        expect(cameraModule.getFov()).toBe(0.8);
    });

    it('setFov updates the stored FOV value', () => {
        cameraModule.setFov(1.5);
        expect(cameraModule.getFov()).toBe(1.5);
    });

    it('setFov clamps values below 0.1 to 0.1', () => {
        cameraModule.setFov(0.05);
        expect(cameraModule.getFov()).toBe(0.1);
    });

    it('setFov clamps values above 3 to 3', () => {
        cameraModule.setFov(5);
        expect(cameraModule.getFov()).toBe(3);
    });

    it('setFov clamps negative values to 0.1', () => {
        cameraModule.setFov(-1);
        expect(cameraModule.getFov()).toBe(0.1);
    });

    it('setFov with value exactly at lower boundary (0.1)', () => {
        cameraModule.setFov(0.1);
        expect(cameraModule.getFov()).toBe(0.1);
    });

    it('setFov with value exactly at upper boundary (3)', () => {
        cameraModule.setFov(3);
        expect(cameraModule.getFov()).toBe(3);
    });

    it('setFov roundtrips correctly', () => {
        cameraModule.setFov(2.5);
        expect(cameraModule.getFov()).toBe(2.5);
        cameraModule.setFov(0.8);
        expect(cameraModule.getFov()).toBe(0.8);
    });

    it('does not throw when no camera is active', () => {
        expect(() => cameraModule.setFov(1.2)).not.toThrow();
    });
});

describe('hasCameraVmd / clearCameraVmd / getCameraVmdName / getCameraVmdPath', () => {
    it('hasCameraVmd returns false when no VMD is loaded', () => {
        expect(cameraModule.hasCameraVmd()).toBe(false);
    });

    it('clearCameraVmd does not throw when no VMD is active', () => {
        expect(() => cameraModule.clearCameraVmd()).not.toThrow();
    });

    it('getCameraVmdName returns empty string by default', () => {
        expect(cameraModule.getCameraVmdName()).toBe('');
    });

    it('getCameraVmdPath returns empty string by default', () => {
        expect(cameraModule.getCameraVmdPath()).toBe('');
    });

    it('hasCameraVmd stays false after clearCameraVmd when already empty', () => {
        cameraModule.clearCameraVmd();
        expect(cameraModule.hasCameraVmd()).toBe(false);
    });
});

describe('getConcertPaused / setConcertPaused', () => {
    it('getConcertPaused returns false initially', () => {
        expect(cameraModule.getConcertPaused()).toBe(false);
    });

    it('setConcertPaused(true) updates the toggle to true', () => {
        cameraModule.setConcertPaused(true);
        expect(cameraModule.getConcertPaused()).toBe(true);
    });

    it('setConcertPaused can toggle back to false', () => {
        cameraModule.setConcertPaused(true);
        expect(cameraModule.getConcertPaused()).toBe(true);
        cameraModule.setConcertPaused(false);
        expect(cameraModule.getConcertPaused()).toBe(false);
    });

    it('setConcertPaused with false after false stays false', () => {
        cameraModule.setConcertPaused(false);
        expect(cameraModule.getConcertPaused()).toBe(false);
    });
});

describe('CameraMode type discrimination', () => {
    it('getCameraMode returns a valid CameraMode string', () => {
        const validModes = ['orbit', 'freefly', 'surround', 'concert', 'oneshot', 'vmd'];
        const mode = cameraModule.getCameraMode();
        expect(validModes).toContain(mode);
    });
});
