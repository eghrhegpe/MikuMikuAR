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
const disposeSpy = vi.fn();
const mockCurrentAnimation = { dispose: disposeSpy };
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

vi.mock('../core/utils', () => ({
    getBaseName: (p: string) => p.split('/').pop() || p,
    clamp01: (v: number) => Math.max(0, Math.min(1, v)),
    swallowError: vi.fn(),
    debounce: (fn: Function) => fn,
}));

vi.mock('../core/logger', () => ({
    logWarn: vi.fn(),
}));

vi.mock('../core/i18n/t', () => ({
    t: (key: string) => key,
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
vi.mock('../scene/motion/vmd-loader', () => ({
    loadVMDMotion: vi.fn().mockResolvedValue(undefined),
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
        spanes: any[] = [];
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

// ======== 导入被测模块 ========
import { addVmdLayer } from '../scene/motion/vmd-layers';

/** 构建最小合法 VMD buffer */
function fakeVmdBuffer(): ArrayBuffer {
    const header = new Uint8Array(54);
    header.set(new TextEncoder().encode('Vocaloid Motion Data 0002'), 0);
    const buf = new ArrayBuffer(54 + 4 + 16);
    new Uint8Array(buf).set(header);
    return buf;
}

describe('vmd-layers — 旧动画句柄 dispose (composite 路径)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // 重置模型状态：无基础 VMD，2 层已启用 VMD 图层 → 触发 composite 路径
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
            },
            {
                id: 'layer_2',
                kind: 'vmd',
                name: 'layer2.vmd',
                weight: 0.5,
                enabled: true,
                data: fakeVmdBuffer(),
            },
        ];
        mockMmdModel.currentAnimation = mockCurrentAnimation as any;
        mockMmdModel.createRuntimeAnimation = vi.fn(() => ({ _handle: 1 }));
    });

    it('添加第三层触发 composite 重建时应 dispose 旧 animation handle', async () => {
        // 当前 2 层 → composite 路径已执行过（创建了 animation handle）
        // 添加第 3 层 → 再次进入 composite 路径 → 应 dispose 旧 handle
        const vmd3 = fakeVmdBuffer();
        await addVmdLayer(vmd3, 'layer3.vmd');
        // 验证：旧 animation handle 的 dispose 被调用
        expect(disposeSpy).toHaveBeenCalled();
    });
});
