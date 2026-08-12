// [doc:adr-198] 场景序列化分段容错单元测试 — serializeScene()
// 覆盖 ADR-198 方向①：单个模型序列化抛错时跳过该条 + 记录，其余模型仍落盘（能存多少存多少）。
// 策略：重依赖统一空 mock（仅在序列化未走到的分支内使用）；让 computeLibraryRef 对特定
// filePath 抛错，模拟单个模型序列化过程崩溃，验证其余模型未受牵连。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ModelInstance } from '../../core/types';

const registry = vi.hoisted(() => new Map<string, unknown>());

// computeLibraryRef 在 serializeModel 内每个模型开头即被调用；令其对含 'BOOM' 的路径抛错，
// 精准模拟“单个模型序列化过程崩溃”而不影响其余模型。
vi.mock('@/core/path', () => ({
    computeLibraryRef: (filePath: string) => {
        if (filePath.includes('BOOM')) {
            throw new Error('simulated per-model serialize failure');
        }
        return '';
    },
    normPath: (p: string) => p,
    getBaseName: (p: string) => p,
    getDirPath: (p: string) => p,
    isUnderRoot: () => false,
    isStageLike: () => false,
}));

vi.mock('../../core/config', () => ({
    computeLibraryRef: () => '',
    resolveLibraryRef: () => '',
    libraryRoot: '',
    envState: {},
    modelRegistry: registry,
    showErrorToast: vi.fn(),
    setStatus: vi.fn(),
    triggerAutoSave: vi.fn(),
}));

vi.mock('../../core/i18n/t', () => ({ t: (k: string) => k }));

// 顶层各字段 getter：返回安全默认值，使 serializeScene 的非模型部分不抛错。
vi.mock('../../scene/scene', () => ({
    getLightState: () => ({}),
    setLightState: vi.fn(),
    getStageLights: () => [],
    loadStageLights: vi.fn(),
    getRenderState: () => ({}),
    setRenderState: vi.fn(),
    removeModel: vi.fn(),
    loadPMXFile: vi.fn(),
    modelManager: {
        setPosition: vi.fn(),
        setOrbit: vi.fn(),
        setScaling: vi.fn(),
        setRotation: vi.fn(),
        setRotationY: vi.fn(),
        reattachAllAttachments: vi.fn(),
        focused: vi.fn(() => null),
    },
    setModelBoneLinesVis: vi.fn(),
    setModelBoneJointsVis: vi.fn(),
    setModelPhysics: vi.fn(),
    getPhysicsCatState: () => null,
    setPhysicsCategory: vi.fn(),
    loadVMDFromPath: vi.fn(),
    getMatState: vi.fn(() => null),
    applyMatState: vi.fn(),
    getActiveFormation: () => null,
    getActiveFormationSpacing: () => 0,
    setModelFormation: vi.fn(),
    disposeScene: vi.fn(),
}));
vi.mock('../../scene/camera/camera', () => ({
    getCameraState: () => ({}),
    setCameraState: vi.fn(),
    hasCameraVmd: () => false,
    getCameraVmdPath: () => '',
    getCameraVmdName: () => '',
    getCameraMode: () => 'orbit',
    setFov: vi.fn(),
    switchCameraMode: vi.fn(),
    logCameraAlpha: vi.fn(),
}));
vi.mock('../../scene/motion/proc-motion-bridge', () => ({
    getProcMotionState: () => ({}),
    regenerateProcMotion: vi.fn(),
    setProcMotionState: vi.fn(),
}));
vi.mock('../../scene/motion/lipsync-bridge', () => ({
    getLipSyncState: () => ({}),
    setLipSyncState: vi.fn(),
}));
vi.mock('../../scene/motion/perception', () => ({
    getPerceptionState: () => ({}),
    getPinnedModelIds: () => [],
    getPerceptionStateFor: () => ({}),
    getAllPerceptionStates: () => [],
    restorePerceptionStateFor: vi.fn(),
    getPerceptionPerfManualTier: () => null,
    isAllPerceptionEnabled: () => false,
    setPerceptionState: vi.fn(),
    pinPerception: vi.fn(),
    setPerceptionPerfTier: vi.fn(),
    enableAllPerception: vi.fn(),
    activatePerception: vi.fn(),
}));
vi.mock('../../scene/motion/animation-retargeter', () => ({
    getRetargetPlayState: () => null,
    restoreRetargetAnimation: vi.fn(() => Promise.resolve()),
}));
vi.mock('../../scene/render/lighting-follow', () => ({
    getPersonalLightState: () => null,
    DEFAULT_PERSONAL_LIGHT: {},
}));
vi.mock('../../scene/motion/motion-intent', () => ({
    getActiveMotionId: () => null,
    getSceneMotions: () => [],
    getLoadedProceduralMotions: () => [],
    addSceneMotion: vi.fn(() => 'id'),
    setDefaultMotion: vi.fn(),
    clearAllSceneMotions: vi.fn(),
    setLoadedProceduralMotions: vi.fn(),
}));
vi.mock('../../scene/env/env-gravity', () => ({
    getGravityStrength: () => 1,
    setGravityStrength: vi.fn(),
}));
vi.mock('@/core/audio', () => ({
    getAudioName: () => '',
    getAudioPath: () => '',
    getVolume: () => 0,
    getAudioOffset: () => 0,
    isAudioPlaying: () => false,
    loadAudioFile: vi.fn(() => Promise.resolve()),
    setVolume: vi.fn(),
    setAudioOffset: vi.fn(),
    resumeAudio: vi.fn(),
}));

