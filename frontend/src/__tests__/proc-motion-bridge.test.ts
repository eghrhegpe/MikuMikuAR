// proc-motion-bridge 系列合并（lifecycle/state/toggles/tracking 4 文件 → 1）
// [2026-08] 同系列合并以省 isolate 单文件 import 成本（vitest.config 同款先例）。
// 4 文件结构完全同构：全 node 环境 + 相同 9 条 vi.mock（config/audio/scene/vmd-layers/
// perception/motion-intent/beat-detector/proc-motion-idle/proc-motion-autodance）+
// 共享 proc-motion-bridge-mocks 工厂 + beforeEach(resetModules + 动态 import sut)，
// 共享样板原在 4 文件重复 4 份，现收敛为一份。各 describe 按原主题分区保留，行为不变。
// 注：proc-motion-idle mock 采用 lifecycle 的转发版（...args → mockState.generateIdleVmd），
// 使 P2#1 回归能断言生成器被调用（其他文件原用 ArrayBuffer(0) 直返桩，行为等价）。
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    DEFAULT_PROC_STATE,
    PROC_MOTION_BONE_CATEGORIES,
} from '../motion-algos/procedural-motion';
import {
    createProcMockState,
    resetProcMockState,
    mockConfig,
    mockAudio,
    mockScene,
    mockVmdLayers,
    mockPerception,
    mockMotionIntent,
    mockBeatDetector,
} from './proc-motion-bridge-mocks';

const mockState = createProcMockState();

vi.mock('../core/config', () => mockConfig(mockState));
vi.mock('@/core/audio', () => mockAudio(mockState));
vi.mock('../scene/scene', () => mockScene(mockState));
vi.mock('../scene/motion/vmd-layers', () => mockVmdLayers());
vi.mock('../scene/motion/perception', () => mockPerception(mockState));
vi.mock('../scene/motion/motion-intent', () => mockMotionIntent(mockState));
vi.mock('../motion-algos/beat-detector', () => mockBeatDetector(mockState));
vi.mock('../motion-algos/proc-motion-idle', () => ({
    generateIdleVmd: (...args: unknown[]) => (mockState.generateIdleVmd as any)(...args),
}));
vi.mock('../motion-algos/proc-motion-autodance', () => ({
    generateAutoDanceVmd: (...args: unknown[]) => (mockState.generateAutoDanceVmd as any)(...args),
}));

type Sut = typeof import('../scene/motion/proc-motion-bridge');
let sut: Sut;

beforeEach(async () => {
    vi.resetModules();
    sut = await import('../scene/motion/proc-motion-bridge');
    resetProcMockState(mockState);
}, 30000); // 全量并行时 transform 与并行套件争抢资源，放宽 hook 超时

// ======== regenerate 守卫 / triggerAutoSave / update 程序化保持（原 lifecycle） ========
describe('regenerateProcMotion — guard returns early', () => {
    it('returns early when mode is off and not active', () => {
        // Default state: mode='off', _procVmdActive=false
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        sut.regenerateProcMotion();
        expect(warnSpy).not.toHaveBeenCalled();
        expect(mockState.loadVMDMotion).not.toHaveBeenCalled();
        warnSpy.mockRestore();
    });

    it('returns early with warning when no focused MMD model', () => {
        // Change mode so the first guard passes
        sut.setProcMotionMode('idle');
        // focusedMmdModel is already mocked to return null

        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        sut.regenerateProcMotion();
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('无目标'));
        expect(mockState.loadVMDMotion).not.toHaveBeenCalled();
        warnSpy.mockRestore();
    });
});

describe('triggerAutoSave interaction', () => {
    it('setProcMotionMode triggers auto-save', () => {
        sut.setProcMotionMode('idle');
        expect(mockState.triggerAutoSave).toHaveBeenCalled();
    });

    it('setProcMotionIntensity triggers auto-save', () => {
        sut.setProcMotionIntensity('idle', 0.5);
        expect(mockState.triggerAutoSave).toHaveBeenCalled();
    });

    it('setProcMotionSpeed triggers auto-save', () => {
        sut.setProcMotionSpeed('idle', 1.0);
        expect(mockState.triggerAutoSave).toHaveBeenCalled();
    });

    it('setProcMotionState does NOT trigger auto-save', () => {
        sut.setProcMotionState({ ...DEFAULT_PROC_STATE });
        expect(mockState.triggerAutoSave).not.toHaveBeenCalled();
    });

    it('stopProcMotion does NOT trigger auto-save', () => {
        sut.stopProcMotion();
        expect(mockState.triggerAutoSave).not.toHaveBeenCalled();
    });
});

