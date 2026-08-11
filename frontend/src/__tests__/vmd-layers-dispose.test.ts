// @vitest-environment node
/**
 * VMD 图层动画句柄 dispose 测试
 *
 * 覆盖审核发现的 🔴 P1：vmd-layers.ts _rebuildCompositeAnimation() 进入 composite 路径时
 * 旧 WASM 动画句柄未 dispose，导致每次调整图层都泄漏 WASM AnimCurve 资源。
 *
 * 触发 composite 路径的条件：vmdEnabledLayers.length > 1 || hasBaseVmd
 * 本测试设置 2+ 个启用 VMD 层 → 触发 composite 路径 → 验证旧句柄被 dispose。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ======== 共享 mock 状态 ========
const mockDispose = vi.fn();
const mockCurrentAnimation = { dispose: mockDispose };
const mockMmdModel = {
    currentAnimation: mockCurrentAnimation as any,
    setRuntimeAnimation: vi.fn(),
    createRuntimeAnimation: vi.fn(() => ({ _handle: 1 })),
    runtimeBones: [] as any[],
};
const mockInst = {
    id: 'model_1',
    mmdModel: mockMmdModel as any,
    vmdLayers: [] as any[],
    vmdData: null as ArrayBuffer | null,
    vmdName: '',
    meshes: [{ skeleton: { bones: [] } }],
    animationDuration: 0,
};
const mockMmdRuntime = {
    seekAnimation: vi.fn().mockResolvedValue(undefined),
    playAnimation: vi.fn().mockResolvedValue(undefined),
};

// ======== mock 模块 ========
vi.mock('../core/config', () => ({
    get mmdRuntime() {
        return mockMmdRuntime;
    },
    get modelRegistry() {
        return new Map([['model_1', mockInst]]);
    },
    get focusedModelId() {
        return 'model_1';
    },
    get isPlaying() {
        return false;
    },
    get autoLoop() {
        return true;
    },
    setIsPlaying: vi.fn(),
    setStatus: vi.fn(),
    triggerAutoSave: vi.fn(),
}));

vi.mock('../core/wails-bindings', () => ({
    readFileBytes: vi.fn().mockResolvedValue(null),
}));

vi.mock('../core/path', () => ({
    getBaseName: (p: string) => p.split('/').pop() || p,
}));
vi.mock('../core/clamp', () => ({
    clamp01: (v: number) => Math.max(0, Math.min(1, v)),
}));

vi.mock('../core/logger', () => ({
    logWarn: vi.fn(),
}));

vi.mock('../core/i18n/t', () => ({
    t: (key: string) => key,
}));

vi.mock('../core/i18n/goerr', () => ({
    translateGoError: (e: unknown) => String(e),
}));

vi.mock('../core/feedback', () => ({
    feedbackStatus: vi.fn(),
}));

vi.mock('../core/toast', () => ({
    showInfoToast: vi.fn(),
}));

vi.mock('encoding-japanese', () => ({
    default: {
        convert: (arr: Uint8Array) => arr,
        detect: () => 'UTF8',
    },
}));

// mock scene module
vi.mock('../scene/scene', () => ({
    scene: {},
    focusedMmdModel: () => mockMmdModel,
    focusedModel: () => mockInst,
    isProcVmdActive: () => false,
    stopProcMotion: vi.fn(),
}));

// mock VMD loader (复用 scene/motion 内部 dynamic import)
const mockLoadVMDMotion = vi.fn().mockResolvedValue(undefined);
vi.mock('../scene/motion/vmd-loader', () => ({
    loadVMDMotion: mockLoadVMDMotion,
    loadVMDFromPath: vi.fn().mockResolvedValue(undefined),
}));

// mock babylon-mmd VmdLoader → 返回包含 endFrame/metadata 的合法对象
vi.mock('babylon-mmd/esm/Loader/vmdLoader', () => ({
    VmdLoader: class {
        async loadFromBufferAsync(_name: string, _data: ArrayBuffer) {
            return {
                endFrame: 60,
                metadata: { camera: null },
            };
        }
    },
}));

// mock MmdCompositeAnimation
vi.mock('babylon-mmd/esm/Runtime/Animation/mmdCompositeAnimation', () => ({
    MmdCompositeAnimation: class {
        spans: any[] = [];
        addSpan() {}
    },
    MmdAnimationSpan: class {
        constructor(_anim: any, _weight: number, _additive: boolean) {}
    },
}));

vi.mock('babylon-mmd/esm/Runtime/Optimized/mmdWasmRuntime', () => ({
    MmdWasmRuntime: class {},
}));

vi.mock('../scene/motion/wasm-layers-blender', () => ({
    isWasmLayersBlenderActive: () => false,
    teardownWasmLayersBlender: vi.fn(),
}));

vi.mock('../scene/motion/proc-motion-bridge', () => ({
    setGazeLayerActive: vi.fn(),
}));

// ======== 导入被测模块 ========
import {
    addVmdLayer,
    removeVmdLayer,
    toggleVmdLayer,
} from '../scene/motion/vmd-layers';

/** 构建最小合法 VMD buffer（不同 byteLength 避免去重） */
function fakeVmdBuffer(extraBytes = 0): ArrayBuffer {
    const header = new Uint8Array(54);
    header.set(new TextEncoder().encode('Vocaloid Motion Data 0002'), 0);
    const buf = new ArrayBuffer(54 + 4 + 16 + extraBytes);
    new Uint8Array(buf).set(header);
    return buf;
}

