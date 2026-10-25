// @vitest-environment node
// vmd-loader.ts 三个路径加载函数 readFileBytes→toArrayBuffer 链覆盖 [audit:fix 2026-10]
//
// 目标行：
//   loadVMDFromPath       L205/L207: if (!vmdBytes) return;  →  const vmdData = toArrayBuffer(vmdBytes);
//   loadCameraVmdFromPath L333/L335: if (!vmdBytes) return;  →  const vmdData = toArrayBuffer(vmdBytes);
//   loadVPDPose           L361/L363: if (!rawBytes) return;  →  const rawData = toArrayBuffer(rawBytes);
//
// 原则：执行到目标行，断言最小。
//   - loadVMDFromPath：mmdRuntime=null + skipSceneIntent=true → 跳过 loadVMDMotion / replaceDefaultMotion
//   - loadCameraVmdFromPath：VmdLoader.loadFromBufferAsync 断言收到非 null ArrayBuffer
//   - loadVPDPose：focusedModelId=null + targetModelId 缺省 → L377 feedbackInfo 短路，避免 applyVPDPose
//
// toArrayBuffer 以 spy 包装（真实逻辑 + 调用记录），证明 readFileBytes→toArrayBuffer 链已执行。
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ======== vi.hoisted 共享 mock ========
const shared = vi.hoisted(() => {
    const logWarn = vi.fn();
    const feedbackStatus = vi.fn();
    const feedbackInfo = vi.fn();
    const triggerAutoSave = vi.fn();
    const addRecentMotion = vi.fn();
    const switchAnimation = vi.fn();
    const showInfoToast = vi.fn();
    const replaceDefaultMotion = vi.fn();
    const getActiveMotion = vi.fn(() => null);
    const getSceneAction = vi.fn(() => undefined);
    const registerSceneAction = vi.fn();
    const isAutoLoadCompanionAudioEnabled = vi.fn(() => false);
    const readFileBytes = vi.fn();
    const getBaseName = vi.fn((p: string) => p.split('/').pop() || p);
    const t = vi.fn((key: string) => key);
    const encodeFileRef = vi.fn(() => 'encoded');
    // 真实 toArrayBuffer 逻辑 + spy
    const toArrayBuffer = vi.fn((bytes: Uint8Array): ArrayBuffer => {
        if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
            return bytes.buffer as ArrayBuffer;
        }
        return bytes.slice().buffer as ArrayBuffer;
    });
    const mockLoadFromBufferAsync = vi.fn().mockResolvedValue({});
    const mockModelRegistry = new Map<string, unknown>();
    const setIsPlaying = vi.fn();
    // mmdRuntime / focusedModelId 可切换
    const configHolder: { mmdRuntime: unknown; focusedModelId: string | null } = {
        mmdRuntime: null,
        focusedModelId: null,
    };
    return {
        logWarn,
        feedbackStatus,
        feedbackInfo,
        triggerAutoSave,
        addRecentMotion,
        switchAnimation,
        showInfoToast,
        replaceDefaultMotion,
        getActiveMotion,
        getSceneAction,
        registerSceneAction,
        isAutoLoadCompanionAudioEnabled,
        readFileBytes,
        getBaseName,
        t,
        encodeFileRef,
        toArrayBuffer,
        mockLoadFromBufferAsync,
        mockModelRegistry,
        setIsPlaying,
        configHolder,
    };
});

// ======== vi.mock 各依赖 ========
vi.mock('@/core/config', () => ({
    get mmdRuntime() {
        return shared.configHolder.mmdRuntime;
    },
    get modelRegistry() {
        return shared.mockModelRegistry;
    },
    get focusedModelId() {
        return shared.configHolder.focusedModelId;
    },
    get isPlaying() {
        return false;
    },
    get autoLoop() {
        return true;
    },
    setIsPlaying: shared.setIsPlaying,
    triggerAutoSave: shared.triggerAutoSave,
    addRecentMotion: shared.addRecentMotion,
    withLoadingIndicator: vi.fn(async (_key: string, fn: () => Promise<void>) => fn()),
}));

vi.mock('@/core/path', () => ({
    getBaseName: shared.getBaseName,
}));

vi.mock('@/core/logger', () => ({
    logWarn: shared.logWarn,
}));

vi.mock('@/core/fileservice', () => ({
    encodeFileRef: shared.encodeFileRef,
}));

vi.mock('@/core/wails-bindings', () => ({
    readFileBytes: shared.readFileBytes,
}));

vi.mock('@/core/array-buffer', () => ({
    toArrayBuffer: shared.toArrayBuffer,
}));

vi.mock('@/core/i18n/t', () => ({
    t: shared.t,
}));

vi.mock('@/core/feedback', () => ({
    feedbackInfo: shared.feedbackInfo,
    feedbackStatus: shared.feedbackStatus,
}));

vi.mock('@/core/mmd-adapter', () => ({
    switchAnimation: shared.switchAnimation,
}));

vi.mock('@/core/toast', () => ({
    showInfoToast: shared.showInfoToast,
}));

vi.mock('./motion-intent', () => ({
    replaceDefaultMotion: shared.replaceDefaultMotion,
    getActiveMotion: shared.getActiveMotion,
}));

vi.mock('@/core/scene-action-bridge', () => ({
    getSceneAction: shared.getSceneAction,
    registerSceneAction: shared.registerSceneAction,
}));