// 背景：per-slot 重构后，程序化动作基础槽位（动作1）写入 inst.vmdData
// （替代旧直写 setRuntimeAnimation）。若用 vmdData 非空判定"用户/场景 VMD 存在"，
// 每帧 onBeforeRender 调用的 updateProcMotion 会把程序化数据误判为用户 VMD 并
// 调用 stopProcMotion() 清空，导致动作1 程序化瞬间失效。判别依据应改为 vmdPath。
describe('updateProcMotion — 程序化动作保持生效', () => {
    it('不误停焦点模型上 vmdData 非空但 vmdPath 为 null 的程序化动作', async () => {
        const mmdModel = { morph: { morphs: [] }, runtimeBones: [] };
        const inst: any = { vmdData: new ArrayBuffer(8), vmdPath: null, mmdModel, vmdLayers: [] };
        mockState.focusedModelId = 'm1';
        mockState.focusedMmdModel.mockReturnValue(mmdModel);
        mockState.focusedModel.mockReturnValue(inst);
        mockState.modelManager.get.mockImplementation((id: string) =>
            id === 'm1' ? inst : undefined
        );

        sut.setProcMotionMode('idle');
        // 触发一次程序化生成：使 _procVmdActive=true 且 inst.vmdData 被程序化结果写入
        sut.regenerateProcMotion('m1');
        expect(sut.isProcVmdActive()).toBe(true);

        // 模拟下一帧 onBeforeRender 触发 updateProcMotion
        await sut.updateProcMotion();

        // 程序化动作应持续生效，vmdData 不应被 stopProcMotion 清空
        expect(sut.isProcVmdActive()).toBe(true);
        expect(inst.vmdData).not.toBeNull();
        expect(inst.vmdPath).toBeNull();
    });

    it('焦点模型持有用户/场景 VMD（vmdPath 非空）时仍会优先于程序化动作', async () => {
        const mmdModel = { morph: { morphs: [] }, runtimeBones: [] };
        const inst: any = { vmdData: new ArrayBuffer(8), vmdPath: null, mmdModel, vmdLayers: [] };
        mockState.focusedModelId = 'm1';
        mockState.focusedMmdModel.mockReturnValue(mmdModel);
        mockState.focusedModel.mockReturnValue(inst);
        mockState.modelManager.get.mockImplementation((id: string) =>
            id === 'm1' ? inst : undefined
        );

        sut.setProcMotionMode('idle');
        sut.regenerateProcMotion('m1');
        expect(sut.isProcVmdActive()).toBe(true);

        // 程序化已激活后，用户/场景 VMD 加载完成（vmdPath 被写入，模拟 loadVMDMotion 之前的状态）
        inst.vmdPath = '/motions/user.vmd';

        await sut.updateProcMotion();

        // 用户/场景 VMD 应优先：程序化被停止（vmdData 因 userVmdPresent 不被清空，属预期行为）
        expect(sut.isProcVmdActive()).toBe(false);
    });
});

describe('P2#1 回归 — updateProcMotion 自动重生成使用 per-model 参数', () => {
    it('per-model procMotion 存在时，自动触发的 idle 生成用该模型参数而非全局默认', async () => {
        const mmdModel = { morph: { morphs: [] }, runtimeBones: [] };
        const inst: any = {
            vmdData: null,
            vmdPath: null,
            mmdModel,
            vmdLayers: [],
            procMotion: {
                mode: 'idle',
                bpmQuantizeEnabled: true,
                eyeTrackingEnabled: true,
                headTrackingEnabled: true,
                params: {
                    idle: { ...DEFAULT_PROC_STATE.params.idle, intensity: 0.9 },
                    autodance: { ...DEFAULT_PROC_STATE.params.autodance },
                },
            },
        };
        mockState.focusedModelId = 'm1';
        mockState.focusedMmdModel.mockReturnValue(mmdModel);
        mockState.focusedModel.mockReturnValue(inst);
        mockState.modelManager.get.mockImplementation((id: string) =>
            id === 'm1' ? inst : undefined
        );

        await sut.updateProcMotion();

        expect(sut.isProcVmdActive()).toBe(true);
        expect(mockState.generateIdleVmd).toHaveBeenCalled();
        // 生成器应收到 per-model 参数（intensity 0.9），而非全局 fallback 默认 0.5
        const params = (mockState.generateIdleVmd as any).mock.calls[0][0] as {
            intensity: number;
        };
        expect(params.intensity).toBe(0.9);
    });
});

