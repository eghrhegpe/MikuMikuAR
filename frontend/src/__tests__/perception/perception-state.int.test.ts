// perception-state.int.test.ts — 感知状态 setter/生命周期 + balanceSway/pin/迁移（2026-08-10 合并 state-lifecycle + balance-sway-pin）
import { describe, it, expect, vi, beforeEach } from 'vitest';

// mockState / mockPipeline 必须 vi.hoisted 留在本文件：beforeEach 的 vi.resetModules() 会驱逐
// 外部模块，若放 perception-mocks.ts 会生成「新实例」与测试持有的 mockState 脱节（SUT 调新实例的
// vi.fn，断言看旧实例 → 误报 0 调用）。
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
vi.mock('@/scene/manager/outfit', () => outfitModuleMock);
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

let sut: PerceptionSut;

beforeEach(async () => {
    sut = await setupPerceptionTest(mockState, mockPipeline);
});

describe('默认 PerceptionState', () => {
    it('所有开关默认开启', () => {
        const s = sut.getPerceptionState();
        expect(s.breathEnabled).toBe(true);
        expect(s.blinkEnabled).toBe(true);
        expect(s.headTrackingEnabled).toBe(true);
        expect(s.eyeTrackingEnabled).toBe(true);
        expect(s.balanceSwayEnabled).toBe(true); // [doc:adr-079] Phase 2
    });

    it('getPerceptionState 返回副本（修改不影响内部状态）', () => {
        const s1 = sut.getPerceptionState();
        s1.breathEnabled = false;
        const s2 = sut.getPerceptionState();
        expect(s2.breathEnabled).toBe(true);
    });

    it('默认眨眼频率为 0.25Hz（生理合理，每 4 秒一次）', () => {
        const s = sut.getPerceptionState();
        expect(s.blinkFrequency).toBe(0.25);
    });
});

describe('setBreathEnabled', () => {
    it('更新 breathEnabled', () => {
        sut.setBreathEnabled(false);
        expect(sut.getPerceptionState().breathEnabled).toBe(false);
    });

    it('调用 triggerAutoSave', () => {
        sut.setBreathEnabled(false);
        expect(mockState.triggerAutoSave).toHaveBeenCalledOnce();
    });
});

describe('setBlinkEnabled', () => {
    it('更新 blinkEnabled', () => {
        sut.setBlinkEnabled(false);
        expect(sut.getPerceptionState().blinkEnabled).toBe(false);
    });

    it('调用 triggerAutoSave', () => {
        sut.setBlinkEnabled(false);
        expect(mockState.triggerAutoSave).toHaveBeenCalledOnce();
    });
});

describe('setHeadTrackingEnabled', () => {
    it('更新 headTrackingEnabled', () => {
        sut.setHeadTrackingEnabled(false);
        expect(sut.getPerceptionState().headTrackingEnabled).toBe(false);
    });

    it('调用 triggerAutoSave', () => {
        sut.setHeadTrackingEnabled(false);
        expect(mockState.triggerAutoSave).toHaveBeenCalledOnce();
    });
});

describe('setEyeTrackingEnabled', () => {
    it('更新 eyeTrackingEnabled', () => {
        sut.setEyeTrackingEnabled(false);
        expect(sut.getPerceptionState().eyeTrackingEnabled).toBe(false);
    });

    it('调用 triggerAutoSave', () => {
        sut.setEyeTrackingEnabled(false);
        expect(mockState.triggerAutoSave).toHaveBeenCalledOnce();
    });
});

describe('setPerceptionState', () => {
    it('部分更新（合并而非替换）', () => {
        sut.setPerceptionState({ breathEnabled: false });
        const s = sut.getPerceptionState();
        expect(s.breathEnabled).toBe(false);
        expect(s.blinkEnabled).toBe(true); // 未变更字段保留
    });

    it('全量更新', () => {
        sut.setPerceptionState({
            breathEnabled: false,
            blinkEnabled: false,
            headTrackingEnabled: false,
            eyeTrackingEnabled: false,
        });
        const s = sut.getPerceptionState();
        expect(s.breathEnabled).toBe(false);
        expect(s.blinkEnabled).toBe(false);
        expect(s.headTrackingEnabled).toBe(false);
        expect(s.eyeTrackingEnabled).toBe(false);
    });
});

describe('activatePerception', () => {
    it('无目标模型 ID 时 warn 并返回', () => {
        mockState.focusedModelId = null;
        sut.activatePerception();
        expect(mockState.scene.onBeforeRenderObservable.add).not.toHaveBeenCalled();
    });

    it('模型未加载时 warn 并返回', () => {
        mockState.focusedModelId = 'm1';
        mockState.modelManager.get.mockReturnValue(null);
        sut.activatePerception();
        expect(mockState.scene.onBeforeRenderObservable.add).not.toHaveBeenCalled();
    });

    it('模型已加载时注册 observer', () => {
        mockState.focusedModelId = 'm1';
        mockState.modelManager.get.mockReturnValue({
            mmdModel: { mesh: { isDisposed: () => false } },
        });
        sut.activatePerception();
        // [fix:2026-08] 原断言误复制「未加载」分支的 not.toHaveBeenCalled，
        // 与用例名相反（加载成功应注册 observer）。注册走 mockPipeline.register。
        expect(mockPipeline.register).toHaveBeenCalledOnce();
    });

    it('重复激活同一模型不重复注册', () => {
        mockState.focusedModelId = 'm1';
        mockState.modelManager.get.mockReturnValue({
            mmdModel: { mesh: { isDisposed: () => false } },
        });
        sut.activatePerception();
        sut.activatePerception();
        expect(mockPipeline.register).toHaveBeenCalledOnce();
    });

    it('切换模型时先注销旧 observer 再注册新 observer', () => {
        mockState.focusedModelId = 'm1';
        mockState.modelManager.get.mockReturnValue({
            mmdModel: { mesh: { isDisposed: () => false } },
        });
        sut.activatePerception();
        sut.activatePerception('m2');
        expect(mockPipeline.unregister).toHaveBeenCalled();
        expect(mockPipeline.register).toHaveBeenCalledTimes(2);
    });
});

describe('deactivatePerception', () => {
    it('注销 observer', () => {
        mockState.focusedModelId = 'm1';
        mockState.modelManager.get.mockReturnValue({
            mmdModel: { mesh: { isDisposed: () => false } },
        });
        sut.activatePerception();
        sut.deactivatePerception();
        expect(mockPipeline.unregister).toHaveBeenCalledOnce();
    });

    it('未激活时调用不抛错', () => {
        expect(() => sut.deactivatePerception()).not.toThrow();
    });
});

describe('onPerceptionModelRemoved', () => {
    it('移除当前感知模型时注销 observer', () => {
        mockState.focusedModelId = 'm1';
        mockState.modelManager.get.mockReturnValue({
            mmdModel: { mesh: { isDisposed: () => false } },
        });
        sut.activatePerception();
        sut.onPerceptionModelRemoved('m1');
        expect(mockPipeline.unregister).toHaveBeenCalledOnce();
    });

    it('移除其他模型时不影响当前 observer', () => {
        mockState.focusedModelId = 'm1';
        mockState.modelManager.get.mockReturnValue({
            mmdModel: { mesh: { isDisposed: () => false } },
        });
        sut.activatePerception();
        sut.onPerceptionModelRemoved('other');
        expect(mockPipeline.unregister).not.toHaveBeenCalled();
    });
});

import { migratePerceptionFromProcMotion, migratePerceptionData } from '../../scene/scene-migrate';

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
