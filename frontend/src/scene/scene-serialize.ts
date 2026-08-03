// [doc:architecture] Scene Serialization — 场景序列化与自动保存
// 规范文档: docs/architecture.md §场景序列化
// 职责: SceneFile 定义、serialize/deserialize、auto-save debounce、last-scene restore
// 注意: 从 scene.ts 静态导入但仅在函数体内访问，ES module live binding 保证安全。

import { SaveLastScene, LoadLastScene } from '../core/wails-bindings';
import { t } from '../core/i18n/t';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';

import { libraryRoot, envState, EnvState, modelRegistry } from '../core/config';
import { showInfoToast } from '../core/toast';
import { feedbackError, feedbackInfo } from '../core/feedback';
import { debounce } from '../core/debounce';
import { swallowError } from '../core/async';
import { computeLibraryRef } from '@/core/path';
import type { ModelInstance } from '../core/types';
import { resolveLibraryRef } from '../library/library-path';
import { logWarn } from '../core/logger';
import {
    getActiveMotionId,
    getSceneMotions,
    addSceneMotion,
    setDefaultMotion,
    clearAllSceneMotions,
    getLoadedProceduralMotions,
    setLoadedProceduralMotions,
} from './motion/motion-intent';
import type { LoadableProcId } from './motion/motion-intent';
import {
    getCameraState,
    setCameraState,
    hasCameraVmd,
    getCameraVmdPath,
    getCameraVmdName,
    getCameraMode,
    switchCameraMode,
    setFov,
    logCameraAlpha,
} from './camera/camera';
import { loadCameraVmdFromPath } from './motion/vmd-loader';
import type { CameraState } from './camera/camera';
import { migratePerceptionFromProcMotion, migratePerceptionData } from './scene-migrate';
// [doc:adr-238] outfit 操作经 scene-action-bridge（outfit 注册）
import { getSceneAction } from '@/core/scene-action-bridge';

import {
    getLightState,
    setLightState,
    getStageLights,
    loadStageLights,
    getRenderState,
    setRenderState,
    removeModel,
    loadPMXFile,
    modelManager,
    setModelBoneLinesVis,
    setModelBoneJointsVis,
    setModelPhysics,
    getPhysicsCatState,
    setPhysicsCategory,
    loadVMDFromPath,
    getMatState,
    applyMatState,
    LightState,
    StageLightState,
    RenderState,
    FormationType,
    getActiveFormation,
    getActiveFormationSpacing,
    setModelFormation,
    disposeScene,
} from './scene';
import { _applyAll, type AlphaCtx, type MaterialCategoryParams } from './manager/material';
import {
    getMatSssState,
    applyMatSssState,
    type SssParams,
} from './manager/material-sss';

import { setEnvState } from './env/_bridge/env-bridge';
import { setEnvSunAngle } from './env/env-time-of-day';
import { flushEnvState, flushUIState, cancelEnvPersistTimer } from './env/_bridge/env-persist';
import { setGravityStrength, getGravityStrength } from './env/env-gravity';
import { applyGroundCollision } from './physics/ground-collision';
import {
    regenerateProcMotion,
    getProcMotionState,
    setProcMotionState,
} from './motion/proc-motion-bridge';
import { getLipSyncState, setLipSyncState } from './motion/lipsync-bridge';

import { migrateProcState } from '../motion-algos/procedural-motion';
import { DEFAULT_LIPSYNC_STATE } from '../motion-algos/lipsync';
import type { ProcMotionState } from '../motion-algos/procedural-motion';
import type { LipSyncState as LipSyncStateType } from '../motion-algos/lipsync';
import type {
    BoneOverrideEntry,
    MotionModuleState,
    MotionPreset,
    ProcMotionConfig,
    ProcPreset,
} from '../core/types';
import {
    getPerceptionState,
    setPerceptionState,
    activatePerception,
    getPinnedModelIds,
    getPerceptionStateFor,
    pinPerception,
    enableAllPerception,
    setPerceptionPerfTier,
    getPerceptionPerfManualTier,
    isAllPerceptionEnabled,
    type PerceptionState,
} from './motion/perception';
import { getRetargetPlayState, restoreRetargetAnimation } from './motion/animation-retargeter';
import {
    getPersonalLightState,
    restorePersonalLights,
    DEFAULT_PERSONAL_LIGHT,
} from './render/lighting-follow';

// ======== Utilities ========

/**
 * Resolve a file path from either a libraryRef or a raw absolute path.
 * Returns the resolved absolute path, or null if neither source is valid.
 * This centralizes the "(libraryRef ? resolveLibraryRef(...) : null) || filePath" pattern
 * that appears repeatedly in serialize/deserialize.
 */
export function resolvePathFromRef(filePath: string, libraryRef?: string): string | null {
    if (libraryRef) {
        const resolved = resolveLibraryRef(libraryRef);
        if (resolved) {
            return resolved;
        }
    }
    return filePath || null;
}

// ======== Scene File Format ========