// 其余重依赖：空 mock（序列化路径不触发）。
vi.mock('../../core/wails-bindings', () => ({
    SaveLastScene: vi.fn(() => Promise.resolve()),
    LoadLastScene: vi.fn(() => Promise.resolve(null)),
}));
vi.mock('../../core/i18n/goerr', () => ({}));
vi.mock('../../scene/motion/vmd-loader', () => ({
    loadCameraVmdFromPath: vi.fn(() => Promise.resolve()),
}));
vi.mock('../../scene/scene-migrate', () => ({
    migratePerceptionData: (p: unknown) => p ?? null,
    migratePerceptionFromProcMotion: () => ({}),
}));
vi.mock('@/scene/manager/outfit', () => ({ loadOutfits: vi.fn(), applyOutfitVariant: vi.fn() }));
vi.mock('../../core/toast', () => ({ showInfoToast: vi.fn() }));
vi.mock('../../core/feedback', () => ({ feedbackError: vi.fn(), feedbackInfo: vi.fn() }));
vi.mock('../../core/logger', () => ({ logWarn: vi.fn() }));
vi.mock('../../core/async', () => ({ swallowError: vi.fn() }));
vi.mock('@/core/library-path', () => ({ resolveLibraryRef: () => '' }));
vi.mock('../../scene/manager/material', () => ({
    _applyAll: vi.fn(),
    getMatCatGroups: vi.fn(() => new Map()),
}));
vi.mock('../../scene/env/env-time-of-day', () => ({ setEnvSunAngle: vi.fn() }));
vi.mock('../../scene/env/_bridge/env-persist', () => ({
    flushEnvState: vi.fn(),
    flushUIState: vi.fn(),
    cancelEnvPersistTimer: vi.fn(),
}));
vi.mock('../../scene/physics/ground-collision', () => ({ applyGroundCollision: vi.fn() }));
vi.mock('../../motion-algos/procedural-motion', () => ({
    DEFAULT_PROC_STATE: {},
    migrateProcState: (raw: unknown) => (raw ?? {}) as object,
}));
vi.mock('../../motion-algos/lipsync', () => ({ DEFAULT_LIPSYNC_STATE: {} }));

import { serializeScene, deserializeScene, triggerAutoSaveImpl, tryRestoreLastScene } from '../../scene/scene-serialize';
import { LoadLastScene } from '../../core/wails-bindings';
import { setCameraState } from '../../scene/camera/camera';
import { getMatState, applyMatState, loadPMXFile } from '../../scene/scene';
import {
    setMatSssParams,
    disposeModelSssState,
    getMatSssState,
} from '../../scene/manager/material-sss';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';

/** 构造序列化所需的最小 ModelInstance；未读到的字段用 as 断言省略。 */
function makeModel(id: string, name: string, filePath: string): ModelInstance {
    return {
        id,
        name,
        filePath,
        kind: 'actor',
        meshes: [{ position: { x: 0, y: 0, z: 0 } }],
        scaling: 1,
        rotationY: 0,
        rotation: [0, 0, 0],
        visible: true,
        opacity: 1,
        wireframe: false,
        showBoneLines: false,
        showBoneJoints: false,
        physicsEnabled: true,
        vmdPath: null,
        vmdName: '',
        vmdLayers: [],
        boneOverrides: [],
    } as unknown as ModelInstance;
}

beforeEach(() => {
    registry.clear();
});