describe('P2#2 回归 — autodance BPM 无效时不锁死 _starting', () => {
    it('bpm=0 时第一次生成抛错被吞，恢复有效 BPM 后仍能重新生成', async () => {
        const mmdModel = { morph: { morphs: [] }, runtimeBones: [] };
        const inst: any = { vmdData: null, vmdPath: null, mmdModel, vmdLayers: [] };
        mockState.focusedModelId = 'm1';
        mockState.focusedMmdModel.mockReturnValue(mmdModel);
        mockState.focusedModel.mockReturnValue(inst);
        mockState.modelManager.get.mockImplementation((id: string) =>
            id === 'm1' ? inst : undefined
        );
        sut.createProcBeatDetector();
        // beatDetectorInst.getBPM 默认 mockReturnValue(0) = 无效 BPM
        sut.setProcMotionMode('autodance');

        // 第一次：BPM 无效 → 抛错被 catch（修复前会在 try 外 throw 且 _starting 永不复位）
        await expect(sut.updateProcMotion()).resolves.toBeUndefined();
        expect(sut.isProcVmdActive()).toBe(false);

        // BPM 恢复有效后应能重新生成（若 _starting 泄漏则 updateProcMotion 永远空转）
        mockState.beatDetectorInst.getBPM.mockReturnValue(120);
        await sut.updateProcMotion();
        expect(sut.isProcVmdActive()).toBe(true);
    });
});

describe('P2#3 回归 — per-model 状态多模型并发不互相覆盖', () => {
    it('焦点在 idle/autodance 两模型间切换时，autodance 不被 idle 覆盖而重复重生成', async () => {
        const mmdModel = { morph: { morphs: [] }, runtimeBones: [] };
        const mkInst = (mode: 'idle' | 'autodance') => ({
            vmdData: null,
            vmdPath: null,
            mmdModel,
            vmdLayers: [],
            procMotion: {
                mode,
                bpmQuantizeEnabled: true,
                eyeTrackingEnabled: true,
                headTrackingEnabled: true,
                params: {
                    idle: { ...DEFAULT_PROC_STATE.params.idle },
                    autodance: { ...DEFAULT_PROC_STATE.params.autodance },
                },
            },
        });
        const m1 = mkInst('idle');
        const m2 = mkInst('autodance');
        mockState.modelManager.get.mockImplementation((id: string) =>
            id === 'm1' ? m1 : id === 'm2' ? m2 : undefined
        );
        mockState.focusedMmdModel.mockReturnValue(mmdModel);
        mockState.beatDetectorInst.getBPM.mockReturnValue(120);
        sut.createProcBeatDetector();

        // 1) 焦点 m2（autodance）→ 启动 autodance
        mockState.focusedModelId = 'm2';
        mockState.focusedModel.mockReturnValue(m2);
        await sut.updateProcMotion();
        expect(mockState.generateAutoDanceVmd).toHaveBeenCalledTimes(1);

        // 2) 焦点切到 m1（idle）→ 启动 idle（修复前会覆盖全局 _activeKind='idle'）
        mockState.focusedModelId = 'm1';
        mockState.focusedModel.mockReturnValue(m1);
        await sut.updateProcMotion();
        expect(mockState.generateIdleVmd).toHaveBeenCalledTimes(1);

        // 3) 焦点切回 m2：BPM 未变、autodance 已在跑 → 不应重复重生成
        //    修复前：_activeKind 被 m1 覆盖为 'idle' → 误判需重生成 → 第 2 次调用
        mockState.focusedModelId = 'm2';
        mockState.focusedModel.mockReturnValue(m2);
        await sut.updateProcMotion();
        expect(mockState.generateAutoDanceVmd).toHaveBeenCalledTimes(1);
    });
});