export interface SceneFile {
    version: 1;
    models: Array<{
        filePath: string;
        libraryRef?: string;
        /** Stable unique identifier for this model. Persisted to survive re-load cycles.
         *  When absent during restore, a new UUID is generated. */
        uuid?: string;
        name: string;
        kind: 'actor' | 'stage';
        vmdPath: string | null;
        vmdLibraryRef?: string;
        vmdName: string;
        vmdLayers?: {
            name: string;
            path: string | null;
            weight: number;
            boneFilter: string[];
            kind?: 'vmd' | 'gaze';
            enabled?: boolean;
        }[];
        positionX: number;
        positionY?: number;
        positionZ?: number;
        scaling?: number;
        rotationY?: number;
        /** [doc:adr-126] 全自由度旋转（欧拉角弧度）：[x, y, z]；缺省回退 rotationY */
        rotation?: [number, number, number];
        visible?: boolean;
        opacity?: number;
        wireframe?: boolean;
        showBoneLines?: boolean;
        showBoneJoints?: boolean;
        physicsEnabled?: boolean;
        /** [fix:physics-cat-persist] 物理分类开关（仅存 false 项，默认开不落盘） */
        physicsCategories?: Record<string, boolean>;
        outfitVariant?: string;
        /** [doc:adr-049] 球面坐标轨道控制：坐标模式，缺省按 'cartesian' 处理 */
        positionMode?: 'cartesian' | 'orbit';
        orbitAzimuth?: number;
        orbitElevation?: number;
        orbitDistance?: number;
        /** [doc:adr-061] Motion Override — 逐骨骼覆盖条目 */
        boneOverrides?: BoneOverrideEntry[];
        /** [doc:adr-116] 动作覆盖模块语义状态（per-model，序列化语义参数而非骨骼级覆盖） */
        motionOverrideModules?: MotionModuleState[];
        /** [doc:adr-145] 动作预设列表 */
        motionPresets?: MotionPreset[];
        /** [audit] 程序化动作自定义预设列表（per-model 参数快照） */
        procPresets?: ProcPreset[];
        /** [doc:adr-233] per-model 程序化动作状态（per-mode 独立参数），序列化/恢复时过 migrateProcState */
        procMotion?: Partial<ProcMotionState>;
        /** [doc:adr-121] 双槽位动作分配（仅 primary.source==='pinned' 落盘，inherit 不落盘） */
        motionSlots?: {
            primary: {
                source: 'pinned';
                pinned: {
                    vmdPath: string | null;
                    vmdName: string;
                    vmdLayers: Array<{
                        name: string;
                        path: string | null;
                        weight: number;
                        boneFilter: string[];
                        kind?: 'vmd' | 'gaze';
                        enabled?: boolean;
                    }>;
                    source: 'vmd' | 'retargeted';
                };
            };
        };
        /** @deprecated 旧格式 motionAssignment，反序列化时迁移到 motionSlots */
        motionAssignment?: {
            mode: 'pinned';
            pinned: {
                vmdPath: string | null;
                vmdName: string;
                vmdLayers: Array<{
                    name: string;
                    path: string | null;
                    weight: number;
                    boneFilter: string[];
                    kind?: 'vmd' | 'gaze';
                    enabled?: boolean;
                }>;
                source: 'vmd' | 'retargeted';
            };
        };
        /** [fix:material-persist] 材质状态（分类调整 + 逐材质覆盖 + 启用标记）。
         *  - categories: 6 类（皮肤/头发/眼睛/服装/配件/道具）的标量乘率
         *  - overrides: 按 matIndex 索引的逐材质覆盖（同模型才有效，跨模型靠 categories 兜底）
         *  - enabled: 按 matIndex 索引的可见性开关 */
        materialCategories?: Record<string, MaterialCategoryParams>;
        materialOverrides?: Record<number, MaterialCategoryParams>;
        materialEnabled?: Record<number, boolean>;
        /** ADR-188: SSS 次表面散射参数（按分类索引） */
        materialSssCategories?: Record<string, SssParams>;
        /** [doc:adr-168] 个人灯设置（仅 actor 类型模型；缺省 = 默认值） */
        personalLight?: Partial<import('./render/lighting-follow').PersonalLightSettings>;
        /** [doc:adr-215] 附属到父模型的稳定标识（ADR-193 uuid） */
        parentId?: string;
        /** [doc:adr-215] 附属到的骨骼名 */
        attachedBone?: string;
        /** [doc:adr-215] 骨骼局部偏移 (x, y, z) */
        attachedOffset?: [number, number, number];
        /** [doc:adr-215] 骨骼局部旋转（欧拉角度）[pitch, yaw, roll] */
        attachedRotation?: [number, number, number];
    }>;
    camera: CameraState;
    lights: LightState;
    render?: RenderState;
    env?: EnvState;
    cameraVmd?: {
        path: string;
        libraryRef?: string;
        name: string;
        active: boolean;
    };
    audio?: {
        path: string;
        libraryRef?: string;
        name: string;
        volume: number;
        offset: number;
        playing: boolean;
    };
    procMotion?: ProcMotionState;
    /** [doc:adr-071] 感知层状态（呼吸/眨眼/视线追踪），独立于程序化动作 */
    /** [doc:adr-162] Phase 4: 新格式 { focused: PerceptionState, pinned: Array<{ modelId }> } */
    /** [doc:adr-164] 新增 tier + allEnabled */
    /** [fix:P3] 场景级存储：pinned 仅白名单 id，参数统一 focused 单例 */
    perception?:
        | PerceptionState
        | {
              focused: PerceptionState;
              pinned: Array<{ modelId: string; state?: PerceptionState }>;
              tier?: 'high' | 'medium' | 'low' | 'auto';
              allEnabled?: boolean;
          };
    lipSync?: LipSyncStateType;
    gravityStrength?: number;
    /** [doc:adr-054] Active formation preset (re-computed on load). */
    formation?: {
        type: FormationType;
        spacing: number;
    };
    stageLight?: StageLightState;
    stageLights?: StageLightState[];
    /** [doc:adr-167] 场景级动作库（持久化，加载时还原）
     *  新格式：sceneMotions + activeMotionId（多主动作平等共存）
     *  旧格式：vmdPath/vmdName/vmdLayers/...（单例；仅反序列化时识别并迁移）
     *  所有字段皆可选以支持新/旧格式共存。 */
    motion?: {
        // ── 新格式字段（ADR-167）──
        sceneMotions?: Array<{
            id?: string;
            vmdPath?: string | null;
            vmdName?: string;
            vmdLayers?: Array<{
                name: string;
                path: string | null;
                weight: number;
                boneFilter: string[];
                kind?: 'vmd' | 'gaze';
                enabled?: boolean;
            }>;
            source?: 'vmd' | 'retargeted';
            motionModules?: MotionModuleState[];
            procMotion?: Partial<ProcMotionState>;
        }>;
        activeMotionId?: string | null;
        // [doc:adr-207] 程序化动作可加载集合
        loadedProceduralMotions?: string[];
        // ── 旧格式字段（ADR-121；仅反序列化兼容，新存档不写）──
        vmdPath?: string | null;
        vmdName?: string;
        vmdLayers?: Array<{
            name: string;
            path: string | null;
            weight: number;
            boneFilter: string[];
            kind?: 'vmd' | 'gaze';
            enabled?: boolean;
        }>;
        source?: 'vmd' | 'retargeted';
        motionModules?: MotionModuleState[];
        procMotion?: Partial<ProcMotionState>;
    } | null;
    /** [doc:adr-108] 当前活跃的 retarget 动画状态（外部动作重定向）。
     *  仅存储源文件路径和骨骼映射预设；AnimationGroup 不可序列化，
     *  反序列化时需重新执行 loadAndRetargetAnimation。 */
    retarget?: {
        filePath: string;
        libraryRef?: string;
        boneMapPreset: string;
    } | null;
}

// ======== Serialization ========

/** [doc:adr-198] 单个模型条目的序列化——从 serializeScene 的 map 回调抽出，
 *  使每个模型可被独立 try/catch 包裹：单个模型序列化抛错时跳过该条并记录，
 *  而非让整次序列化崩溃导致本次自动保存整体丢失（能存多少存多少）。 */