vi.mock('@/motion-algos/procedural-motion', () => ({
    PROC_VMD_NAME_IDLE: 'idle',
    PROC_VMD_NAME_AUTODANCE: 'autodance',
}));

vi.mock('@/core/state', () => ({
    isAutoLoadCompanionAudioEnabled: shared.isAutoLoadCompanionAudioEnabled,
}));

// getScene() → import('../scene') → scene/scene.ts
vi.mock('@/scene/scene', () => ({
    scene: {},
    focusedMmdModel: () => null,
    focusedModel: () => null,
    isProcVmdActive: () => false,
    stopProcMotion: vi.fn(),
}));

// VmdLoader 构造器 → loadFromBufferAsync 可控
vi.mock('babylon-mmd/esm/Loader/vmdLoader', () => ({
    VmdLoader: class {
        constructor(_scene: unknown) {}
        async loadFromBufferAsync(name: string, data: ArrayBuffer) {
            return shared.mockLoadFromBufferAsync(name, data);
        }
    },
}));

vi.mock('babylon-mmd/esm/Runtime/Optimized/Animation/mmdWasmAnimation', () => ({
    MmdWasmAnimation: class {},
}));

vi.mock('babylon-mmd/esm/Runtime/Optimized/mmdWasmRuntime', () => ({
    MmdWasmRuntime: class {},
}));

// loadVPDPose 动态 import
vi.mock('@/motion-algos/vpd-parser', () => ({
    decodeVPDData: vi.fn((_buf: ArrayBuffer) => ''),
    parseVPDText: vi.fn((_text: string) => ({ bones: [], morphs: [] })),
}));

vi.mock('@/scene/manager/model-ops', () => ({
    applyVPDPose: vi.fn(),
}));

// ======== 导入被测模块 ========
import { loadVMDFromPath, loadCameraVmdFromPath, loadVPDPose } from '@/scene/motion/vmd-loader';

// ======== 构建最小合法 VMD buffer ========
function fakeVmdBytes(extraBytes = 0): Uint8Array {
    const header = new Uint8Array(54);
    header.set(new TextEncoder().encode('Vocaloid Motion Data 0002'), 0);
    const buf = new ArrayBuffer(54 + 4 + 16 + extraBytes);
    const u8 = new Uint8Array(buf);
    u8.set(header);
    return u8;
}

describe('vmd-loader — readFileBytes→toArrayBuffer 链覆盖 [audit:fix 2026-10]', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        shared.configHolder.mmdRuntime = null;
        shared.configHolder.focusedModelId = null;
    });

    it('loadVMDFromPath L205/L207: readFileBytes 返回字节 → toArrayBuffer 执行 → mmdRuntime=null 跳过 loadVMDMotion', async () => {
        shared.readFileBytes.mockResolvedValue(fakeVmdBytes());

        await loadVMDFromPath('/models/test.vmd', undefined, undefined, true);

        // toArrayBuffer spy 被调，参数是非 null Uint8Array
        expect(shared.toArrayBuffer).toHaveBeenCalledTimes(1);
        const arg = shared.toArrayBuffer.mock.calls[0][0];
        expect(arg).toBeInstanceOf(Uint8Array);
        expect((arg as Uint8Array).byteLength).toBeGreaterThan(0);
        // 返回值是 ArrayBuffer
        expect(shared.toArrayBuffer.mock.results[0].value).toBeInstanceOf(ArrayBuffer);
        // addRecentMotion 被调（L250 可达）
        expect(shared.addRecentMotion).toHaveBeenCalled();
    });

    it('loadCameraVmdFromPath L333/L335: readFileBytes 返回字节 → toArrayBuffer → VmdLoader.loadFromBufferAsync 收到非 null ArrayBuffer', async () => {
        shared.readFileBytes.mockResolvedValue(fakeVmdBytes());
        shared.mockLoadFromBufferAsync.mockResolvedValueOnce({});

        await loadCameraVmdFromPath('/models/camera.vmd');

        // toArrayBuffer spy 被调
        expect(shared.toArrayBuffer).toHaveBeenCalledTimes(1);
        const arg = shared.toArrayBuffer.mock.calls[0][0];
        expect(arg).toBeInstanceOf(Uint8Array);
        // 下游 VmdLoader.loadFromBufferAsync 收到 toArrayBuffer 的返回值（ArrayBuffer）
        expect(shared.mockLoadFromBufferAsync).toHaveBeenCalledTimes(1);
        const bufArg = shared.mockLoadFromBufferAsync.mock.calls[0][1];
        expect(bufArg).toBeInstanceOf(ArrayBuffer);
        expect((bufArg as ArrayBuffer).byteLength).toBeGreaterThan(0);
    });

    it('loadVPDPose L361/L363: readFileBytes 返回字节 → toArrayBuffer → focusedModelId=null 短路 feedbackInfo', async () => {
        shared.readFileBytes.mockResolvedValue(new Uint8Array(new ArrayBuffer(60)));

        await loadVPDPose('/models/pose.vpd');

        // toArrayBuffer spy 被调
        expect(shared.toArrayBuffer).toHaveBeenCalledTimes(1);
        const arg = shared.toArrayBuffer.mock.calls[0][0];
        expect(arg).toBeInstanceOf(Uint8Array);
        // L376-378: id = undefined || null = null → feedbackInfo 短路
        expect(shared.feedbackInfo).toHaveBeenCalledWith('scene.vmd.loadModelFirst', undefined);
    });
});