describe('serializeScene — 分段容错（ADR-198 方向①）', () => {
    it('单个模型序列化抛错时跳过该条，其余模型仍落盘', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        registry.set('a', makeModel('a', '模型甲', '/models/a.pmx'));
        registry.set('b', makeModel('b', '模型乙', '/models/BOOM.pmx')); // 序列化会抛错
        registry.set('c', makeModel('c', '模型丙', '/models/c.pmx'));

        const scene = serializeScene();

        // 抛错的模型乙被跳过，甲/丙仍落盘
        const names = scene.models.map((m) => m.name);
        expect(names).toEqual(['模型甲', '模型丙']);
        expect(scene.models).toHaveLength(2);
        warn.mockRestore();
    });

    it('全部模型正常时不丢任何条目', () => {
        registry.set('a', makeModel('a', '模型甲', '/models/a.pmx'));
        registry.set('b', makeModel('b', '模型乙', '/models/b.pmx'));

        const scene = serializeScene();

        expect(scene.models.map((m) => m.name)).toEqual(['模型甲', '模型乙']);
    });

    it('空场景（无模型）序列化返回空 models 数组', () => {
        const scene = serializeScene();
        expect(scene.models).toEqual([]);
        expect(scene.version).toBe(1);
    });

    it('包含 SSS 状态时序列化到 materialSssCategories', () => {
        registry.set('a', makeModel('a', '模型甲', '/models/a.pmx'));
        setMatSssParams('a', '皮肤', {
            sssPower: 0.8,
            sssColor: new Color3(1, 0.6, 0.4),
            sssDistance: 0.3,
        });

        // 覆盖 getMatState mock：serializeModel 通过 getMatState(inst.id) 读取 SSS 数据，
        // 但顶层 mock 固定返回 null。此处用 mockImplementationOnce 从真实 _sssState 取数。
        vi.mocked(getMatState).mockImplementationOnce((id: string) => {
            const sssState = getMatSssState(id);
            if (!sssState) return null;
            return { categories: {}, overrides: {}, enabled: {}, ...sssState };
        });

        const scene = serializeScene();
        expect(scene.models).toHaveLength(1);
        expect(scene.models[0].materialSssCategories).toBeDefined();
        expect(scene.models[0].materialSssCategories!['皮肤'].sssPower).toBe(0.8);
        expect(scene.models[0].materialSssCategories!['皮肤'].sssDistance).toBe(0.3);

        disposeModelSssState('a');
    });

    it('无 SSS 状态时 materialSssCategories 不出现在序列化中', () => {
        registry.set('a', makeModel('a', '模型甲', '/models/a.pmx'));
        const scene = serializeScene();
        expect(scene.models[0].materialSssCategories).toBeUndefined();
    });

    it('P2#3 回归：serializeScene 序列化 per-model procMotion（per-mode 参数落盘）', () => {
        const model = makeModel('a', '模型甲', '/models/a.pmx');
        (model as any).procMotion = {
            mode: 'idle',
            bpmQuantizeEnabled: true,
            eyeTrackingEnabled: true,
            headTrackingEnabled: true,
            params: {
                idle: { intensity: 0.9, speed: 0.7 },
                autodance: { intensity: 0.3, speed: 1.6 },
            },
        };
        registry.set('a', model);

        const scene = serializeScene();
        expect(scene.models).toHaveLength(1);
        expect(scene.models[0].procMotion).toBeDefined();
        expect((scene.models[0].procMotion as any).mode).toBe('idle');
        expect((scene.models[0].procMotion as any).params.idle.intensity).toBe(0.9);
        expect((scene.models[0].procMotion as any).params.autodance.speed).toBe(1.6);
    });

    it('P2#3 回归：serializeScene 深拷贝 procMotionModules（undo 快照不污染运行时）', () => {
        const model = makeModel('a', '模型甲', '/models/a.pmx');
        (model as any).procMotionModules = {
            idle: [{ id: 'body-posture', enabled: true, params: { tilt: 5 } }],
        };
        registry.set('a', model);

        const scene = serializeScene();
        expect(scene.models[0].procMotionModules).toBeDefined();
        expect((scene.models[0].procMotionModules as any).idle).toEqual([
            { id: 'body-posture', enabled: true, params: { tilt: 5 } },
        ]);

        // 修改快照不应污染运行时 procMotionModules（引用隔离）
        (scene.models[0].procMotionModules as any).idle[0].params.tilt = 99;
        expect((model as any).procMotionModules.idle[0].params.tilt).toBe(5);
    });
});