function serializeModel(inst: ModelInstance): SceneFile['models'][number] {
    // [doc:stable-identity] runtime id 即稳定 uuid，直接持久化；恢复时以相同 uuid 重建实例，
    // 使材质/outfit/个人灯等按此 id 落盘的状态可跨会话还原。
    const uuid = inst.id;
    return {
        filePath: inst.filePath,
        libraryRef: computeLibraryRef(inst.filePath, libraryRoot) || undefined,
        uuid,
        name: inst.name,
        kind: inst.kind,
        vmdPath: inst.vmdPath,
        vmdLibraryRef: inst.vmdPath
            ? computeLibraryRef(inst.vmdPath, libraryRoot) || undefined
            : undefined,
        vmdName: inst.vmdName,
        vmdLayers:
            inst.vmdLayers.length > 0
                ? inst.vmdLayers.map((l) => ({
                      kind: l.kind,
                      name: l.name,
                      path: l.path,
                      weight: l.weight,
                      boneFilter: l.boneFilter,
                      enabled: l.enabled,
                  }))
                : undefined,
        positionX: inst.meshes[0]?.position.x ?? 0,
        positionY: inst.meshes[0]?.position.y ?? 0,
        positionZ: inst.meshes[0]?.position.z ?? 0,
        scaling: inst.scaling,
        rotationY: inst.rotationY,
        rotation: inst.rotation,
        visible: inst.visible,
        opacity: inst.opacity,
        wireframe: inst.wireframe,
        showBoneLines: inst.showBoneLines,
        showBoneJoints: inst.showBoneJoints,
        physicsEnabled: inst.physicsEnabled,
        // [fix:physics-cat-persist] 落盘物理分类开关（仅存 false 项，避免默认值噪声）
        ...(() => {
            const pcs = getPhysicsCatState(inst.id);
            if (!pcs) {
                return {};
            }
            const diff: Record<string, boolean> = {};
            for (const [cat, enabled] of Object.entries(pcs)) {
                if (!enabled) {
                    diff[cat] = false;
                }
            }
            return Object.keys(diff).length > 0 ? { physicsCategories: diff } : {};
        })(),
        outfitVariant: inst.activeVariant,
        positionMode: inst.positionMode,
        orbitAzimuth: inst.orbitAzimuth,
        orbitElevation: inst.orbitElevation,
        orbitDistance: inst.orbitDistance,
        boneOverrides: inst.boneOverrides.length > 0 ? inst.boneOverrides : undefined,
        // [doc:adr-116] 序列化模块语义状态（仅存 enabled + params 差异值，默认值不落盘）
        motionOverrideModules:
            inst.motionOverrideModules && inst.motionOverrideModules.length > 0
                ? inst.motionOverrideModules
                : undefined,
        // [doc:adr-145] 序列化动作预设
        motionPresets:
            inst.motionPresets && inst.motionPresets.length > 0 ? inst.motionPresets : undefined,
        // [doc:adr-233] 序列化 per-model 程序化动作状态（per-mode 独立参数，仅非默认时落盘）
        // [fix:P3] 深拷贝：浅拷贝会让快照的 params.*.boneToggles 与运行时状态共引用，
        // 快照若驻留内存（undo）会被后续编辑回写污染。
        procMotion: inst.procMotion ? structuredClone(inst.procMotion) : undefined,
        // [audit] 序列化程序化自定义预设（参数快照，深拷贝防与运行时共引用）
        procPresets:
            inst.procPresets && inst.procPresets.length > 0
                ? structuredClone(inst.procPresets)
                : undefined,
        // [doc:adr-121] 序列化 primary 槽位（仅 source==='pinned' 落盘）
        // [doc:adr-167] overlay 槽位已移除（ADR-144 废弃）
        motionSlots: (() => {
            const primary =
                inst.motionSlots?.primary.source === 'pinned'
                    ? {
                          source: 'pinned' as const,
                          pinned: {
                              vmdPath: inst.motionSlots.primary.pinned?.vmdPath ?? null,
                              vmdName: inst.motionSlots.primary.pinned?.vmdName ?? '',
                              vmdLayers:
                                  inst.motionSlots.primary.pinned?.vmdLayers.map((l) => ({
                                      kind: l.kind,
                                      name: l.name,
                                      path: l.path,
                                      weight: l.weight,
                                      boneFilter: l.boneFilter,
                                      enabled: l.enabled,
                                  })) ?? [],
                              source: inst.motionSlots.primary.pinned?.source ?? 'vmd',
                          },
                      }
                    : undefined;
            if (!primary) {
                return undefined;
            }
            return { primary };
        })(),
        // [fix:material-persist] 落盘材质状态（仅非 null 才写，避免默认值噪声）
        ...(() => {
            const ms = getMatState(inst.id);
            if (!ms) {
                return {};
            }
            return {
                materialCategories: ms.categories,
                materialOverrides: ms.overrides,
                materialEnabled: ms.enabled,
                ...(Object.keys(ms.sssCategories ?? {}).length > 0
                    ? { materialSssCategories: ms.sssCategories }
                    : {}),
            };
        })(),
        // [doc:adr-168] 个人灯设置（仅 actor 且有差异时落盘）
        ...(() => {
            if (inst.kind !== 'actor') {
                return {};
            }
            const pls = getPersonalLightState(inst.id);
            if (!pls) {
                return {};
            }
            // 只存与默认值不同的字段，减少噪声
            const diff: Record<string, unknown> = {};
            for (const key of Object.keys(pls) as Array<keyof typeof pls>) {
                if (JSON.stringify(pls[key]) !== JSON.stringify(DEFAULT_PERSONAL_LIGHT[key])) {
                    diff[key] = pls[key];
                }
            }
            return Object.keys(diff).length > 0 ? { personalLight: diff } : {};
        })(),
        // [doc:adr-215] 模型附属关系
        parentId: inst.parentId,
        attachedBone: inst.attachedBone,
        attachedOffset: inst.attachedOffset,
        attachedRotation: inst.attachedRotation,
    };
}

/** 序列化当前场景为 SceneFile（分段容错，单模型失败跳过并记录）。 */
export function serializeScene(): SceneFile {
    const procState = getProcMotionState();
    const lipState = getLipSyncState();
    // [doc:adr-198] 分段容错：逐个模型序列化，单条抛错时跳过 + 记录，
    // 保证其余模型仍能落盘，而非整次序列化崩溃使本次保存全丢。
    const models: SceneFile['models'] = [];
    for (const inst of modelRegistry.values()) {
        try {
            models.push(serializeModel(inst));
        } catch (err) {
            logWarn(
                'scene:serialize',
                `model "${inst.name}" (${inst.id}) serialize failed, skipped: ${String(err)}`
            );
        }
    }
    return {
        version: 1,
        models,
        camera: getCameraState(),
        lights: getLightState(),
        render: getRenderState(),
        env: envState,
        cameraVmd: hasCameraVmd()
            ? {
                  path: getCameraVmdPath(),
                  libraryRef: getCameraVmdPath()
                      ? computeLibraryRef(getCameraVmdPath(), libraryRoot) || undefined
                      : undefined,
                  name: getCameraVmdName(),
                  active: getCameraMode() === 'vmd',
              }
            : undefined,
        audio: getSceneAction('getAudioName')?.() ?? ''
            ? {
                  path: getSceneAction('getAudioPath')?.() ?? '',
                  libraryRef: getSceneAction('getAudioPath')?.() ?? ''
                      ? computeLibraryRef(getSceneAction('getAudioPath')?.() ?? '', libraryRoot) || undefined
                      : undefined,
                  name: getSceneAction('getAudioName')?.() ?? '',
                  volume: getSceneAction('getVolume')?.() ?? 1,
                  offset: getSceneAction('getAudioOffset')?.() ?? 0,
                  playing: getSceneAction('isAudioPlaying')?.() ?? false,
              }
            : undefined,
        // [fix:P3] 与 serializeModel 一致：深拷贝防嵌套 params 与运行时状态共引用
        procMotion: structuredClone(procState),
        perception: {
            // [fix:P3] 场景级存储：仅存单一参数 + pinned 白名单（无 per-model allStates）
            focused: { ...getPerceptionState() },
            pinned: getPinnedModelIds().map((id) => ({ modelId: id })),
            // [doc:adr-164] 性能档位与全员感知开关（保存用户意图而非运行时 tier，防止反序列化后自动降级失效）
            tier: getPerceptionPerfManualTier(),
            allEnabled: isAllPerceptionEnabled(),
        },
        lipSync: { ...lipState },
        gravityStrength: getGravityStrength(),
        formation: getActiveFormation()
            ? { type: getActiveFormation()!, spacing: getActiveFormationSpacing() }
            : undefined,
        stageLights: getStageLights(),
        // [doc:adr-167] 场景级动作库（新格式：sceneMotions + activeMotionId）
        motion: (() => {
            const sceneMotions = getSceneMotions();
            const activeMotionId = getActiveMotionId();
            if (sceneMotions.length === 0 && activeMotionId === null) {
                return null;
            }
            return {
                sceneMotions: sceneMotions.map((m) => ({
                    id: m.id ?? undefined,
                    vmdPath: m.vmdPath,
                    vmdName: m.vmdName,
                    vmdLayers: m.vmdLayers.map((l) => ({
                        kind: l.kind,
                        name: l.name,
                        path: l.path,
                        weight: l.weight,
                        boneFilter: l.boneFilter,
                        enabled: l.enabled,
                    })),
                    source: m.source,
                    motionModules: m.motionModules,
                    // [fix:P3] 深拷贝：此前直接引用 activeMotion 上的运行时对象
                    procMotion: m.procMotion ? structuredClone(m.procMotion) : undefined,
                })),
                activeMotionId,
                // [doc:adr-207] 程序化动作可加载集合
                loadedProceduralMotions: [...getLoadedProceduralMotions()],
            };
        })(),
        // [doc:adr-108] 序列化当前活跃的 retarget 动画状态
        retarget: (() => {
            const state = getRetargetPlayState();
            if (!state) {
                return null;
            }
            return {
                filePath: state.filePath,
                libraryRef: computeLibraryRef(state.filePath, libraryRoot) || undefined,
                boneMapPreset: state.boneMapPreset,
            };
        })(),
    };
}

// ======== Deserialization ========

/**
 * Phase 1 + Phase 2: clear scene → load all models → apply post-load config.
 * Both phases are kept as one function so the models array is traversed once,
 * avoiding N-pass scanning that would occur with separate per-category functions.
 * @returns [modelIds, errors] where modelIds[i] = runtime ID if loaded, null if failed.
 */