/** 重置模型到标准 composite 路径前置状态（2 层已启用 VMD） */
function resetToCompositeState() {
    mockInst.vmdData = null;
    mockInst.vmdName = '';
    mockInst.vmdLayers = [
        {
            id: 'layer_1',
            kind: 'vmd',
            name: 'layer1.vmd',
            weight: 1.0,
            enabled: true,
            data: fakeVmdBuffer(),
            boneFilter: [],
            path: null,
        },
        {
            id: 'layer_2',
            kind: 'vmd',
            name: 'layer2.vmd',
            weight: 0.5,
            enabled: true,
            data: fakeVmdBuffer(1),
            boneFilter: [],
            path: null,
        },
    ];
    mockMmdModel.currentAnimation = mockCurrentAnimation as any;
    mockMmdModel.createRuntimeAnimation = vi.fn(() => ({ _handle: 1 }));
}

describe('vmd-layers — 旧动画句柄 dispose (composite 路径)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetToCompositeState();
    });

    it('添加第三层触发 composite 重建时应 dispose 旧 animation handle', async () => {
        const vmd3 = fakeVmdBuffer(2);
        await addVmdLayer(vmd3, 'layer3.vmd');
        // switchAnimation 内部取出 currentAnimation 并调用 dispose
        expect(mockDispose).toHaveBeenCalled();
        // 且新动画句柄被绑定
        expect(mockMmdModel.setRuntimeAnimation).toHaveBeenCalled();
    });

    it('currentAnimation 为 null 时不崩溃、不调用 dispose', async () => {
        mockMmdModel.currentAnimation = null as any;
        const vmd3 = fakeVmdBuffer(2);
        await addVmdLayer(vmd3, 'layer3.vmd');
        expect(mockDispose).not.toHaveBeenCalled();
        // 新动画仍应被绑定
        expect(mockMmdModel.createRuntimeAnimation).toHaveBeenCalled();
    });

    it('旧句柄 dispose 抛异常时不阻断新动画绑定', async () => {
        mockDispose.mockImplementationOnce(() => {
            throw new Error('WASM dispose failed');
        });
        const vmd3 = fakeVmdBuffer(2);
        await addVmdLayer(vmd3, 'layer3.vmd');
        // switchAnimation 的 try-catch 应吞掉 dispose 异常
        expect(mockMmdModel.createRuntimeAnimation).toHaveBeenCalled();
        expect(mockMmdModel.setRuntimeAnimation).toHaveBeenCalled();
    });

    it('removeVmdLayer 移除后走 fallback 路径应调用 loadVMDMotion（其内部负责 dispose）', async () => {
        await removeVmdLayer('layer_2');
        // 移除后只剩 1 层且无 baseVmd → fallback 路径 → loadVMDMotion
        // loadVMDMotion 内部调用 switchAnimation 完成旧句柄 dispose（见 vmd-loader.ts:148）
        expect(mockLoadVMDMotion).toHaveBeenCalled();
    });

    it('toggleVmdLayer 禁用一层后走 fallback 路径应调用 loadVMDMotion', async () => {
        await toggleVmdLayer('layer_2');
        // 禁用一层后只剩 1 层 → fallback 路径 → loadVMDMotion
        expect(mockLoadVMDMotion).toHaveBeenCalled();
    });

    it('重复添加同名同大小 VMD 应返回 null 且不触发 rebuild', async () => {
        // 尝试添加与 layer_1 同名同 byteLength 的 VMD
        const dupResult = await addVmdLayer(fakeVmdBuffer(), 'layer1.vmd');
        expect(dupResult).toBeNull();
        // 重复检测在 rebuild 之前，不应触发 dispose
        expect(mockDispose).not.toHaveBeenCalled();
    });
});
