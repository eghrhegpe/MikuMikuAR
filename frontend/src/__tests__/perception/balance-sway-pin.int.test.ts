// perception/balance-sway-pin.int.test.ts — 重心微动 + pin/unpin + setPerceptionStateFor + 旧档迁移（ADR-204 P3，拆自旧 perception.test.ts）
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../scene/scene', async () => (await import('./perception-mocks')).sceneModuleMock);
vi.mock('../../ar/ar-camera', async () => (await import('./perception-mocks')).arCameraModuleMock);
vi.mock('../../core/wails-bindings', async () => (await import('./perception-mocks')).wailsBindingsModuleMock);
vi.mock('../../core/i18n/t', async () => (await import('./perception-mocks')).i18nTModuleMock);
vi.mock('@babylonjs/core/Materials/standardMaterial', async () => (await import('./perception-mocks')).standardMaterialModuleMock);
vi.mock('../../core/config', async () => (await import('./perception-mocks')).configModuleMock);
vi.mock('../../scene/camera/camera', async () => (await import('./perception-mocks')).cameraModuleMock);
vi.mock('../../scene/motion/vmd-loader', async () => (await import('./perception-mocks')).vmdLoaderModuleMock);
vi.mock('../../outfit/audio', async () => (await import('./perception-mocks')).outfitAudioModuleMock);
vi.mock('../../outfit/outfit', async () => (await import('./perception-mocks')).outfitModuleMock);
vi.mock('../../scene/env/props', async () => (await import('./perception-mocks')).envPropsModuleMock);
vi.mock('../../scene/env/env-bridge', async () => (await import('./perception-mocks')).envBridgeModuleMock);
vi.mock('../../scene/env/env-impl', async () => (await import('./perception-mocks')).envImplModuleMock);
vi.mock('../../scene/motion/motion-pipeline', async () => (await import('./perception-mocks')).motionPipelineModuleMock);
vi.mock('../../scene/motion/proc-motion-bridge', async () => (await import('./perception-mocks')).procMotionBridgeModuleMock);
vi.mock('../../scene/motion/lipsync-bridge', async () => (await import('./perception-mocks')).lipsyncBridgeModuleMock);
vi.mock('../../motion-algos/procedural-motion', async () => (await import('./perception-mocks')).proceduralMotionModuleMock);
vi.mock('../../motion-algos/lipsync', async () => (await import('./perception-mocks')).lipsyncAlgosModuleMock);

import { setupPerceptionTest, mockState, mockPipeline, type PerceptionSut } from './perception-mocks';
// 迁移函数为纯函数，静态导入
import {
    migratePerceptionFromProcMotion,
    migratePerceptionData,
} from '../../scene/scene-migrate';

let sut: PerceptionSut;

beforeEach(async () => {
    sut = await setupPerceptionTest();
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
    it('可为指定模型独立设置感知状态', () => {
        sut.setPerceptionStateFor('m1', { breathEnabled: false });
        expect(sut.getPerceptionStateFor('m1').breathEnabled).toBe(false);
        // 未激活时 fallback 状态不受影响
        expect(sut.getPerceptionState().breathEnabled).toBe(true);
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