async function deserializeModels(
    modelsData: SceneFile['models']
): Promise<[Array<string | null>, string[]]> {
    // --- Clear existing scene ---
    for (const id of Array.from(modelRegistry.keys())) {
        removeModel(id);
    }

    // --- Phase 1: Load all models and record runtime IDs ---
    const modelIds: Array<string | null> = [];
    const errors: string[] = [];

    for (let i = 0; i < modelsData.length; i++) {
        const m = modelsData[i];
        try {
            const resolvedPath = resolvePathFromRef(m.filePath, m.libraryRef);
            if (!resolvedPath) {
                errors.push(t('scene.serialize.modelPathUnresolved', { name: m.name }));
                modelIds.push(null);
                continue;
            }
            // D5: 直接用 loadPMXFile 返回的运行时 ID 查询，不依赖 focusedModel() 反查
            // [doc:stable-identity] 传入存档 uuid 作为 runtime id，确保恢复后材质/个人灯状态按同 id 还原
            const loadedId = await loadPMXFile(
                resolvedPath,
                m.kind === 'stage',
                true,
                undefined,
                undefined,
                undefined,
                m.uuid
            );
            if (!loadedId) {
                errors.push(t('scene.serialize.modelNoMesh', { name: m.name }));
                modelIds.push(null);
                continue;
            }
            const inst = modelRegistry.get(loadedId);
            if (!inst || inst.meshes.length === 0) {
                errors.push(t('scene.serialize.modelNoMesh', { name: m.name }));
                modelIds.push(null);
                continue;
            }
            modelIds.push(loadedId);

            // Apply immediate model properties (position, scale, visibility, etc.)
            if (
                m.positionMode === 'orbit' &&
                m.orbitAzimuth !== undefined &&
                m.orbitElevation !== undefined &&
                m.orbitDistance !== undefined
            ) {
                modelManager.setOrbit(inst.id, m.orbitAzimuth, m.orbitElevation, m.orbitDistance);
            } else {
                modelManager.setPosition(
                    inst.id,
                    m.positionX ?? 0,
                    m.positionY ?? 0,
                    m.positionZ ?? 0
                );
                inst.positionMode = m.positionMode ?? 'cartesian';
            }
            if (m.scaling !== undefined) {
                modelManager.setScaling(inst.id, m.scaling);
            }
            if (m.rotationY !== undefined) {
                if (m.rotation) {
                    modelManager.setRotation(
                        inst.id,
                        new Vector3(m.rotation[0], m.rotation[1], m.rotation[2])
                    );
                } else if (m.rotationY !== undefined) {
                    modelManager.setRotationY(inst.id, m.rotationY);
                }
            }
            inst.visible = m.visible ?? true;
            inst.opacity = m.opacity ?? 1.0;
            inst.wireframe = m.wireframe ?? false;
            if (m.showBoneLines !== undefined) {
                inst.showBoneLines = m.showBoneLines;
                setModelBoneLinesVis(inst.id, m.showBoneLines);
            }
            if (m.showBoneJoints !== undefined) {
                inst.showBoneJoints = m.showBoneJoints;
                setModelBoneJointsVis(inst.id, m.showBoneJoints);
            }
            if (m.physicsEnabled !== undefined) {
                inst.physicsEnabled = m.physicsEnabled;
                setModelPhysics(inst.id, m.physicsEnabled);
            }
            // [fix:physics-cat-persist] 恢复物理分类开关（须在模型加载完成后，setPhysicsCategory 依赖 inst.mmdModel）
            if (m.physicsCategories) {
                for (const [cat, enabled] of Object.entries(m.physicsCategories)) {
                    setPhysicsCategory(inst.id, cat, enabled);
                }
            }
            if (m.boneOverrides) {
                inst.boneOverrides = m.boneOverrides.map((b) => ({
                    boneName: b.boneName,
                    euler: b.euler,
                    weight: b.weight,
                    enabled: b.enabled ?? true,
                }));
            }
            // [doc:adr-116] 恢复模块语义状态（仅写入 ModelInstance，运行时烘焙在下方 restoreOverrides 之后）
            if (m.motionOverrideModules) {
                inst.motionOverrideModules = m.motionOverrideModules;
            }
            // [doc:adr-145] 恢复动作预设
            if (m.motionPresets && Array.isArray(m.motionPresets)) {
                inst.motionPresets = m.motionPresets;
            }
            // [doc:adr-233] 恢复 per-model 程序化动作状态（统一过 migrateProcState，兼容旧扁平存档）
            if (m.procMotion) {
                inst.procMotion = migrateProcState(m.procMotion);
            }
            // [audit] 恢复程序化自定义预设（纯数据，无需迁移）
            if (m.procPresets && Array.isArray(m.procPresets)) {
                inst.procPresets = m.procPresets;
            }
            // [doc:adr-121] 恢复双槽位动作分配（兼容旧 motionAssignment 格式）
            const pinnedData =
                m.motionSlots?.primary?.source === 'pinned'
                    ? m.motionSlots.primary.pinned
                    : m.motionAssignment?.mode === 'pinned'
                      ? m.motionAssignment.pinned
                      : null;
            if (pinnedData) {
                inst.motionSlots = {
                    primary: {
                        source: 'pinned',
                        pinned: {
                            vmdPath: pinnedData.vmdPath,
                            vmdName: pinnedData.vmdName,
                            vmdLayers: pinnedData.vmdLayers.map((l) => ({
                                id: '',
                                kind: l.kind ?? 'vmd',
                                name: l.name,
                                data: new ArrayBuffer(0),
                                path: l.path,
                                weight: l.weight,
                                boneFilter: l.boneFilter,
                                enabled: l.enabled ?? true,
                            })),
                            source: pinnedData.source,
                        },
                        status: 'idle',
                    },
                };
            } else {
                // inherit 模式不落盘，加载时自动继承全局 activeMotion
                inst.motionSlots = {
                    primary: { source: 'inherit', status: 'idle' },
                };
            }

            // [doc:adr-167] overlay 槽位已移除（ADR-144 废弃），旧场景文件中的 overlay 配置忽略
            if (inst.visible === false) {
                for (const mesh of inst.meshes) {
                    mesh.setEnabled(false);
                }
            }
            if (inst.opacity < 1.0 || inst.wireframe) {
                for (const mesh of inst.meshes) {
                    const mat = mesh.material;
                    if (mat instanceof StandardMaterial || mat instanceof PBRMaterial) {
                        mat.wireframe = inst.wireframe;
                    }
                }
                const alphaCtx: AlphaCtx = {
                    opacity: inst.opacity,
                    origAlpha: inst._origAlpha ?? [],
                };
                _applyAll(loadedId, alphaCtx);
            }
        } catch (err) {
            errors.push(
                t('scene.serialize.modelError', {
                    name: m.name,
                    error: (err as Error)?.message ?? String(err),
                })
            );
            modelIds.push(null);
        }
    }

    // --- Phase 2: Apply VMD animations and outfit variants by recorded ID ---
    for (let i = 0; i < modelsData.length; i++) {
        const id = modelIds[i];
        if (!id) {
            continue;
        } // Model failed to load

        const m = modelsData[i];
        if (m.vmdPath) {
            try {
                const resolvedVmdPath = resolvePathFromRef(m.vmdPath, m.vmdLibraryRef);
                if (resolvedVmdPath) {
                    await loadVMDFromPath(resolvedVmdPath, id);
                }
            } catch (err) {
                logWarn('scene-serialize', `场景恢复: 模型 ${m.name} VMD 加载失败:`, err);
            }
        }
        // 恢复 Motion Layers（批量添加，只触发一次 composite rebuild）
        if (m.vmdLayers && m.vmdLayers.length > 0) {
            try {
                const { addVmdLayersFromPaths } = await import('./motion/vmd-layers');
                const resolvedLayers = m.vmdLayers
                    .filter((l) => l.path)
                    .map((l) => ({
                        path: resolvePathFromRef(l.path!),
                        weight: l.weight,
                        boneFilter: l.boneFilter,
                    }))
                    .filter(
                        (l): l is { path: string; weight: number; boneFilter: string[] } => !!l.path
                    );
                if (resolvedLayers.length > 0) {
                    await addVmdLayersFromPaths(resolvedLayers, id);
                }
            } catch (err) {
                logWarn('scene-serialize', `场景恢复: 模型 ${m.name} 图层恢复失败:`, err);
            }
        }
        // 恢复 gaze 图层（程序化图层，无 VMD 数据）
        if (m.vmdLayers && m.vmdLayers.length > 0) {
            const gazeLayers = m.vmdLayers.filter((l) => l.kind === 'gaze');
            if (gazeLayers.length > 0) {
                try {
                    const { addGazeLayer } = await import('./motion/vmd-layers');
                    for (const gl of gazeLayers) {
                        await addGazeLayer(id, gl.name, gl.weight, gl.enabled ?? true);
                    }
                } catch (err) {
                    logWarn('scene-serialize', `场景恢复: 模型 ${m.name} gaze 图层恢复失败:`, err);
                }
            }
        }
        if (m.outfitVariant) {
            try {
                await getSceneAction('loadOutfits')?.(id);
                await getSceneAction('applyOutfitVariant')?.(id, m.outfitVariant);
            } catch (err) {
                logWarn('scene-serialize', `场景恢复: 模型 ${m.name} 变体应用失败:`, err);
            }
        }
        // 恢复 Bone Override 运行时状态
        if (m.boneOverrides && m.boneOverrides.length > 0) {
            try {
                const { restoreOverrides } = await import('./motion/bone-override');
                restoreOverrides(m.boneOverrides);
            } catch (err) {
                logWarn('scene-serialize', `场景恢复: 模型 ${m.name} 骨骼覆盖恢复失败:`, err);
            }
        }
        // [doc:adr-116] 恢复模块语义状态：setState 写入 + enabled 模块重烘焙
        // 与 boneOverrides 独立：模块层走 setBoneOverride/setBoneOverridePosition，
        // boneOverrides 是用户手动骨骼覆盖（高级子页），两者共享 _overrideMap 但来源不同
        if (m.motionOverrideModules && m.motionOverrideModules.length > 0) {
            try {
                const { createModule } = await import('./motion/motion-modules/registry');
                for (const ms of m.motionOverrideModules) {
                    const mod = createModule(ms.id, id);
                    if (!mod) {
                        logWarn(
                            'scene-serialize',
                            `场景恢复: 模型 ${m.name} 未知动作覆盖模块 "${ms.id}"，跳过`
                        );
                        continue;
                    }
                    mod.setState(ms);
                    if (ms.enabled) {
                        mod.enable(); // 重烘焙到引擎 _overrideMap
                    }
                }
            } catch (err) {
                logWarn('scene-serialize', `场景恢复: 模型 ${m.name} 动作覆盖模块恢复失败:`, err);
            }
        }
        // [fix:material-persist] 恢复材质状态（categories + overrides + enabled + SSS）
        // _capture 已在 model-loader.ts 加载时调用，_origValues 就绪，可安全 apply
        if (m.materialCategories || m.materialOverrides || m.materialEnabled || m.materialSssCategories) {
            try {
                applyMatState(id, {
                    categories: m.materialCategories,
                    overrides: m.materialOverrides,
                    enabled: m.materialEnabled,
                    sssCategories: m.materialSssCategories,
                });
            } catch (err) {
                logWarn('scene-serialize', `场景恢复: 模型 ${m.name} 材质状态恢复失败:`, err);
            }
        }
        // [doc:adr-168] 恢复个人灯设置（attach 已由 onModelLoaded 触发，此处覆盖参数）
        if (m.personalLight) {
            try {
                restorePersonalLights([{ modelId: id, settings: m.personalLight }]);
            } catch (err) {
                logWarn('scene-serialize', `场景恢复: 模型 ${m.name} 个人灯恢复失败:`, err);
            }
        }
        // [doc:adr-215] 恢复模型附属关系字段（写入 ModelInstance，deferred reattach 在 Phase 3）
        if (m.parentId) {
            const inst = modelRegistry.get(id);
            if (inst) {
                inst.parentId = m.parentId;
                inst.attachedBone = m.attachedBone;
                inst.attachedOffset = m.attachedOffset;
                inst.attachedRotation = m.attachedRotation;
            }
        }
    }

    // --- Phase 3: Deferred reattach — 所有模型加载完成后重建附属链 ---
    // [doc:adr-215] 先全加载再统一重建附属关系，避免父模型尚未就绪的时序问题。
    modelManager.reattachAllAttachments();

    return [modelIds, errors];
}