// ======== 状态读写 / 模式 / 强度 / 速度 / 拷贝语义（原 state） ========
describe('isProcVmdActive', () => {
    it('returns false initially', () => {
        expect(sut.isProcVmdActive()).toBe(false);
    });
});

describe('setProcMotionMode', () => {
    it('sets mode to idle', () => {
        sut.setProcMotionMode('idle');
        expect(sut.getProcMotionState().mode).toBe('idle');
    });

    it('sets mode to autodance', () => {
        sut.setProcMotionMode('autodance');
        expect(sut.getProcMotionState().mode).toBe('autodance');
    });

    it('sets mode to off and stops proc motion', () => {
        sut.setProcMotionMode('off');
        expect(sut.getProcMotionState().mode).toBe('off');
        expect(sut.isProcVmdActive()).toBe(false);
    });

    it('calls triggerAutoSave', () => {
        sut.setProcMotionMode('idle');
        expect(mockState.triggerAutoSave).toHaveBeenCalledOnce();
    });

    it('does not crash when stopping with no active motion', () => {
        // Default state = off, not active — stopProcMotion is called but is a no-op
        sut.setProcMotionMode('idle');
        sut.setProcMotionMode('off');
        expect(sut.getProcMotionState().mode).toBe('off');
    });
});

describe('setProcMotionIntensity', () => {
    it('stores the given value', () => {
        sut.setProcMotionIntensity('idle', 0.3);
        expect(sut.getProcMotionState().params.idle.intensity).toBe(0.3);
    });

    it('clamps negative values to 0', () => {
        sut.setProcMotionIntensity('idle', -0.1);
        expect(sut.getProcMotionState().params.idle.intensity).toBe(0);
    });

    it('clamps values above 1 to 1', () => {
        sut.setProcMotionIntensity('idle', 1.5);
        expect(sut.getProcMotionState().params.idle.intensity).toBe(1);
    });

    it('accepts boundary values 0 and 1', () => {
        sut.setProcMotionIntensity('idle', 0);
        expect(sut.getProcMotionState().params.idle.intensity).toBe(0);
        sut.setProcMotionIntensity('idle', 1);
        expect(sut.getProcMotionState().params.idle.intensity).toBe(1);
    });

    it('defaults to DEFAULT_PROC_STATE.params.idle.intensity', () => {
        expect(sut.getProcMotionState().params.idle.intensity).toBe(DEFAULT_PROC_STATE.params.idle.intensity);
    });

    it('calls triggerAutoSave', () => {
        sut.setProcMotionIntensity('idle', 0.7);
        expect(mockState.triggerAutoSave).toHaveBeenCalledOnce();
    });
});

describe('setProcMotionSpeed', () => {
    it('stores the given value', () => {
        sut.setProcMotionSpeed('idle', 0.8);
        expect(sut.getProcMotionState().params.idle.speed).toBe(0.8);
    });

    it('clamps below 0.5 to 0.5', () => {
        sut.setProcMotionSpeed('idle', 0.1);
        expect(sut.getProcMotionState().params.idle.speed).toBe(0.5);
    });

    it('clamps above 2 to 2', () => {
        sut.setProcMotionSpeed('idle', 3);
        expect(sut.getProcMotionState().params.idle.speed).toBe(2);
    });

    it('accepts boundary values 0.5 and 2', () => {
        sut.setProcMotionSpeed('idle', 0.5);
        expect(sut.getProcMotionState().params.idle.speed).toBe(0.5);
        sut.setProcMotionSpeed('idle', 2);
        expect(sut.getProcMotionState().params.idle.speed).toBe(2);
    });

    it('defaults to DEFAULT_PROC_STATE.params.idle.speed', () => {
        expect(sut.getProcMotionState().params.idle.speed).toBe(DEFAULT_PROC_STATE.params.idle.speed);
    });

    it('calls triggerAutoSave', () => {
        sut.setProcMotionSpeed('idle', 1.5);
        expect(mockState.triggerAutoSave).toHaveBeenCalledOnce();
    });
});

