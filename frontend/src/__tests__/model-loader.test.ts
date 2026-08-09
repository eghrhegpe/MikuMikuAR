// model-loader.test.ts — Stage / Actor 全路径覆盖 + abort 清理 + 回调验证
//
// 可达性分析（stage abort guard line 589-595）：
//   stage 分支在 ImportMeshAsync 之后到 guard 之间无 await/yield，
//   signal 状态在单线程内不可翻转 ⇒ 589 结构上不可达（v8 ignore）。
// Actor 路径（line 636-828）：createMmdModel → register →贴地→ _applySceneMotion → focus → 缩略图。
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
    class Mesh {
        static [Symbol.hasInstance](obj: any): boolean {
            return obj != null && obj.__proto__ === Mesh.prototype;
        }
        name = 'mesh';
        material: any = null;
        position = { x: 0, y: 0, z: 0 };
        isDisposed = () => false;
        getHierarchyBoundingVectors = () => ({
            min: { x: 0, y: 0, z: 0 },
            max: { x: 0, y: 10, z: 0 },
        });
        skeleton = { bones: [] };
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

import { initLoader, loadPMXFile, setOnMeshesReady, setOnModelLoaded } from '../scene/manager/model-loader';

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

// ========== Actor 主路径（asStage=false, line 636-828）==========

describe('loadPMXFile actor 路径', () => {
    let mm: ReturnType<typeof makeModelManager>;
    const mockMeshes = [new h.Mesh(), new h.Mesh()];

    beforeEach(() => {
        h.removeCalls.length = 0;
        h.importMeshAsync.mockReset();
        h.importMeshAsync.mockResolvedValue({ meshes: mockMeshes });
        mm = makeModelManager();
        setOnMeshesReady(null as any);
        setOnModelLoaded(null as any);
        initLoader(scene, mmdRuntime, mm as any, vi.fn(), vi.fn(), vi.fn(), vi.fn());
    });

    it('成功加载：createMmdModel → register → focus → 返回 id', async () => {
        const id = await loadPMXFile('/models/actor.pmx', false, true); // skipAutoApply=true（预设应用由其他测试覆盖）
        expect(id).toBe('gen-id');
        expect(mmdRuntime.createMmdModel).toHaveBeenCalledTimes(1);
        expect(mm.register).toHaveBeenCalledTimes(1);
        expect(mm.focus).toHaveBeenCalledWith('gen-id', undefined);
    });

    it('import 抛错：不注册模型，返回 null', async () => {
        h.importMeshAsync.mockRejectedValueOnce(new Error('file not found'));
        const id = await loadPMXFile('/models/bad.pmx');
        expect(id).toBeNull();
        expect(mm.register).not.toHaveBeenCalled();
    });

    it('import 返回空 meshes：反馈 noMeshes，返回 null', async () => {
        h.importMeshAsync.mockResolvedValueOnce({ meshes: [] });
        const id = await loadPMXFile('/models/empty.pmx');
        expect(id).toBeNull();
        expect(mm.register).not.toHaveBeenCalled();
    });

    it('abort 后清理：post-register 阶段（line 733-743）remove 被调用', async () => {
        const ctrl = new AbortController();
        // 让 _applySceneMotion 走到 readFileBytes 路径：getSceneAction 返回 activeMotion
        const { getSceneAction } = await import('@/core/scene-action-bridge');
        (getSceneAction as any).mockImplementation((key: string) => {
            if (key === 'getActiveMotion') return { vmdPath: '/test.vmd', vmdName: 'test.vmd' };
            if (key === 'getMotionGen') return 0;
            return undefined;
        });
        // readFileBytes：第一次返回 VMD 数据，之后 abort
        let readCount = 0;
        const { readFileBytes } = await import('@/core/wails-bindings');
        (readFileBytes as any).mockImplementation(async () => {
            readCount++;
            if (readCount >= 2) ctrl.abort();
            return new Uint8Array([1, 2, 3]);
        });
        const id = await loadPMXFile('/models/abort.pmx', false, false, undefined, undefined, ctrl.signal);
        expect(id).toBeNull();
        // _applySceneMotion abort 路径（line 408-409）清理已注册模型
        expect(mm.remove).toHaveBeenCalled();
    });
});

// ========== existing 模型切换快速路径（line 448-457）==========

describe('loadPMXFile existing 模型切换', () => {
    let mm: ReturnType<typeof makeModelManager>;

    beforeEach(() => {
        h.removeCalls.length = 0;
        h.importMeshAsync.mockReset();
        mm = makeModelManager();
        initLoader(scene, mmdRuntime, mm as any, vi.fn(), vi.fn(), vi.fn(), vi.fn());
    });

    it('findByFilePath 命中已有实例：focus + toast，返回已有 id，不重新加载', async () => {
        const existingInst = { id: 'existing-123', name: 'Miku' };
        mm.findByFilePath.mockReturnValue(existingInst);
        const id = await loadPMXFile('/models/miku.pmx');
        expect(id).toBe('existing-123');
        expect(mm.focus).toHaveBeenCalledWith('existing-123', undefined);
        expect(mm.register).not.toHaveBeenCalled();
        expect(h.importMeshAsync).not.toHaveBeenCalled();
    });
});

// ========== abort 后 Mesh 清理验证（line 508-517, instanceof 修复）==========

describe('loadPMXFile abort Mesh 清理', () => {
    let mm: ReturnType<typeof makeModelManager>;
    const mesh1 = new h.Mesh();
    const mesh2 = new h.Mesh();

    beforeEach(() => {
        h.removeCalls.length = 0;
        h.importMeshAsync.mockReset();
        mesh1.dispose.mockClear();
        mesh2.dispose.mockClear();
        h.importMeshAsync.mockResolvedValue({ meshes: [mesh1, mesh2] });
        mm = makeModelManager();
        initLoader(scene, mmdRuntime, mm as any, vi.fn(), vi.fn(), vi.fn(), vi.fn());
    });

    it('import 完成后 abort：Mesh 实例通过 instanceof 过滤并逐个 dispose', async () => {
        const ctrl = new AbortController();
        h.importMeshAsync.mockImplementation(async () => {
            ctrl.abort();
            return { meshes: [mesh1, mesh2] };
        });
        const id = await loadPMXFile('/models/abort.pmx', true, false, undefined, undefined, ctrl.signal);
        expect(id).toBeNull();
        expect(mesh1.dispose).toHaveBeenCalledTimes(1);
        expect(mesh2.dispose).toHaveBeenCalledTimes(1);
        expect(mm.register).not.toHaveBeenCalled();
    });
});

// ========== setOnMeshesReady / setOnModelLoaded 回调 ==========

describe('loadPMXFile 回调', () => {
    let mm: ReturnType<typeof makeModelManager>;

    beforeEach(async () => {
        h.removeCalls.length = 0;
        h.importMeshAsync.mockReset();
        h.importMeshAsync.mockResolvedValue({ meshes: [new h.Mesh()] });
        mm = makeModelManager();
        setOnMeshesReady(null as any);
        setOnModelLoaded(null as any);
        // 清除其他测试对 getSceneAction 的 mockImplementation 泄漏
        const { getSceneAction } = await import('@/core/scene-action-bridge');
        (getSceneAction as any).mockReset();
        (getSceneAction as any).mockReturnValue(undefined);
        initLoader(scene, mmdRuntime, mm as any, vi.fn(), vi.fn(), vi.fn(), vi.fn());
    });

    it('stage 路径：onMeshesReady 被调用', async () => {
        const cb = vi.fn();
        setOnMeshesReady(cb);
        await loadPMXFile('/models/s.pmx', true);
        expect(cb).toHaveBeenCalledTimes(1);
        expect(cb.mock.calls[0][0]).toHaveLength(1);
    });

    it('actor 路径：onMeshesReady 和 onModelLoaded 均被调用', async () => {
        const meshesCb = vi.fn();
        const loadedCb = vi.fn();
        setOnMeshesReady(meshesCb);
        setOnModelLoaded(loadedCb);
        await loadPMXFile('/models/a.pmx');
        expect(meshesCb).toHaveBeenCalledTimes(1);
        expect(loadedCb).toHaveBeenCalledWith('gen-id');
    });
});