/**
 * Restore scene state from a SceneFile.
 *
 * Model loading uses a **two-phase** approach to avoid the race condition where
 * a failed model load leaves `focusedModel()` pointing to the wrong instance:
 *   1. Phase 1: Load all models sequentially, record runtime IDs on success.
 *   2. Phase 2: Apply VMD animations and outfit variants by looking up the
 *      recorded runtime IDs (never relying on global `focusedModel()`).
 *
 * @param data  The serialized scene data to restore.
 * @param skipEnv  If true, skip environment state restoration.
 *   Used during initial app startup because env state is restored separately
 *   from Go Config.Env to avoid double-application.
 */
export async function deserializeScene(data: SceneFile, skipEnv = false): Promise<number> {
    // 抑制恢复过程中的 auto-save，防止 setCameraState/setLightState/setRenderState
    // 等函数触发级联保存覆盖 last_scene.json。
    _suppressAutoSave = true;
    // [fix:suppress-leak] 主体任何一步抛异常（数据损坏致 setter throw）也必须复位
    // suppress，否则 auto-save 永久失效、last_scene.json 不再更新。
    try {
        // --- Load all models and apply post-load config ---
        const [, errors] = await deserializeModels(data.models);

        // --- Formation: re-apply if saved ---
        if (data.formation && modelManager) {
            try {
                setModelFormation(data.formation.type, data.formation.spacing);
            } catch (err) {
                logWarn('scene-serialize', '场景恢复: 队形恢复失败:', err);
            }
        }

        // --- Camera, Lights, Render ---
        if (data.camera) {
            setCameraState(data.camera);
        }
        if (data.lights) {
            setLightState(data.lights);
        }
        if (data.render) {
            setRenderState(data.render);
        }
        // Backward compat: old scene files store FOV in render.fov (pre-Phase 9)
        if (data.render && 'fov' in data.render) {
            setFov((data.render as unknown as Record<string, number>).fov);
        }

        // --- Environment ---
        // [fix:ghost-state] setEnvState 现在会反向同步 envSunAngle 模块缓存，
        // 显式 setEnvSunAngle 调用保留为前置 clamp（确保 sunAngle 在 [-15, 90] 范围内），
        // 顺序不再敏感（两者都会写入双源）。
        if (data.env && !skipEnv) {
            if (data.env.sunAngle !== undefined) {
                setEnvSunAngle(data.env.sunAngle);
            }
            setEnvState(data.env, true);
        }
        if (data.gravityStrength !== undefined) {
            setGravityStrength(data.gravityStrength);
        }
        // [adr:ground] envState 已恢复（含 groundCollisionEnabled），注入/移除地面刚体
        applyGroundCollision();
        // 舞台灯光：优先新格式 stageLights，兼容旧格式 stageLight
        if (data.stageLights && data.stageLights.length > 0) {
            loadStageLights(data.stageLights);
        } else if (data.stageLight) {
            const sl = {
                id: 'light-1',
                name: '主光',
                type: 'spot' as const,
                range: 50,
                ...data.stageLight,
            };
            loadStageLights([sl]);
        }

        // --- Procedural Motion ---
        // regenerateProcMotion() is needed because procedural motion is driven by
        // per-frame callbacks that get reset when models are cleared/reloaded.
        // Simply restoring state won't re-register these callbacks.
        // [audit] per-mode：加载统一过 migrateProcState，兼容旧扁平与新嵌套存档。
        if (data.procMotion) {
            setProcMotionState(migrateProcState(data.procMotion));
            regenerateProcMotion();
        }

        // --- Perception Layer --- [doc:adr-071]
        // 优先读 data.perception（兼容旧格式 PerceptionState 与新格式 { focused, pinned, tier, allEnabled }）
        const perceptionData = migratePerceptionData(data.perception);
        if (perceptionData) {
            setPerceptionState(perceptionData.focused);
            // [fix:P3] 场景级存储：仅恢复 pinned 白名单（参数统一来自 focused 单例）
            for (const p of perceptionData.pinned) {
                pinPerception(p.modelId);
            }
            // [doc:adr-164/adr-166] 恢复性能档位与全员感知开关（通过 migratePerceptionData 安全取值）
            if (perceptionData.tier && perceptionData.tier !== 'auto') {
                setPerceptionPerfTier(perceptionData.tier);
            }
            if (perceptionData.allEnabled === true) {
                enableAllPerception();
            }
        } else if (data.procMotion) {
            setPerceptionState(
                migratePerceptionFromProcMotion(data.procMotion as Partial<ProcMotionState>)
            );
        }
        activatePerception();

        // --- LipSync ---
        if (data.lipSync) {
            setLipSyncState({
                ...DEFAULT_LIPSYNC_STATE,
                ...(data.lipSync as Partial<LipSyncStateType>),
            });
        } else {
            setLipSyncState({ ...DEFAULT_LIPSYNC_STATE });
        }

        // --- Camera VMD ---
        if (data.cameraVmd && data.cameraVmd.path) {
            try {
                const resolvedPath = resolvePathFromRef(
                    data.cameraVmd.path,
                    data.cameraVmd.libraryRef
                );
                if (resolvedPath) {
                    await loadCameraVmdFromPath(resolvedPath);
                    if (data.cameraVmd.active) {
                        switchCameraMode('vmd');
                    }
                }
            } catch (err) {
                logWarn('scene-serialize', '场景恢复: 相机 VMD 加载失败:', err);
            }
        }

        // --- Audio ---
        if (data.audio && data.audio.path) {
            try {
                const resolvedPath = resolvePathFromRef(data.audio.path, data.audio.libraryRef);
                if (resolvedPath) {
                    await getSceneAction('loadAudioFile')?.(resolvedPath);
                    getSceneAction('setVolume')?.(data.audio.volume ?? 1);
                    getSceneAction('setAudioOffset')?.(data.audio.offset ?? 0);
                    if (data.audio.playing) {
                        // In Wails desktop environments, AudioContext.resume() works without
                        // user gesture. But to be safe in any environment, check state first.
                        try {
                            const ctx = window.AudioContext ? new window.AudioContext() : null;
                            if (ctx && ctx.state === 'suspended') {
                                logWarn(
                                    'scene-serialize',
                                    '场景恢复: 音频上下文已暂停，跳过自动播放（需用户交互后手动播放）'
                                );
                            } else {
                                getSceneAction('resumeAudio')?.();
                            }
                        } catch (e) {
                            logWarn(
                                'scene-serialize',
                                '场景恢复: AudioContext 创建失败，尝试直接 resume:',
                                e
                            );
                            getSceneAction('resumeAudio')?.();
                        }
                    }
                }
            } catch (err) {
                logWarn('scene-serialize', '场景恢复: 音频加载失败:', err);
            }
        }

        // [doc:adr-167] 恢复场景级动作库（新格式优先；旧格式单例迁移）
        // 注意：motion 恢复在模型加载完成后执行，此时各模型 vmdPath 已由旧序列化恢复
        if (data.motion) {
            // 先清空运行时场景库（防止残留旧数据）
            clearAllSceneMotions();
            if (data.motion.sceneMotions && data.motion.sceneMotions.length > 0) {
                // 新格式：多主动作平等共存
                let firstId: string | null = null;
                for (const m of data.motion.sceneMotions) {
                    const id = addSceneMotion({
                        id: m.id,
                        vmdPath: m.vmdPath,
                        vmdName: m.vmdName,
                        vmdLayers: m.vmdLayers.map((l) => ({
                            id: '',
                            kind: l.kind ?? 'vmd',
                            name: l.name,
                            data: new ArrayBuffer(0),
                            path: l.path,
                            weight: l.weight,
                            boneFilter: l.boneFilter,
                            enabled: l.enabled ?? true,
                        })),
                        source: m.source,
                        motionModules: m.motionModules,
                        procMotion: m.procMotion
                            ? (migrateProcState(m.procMotion) as ProcMotionConfig)
                            : undefined,
                    });
                    if (firstId === null) {
                        firstId = id;
                    }
                }
                // 设置默认动作（若存档中明确为 null，则保留 null=无默认；否则用 activeMotionId 或首项）
                const desired = data.motion.activeMotionId ?? firstId;
                setDefaultMotion(desired);
            } else if (
                data.motion.vmdPath !== undefined ||
                data.motion.vmdName !== undefined ||
                (data.motion.vmdLayers && data.motion.vmdLayers.length > 0)
            ) {
                // 旧格式：单例迁移到新场景库
                const legacy = data.motion as {
                    vmdPath: string | null;
                    vmdName: string;
                    vmdLayers: Array<{
                        name: string;
                        path: string | null;
                        weight: number;
                        boneFilter: string[];
                        kind?: 'vmd' | 'gaze';
                        enabled?: boolean;
                    }>;
                    source: 'vmd' | 'retargeted';
                    motionModules?: MotionModuleState[];
                    procMotion?: Partial<ProcMotionState>;
                };
                addSceneMotion({
                    vmdPath: legacy.vmdPath,
                    vmdName: legacy.vmdName,
                    vmdLayers: legacy.vmdLayers.map((l) => ({
                        id: '',
                        kind: l.kind ?? 'vmd',
                        name: l.name,
                        data: new ArrayBuffer(0),
                        path: l.path,
                        weight: l.weight,
                        boneFilter: l.boneFilter,
                        enabled: l.enabled ?? true,
                    })),
                    source: legacy.source,
                    motionModules: legacy.motionModules,
                    procMotion: legacy.procMotion
                        ? (migrateProcState(legacy.procMotion) as ProcMotionConfig)
                        : undefined,
                });
                // addSceneMotion 首次添加自动设为默认
            }
            // 否则（motion 存在但字段全空）= 显式清空状态，保持 clearAllSceneMotions 结果
            // [doc:adr-207] 恢复程序化动作可加载集合
            if (data.motion.loadedProceduralMotions) {
                setLoadedProceduralMotions(data.motion.loadedProceduralMotions as LoadableProcId[]);
            }
        } else {
            // 旧场景文件无 motion 块 → 保持已有 vmdPath 缓存（与当前行为一致）
            // 不调用 clearAllSceneMotions 避免覆盖每模型独立 VMD
        }

        // [doc:adr-108] 恢复 retarget 动画状态（在模型加载完成后执行）
        if (data.retarget && data.retarget.filePath) {
            const resolvedPath = resolvePathFromRef(
                data.retarget.filePath,
                data.retarget.libraryRef
            );
            if (resolvedPath) {
                const foc = modelManager.focused();
                if (foc) {
                    const preset = data.retarget.boneMapPreset as 'mixamo' | 'vrm' | 'custom';
                    await restoreRetargetAnimation(resolvedPath, preset, foc.id).catch((err) => {
                        logWarn('scene-serialize', 'retarget 动画恢复失败:', err);
                    });
                }
            }
        }

        // --- Report loading errors ---
        if (errors.length > 0) {
            logWarn(
                'scene-serialize',
                `场景恢复: ${errors.length}/${data.models.length} 个模型加载失败`
            );
            for (const err of errors) {
                logWarn('scene-serialize', `  - ${err}`);
            }
            // Emit a user-visible warning via a DOM event so the UI can show a toast
            if (typeof document !== 'undefined') {
                document.dispatchEvent(
                    new CustomEvent('scene-restore-errors', {
                        detail: { errors, total: data.models.length },
                    })
                );
            }
        }
        // 恢复完成，允许 auto-save 再次触发
        return errors.length;
    } finally {
        _suppressAutoSave = false;
    }
}