describe('getProcMotionState', () => {
    it('returns a copy — mutating the result does not affect internal state', () => {
        const state = sut.getProcMotionState();
        state.params.idle.intensity = 0.99;
        expect(sut.getProcMotionState().params.idle.intensity).toBe(
            DEFAULT_PROC_STATE.params.idle.intensity
        );
    });

    it('returns a new object each call', () => {
        const a = sut.getProcMotionState();
        const b = sut.getProcMotionState();
        expect(a).not.toBe(b);
    });

    it('reflects changes made by setters', () => {
        sut.setProcMotionMode('idle');
        sut.setProcMotionIntensity('idle', 0.7);
        sut.setProcMotionSpeed('idle', 1.2);

        const s = sut.getProcMotionState();
        expect(s.mode).toBe('idle');
        expect(s.params.idle.intensity).toBe(0.7);
        expect(s.params.idle.speed).toBe(1.2);
    });

    it('defaults match DEFAULT_PROC_STATE', () => {
        const s = sut.getProcMotionState();
        expect(s.mode).toBe(DEFAULT_PROC_STATE.mode);
        expect(s.params.idle.intensity).toBe(DEFAULT_PROC_STATE.params.idle.intensity);
        expect(s.params.idle.speed).toBe(DEFAULT_PROC_STATE.params.idle.speed);
        expect(s.params.idle.boneToggles).toEqual(DEFAULT_PROC_STATE.params.idle.boneToggles);
        expect(s.params.autodance).toEqual(DEFAULT_PROC_STATE.params.autodance);
        expect(s.bpmQuantizeEnabled).toBe(DEFAULT_PROC_STATE.bpmQuantizeEnabled);
        expect(s.eyeTrackingEnabled).toBe(DEFAULT_PROC_STATE.eyeTrackingEnabled);
        expect(s.headTrackingEnabled).toBe(DEFAULT_PROC_STATE.headTrackingEnabled);
    });
});

describe('setProcMotionState', () => {
    it('replaces the entire state', () => {
        sut.setProcMotionMode('idle');

        const newState = {
            ...DEFAULT_PROC_STATE,
            mode: 'autodance' as const,
            params: {
                idle: { ...DEFAULT_PROC_STATE.params.idle, intensity: 0.9 },
                autodance: { ...DEFAULT_PROC_STATE.params.autodance },
            },
        };
        sut.setProcMotionState(newState);

        const s = sut.getProcMotionState();
        expect(s.mode).toBe('autodance');
        expect(s.params.idle.intensity).toBe(0.9);
        expect(s.params.idle.speed).toBe(DEFAULT_PROC_STATE.params.idle.speed);
    });

    it('does not call triggerAutoSave', () => {
        sut.setProcMotionState({ ...DEFAULT_PROC_STATE });
        expect(mockState.triggerAutoSave).not.toHaveBeenCalled();
    });
});

describe('per-mode 独立参数（audit）', () => {
    it('idle 与 autodance 的强度/速度互不影响', () => {
        sut.setProcMotionIntensity('idle', 0.3);
        sut.setProcMotionIntensity('autodance', 0.9);
        sut.setProcMotionSpeed('idle', 0.6);
        sut.setProcMotionSpeed('autodance', 1.8);
        const s = sut.getProcMotionState();
        expect(s.params.idle.intensity).toBe(0.3);
        expect(s.params.autodance.intensity).toBe(0.9);
        expect(s.params.idle.speed).toBe(0.6);
        expect(s.params.autodance.speed).toBe(1.8);
    });

    it('两模式参数引用独立（改一个不影响另一个）', () => {
        const s = sut.getProcMotionState();
        expect(s.params.idle).not.toBe(s.params.autodance);
    });
});