describe('deserializeScene — suppress 泄漏防护（fix:suppress-leak）', () => {
    it('中途抛异常后 auto-save suppress 复位（finally 防泄漏）', async () => {
        // 让恢复过程中的一个 setter 抛错，模拟数据损坏导致的中途异常。
        vi.mocked(setCameraState).mockImplementationOnce(() => {
            throw new Error('simulated mid-deserialize setter failure');
        });
        const data = { version: 1, models: [], camera: {} } as never;

        await expect(deserializeScene(data)).rejects.toThrow(
            'simulated mid-deserialize setter failure'
        );

        // suppress 应已复位：triggerAutoSaveImpl 走正常分支（调度防抖），而非 suppressed 分支。
        const info = vi.spyOn(console, 'info').mockImplementation(() => {});
        triggerAutoSaveImpl();
        const logs = info.mock.calls.map((c) => String(c[0]));
        expect(
            logs.some((l) => l.includes('triggerAutoSaveImpl() called — debounce scheduled'))
        ).toBe(true);
        expect(logs.some((l) => l.includes('suppressed'))).toBe(false);
        info.mockRestore();
        vi.mocked(setCameraState).mockReset();
    });

    it('tryRestoreLastScene — env 恢复 try/finally 复位 suppress（fix:suppress-leak）', async () => {
        vi.mocked(LoadLastScene).mockResolvedValueOnce(
            JSON.stringify({ version: 1, models: [], env: { time: 12 } })
        );
        await tryRestoreLastScene();
        const info = vi.spyOn(console, 'info').mockImplementation(() => {});
        triggerAutoSaveImpl();
        const logs = info.mock.calls.map((c) => String(c[0]));
        expect(logs.some((l) => l.includes('triggerAutoSaveImpl() called — debounce scheduled'))).toBe(true);
        expect(logs.some((l) => l.includes('suppressed'))).toBe(false);
        info.mockRestore();
        vi.mocked(LoadLastScene).mockReset();
    });

    it('deserializeScene 恢复 SSS materialSssCategories', async () => {
        vi.mocked(loadPMXFile).mockResolvedValueOnce('test-sss-id');
        registry.set('test-sss-id', makeModel('test-sss-id', '模型SSS', '/models/sss.pmx'));

        const data = {
            version: 1,
            models: [{
                name: '模型SSS',
                filePath: '/models/sss.pmx',
                kind: 'actor' as const,
                materialSssCategories: {
                    '皮肤': { sssPower: 0.8, sssColor: { r: 1, g: 0.6, b: 0.4 }, sssDistance: 0.3 },
                },
            }],
            camera: {},
        } as never;

        await deserializeScene(data);

        expect(vi.mocked(applyMatState)).toHaveBeenCalledWith(
            'test-sss-id',
            expect.objectContaining({
                sssCategories: { '皮肤': { sssPower: 0.8, sssColor: { r: 1, g: 0.6, b: 0.4 }, sssDistance: 0.3 } },
            }),
        );
    });

    it('P2#3 回归：deserializeScene 恢复 per-model procMotion（挂载到 inst，走 migrateProcState 入口）', async () => {
        vi.mocked(loadPMXFile).mockResolvedValueOnce('test-proc-id');
        const inst = makeModel('test-proc-id', '模型Proc', '/models/proc.pmx');
        registry.set('test-proc-id', inst);

        const data = {
            version: 1,
            models: [{
                name: '模型Proc',
                filePath: '/models/proc.pmx',
                kind: 'actor' as const,
                // 嵌套结构（migrateProcState 在本测试被 mock 为恒等透传；迁移细节见 proc-motion-migrate.test.ts）
                procMotion: {
                    mode: 'idle',
                    params: {
                        idle: { intensity: 0.9, speed: 1.4 },
                        autodance: { intensity: 0.3 },
                    },
                },
            }],
            camera: {},
        } as never;

        await deserializeScene(data);

        const restored = (inst as any).procMotion;
        expect(restored).toBeDefined();
        expect(restored.mode).toBe('idle');
        expect(restored.params.idle.intensity).toBe(0.9);
        expect(restored.params.autodance.intensity).toBe(0.3);
    });

    it('P2#3 回归：deserializeScene 恢复 per-proc 模块配置（合法 + 畸形降级）', async () => {
        vi.mocked(loadPMXFile).mockResolvedValueOnce('test-procmod-id');
        const inst = makeModel('test-procmod-id', '模型ProcMod', '/models/procmod.pmx');
        registry.set('test-procmod-id', inst);

        const data = {
            version: 1,
            models: [{
                name: '模型ProcMod',
                filePath: '/models/procmod.pmx',
                kind: 'actor' as const,
                procMotionModules: {
                    // 合法：idle 有完整模块状态
                    idle: [{ id: 'body-posture', enabled: true, params: { tilt: 5 } }],
                    // 畸形：autodance 值为字符串 → 应被丢弃
                    autodance: 'garbage',
                    // 畸形：元素缺 id → 过滤
                    mixed: [{ nope: true }, { id: 'left-hand', enabled: false, params: {} }],
                },
            }],
            camera: {},
        } as never;

        await deserializeScene(data);

        const restored = (inst as any).procMotionModules;
        expect(restored).toBeDefined();
        // idle 完整保留
        expect(restored.idle).toEqual([{ id: 'body-posture', enabled: true, params: { tilt: 5 } }]);
        // autodance 字符串被丢弃
        expect(restored.autodance).toBeUndefined();
        // mixed 仅保留含 id 的元素
        expect(restored.mixed).toEqual([{ id: 'left-hand', enabled: false, params: {} }]);
    });

    it('P2#3 回归：procMotionModules 缺失/空对象时 inst 不挂载（旧存档兼容）', async () => {
        vi.mocked(loadPMXFile).mockResolvedValueOnce('test-procmod-none');
        const inst = makeModel('test-procmod-none', '模型None', '/models/none.pmx');
        registry.set('test-procmod-none', inst);

        const data = {
            version: 1,
            models: [{
                name: '模型None',
                filePath: '/models/none.pmx',
                kind: 'actor' as const,
                // 无 procMotionModules 字段（旧存档）
            }],
            camera: {},
        } as never;

        await deserializeScene(data);

        expect((inst as any).procMotionModules).toBeUndefined();
    });

    it('deserializeScene PBRMaterial wireframe 恢复', async () => {
        vi.mocked(loadPMXFile).mockResolvedValueOnce('test-pbr-id');
        // 用 Object.create 绕过 PBRMaterial 构造函数（需要 Babylon.js Engine），
        // 再用 defineProperty 覆盖 wireframe setter（继承自 Material，调用 markAsDirty 依赖 _scene）
        const pbrMat = Object.create(PBRMaterial.prototype) as PBRMaterial;
        Object.defineProperty(pbrMat, 'wireframe', { value: false, writable: true, configurable: true });
        const model = makeModel('test-pbr-id', '模型PBR', '/models/pbr.pmx');
        model.meshes = [{ position: { x: 0, y: 0, z: 0 }, material: pbrMat }] as never;
        registry.set('test-pbr-id', model);

        const data = {
            version: 1,
            models: [{
                name: '模型PBR',
                filePath: '/models/pbr.pmx',
                kind: 'actor' as const,
                wireframe: true,
            }],
            camera: {},
        } as never;

        await deserializeScene(data);

        expect(pbrMat.wireframe).toBe(true);
    });
});

