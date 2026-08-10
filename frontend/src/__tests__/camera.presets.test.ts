// @vitest-environment node
// @ts-nocheck — mock 类运行时替换（camera 拆分测试用）
// [doc:adr-204] camera.adr100.test.ts 拆分：P3 presets + FOV
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

describe('defaultCameraPreset', () => {
    it('structure', () => {
        const p = cam.defaultCameraPreset();
        ['mode', 'orbit', 'freefly', 'concert', 'surround'].forEach((k) =>
            expect(p).toHaveProperty(k)
        );
        ['targetHeight', 'distance', 'beta'].forEach((k) => expect(p.orbit).toHaveProperty(k));
        ['speed', 'angularSensibility'].forEach((k) => expect(p.freefly).toHaveProperty(k));
    });
    it('defaults', () => {
        const p = cam.defaultCameraPreset();
        expect(p.mode).toBe('orbit');
        expect(p.orbit.targetHeight).toBe(0);
        expect(p.orbit.distance).toBe(16);
    });
    it('fresh copy', () => {
        const a = cam.defaultCameraPreset();
        expect(a).not.toBe(cam.defaultCameraPreset());
    });
});
describe('setOrbitParams', () => {
    it('partial', () => {
        cam.setOrbitParams({ distance: 20 });
        expect(cam.getOrbitParams().distance).toBe(20);
        expect(cam.getOrbitParams().targetHeight).toBe(0);
    });
    it('all at once', () => {
        cam.setOrbitParams({ targetHeight: 10, distance: 22, beta: 1.2 });
        const p = cam.getOrbitParams();
        expect(p.targetHeight).toBe(10);
        expect(p.distance).toBe(22);
        expect(p.beta).toBe(1.2);
    });
    it('no live camera safe', () => {
        expect(() => cam.setOrbitParams({ distance: 5 })).not.toThrow();
    });
    it('preserves others', () => {
        cam.setOrbitParams({ distance: 30 });
        expect(cam.getFreeflyParams().speed).toBe(0.5);
    });
    it('accumulates', () => {
        cam.setOrbitParams({ distance: 10 });
        cam.setOrbitParams({ beta: 0.5 });
        cam.setOrbitParams({ targetHeight: 3 });
        const p = cam.getOrbitParams();
        expect(p.distance).toBe(10);
        expect(p.beta).toBe(0.5);
        expect(p.targetHeight).toBe(3);
    });
});
describe('setFreeflyParams', () => {
    it('partial', () => {
        cam.setFreeflyParams({ speed: 2 });
        expect(cam.getFreeflyParams().speed).toBe(2);
        expect(cam.getFreeflyParams().angularSensibility).toBe(2000);
    });
    it('angular independently', () => {
        cam.setFreeflyParams({ angularSensibility: 5000 });
        expect(cam.getFreeflyParams().angularSensibility).toBe(5000);
        expect(cam.getFreeflyParams().speed).toBe(0.5);
    });
    it('no live universal safe', () => {
        expect(() => cam.setFreeflyParams({ speed: 5 })).not.toThrow();
    });
    it('both', () => {
        cam.setFreeflyParams({ speed: 3, angularSensibility: 800 });
        const p = cam.getFreeflyParams();
        expect(p.speed).toBe(3);
        expect(p.angularSensibility).toBe(800);
    });
});
describe('setConcertParams', () => {
    it('all fields', () => {
        cam.setConcertParams({ radius: 20, height: 10, sweepAngle: 80, baseBeta: 0.9 });
        const p = cam.getConcertParams();
        expect(p.radius).toBe(20);
        expect(p.height).toBe(10);
        expect(p.sweepAngle).toBe(80);
        expect(p.baseBeta).toBeCloseTo(0.9, 6);
    });
    it('partial preserve', () => {
        cam.setConcertParams({ radius: 18 });
        const p = cam.getConcertParams();
        expect(p.radius).toBe(18);
        expect(p.height).toBe(8);
        expect(p.sweepAngle).toBe(120);
    });
    it('no throw', () => {
        expect(() => cam.setConcertParams({ radius: 99 })).not.toThrow();
    });
});
describe('setSurroundParams', () => {
    it('all fields', () => {
        cam.setSurroundParams({ radius: 20, height: 10, speed: 0.8 });
        const p = cam.getSurroundParams();
        expect(p.radius).toBe(20);
        expect(p.height).toBe(10);
        expect(p.speed).toBe(0.8);
    });
    it('partial preserve', () => {
        cam.setSurroundParams({ radius: 18 });
        const p = cam.getSurroundParams();
        expect(p.radius).toBe(18);
        expect(p.height).toBe(8);
        expect(p.speed).toBe(0.3);
    });
});
describe('gCM/gCC', () => {
    it('default orbit', () => {
        expect(cam.getCameraMode()).toBe('orbit');
    });
    it('null camera', () => {
        expect(cam.getCurrentCamera()).toBeNull();
    });
});
describe('FOV', () => {
    it('default 0.8', () => {
        expect(cam.getFov()).toBe(0.8);
    });
    it('set 1.5', () => {
        cam.setFov(1.5);
        expect(cam.getFov()).toBe(1.5);
    });
    it('clamp min', () => {
        cam.setFov(0.05);
        expect(cam.getFov()).toBe(0.1);
    });
    it('clamp max', () => {
        cam.setFov(5);
        expect(cam.getFov()).toBe(3);
    });
    it('clamp negative', () => {
        cam.setFov(-1);
        expect(cam.getFov()).toBe(0.1);
    });
    it('boundary low', () => {
        cam.setFov(0.1);
        expect(cam.getFov()).toBe(0.1);
    });
    it('boundary high', () => {
        cam.setFov(3);
        expect(cam.getFov()).toBe(3);
    });
    it('roundtrip', () => {
        cam.setFov(2.5);
        expect(cam.getFov()).toBe(2.5);
        cam.setFov(0.8);
        expect(cam.getFov()).toBe(0.8);
    });
    it('no cam safe', () => {
        expect(() => cam.setFov(1.2)).not.toThrow();
    });
});