// ======== 骨骼开关 / VPD / 插值覆盖（原 toggles） ========
describe('setProcMotionBoneToggle', () => {
    it('sets a valid bone category to true', () => {
        sut.setProcMotionBoneToggle('idle', 'arm', false);
        sut.setProcMotionBoneToggle('idle', 'arm', true);
        expect(sut.getProcMotionState().params.idle.boneToggles.arm).toBe(true);
    });

    it('sets a valid bone category to false', () => {
        sut.setProcMotionBoneToggle('idle', 'arm', false);
        expect(sut.getProcMotionState().params.idle.boneToggles.arm).toBe(false);
    });

    it('warns and returns for invalid bone category', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        sut.setProcMotionBoneToggle('idle', 'nonexistent' as any, true);
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('invalid bone category'));
        warnSpy.mockRestore();
    });

    it('warns and returns for non-boolean value', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        sut.setProcMotionBoneToggle('idle', 'arm', 1 as any);
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('invalid value type'));
        warnSpy.mockRestore();
    });

    it('calls triggerAutoSave on success', () => {
        sut.setProcMotionBoneToggle('idle', 'arm', false);
        expect(mockState.triggerAutoSave).toHaveBeenCalledOnce();
    });

    it('does not call triggerAutoSave on invalid category', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        sut.setProcMotionBoneToggle('idle', 'nonexistent' as any, false);
        expect(mockState.triggerAutoSave).not.toHaveBeenCalled();
        warnSpy.mockRestore();
    });

    it('all toggles default true from DEFAULT_PROC_STATE', () => {
        const s = sut.getProcMotionState();
        for (const cat of PROC_MOTION_BONE_CATEGORIES) {
            expect(s.params.idle.boneToggles[cat]).toBe(true);
        }
    });
});

describe('setProcMotionBoneToggles', () => {
    it('sets multiple toggles at once', () => {
        sut.setProcMotionBoneToggles('idle', { arm: false, head: false });
        const s = sut.getProcMotionState();
        expect(s.params.idle.boneToggles.arm).toBe(false);
        expect(s.params.idle.boneToggles.head).toBe(false);
        // Other toggles remain default
        expect(s.params.idle.boneToggles.waist).toBe(true);
    });

    it('warns and returns when a value is not boolean', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        sut.setProcMotionBoneToggles('idle', { arm: false, head: 'yes' as any });
        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining('invalid value type for key "head"')
        );
        warnSpy.mockRestore();
        // No toggles should have been applied
        expect(sut.getProcMotionState().params.idle.boneToggles.arm).toBe(true);
    });

    it('calls triggerAutoSave on success', () => {
        sut.setProcMotionBoneToggles('idle', { arm: false });
        expect(mockState.triggerAutoSave).toHaveBeenCalledOnce();
    });

    it('does not call triggerAutoSave on invalid value', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        sut.setProcMotionBoneToggles('idle', { arm: 'bad' as any });
        expect(mockState.triggerAutoSave).not.toHaveBeenCalled();
        warnSpy.mockRestore();
    });
});

describe('setProcMotionVpdApplyEnabled', () => {
    it('sets vpdApplyEnabled to true', () => {
        sut.setProcMotionVpdApplyEnabled('idle', true);
        expect(sut.getProcMotionState().params.idle.vpdApplyEnabled).toBe(true);
    });

    it('sets vpdApplyEnabled to false', () => {
        sut.setProcMotionVpdApplyEnabled('idle', true);
        sut.setProcMotionVpdApplyEnabled('idle', false);
        expect(sut.getProcMotionState().params.idle.vpdApplyEnabled).toBe(false);
    });

    it('defaults to DEFAULT_PROC_STATE.params.idle.vpdApplyEnabled', () => {
        expect(sut.getProcMotionState().params.idle.vpdApplyEnabled).toBe(DEFAULT_PROC_STATE.params.idle.vpdApplyEnabled);
    });

    it('warns and returns for non-boolean value', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        sut.setProcMotionVpdApplyEnabled('idle', 'yes' as any);
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('invalid value type'));
        warnSpy.mockRestore();
    });

    it('calls triggerAutoSave on success', () => {
        sut.setProcMotionVpdApplyEnabled('idle', true);
        expect(mockState.triggerAutoSave).toHaveBeenCalledOnce();
    });
});

describe('setProcMotionInterpOverride', () => {
    it('sets a valid override value', () => {
        sut.setProcMotionInterpOverride('idle', 'sharp');
        expect(sut.getProcMotionState().params.idle.interpOverride).toBe('sharp');
    });

    it('accepts all valid values', () => {
        const valid = ['auto', 'sharp', 'ease-in-out', 'ease-out'] as const;
        for (const v of valid) {
            sut.setProcMotionInterpOverride('idle', v);
            expect(sut.getProcMotionState().params.idle.interpOverride).toBe(v);
        }
    });

    it('warns and returns for invalid value', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        sut.setProcMotionInterpOverride('idle', 'invalid' as any);
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('invalid value'));
        warnSpy.mockRestore();
    });

    it('defaults to DEFAULT_PROC_STATE.params.idle.interpOverride', () => {
        expect(sut.getProcMotionState().params.idle.interpOverride).toBe(DEFAULT_PROC_STATE.params.idle.interpOverride);
    });

    it('calls triggerAutoSave on success', () => {
        sut.setProcMotionInterpOverride('idle', 'ease-out');
        expect(mockState.triggerAutoSave).toHaveBeenCalledOnce();
    });

    it('does not call triggerAutoSave on invalid value', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        sut.setProcMotionInterpOverride('idle', 'bad' as any);
        expect(mockState.triggerAutoSave).not.toHaveBeenCalled();
        warnSpy.mockRestore();
    });
});

