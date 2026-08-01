// [doc:adr-198] 场景序列化分段容错单元测试 — serializeScene()
// 覆盖 ADR-198 方向①：单个模型序列化抛错时跳过该条 + 记录，其余模型仍落盘（能存多少存多少）。
// 策略：重依赖统一空 mock（仅在序列化未走到的分支内使用）；让 computeLibraryRef 对特定
// filePath 抛错，模拟单个模型序列化过程崩溃，验证其余模型未受牵连。
import { describe, it, expect, vi, beforeEach } from 'vitest';
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
    getMatState: () => null,
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
vi.mock('../../scene/env/env-gravity', () => ({ getGravityStrength: () => 1, setGravityStrength: vi.fn() }));
vi.mock('../../outfit/audio', () => ({
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
vi.mock('../../core/wails-bindings', () => ({ SaveLastScene: vi.fn(() => Promise.resolve()), LoadLastScene: vi.fn(() => Promise.resolve(null)) }));
vi.mock('../../core/i18n/goerr', () => ({}));
vi.mock('../../scene/motion/vmd-loader', () => ({ loadCameraVmdFromPath: vi.fn(() => Promise.resolve()) }));
vi.mock('../../scene/scene-migrate', () => ({
    migratePerceptionData: (p: unknown) => p ?? null,
    migratePerceptionFromProcMotion: () => ({}),
}));
vi.mock('../../outfit/outfit', () => ({ loadOutfits: vi.fn(), applyOutfitVariant: vi.fn() }));
vi.mock('../../core/toast', () => ({ showInfoToast: vi.fn() }));
vi.mock('../../core/feedback', () => ({ feedbackError: vi.fn(), feedbackInfo: vi.fn() }));
vi.mock('../../core/logger', () => ({ logWarn: vi.fn() }));
vi.mock('../../core/async', () => ({ swallowError: vi.fn() }));
vi.mock('../../library/library-path', () => ({ resolveLibraryRef: () => '' }));
vi.mock('../../scene/manager/material', () => ({ _applyAll: vi.fn() }));
vi.mock('../../scene/env/env-time-of-day', () => ({ setEnvSunAngle: vi.fn() }));
vi.mock('../../scene/env/_bridge/env-persist', () => ({
    flushEnvState: vi.fn(),
    flushUIState: vi.fn(),
    cancelEnvPersistTimer: vi.fn(),
}));
vi.mock('../../scene/physics/ground-collision', () => ({ applyGroundCollision: vi.fn() }));
vi.mock('../../motion-algos/procedural-motion', () => ({ DEFAULT_PROC_STATE: {} }));
vi.mock('../../motion-algos/lipsync', () => ({ DEFAULT_LIPSYNC_STATE: {} }));

import { serializeScene, deserializeScene, triggerAutoSaveImpl } from '../../scene/scene-serialize';
import { setCameraState } from '../../scene/camera/camera';

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
});

describe('deserializeScene — suppress 泄漏防护（fix:suppress-leak）', () => {
    it('中途抛异常后 auto-save suppress 复位（finally 防泄漏）', async () => {
        // 让恢复过程中的一个 setter 抛错，模拟数据损坏导致的中途异常。
        vi.mocked(setCameraState).mockImplementationOnce(() => {
            throw new Error('simulated mid-deserialize setter failure');
        });
        const data = { version: 1, models: [], camera: {} } as never;

        await expect(deserializeScene(data)).rejects.toThrow('simulated mid-deserialize setter failure');

        // suppress 应已复位：triggerAutoSaveImpl 走正常分支（调度防抖），而非 suppressed 分支。
        const info = vi.spyOn(console, 'info').mockImplementation(() => {});
        triggerAutoSaveImpl();
        const logs = info.mock.calls.map((c) => String(c[0]));
        expect(logs.some((l) => l.includes('triggerAutoSaveImpl() called — debounce scheduled'))).toBe(true);
        expect(logs.some((l) => l.includes('suppressed'))).toBe(false);
        info.mockRestore();
        vi.mocked(setCameraState).mockReset();
    });
});
