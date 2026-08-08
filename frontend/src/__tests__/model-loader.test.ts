// model-loader.test.ts — [fix:round15 P2] Stage 分支注册后 abort 清理块（line 587-596）覆盖尝试。
//
// 关键可达性分析（决定了本文件的变更行覆盖上限）：
//   loadPMXFile 的 stage 分支在 `await ImportMeshAsync(...)`（line 491）之后、到新 guard（line 589）
//   之间**没有任何 await / yield**；effectiveSignal.aborted 是同一 AbortSignal 的实时 getter。
//   - 若 signal 在 import 前/中已 abort：line 473 或 line 508 的既有 guard 已 return null，永远到不了 589。
//   - 若 import 时未 abort：508 之后同步执行直到 589，期间 signal 状态不可能翻转（单线程无 yield）。
//   ⇒ 新 guard（589-595）在单次调用内结构上不可达。本测试以 stage 成功路径 + abort 路径
//     证明该结论，并覆盖其周边 stage 代码；变更行本身 0% 可通过无头单测覆盖。
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
    class Mesh {
        name = 'mesh';
        material: any = null;
        position = { x: 0, y: 0, z: 0 };
        getHierarchyBoundingVectors = () => ({ min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } });
        dispose = vi.fn();
    }
    return {
        Mesh,
        importMeshAsync: vi.fn(),
        logWarn: vi.fn(),
        auditMissingTextures: vi.fn(() => Promise.resolve([])),
        parsePmxTexturePaths: vi.fn(() => []),
        renderInstanceThumbnail: vi.fn(() => Promise.resolve()),
        removeCalls: [] as string[],
    };
});

vi.mock('@babylonjs/core/Meshes/mesh', () => ({ Mesh: h.Mesh }));
vi.mock('@babylonjs/core/Loading/sceneLoader', () => ({ ImportMeshAsync: h.importMeshAsync }));
vi.mock('babylon-mmd/esm/Runtime/Optimized/mmdWasmModel', () => ({ MmdWasmModel: class {} }));
vi.mock('../scene/manager/material-proxy-resolver', () => ({ getStandardMaterialProxy: vi.fn(() => ({})) }));
vi.mock('../scene/manager/thumbnail-capture', () => ({ renderInstanceThumbnail: h.renderInstanceThumbnail }));
vi.mock('../scene/manager/thumbnail-key', () => ({ thumbnailBaseKey: vi.fn(() => 'thumb-key') }));
vi.mock('@/core/feedback', () => ({ feedbackStatus: vi.fn() }));
vi.mock('@/core/status-bar', () => ({ setStatus: vi.fn() }));
vi.mock('@/core/toast', () => ({ showInfoToast: vi.fn() }));
vi.mock('@/core/path', () => ({ getBaseName: (p: string) => p.split(/[\\/]/).pop() || p }));
vi.mock('@/core/async', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        swallowError: (p: any) => {
            if (p && typeof p.then === 'function') p.catch(() => {});
            return p;
        },
        fireAndForget: vi.fn(),
    };
});
vi.mock('../scene/manager/model-id', () => ({ resolveModelId: (id?: string) => id ?? 'gen-id' }));
vi.mock('@/core/logger', () => ({ logWarn: h.logWarn }));
vi.mock('@/core/pmx-meta', () => ({ parsePmxComment: vi.fn(() => '') }));
vi.mock('@/core/scene-action-bridge', () => ({
    getSceneAction: vi.fn(() => undefined),
    registerSceneAction: vi.fn(),
    setSceneAction: vi.fn(),
    unregisterSceneAction: vi.fn(),
    getSceneActions: vi.fn(() => []),
}));
vi.mock('@/core/fileservice', () => ({ resolveModelDir: (p: string) => p.replace(/[^\\/]+$/, '') || '/' }));
vi.mock('@/core/wails-bindings', () => ({
    readFileBytes: vi.fn(() => new Uint8Array([1, 2, 3])),
    ListDirRecursive: vi.fn(() => Promise.resolve([])),
}));
vi.mock('../scene/shared/texture-lru', () => ({ readTextureWithLRU: vi.fn(() => new ArrayBuffer(8)) }));
vi.mock('../scene/manager/pmx-texture-audit', () => ({
    auditMissingTextures: h.auditMissingTextures,
    parsePmxTexturePaths: h.parsePmxTexturePaths,
}));
vi.mock('../scene/manager/texture-fallback', () => ({
    registerDeclaredAliases: (f: any) => f,
    expandFallbackCandidates: (f: any) => f,
}));
vi.mock('@/core/resource-warning-sink', () => ({ reportResourceWarning: vi.fn() }));
vi.mock('@/core/i18n/t', () => ({ t: (k: string) => k }));
vi.mock('@/scene/physics/wind-physics', () => ({ retryWindPhysicsSubscription: vi.fn() }));
vi.mock('../scene/manager/material', () => ({ _capture: vi.fn() }));
vi.mock('../scene/render/lighting', () => ({ rebuildShadowCasters: vi.fn() }));
vi.mock('../scene/env/env-impl', () => ({
    getGroundHeightAt: vi.fn(() => 0),
    setOnTerrainReady: vi.fn(),
    setOnGroundChanged: vi.fn(),
}));
vi.mock('../scene/transform/transform-pick', () => ({ setTransformMetadata: vi.fn() }));
vi.mock('@/core/config', () => ({
    dom: {
        loadingEl: { style: { display: '' } },
        loadingText: { textContent: '' },
        canvas: { setAttribute: vi.fn() },
    },
    setFocusedModelId: vi.fn(),
    ModelInstance: class {},
    triggerAutoSave: vi.fn(),
    formatError: (e: unknown) => String(e),
    uiState: {},
    modelRegistry: new Map(),
}));