// ======== Auto-save Debounce ========
// 反序列化期间的抑制标志，防止恢复过程中的 setCameraState/setLightState/setRenderState
// 等函数触发级联 auto-save 覆盖 last_scene.json。
let _suppressAutoSave = false;

export function setSuppressAutoSave(v: boolean): void {
    _suppressAutoSave = v;
}

const _autoSaveDebounced = debounce((): void => {
    console.info('[auto-save] debounce fired → saveSceneImmediate()');
    swallowError(saveSceneImmediate());
}, 500);

export function triggerAutoSaveImpl(): void {
    if (_suppressAutoSave) {
        console.info('[auto-save] triggerAutoSaveImpl() suppressed (deserializeScene in progress)');
        return;
    }
    console.info('[auto-save] triggerAutoSaveImpl() called — debounce scheduled (500ms)');
    _autoSaveDebounced();
}

// ======== Undo Snapshot Stack (Memento) ========
// 内存快照栈：破坏性操作前抓整场景序列化 JSON，撤销时 deserializeScene 回去。
// 与 SaveLastScene 单文件覆盖解耦——自动保存逻辑无需改动。
// 设计：每个撤销 toast 捕获自己压栈时的快照字符串（闭包持有），点击撤销恢复该特定快照，
// 因此多个 toast 并存时各自恢复正确的历史态（非全局 LIFO 误恢复）。
const UNDO_LIMIT = 5;
const _undoStack: string[] = [];

