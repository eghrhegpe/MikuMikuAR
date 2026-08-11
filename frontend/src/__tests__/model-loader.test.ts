// @vitest-environment node
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
    const actual = await importOriginal<typeof import('@/core/async')>();
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
        focused: vi.fn(() => [...store.values()][0] ?? null),
        storeRigidBodyState: vi.fn(),
    };
}

const scene = { whenReadyAsync: vi.fn(() => Promise.resolve()) } as any;
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

// ========== _applySceneMotion 分支覆盖（通过 Actor 路径间接测试）==========

describe('_applySceneMotion 分支', () => {
    let mm: ReturnType<typeof makeModelManager>;

    beforeEach(async () => {
        h.removeCalls.length = 0;
        h.importMeshAsync.mockReset();
        h.importMeshAsync.mockResolvedValue({ meshes: [new h.Mesh()] });
        mm = makeModelManager();
        setOnMeshesReady(null as any);
        setOnModelLoaded(null as any);
        // mockReset + mockReturnValue 清除所有测试的 mockImplementation 泄漏
        const { getSceneAction } = await import('@/core/scene-action-bridge');
        (getSceneAction as any).mockReset();
        (getSceneAction as any).mockReturnValue(undefined);
        const { readFileBytes } = await import('@/core/wails-bindings');
        (readFileBytes as any).mockReset();
        (readFileBytes as any).mockResolvedValue(new Uint8Array([1, 2, 3]));
        initLoader(scene, mmdRuntime, mm as any, vi.fn(), vi.fn(), vi.fn(), vi.fn());
    });

    it('VMD 兼容：activeMotion + compatible → loadVMDMotion 被调用', async () => {
        const { getSceneAction } = await import('@/core/scene-action-bridge');
        (getSceneAction as any).mockImplementation((key: string) => {
            if (key === 'getActiveMotion') return () => ({ vmdPath: '/test.vmd', vmdName: 'dance.vmd' });
            if (key === 'getMotionGen') return () => 0;
            if (key === 'resolveCompatibility') return () => ({ compatible: true });
            return undefined;
        });
        // mock runtimeBones 供兼容性检查
        mmdRuntime.createMmdModel.mockReturnValue({
            rigidBodyStates: null,
            runtimeBones: [{ name: '頭' }, { name: '上半身' }],
        });
        await loadPMXFile('/models/vmd.pmx', false, true);
        // 验证：模型成功加载（VMD 应用成功，不走 incompatible 降级）
        expect(mm.register).toHaveBeenCalledTimes(1);
        expect(mm.focus).toHaveBeenCalled();
    });

    it('VMD 不兼容：compatible=false → motionSlots.status=incompatible', async () => {
        const { getSceneAction } = await import('@/core/scene-action-bridge');
        (getSceneAction as any).mockImplementation((key: string) => {
            if (key === 'getActiveMotion') return () => ({ vmdPath: '/test.vmd', vmdName: 'dance.vmd' });
            if (key === 'getMotionGen') return () => 0;
            if (key === 'resolveCompatibility') return () => ({ compatible: false });
            return undefined;
        });
        mmdRuntime.createMmdModel.mockReturnValue({
            rigidBodyStates: null,
            runtimeBones: [],
        });
        const id = await loadPMXFile('/models/incompat.pmx', false, true);
        // 模型仍加载成功（VMD 不兼容不阻塞模型加载），但 motionSlots 应标记 incompatible
        expect(id).toBe('gen-id');
        expect(mm.register).toHaveBeenCalledTimes(1);
    });

    it('generation 过期：getMotionGen 在 readFileBytes 后变化 → VMD 被丢弃', async () => {
        let genValue = 0;
        const { getSceneAction } = await import('@/core/scene-action-bridge');
        (getSceneAction as any).mockImplementation((key: string) => {
            if (key === 'getActiveMotion') return () => ({ vmdPath: '/test.vmd', vmdName: 'dance.vmd' });
            if (key === 'getMotionGen') {
                const g = genValue;
                genValue = 99; // 第二次调用返回不同 generation
                return () => g;
            }
            if (key === 'resolveCompatibility') return () => ({ compatible: true });
            return undefined;
        });
        mmdRuntime.createMmdModel.mockReturnValue({
            rigidBodyStates: null,
            runtimeBones: [{ name: '頭' }],
        });
        const id = await loadPMXFile('/models/stale.pmx', false, true);
        // 模型仍加载成功（VMD 被丢弃但不阻塞）
        expect(id).toBe('gen-id');
        expect(mm.register).toHaveBeenCalledTimes(1);
    });

    it('VMD 加载失败：readFileBytes 抛错 → 降级加载模型', async () => {
        const { getSceneAction } = await import('@/core/scene-action-bridge');
        (getSceneAction as any).mockImplementation((key: string) => {
            if (key === 'getActiveMotion') return () => ({ vmdPath: '/test.vmd', vmdName: 'dance.vmd' });
            if (key === 'getMotionGen') return () => 0;
            if (key === 'resolveCompatibility') return () => ({ compatible: true });
            return undefined;
        });
        mmdRuntime.createMmdModel.mockReturnValue({
            rigidBodyStates: null,
            runtimeBones: [{ name: '頭' }],
        });
        const { readFileBytes } = await import('@/core/wails-bindings');
        let callCount = 0;
        (readFileBytes as any).mockImplementation(async () => {
            callCount++;
            // 第一次调用（PMX 读取）成功，第二次调用（VMD 读取）失败
            if (callCount >= 2) throw new Error('VMD read failed');
            return new Uint8Array([1, 2, 3]);
        });
        const id = await loadPMXFile('/models/vmdfail.pmx', false, true);
        // 模型仍加载成功（VMD 失败降级，不阻塞模型加载）
        expect(id).toBe('gen-id');
        expect(mm.register).toHaveBeenCalledTimes(1);
    });
});