describe('serialize → deserialize round-trip（procMotionModules 无损往返）', () => {
    // 放在文件末尾：deserializeScene 有全局副作用（模块/material 状态），
    // 提前执行会污染后续 deserialize 测试（顺序依赖），故置于末尾。
    it('P2#3 回归：round-trip 一致性（合法 procMotionModules 序列化→反序列化无损）', async () => {
        vi.mocked(loadPMXFile).mockResolvedValueOnce('roundtrip-procmod');
        const inst = makeModel('roundtrip-procmod', '模型RoundTrip', '/models/rt.pmx');
        (inst as any).procMotionModules = {
            idle: [{ id: 'body-posture', enabled: true, params: { tilt: 5, footHeight: 0.3 } }],
            autodance: [{ id: 'left-hand', enabled: false, params: {} }],
        };
        registry.set('roundtrip-procmod', inst);

        // 序列化 → 深拷贝落盘（模拟 structuredClone + JSON 存取）。
        // 仅取 models 落盘，剥离 env（serializeScene 的 env 输出本身不对称，见既有 deserialize 测试均用 camera:{}）。
        const scene = serializeScene();
        const serialized = JSON.parse(JSON.stringify(scene));
        const data = { version: 1, models: serialized.models, camera: {} };

        // 清空运行时存储，模拟恢复全新场景
        registry.clear();
        vi.mocked(loadPMXFile).mockResolvedValueOnce('roundtrip-procmod');
        const restoredInst = makeModel('roundtrip-procmod', '模型RoundTrip', '/models/rt.pmx');
        registry.set('roundtrip-procmod', restoredInst);

        await deserializeScene(data as never);

        expect((restoredInst as any).procMotionModules).toEqual((inst as any).procMotionModules);
    });
});

afterEach(() => {
    vi.restoreAllMocks();
});