/** 破坏性操作前调用：抓当前整场景快照压栈（环形，上限 UNDO_LIMIT），返回快照字符串供撤销绑定。 */
export function pushUndoSnapshot(): string | null {
    try {
        const snap = JSON.stringify(serializeScene());
        _undoStack.push(snap);
        while (_undoStack.length > UNDO_LIMIT) {
            _undoStack.shift();
        }
        return snap;
    } catch (e) {
        console.warn('[undo] pushUndoSnapshot failed:', e);
        return null;
    }
}

export function canUndo(): boolean {
    return _undoStack.length > 0;
}

/** 弹出最近一次撤销快照（LIFO），供全局撤销按钮 / Ctrl+Z 使用。返回快照字符串，无快照时返回 null。 */
export function popUndoSnapshot(): string | null {
    if (_undoStack.length === 0) {
        return null;
    }
    return _undoStack.pop() ?? null;
}

/** 取消待执行的防抖自动保存（撤销前调用，避免覆盖刚恢复的状态）。 */
function cancelPendingAutoSave(): void {
    _autoSaveDebounced.cancel();
}

/**
 * 恢复特定快照到整场景。返回是否成功恢复。
 * 恢复期间抑制 auto-save，防止 deserializeScene 级联触发保存覆盖刚恢复的状态（与 tryRestoreLastScene 同款防御）。
 */
export async function restoreUndoSnapshot(snap: string): Promise<boolean> {
    cancelPendingAutoSave();
    setSuppressAutoSave(true);
    try {
        const raw = JSON.parse(snap);
        const data = migrateScene(raw);
        if (!SUPPORTED_VERSIONS.includes(data.version as number) || !Array.isArray(data.models)) {
            console.warn('[undo] snapshot unsupported/malformed — abort undo');
            return false;
        }
        await deserializeScene(data as unknown as SceneFile, true);
        await saveSceneImmediate(true);
        return true;
    } catch (e) {
        console.warn('[undo] restoreUndoSnapshot failed:', e);
        return false;
    } finally {
        // 三条出口路径（malformed return / success / catch）统一复位，杜绝 suppress 泄漏。
        setSuppressAutoSave(false);
    }
}

/** 破坏性操作后调用：弹出中性撤销 toast（复用 action-button toast，info 变体）。 */
export function offerSceneUndo(message: string, snap: string | null, onRestored: () => void): void {
    if (!snap) {
        return;
    }
    showInfoToast(
        message,
        undefined,
        [
            {
                label: t('toast.undo'),
                onClick: () => {
                    void restoreUndoSnapshot(snap).then((ok) => {
                        if (ok) {
                            onRestored();
                        }
                    });
                },
            },
        ],
        8000
    );
}

/** offerSceneUndo 的常见变体：撤销恢复后执行 reRender 回调并统一提示 `undoApplied`。
 *  收敛 motion-* / override / camera 各撤销调用点重复的 onRestored 尾巴（reRender + setStatus）。 */
export function offerSceneUndoAndRefresh(
    message: string,
    snap: string | null,
    reRender: () => void
): void {
    offerSceneUndo(message, snap, () => {
        reRender();
        feedbackInfo('motion.undoApplied', undefined);
    });
}

/** Save scene immediately (no debounce). Used in visibilitychange / beforeunload.
 *  @param suppressToast  When true (visibilitychange scenario), skip toast on error.
 *  @param force  When true (exit-flush scenario), bypass the reentrancy guard so a
 *    save in flight cannot swallow the final change into the never-flushed pending
 *    slot (the process is about to exit, no trailing save will ever run). */
let _saving = false;
let _savePending = false;
export async function saveSceneImmediate(suppressToast = false, force = false): Promise<void> {
    // Reentrancy guard: undo-restore / visibilitychange flush / debounce fire can
    // all call this concurrently. Serialise them so serializeScene() never reads a
    // scene mutated mid-write, and coalesce overlapping calls into one trailing save.
    // `force` opts out of coalescing for the exit path (see doc above).
    if (_saving && !force) {
        _savePending = true;
        return;
    }
    _saving = true;
    try {
        const _sStart = performance.now();
        // [doc:adr-198] 区分序列化失败 vs 写盘失败：序列化在前（已分段容错，
        // 正常不会整体抛错），如果仍崩溃则上报更明确的诊断，便于定位中间态问题。
        let data: SceneFile;
        try {
            data = serializeScene();
        } catch (serErr) {
            logWarn('scene:serialize', `serializeScene() threw, save aborted: ${String(serErr)}`);
            if (!suppressToast) {
                feedbackError('scene.serialize.autosaveFailed', undefined, serErr);
            }
            return;
        }
        const _sSerialize = performance.now() - _sStart;
        const json = JSON.stringify(data);
        const _sJson = performance.now() - _sStart - _sSerialize;
        console.info(
            `[auto-save] serialize=${_sSerialize.toFixed(1)}ms json=${_sJson.toFixed(1)}ms len=${json.length} → SaveLastScene()`
        );
        if (_sSerialize + _sJson > 2) {
            logWarn(
                'perf:save',
                `serialize=${_sSerialize.toFixed(1)}ms json=${_sJson.toFixed(1)}ms len=${json.length}`
            );
        }

        // Go 端作为唯一存储（Fail-Fast：失败直接抛错）
        await SaveLastScene(json);
        console.info('[auto-save] SaveLastScene succeeded');
    } catch (_err) {
        // 序列化已在上方单独捕获并 return，这里到达即写盘（SaveLastScene）失败。
        console.warn('[auto-save] SaveLastScene FAILED (write):', _err);
        if (!suppressToast) {
            feedbackError('scene.serialize.autosaveFailed', undefined, _err);
        }
    } finally {
        _saving = false;
        // A save was requested while this one was in flight — flush a trailing save
        // so the final state is never lost to the coalescing above.
        if (_savePending) {
            _savePending = false;
            swallowError(saveSceneImmediate(suppressToast));
        }
    }
}