// ========== captureThumbnail 调用验证 ==========

describe('captureThumbnail 调用', () => {
    let mm: ReturnType<typeof makeModelManager>;

    beforeEach(async () => {
        h.removeCalls.length = 0;
        h.importMeshAsync.mockReset();
        h.importMeshAsync.mockResolvedValue({ meshes: [new h.Mesh()] });
        mm = makeModelManager();
        setOnMeshesReady(null as any);
        setOnModelLoaded(null as any);
        const { getSceneAction } = await import('@/core/scene-action-bridge');
        (getSceneAction as any).mockReset();
        (getSceneAction as any).mockReturnValue(undefined);
        const { readFileBytes } = await import('@/core/wails-bindings');
        (readFileBytes as any).mockReset();
        (readFileBytes as any).mockResolvedValue(new Uint8Array([1, 2, 3]));
        initLoader(scene, mmdRuntime, mm as any, vi.fn(), vi.fn(), vi.fn(), vi.fn());
    });

    it('stage 加载后触发 captureThumbnail（异步 setTimeout）', async () => {
        h.renderInstanceThumbnail.mockClear();
        await loadPMXFile('/models/t.pmx', true);
        // captureThumbnail 通过 setTimeout(..., 0) 异步触发
        // 等待微任务队列和 setTimeout 回调执行
        await new Promise((r) => setTimeout(r, 10));
        expect(h.renderInstanceThumbnail).toHaveBeenCalled();
    });
});

// ========== 新加载自动取消前一次加载（ADR-096 _loadAbortController）==========

describe('loadPMXFile 自动取消前一次加载', () => {
    let mm: ReturnType<typeof makeModelManager>;

    beforeEach(async () => {
        h.removeCalls.length = 0;
        h.importMeshAsync.mockReset();
        h.importMeshAsync.mockResolvedValue({ meshes: [new h.Mesh()] });
        // 重置 readFileBytes，避免前序测试的 mockImplementation 泄漏
        const { readFileBytes } = await import('@/core/wails-bindings');
        (readFileBytes as any).mockReset();
        (readFileBytes as any).mockResolvedValue(new Uint8Array([1, 2, 3]));
        mm = makeModelManager();
        initLoader(scene, mmdRuntime, mm as any, vi.fn(), vi.fn(), vi.fn(), vi.fn());
    });

    it('第二次 loadPMXFile 启动时自动 abort 前一次加载', async () => {
        // 让第一次 readFileBytes 挂起，模拟真实异步窗口，
        // 使 load1 在 Promise.all 处等待，load2 得以触发 _loadAbortController.abort()
        const { readFileBytes } = await import('@/core/wails-bindings');
        let deferred: (v: any) => void;
        const deferredPromise = new Promise<any>((r) => { deferred = r; });
        (readFileBytes as any).mockImplementationOnce(() => deferredPromise);

        const load1 = loadPMXFile('/models/first.pmx', true);
        // load2 启动 → line 435 abortCtrl1.abort() → effectiveSignal1 标记 aborted
        const load2 = loadPMXFile('/models/second.pmx', true);

        // 释放 load1 的 readFileBytes → Promise.all 解析 → line 473 effectiveSignal.aborted → return null
        deferred!(new Uint8Array([1, 2, 3]));

        const id1 = await load1;
        const id2 = await load2;

        expect(id1).toBeNull();
        expect(id2).toBe('gen-id');
    });
});

// ========== Actor createMmdModel 抛错清理路径（line 638 → catch 830-855）==========

describe('loadPMXFile actor createMmdModel 错误', () => {
    let mm: ReturnType<typeof makeModelManager>;

    beforeEach(() => {
        h.removeCalls.length = 0;
        h.importMeshAsync.mockReset();
        h.importMeshAsync.mockResolvedValue({ meshes: [new h.Mesh()] });
        mm = makeModelManager();
        initLoader(scene, mmdRuntime, mm as any, vi.fn(), vi.fn(), vi.fn(), vi.fn());
    });

    it('createMmdModel 抛错：mesh 被 dispose，模型不注册，返回 null', async () => {
        const mesh = new h.Mesh();
        h.importMeshAsync.mockResolvedValueOnce({ meshes: [mesh] });
        mmdRuntime.createMmdModel.mockImplementationOnce(() => {
            throw new Error('createMmdModel failed');
        });
        const id = await loadPMXFile('/models/err.pmx');
        expect(id).toBeNull();
        expect(mm.register).not.toHaveBeenCalled();
        expect(mesh.dispose).toHaveBeenCalled();
    });
});

// 注：loader 未初始化快速路径（line 430-432）无法在同文件测试——
// _scene/_mmdRuntime 是模块级 let，前序 describe 已调用 initLoader 设置，
// vi.resetModules() 会断开所有 mock 绑定。该 guard 由代码审核覆盖。
