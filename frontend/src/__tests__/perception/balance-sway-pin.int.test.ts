// perception/balance-sway-pin.int.test.ts — 重心微动 + pin/unpin + setPerceptionStateFor + 旧档迁移（ADR-204 P3，拆自旧 perception.test.ts）
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockState = vi.hoisted(() => ({
    focusedModelId: null as string | null,
    triggerAutoSave: vi.fn(),
    modelManager: {
        get: vi.fn(),
        modelRegistry: new Map<string, any>(),
    },
    scene: {
        onBeforeRenderObservable: {
            add: vi.fn(() => ({})),
            remove: vi.fn(),
        },
        activeCamera: null,
        isDisposed: false,
    },
    isAudioPlaying: vi.fn(() => false),
    getAudioPath: vi.fn(() => ''),
    getProcBeatDetector: vi.fn(() => null),
    findLipMorph: vi.fn(() => null),
    findAllLipMorphs: vi.fn(() => ({ open: null, close: null, pucker: null, smile: null })),
    amplitudeToWeight: vi.fn(() => 0),
}));
const mockPipeline = vi.hoisted(() => ({
    register: vi.fn(),
    unregister: vi.fn(),
    lastRunCallback: null as null | ((ctx?: any) => void),
}));

vi.mock('../../scene/scene', () => sceneModuleFactory(mockState));
vi.mock('../../ar/ar-camera', () => arCameraModuleMock);
vi.mock('../../core/wails-bindings', () => wailsBindingsModuleMock);
vi.mock('../../core/i18n/t', () => i18nTModuleMock);
vi.mock('@babylonjs/core/Materials/standardMaterial', () => standardMaterialModuleMock);
vi.mock('../../core/config', () => configModuleFactory(mockState));
vi.mock('../../scene/camera/camera', () => cameraModuleMock);
vi.mock('../../scene/motion/vmd-loader', () => vmdLoaderModuleMock);
vi.mock('@/core/audio', () => outfitAudioModuleFactory(mockState));
vi.mock('../../outfit/outfit', () => outfitModuleMock);
vi.mock('../../scene/env/props', () => envPropsModuleMock);
vi.mock('../../scene/env/_bridge/env-bridge', () => envBridgeModuleMock);
vi.mock('../../scene/env/env-impl', () => envImplModuleFactory(mockState));
vi.mock('../../scene/motion/motion-pipeline', () => motionPipelineModuleFactory(mockPipeline));
vi.mock('../../scene/motion/proc-motion-bridge', () => procMotionBridgeModuleFactory(mockState));
vi.mock('../../scene/motion/lipsync-bridge', () => lipsyncBridgeModuleMock);
vi.mock('../../motion-algos/procedural-motion', () => proceduralMotionModuleMock);
vi.mock('../../motion-algos/lipsync', () => lipsyncAlgosModuleFactory(mockState));

import {
    setupPerceptionTest,
    sceneModuleFactory,
    arCameraModuleMock,
    wailsBindingsModuleMock,
    i18nTModuleMock,
    standardMaterialModuleMock,
    configModuleFactory,
    cameraModuleMock,
    vmdLoaderModuleMock,
    outfitAudioModuleFactory,
    outfitModuleMock,
    envPropsModuleMock,
    envBridgeModuleMock,
    envImplModuleFactory,
    motionPipelineModuleFactory,
    procMotionBridgeModuleFactory,
    lipsyncBridgeModuleMock,
    proceduralMotionModuleMock,
    lipsyncAlgosModuleFactory,
    type PerceptionSut,
} from './perception-mocks';
// 迁移函数为纯函数，静态导入
import { migratePerceptionFromProcMotion, migratePerceptionData } from '../../scene/scene-migrate';

let sut: PerceptionSut;

beforeEach(async () => {
    sut = await setupPerceptionTest(mockState, mockPipeline);
});

describe('setBalanceSwayEnabled', () => {
    it('更新 balanceSwayEnabled', () => {
        sut.setBalanceSwayEnabled(false);
        expect(sut.getPerceptionState().balanceSwayEnabled).toBe(false);
    });

    it('调用 triggerAutoSave', () => {
        sut.setBalanceSwayEnabled(false);
        expect(mockState.triggerAutoSave).toHaveBeenCalledOnce();
    });
});

describe('migratePerceptionFromProcMotion — balanceSway 迁移', () => {
    it('旧存档无 boneToggles 时 balanceSwayEnabled=true（默认 always-on）', () => {
        const migrated = migratePerceptionFromProcMotion({} as any);
        expect(migrated.balanceSwayEnabled).toBe(true);
    });

    it('旧存档 boneToggles.center=true 时 balanceSwayEnabled=true', () => {
        const migrated = migratePerceptionFromProcMotion({
            boneToggles: { center: true, upper2: false, waist: false, allParent: false },
        } as any);
        expect(migrated.balanceSwayEnabled).toBe(true);
    });

    it('旧存档 boneToggles 全 false 时 balanceSwayEnabled=false（用户明确关闭）', () => {
        const migrated = migratePerceptionFromProcMotion({
            boneToggles: { center: false, upper2: false, waist: false, allParent: false },
        } as any);
        expect(migrated.balanceSwayEnabled).toBe(false);
    });
});