import { initLoader, loadPMXFile } from '../scene/manager/model-loader';

function makeModelManager() {
    const store = new Map<string, any>();
    return {
        store,
        register: vi.fn((inst: any) => store.set(inst.id, inst)),
        remove: vi.fn((id: string) => {
            h.removeCalls.push(id);
            store.delete(id);
        }),
        getAll: vi.fn(() => [...store.values()]),
        findByFilePath: vi.fn(() => undefined),
        focus: vi.fn(),
        arrange: vi.fn(),
    };
}

const scene = {} as any;
const mmdRuntime = { createMmdModel: vi.fn() } as any;

describe('loadPMXFile stage 路径（round15 P2 周边覆盖）', () => {
    let mm: ReturnType<typeof makeModelManager>;

    beforeEach(() => {
        h.removeCalls.length = 0;
        h.importMeshAsync.mockReset();
        h.importMeshAsync.mockResolvedValue({ meshes: [new h.Mesh()] });
        mm = makeModelManager();
        initLoader(scene, mmdRuntime, mm as any, vi.fn(), vi.fn(), vi.fn(), vi.fn());
    });

    it('stage 加载成功：注册模型并返回 id，不触发 remove', async () => {
        const id = await loadPMXFile('/models/m.pmx', true);
        expect(id).toBe('gen-id');
        expect(mm.register).toHaveBeenCalledTimes(1);
        expect(mm.remove).not.toHaveBeenCalled();
    });

    it('signal 在 import 期间 abort：既有 guard（line 508）return null，不到达 589 新 guard', async () => {
        const ctrl = new AbortController();
        // import 解析前先 abort 外部 signal —— 触发 508 既有 guard，register 不发生
        h.importMeshAsync.mockImplementation(async () => {
            ctrl.abort();
            return { meshes: [new h.Mesh()] };
        });
        const id = await loadPMXFile('/models/m.pmx', true, false, undefined, undefined, ctrl.signal);
        expect(id).toBeNull();
        expect(mm.register).not.toHaveBeenCalled(); // ⇒ 589 新 guard 未触及
    });

    it('信号已 abort 于读取阶段：line 473 即 return null，新 guard 不可达', async () => {
        const ctrl = new AbortController();
        ctrl.abort();
        const id = await loadPMXFile('/models/m.pmx', true, false, undefined, undefined, ctrl.signal);
        expect(id).toBeNull();
        expect(mm.register).not.toHaveBeenCalled();
    });
});
