import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Color3 } from '@babylonjs/core/Maths/math.color';

// hoisted mock scene
const mockScene = vi.hoisted(() => ({
    engine: {} as any,
    isDisposed: false,
    activeCamera: null,
    onBeforeRenderObservable: { add: vi.fn(() => ({ remove: vi.fn() })), remove: vi.fn() },
    onAfterRenderObservable: { add: vi.fn(() => ({ remove: vi.fn() })), remove: vi.fn() },
    renderTargets: [],
    cameras: [],
    lights: [],
}));

vi.mock('@babylonjs/core/scene', () => ({ Scene: vi.fn(() => mockScene) }));
vi.mock('@babylonjs/core/Engines/engine', () => ({ Engine: vi.fn() }));

// Build a mock PBRMaterial that properly returns `this` so subclass constructors work
const MockPBR = vi.hoisted(() => {
    class Base {
        constructor(_name: string) {
            // PBRMaterial auto-registers PBRSubSurfaceConfiguration in its constructor.
            // Simulate by attaching a stub to this.plugins
            (this as any).plugins = [];
            (this as any).getScene = vi.fn(() => mockScene);
            (this as any).markDirty = vi.fn();
            (this as any).dispose = vi.fn();
            (this as any).clone = vi.fn().mockImplementation(function () {
                const c = new Base('cloned');
                return c;
            });
        }
        // PBRMaterial properties
        albedoColor = new Color3(1, 1, 1);
        roughness = 0.5;
        metallic = 0.0;
        getScene = vi.fn(() => mockScene);
        markDirty = vi.fn();
        dispose = vi.fn();
        clone = vi.fn();
    }
    return Base;
});

vi.mock('@babylonjs/core/Materials/PBR/pbrMaterial', () => ({
    PBRMaterial: MockPBR,
}));

vi.mock('@babylonjs/core/Materials/PBR/pbrSubSurfaceConfiguration', () => ({
    PBRSubSurfaceConfiguration: vi.fn().mockImplementation(function () {
        return {
            isTranslucencyEnabled: false,
            isScatteringEnabled: false,
            translucencyIntensity: 0.0,
            tintColor: new Color3(1, 1, 1),
            tintColorAtDistance: 0.5,
            diffusionDistance: new Color3(1, 1, 1),
            scatteringDiffusionProfile: null,
            minimumThickness: 0.0,
            maximumThickness: 1.0,
            useThicknessAsDepth: false,
        };
    }),
}));

// Force re-import after mocks
import { SssPBRMaterial } from '@/scene/manager/sss-pbr-material';

describe('SssPBRMaterial — property defaults & setters', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('constructor & defaults', () => {
        it('isSssEnabled defaults to false', () => {
            const mat = new SssPBRMaterial('test');
            expect(mat.isSssEnabled).toBe(false);
        });

        it('sssPower defaults to 0', () => {
            const mat = new SssPBRMaterial('test');
            expect(mat.sssPower).toBe(0.0);
        });

        it('sssDistance defaults to 0.5', () => {
            const mat = new SssPBRMaterial('test');
            expect(mat.sssDistance).toBe(0.5);
        });

        it('sssColor defaults to white', () => {
            const mat = new SssPBRMaterial('test');
            expect(mat.sssColor.equals(Color3.White())).toBe(true);
        });
    });

    describe('sssPower setter', () => {
        it('clamps to [0, 2]', () => {
            const mat = new SssPBRMaterial('test');
            mat.sssPower = -1.0;
            expect(mat.sssPower).toBe(0.0);
            mat.sssPower = 3.0;
            expect(mat.sssPower).toBe(2.0);
            mat.sssPower = 0.8;
            expect(mat.sssPower).toBe(0.8);
        });
    });

    describe('sssDistance setter', () => {
        it('clamps to [0, 1]', () => {
            const mat = new SssPBRMaterial('test');
            mat.sssDistance = -0.5;
            expect(mat.sssDistance).toBe(0.0);
            mat.sssDistance = 1.5;
            expect(mat.sssDistance).toBe(1.0);
        });
    });

    describe('sssEnabled setter', () => {
        it('toggles enabled flag', () => {
            const mat = new SssPBRMaterial('test');
            mat.isSssEnabled = true;
            expect(mat.isSssEnabled).toBe(true);
            mat.isSssEnabled = false;
            expect(mat.isSssEnabled).toBe(false);
        });
    });

    describe('color setters', () => {
        it('assigns sssColor correctly', () => {
            const mat = new SssPBRMaterial('test');
            mat.sssColor = new Color3(1.0, 0.6, 0.4);
            expect(mat.sssColor.r).toBe(1.0);
            expect(mat.sssColor.g).toBe(0.6);
            expect(mat.sssColor.b).toBe(0.4);
        });

        it('assigns sssDiffusion correctly', () => {
            const mat = new SssPBRMaterial('test');
            mat.sssDiffusion = new Color3(0.5, 0.3, 0.1);
            expect(mat.sssDiffusion.r).toBe(0.5);
            expect(mat.sssDiffusion.g).toBe(0.3);
            expect(mat.sssDiffusion.b).toBe(0.1);
        });
    });

    describe('clone', () => {
        it('clones without throwing', () => {
            const mat = new SssPBRMaterial('test');
            mat.isSssEnabled = true;
            mat.sssPower = 0.8;
            expect(() => mat.clone('cloned')).not.toThrow();
        });
    });

    describe('dispose', () => {
        it('is idempotent', () => {
            const mat = new SssPBRMaterial('test');
            expect(() => {
                mat.dispose();
                mat.dispose();
            }).not.toThrow();
        });
    });
});