describe('balanceSway 可调参数', () => {
    it('默认 period=2.0, amplitude=1.0', () => {
        const s = sut.getPerceptionState();
        expect(s.balanceSwayPeriod).toBe(2.0);
        expect(s.balanceSwayAmplitude).toBe(1.0);
    });

    it('setBalanceSwayPeriod 钳制 0.5–5.0', () => {
        sut.setBalanceSwayPeriod(0.1);
        expect(sut.getPerceptionState().balanceSwayPeriod).toBe(0.5);
        sut.setBalanceSwayPeriod(10);
        expect(sut.getPerceptionState().balanceSwayPeriod).toBe(5.0);
        sut.setBalanceSwayPeriod(3.0);
        expect(sut.getPerceptionState().balanceSwayPeriod).toBe(3.0);
    });

    it('setBalanceSwayAmplitude 钳制 0–2.0', () => {
        sut.setBalanceSwayAmplitude(-1);
        expect(sut.getPerceptionState().balanceSwayAmplitude).toBe(0);
        sut.setBalanceSwayAmplitude(5);
        expect(sut.getPerceptionState().balanceSwayAmplitude).toBe(2.0);
        sut.setBalanceSwayAmplitude(1.5);
        expect(sut.getPerceptionState().balanceSwayAmplitude).toBe(1.5);
    });

    it('调用 triggerAutoSave', () => {
        sut.setBalanceSwayPeriod(3.0);
        expect(mockState.triggerAutoSave).toHaveBeenCalled();
        sut.setBalanceSwayAmplitude(0.5);
        expect(mockState.triggerAutoSave).toHaveBeenCalled();
    });
});

describe('pinPerception', () => {
    it('pin 模型后焦点切换时 pinned 仍激活', () => {
        mockState.focusedModelId = 'm1';
        mockState.modelManager.get.mockReturnValue({
            mmdModel: { mesh: { isDisposed: () => false } },
        });
        sut.activatePerception('m1');
        sut.pinPerception('m1');

        // 切换焦点到 m2
        mockState.focusedModelId = 'm2';
        mockState.modelManager.get.mockImplementation((id: string) =>
            id === 'm2' ? { mmdModel: { mesh: { isDisposed: () => false } } } : null
        );
        sut.activatePerception('m2');

        expect(sut.getPinnedModelIds()).toContain('m1');
        // m1 pinned 后切换焦点到 m2，observer 保留运行（不注销再注册）
        expect(mockPipeline.register).toHaveBeenCalledTimes(1);
        // m2 成为新焦点
        expect(sut.getPerceptionStateFor('m2').breathEnabled).toBe(true);
    });

    it('[doc:adr-164] pin 上限已移除，可 pin 超过 5 个模型', () => {
        for (let i = 1; i <= 6; i++) {
            sut.pinPerception(`m${i}`);
        }
        expect(sut.getPinnedModelIds().length).toBe(6);
    });

    it('unpin 非焦点模型后该模型从 pinned 列表移除', () => {
        sut.pinPerception('m1');
        expect(sut.getPinnedModelIds()).toContain('m1');
        sut.unpinPerception('m1');
        expect(sut.getPinnedModelIds()).not.toContain('m1');
    });
});

describe('setPerceptionStateFor', () => {
    it('写入场景级单例（所有模型共享参数）', () => {
        sut.setPerceptionStateFor('m1', { breathEnabled: false });
        expect(sut.getPerceptionStateFor('m1').breathEnabled).toBe(false);
        // [fix:P3] 场景级存储：参数对所有模型一致
        expect(sut.getPerceptionState().breathEnabled).toBe(false);
    });
});

describe('migratePerceptionData', () => {
    it('旧格式 PerceptionState → { focused: oldState, pinned: [] }', () => {
        const old = { breathEnabled: false, blinkEnabled: true };
        const migrated = migratePerceptionData(old);
        expect(migrated).not.toBeNull();
        expect(migrated!.focused.breathEnabled).toBe(false);
        expect(migrated!.pinned).toEqual([]);
    });

    it('旧格式迁移结果不含 tier/allEnabled', () => {
        const old = { breathEnabled: true };
        const migrated = migratePerceptionData(old);
        expect(migrated).not.toBeNull();
        expect(migrated!.tier).toBeUndefined();
        expect(migrated!.allEnabled).toBeUndefined();
    });

    it('新格式直接透传（含 tier/allEnabled）', () => {
        const neu = {
            focused: { breathEnabled: true },
            pinned: [{ modelId: 'm1', state: { breathEnabled: false } }],
            tier: 'medium' as const,
            allEnabled: true,
        };
        const migrated = migratePerceptionData(neu);
        expect(migrated).toEqual(neu);
    });

    it('null/undefined 输入返回 null', () => {
        expect(migratePerceptionData(null)).toBeNull();
        expect(migratePerceptionData(undefined)).toBeNull();
    });
});
