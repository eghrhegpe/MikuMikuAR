// proc-motion-bridge 拆分 — regenerate 守卫 / triggerAutoSave 交互 / update 程序化保持生效（adr-129 回归）
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DEFAULT_PROC_STATE } from '../motion-algos/procedural-motion';
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
vi.mock('../outfit/audio', () => mockAudio(mockState));
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