// ======== BPM 量化 / 眼球·头部追踪 / 停止（原 tracking） ========
describe('setBpmQuantizeEnabled / getBpmQuantizeEnabled', () => {
    it('getBpmQuantizeEnabled returns true when no beat detector exists', () => {
        // Default state: procBeatDetector is null
        expect(sut.getBpmQuantizeEnabled()).toBe(true);
    });

    it('setBpmQuantizeEnabled is a no-op when no beat detector exists (no crash)', () => {
        expect(() => sut.setBpmQuantizeEnabled(false)).not.toThrow();
        expect(() => sut.setBpmQuantizeEnabled(true)).not.toThrow();
    });

    it('warns and returns for non-boolean value', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        sut.setBpmQuantizeEnabled('yes' as any);
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('invalid value type'));
        warnSpy.mockRestore();
    });

    it('delegates to a real BeatDetector when one exists', () => {
        // Create a beat detector via the exported factory
        const bd = sut.createProcBeatDetector();

        // At this point procBeatDetector is set internally
        sut.setBpmQuantizeEnabled(false);
        expect(bd.getBpmQuantizeEnabled()).toBe(false);
        expect(sut.getBpmQuantizeEnabled()).toBe(false);

        sut.setBpmQuantizeEnabled(true);
        expect(bd.getBpmQuantizeEnabled()).toBe(true);
        expect(sut.getBpmQuantizeEnabled()).toBe(true);
    });

    it('getBpmQuantizeEnabled reads from the real beat detector after creation', () => {
        sut.createProcBeatDetector();
        sut.setBpmQuantizeEnabled(false);
        expect(sut.getBpmQuantizeEnabled()).toBe(false);
    });
});

describe('setProcMotionEyeTrackingEnabled', () => {
    it('sets eyeTrackingEnabled in state', () => {
        sut.setProcMotionEyeTrackingEnabled(false);
        expect(sut.getProcMotionState().eyeTrackingEnabled).toBe(false);
    });

    it('calls triggerAutoSave', () => {
        sut.setProcMotionEyeTrackingEnabled(true);
        expect(mockState.triggerAutoSave).toHaveBeenCalledOnce();
    });

    it('defaults to DEFAULT_PROC_STATE.eyeTrackingEnabled', () => {
        expect(sut.getProcMotionState().eyeTrackingEnabled).toBe(
            DEFAULT_PROC_STATE.eyeTrackingEnabled
        );
    });
});

describe('setProcMotionHeadTrackingEnabled', () => {
    it('sets headTrackingEnabled in state', () => {
        sut.setProcMotionHeadTrackingEnabled(true);
        expect(sut.getProcMotionState().headTrackingEnabled).toBe(true);
    });

    it('calls triggerAutoSave', () => {
        sut.setProcMotionHeadTrackingEnabled(true);
        expect(mockState.triggerAutoSave).toHaveBeenCalledOnce();
    });

    it('defaults to DEFAULT_PROC_STATE.headTrackingEnabled', () => {
        expect(sut.getProcMotionState().headTrackingEnabled).toBe(
            DEFAULT_PROC_STATE.headTrackingEnabled
        );
    });
});

describe('stopProcMotion', () => {
    it('sets isProcVmdActive to false', () => {
        sut.stopProcMotion();
        expect(sut.isProcVmdActive()).toBe(false);
    });

    it('does not crash when called multiple times', () => {
        sut.stopProcMotion();
        sut.stopProcMotion();
        sut.stopProcMotion();
        expect(sut.isProcVmdActive()).toBe(false);
    });
});
