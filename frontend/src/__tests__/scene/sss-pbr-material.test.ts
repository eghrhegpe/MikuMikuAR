// @vitest-environment node
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
    // Babylon 9.x PBRBaseMaterial 构造器创建 PBRSubSurfaceConfiguration 并赋给公开 subSurface 属性
    const makeSubSurface = () => ({
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
    });
    class Base {
        constructor(_name: string) {
            // PBRMaterial 构造器自动创建 subSurface（9.x 公开只读属性）
            (this as any).subSurface = makeSubSurface();
            (this as any).getScene = vi.fn(() => mockScene);
            (this as any).markDirty = vi.fn();
            (this as any).dispose = vi.fn();
        }
        // PBRMaterial properties
        albedoColor = new Color3(1, 1, 1);
        roughness = 0.5;
        metallic = 0.0;
        getScene = vi.fn(() => mockScene);
        markDirty = vi.fn();
        dispose = vi.fn();
        // [fix P2] clone 必须是原型方法（模拟 Babylon 基类 clone 在原型上的行为），
        // 不能用实例字段——实例属性会遮蔽 SssPBRMaterial.prototype.clone，
        // 使真实 clone 实现永不执行（旧 mock 因此假绿）。
        clone(name: string): Base {
            const c = new Base(name);
            c.albedoColor = this.albedoColor.clone();
            c.roughness = this.roughness;
            c.metallic = this.metallic;
            return c;
        }
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

    describe('SSS 参数传播到底层 PBRSubSurfaceConfiguration（[fix P1/P2] 插件接线）', () => {
        it('isSssEnabled=true + sssPower 写入 isTranslucencyEnabled / translucencyIntensity', () => {
            const mat = new SssPBRMaterial('test') as any;
            const ss = mat.subSurface;
            mat.isSssEnabled = true;
            mat.sssPower = 0.8;
            expect(ss.isTranslucencyEnabled).toBe(true);
            expect(ss.isScatteringEnabled).toBe(true);
            expect(ss.translucencyIntensity).toBe(0.8);
        });

        it('sssColor / sssDistance / sssDiffusion 传播到 config', () => {
            const mat = new SssPBRMaterial('test') as any;
            const ss = mat.subSurface;
            mat.isSssEnabled = true; // tintColorAtDistance 仅在启用时写入（_syncSubSurface 契约）
            mat.sssColor = new Color3(1.0, 0.6, 0.4);
            mat.sssDistance = 0.3;
            mat.sssDiffusion = new Color3(0.5, 0.3, 0.1);
            expect(ss.tintColor.r).toBe(1.0);
            expect(ss.tintColorAtDistance).toBe(0.3);
            expect(ss.diffusionDistance.r).toBe(0.5);
        });

        it('无 subSurface 时 setter 静默跳过不抛错（失败路径）', () => {
            const mat = new SssPBRMaterial('test') as any;
            (mat as any)._subSurface = null;
            expect(() => {
                mat.isSssEnabled = true;
                mat.sssPower = 0.8;
            }).not.toThrow();
            expect(mat.sssPower).toBe(0.8); // 包装层状态仍更新
        });

        it('NaN 不被存储（[fix P4]）', () => {
            const mat = new SssPBRMaterial('test');
            mat.sssPower = NaN;
            expect(mat.sssPower).toBe(0.0); // 默认 0，NaN 被拒
            mat.sssPower = 0.8;
            mat.sssPower = NaN;
            expect(mat.sssPower).toBe(0.8); // 已有值不被 NaN 覆盖
        });
    });

    describe('clone', () => {
        it('克隆结果是 SssPBRMaterial 且 SSS 状态完整复制并同步到底层 subSurface', () => {
            const mat = new SssPBRMaterial('test');
            mat.isSssEnabled = true;
            mat.sssPower = 0.8;
            mat.sssColor = new Color3(1.0, 0.6, 0.4);
            const c = mat.clone('cloned');
            expect(c).toBeInstanceOf(SssPBRMaterial);
            expect(c.isSssEnabled).toBe(true);
            expect(c.sssPower).toBe(0.8);
            expect(c.sssColor.r).toBe(1.0);
            // 底层 subSurface 为新实例且已同步（P1 修复后原型恢复，_syncSubSurface 真实执行）
            const ss = (c as any).subSurface;
            expect(ss).toBeDefined();
            expect(ss.isTranslucencyEnabled).toBe(true);
            expect(ss.translucencyIntensity).toBe(0.8);
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