/** Clean up pending timers and save state. Must be called before window unload. */
function cleanupAndFlushSave(): void {
    console.info('[auto-save] cleanupAndFlushSave() — visibilitychange/beforeunload triggered');
    // Cancel the debounce timer — we serialise + dispatch the write synchronously
    // below, so the pending debounced save (if any) would only duplicate this one.
    _autoSaveDebounced.cancel();
    // flushEnvState/flushUIState 是 async，但此处是 visibilitychange/beforeunload 回调，
    // 不能 await（浏览器不等待 Promise）。用 void 标记 fire-and-forget，
    // 函数内部已有 try/catch + setStatus，不会产生 unhandled rejection。
    void flushEnvState();
    void flushUIState();
    // Exit-flush must NOT rely on saveSceneImmediate's async body — the WebView does
    // not await the returned Promise, so a save that yields at `await SaveLastScene`
    // would never land before the window closes. Instead serialise synchronously
    // here and dispatch the write request before returning: the Go binding call is
    // issued (and the backend write is synchronous) within this same tick.
    if (_suppressAutoSave) {
        console.info('[auto-save] cleanupAndFlushSave: suppressed (deserialize in progress)');
        return;
    }
    try {
        const json = JSON.stringify(serializeScene());
        swallowError(SaveLastScene(json));
        console.info(
            `[auto-save] cleanupAndFlushSave: dispatched SaveLastScene (${json.length} bytes)`
        );
    } catch (_err) {
        console.warn('[auto-save] cleanupAndFlushSave: serialize/dispatch FAILED:', _err);
    }
}

// Flush save when page becomes hidden (covers app close / Alt+F4 / refresh).
// visibilitychange fires reliably in Wails; beforeunload is fallback.
// NOTE: hidden 只刷盘，不 dispose —— 最小化/切后台再回来时渲染循环保持存活。
if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            cleanupAndFlushSave();
        }
    });
    window.addEventListener('beforeunload', () => {
        cleanupAndFlushSave();
        // 仅在应用真正退出时释放 WebGL context（GPU 内存回收）
        disposeScene();
    });
}

// ======== Auto-restore ========

/** Currently supported scene file versions. */
const SUPPORTED_VERSIONS = [1];

// ======== Scene Migration Registry ========
// 新增迁移在此追加函数 + 注册到 _sceneMigrators。
// 每个 migrator 返回 true 表示发生了变更。
type SceneMigrator = (data: Record<string, unknown>) => boolean;

/** v0 → v1: no-op（v1 为初始版本，仅设置版本号）。 */
function migrateToV1(data: Record<string, unknown>): boolean {
    const v = (data.version as number) ?? 0;
    if (v < 1) {
        data.version = 1;
        return true;
    }
    return false;
}

/** 迁移注册表：新增迁移在此追加。 */
const _sceneMigrators: SceneMigrator[] = [migrateToV1];

/**
 * Migrate a scene file from an older version to the latest format.
 * Iterates the registry sequentially; each migrator bumps version on success.
 */
function migrateScene(data: Record<string, unknown>): Record<string, unknown> {
    for (const m of _sceneMigrators) {
        m(data);
    }
    return data;
}

export async function tryRestoreLastScene(): Promise<void> {
    console.info('[auto-load] tryRestoreLastScene() called — attempting to load last scene');
    let json: string | null = null;

    // Go 端作为唯一存储（Fail-Fast：失败直接抛错）
    json = await LoadLastScene();

    if (!json) {
        console.info('[auto-load] LoadLastScene returned empty — no last scene to restore');
        return;
    }
    console.info(`[auto-load] LoadLastScene succeeded: ${json.length} bytes`);

    try {
        const raw = JSON.parse(json);

        // 防御二次序列化：parse 后仍是字符串说明数据异常
        if (!raw || typeof raw !== 'object') {
            logWarn('scene-serialize', '场景数据格式异常（可能被二次序列化），跳过恢复');
            return;
        }

        const data = migrateScene(raw);
        const version = data.version as number;
        console.info(
            `[auto-load] Scene file version: v${version}, models: ${Array.isArray(data.models) ? data.models.length : 'N/A'}`
        );

        // 版本校验 + 基础字段完整性校验
        if (!SUPPORTED_VERSIONS.includes(version)) {
            logWarn(
                'scene-serialize',
                `场景文件版本 v${version} 不受支持（支持: ${SUPPORTED_VERSIONS.join(', ')}）`
            );
            return;
        }

        // 确保 models 字段存在且是数组
        if (!Array.isArray(data.models)) {
            logWarn('scene-serialize', '场景数据缺少有效的 models 字段，跳过恢复');
            return;
        }

        // Pre-snapshot: 快照当前场景（启动时为空），加载失败可回滚
        const preSnap = JSON.stringify(serializeScene());
        const errorCount = await deserializeScene(data as unknown as SceneFile, true);
        logCameraAlpha(); // 记录当前 alpha 诊断

        // 全部模型加载失败时回滚到快照状态（空场景）
        const modelCount = data.models.length;
        if (modelCount > 0 && errorCount >= modelCount) {
            logWarn(
                'scene-serialize',
                `场景恢复失败: ${errorCount}/${modelCount} 个模型均无法加载，回滚到空场景`
            );
            feedbackError('scene.serialize.restoreFailed', undefined);
            try {
                const raw = JSON.parse(preSnap);
                await deserializeScene(raw as unknown as SceneFile, true);
            } catch {
                // 回滚也失败则静默——此时已是空场景
            }
            return;
        }

        // 场景文件中有 env 状态时，覆盖 config.json 中的 env 状态
        // 因为 config.json 的 env 可能在页面关闭时未及时写入（SetEnvState binding 异步未完成），
        // 而场景文件（saveSceneImmediate）的写入时机更可靠。
        // 注意：lambda 内捕获 data.env 的值，避免闭包引用问题
        const envFromScene = (data as Record<string, unknown>).env;
        if (envFromScene && typeof envFromScene === 'object') {
            console.info('[auto-load] 场景文件中包含 env 状态，覆盖 config.json 的 env 状态');
            setSuppressAutoSave(true);
            setEnvState(envFromScene as Partial<EnvState>, true);
            // 同 restoreEnvState：取消恢复触发的 env 防抖写入，避免 500ms 后
            // 把刚覆盖的值写回 config.json（见 buglog 2026-07-16 教训3）。
            cancelEnvPersistTimer();
            setSuppressAutoSave(false);
        }

        console.info('[auto-load] Scene restored successfully');
    } catch (err) {
        logWarn('scene-serialize', '场景恢复失败（数据可能已损坏）:', err);
    }
}

// [doc:adr-238] 注册撤销/模型列表供 core/action-defs 经 scene-action-bridge 调用
import { registerSceneAction } from '@/core/scene-action-bridge';
registerSceneAction('popUndoSnapshot', () => popUndoSnapshot());
registerSceneAction('restoreUndoSnapshot', (snap: unknown) =>
    restoreUndoSnapshot(snap as string)
);
registerSceneAction('listModels', () =>
    modelManager.getAll().map((m) => ({ id: m.id, name: m.name }))
);

// [doc:adr-238] 补充注册撤销快照供 core/action-defs 经 scene-action-bridge 调用
registerSceneAction('pushUndoSnapshot', () => pushUndoSnapshot());
registerSceneAction('offerSceneUndoAndRefresh', (label: string, snap: unknown, afterApply?: () => void) => {
    offerSceneUndoAndRefresh(label, snap as string, afterApply);
});

// [doc:adr-238] 注册场景恢复/保存供 core/init 经 scene-action-bridge 调用
registerSceneAction('tryRestoreLastScene', () => tryRestoreLastScene());
registerSceneAction('setSuppressAutoSave', (s: boolean) => setSuppressAutoSave(s));
registerSceneAction('saveSceneImmediate', () => saveSceneImmediate());
