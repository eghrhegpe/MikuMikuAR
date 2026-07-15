// [doc:architecture] Scene Serialization — 场景序列化与自动保存
// 规范文档: docs/architecture.md §场景序列化
// 职责: SceneFile 定义、serialize/deserialize、auto-save debounce、last-scene restore
// 注意: 从 scene.ts 静态导入但仅在函数体内访问，ES module live binding 保证安全。

import { SaveLastScene, LoadLastScene } from '../core/wails-bindings';
import { t } from '../core/i18n/t';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';

import {
    computeLibraryRef,
    resolveLibraryRef,
    envState,
    EnvState,
    modelRegistry,
    propRegistry,
    showErrorToast,
} from '../core/config';
import { debounce, swallowError, logWarn } from '../core/utils';
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
import {
    getAudioName,
    getAudioPath,
    getVolume,
    getAudioOffset,
    isAudioPlaying,
    loadAudioFile,
    setVolume,
    setAudioOffset,
    resumeAudio,
} from '../outfit/audio';
import { loadOutfits, applyOutfitVariant } from '../outfit/outfit';

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
    loadVMDFromPath,
    LightState,
    StageLightState,
    RenderState,
    FormationType,
    getActiveFormation,
    getActiveFormationSpacing,
    setModelFormation,
} from './scene';
import { removeProp, loadProp, setPropTransform, setPropOrbit } from './env/props';
import { setEnvState, setEnvSunAngle, flushEnvState, flushUIState } from './env/env-bridge';
import { setGravityStrength, getGravityStrength } from './env/env-bridge';
import {
    regenerateProcMotion,
    getProcMotionState,
    setProcMotionState,
} from './motion/proc-motion-bridge';
import { getLipSyncState, setLipSyncState } from './motion/lipsync-bridge';

import { DEFAULT_PROC_STATE } from '../motion-algos/procedural-motion';
import { DEFAULT_LIPSYNC_STATE } from '../motion-algos/lipsync';
import type { ProcMotionState } from '../motion-algos/procedural-motion';
import type { LipSyncState as LipSyncStateType } from '../motion-algos/lipsync';
import type { BoneOverrideEntry, FeetState } from '../core/types';
import {
    getPerceptionState,
    setPerceptionState,
    activatePerception,
    type PerceptionState,
} from './motion/perception';

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

/** 从旧 lipSync state 迁移为 PerceptionState 的 lip-sync 字段 */
export function migrateLipSyncFromOldState(old: {
    lipSync?: {
        enabled?: boolean;
        sensitivity?: number;
        intensity?: number;
        multiMorphEnabled?: boolean;
    };
}): {
    lipSyncEnabled: boolean;
    lipSyncSensitivity: number;
    lipSyncIntensity: number;
    lipSyncMultiMorphEnabled: boolean;
} {
    const l = old.lipSync;
    if (!l) {
        // 旧存档无 lipSync 字段 → 使用默认值（false/0.2/0.8/false）
        return {
            lipSyncEnabled: false,
            lipSyncSensitivity: 0.2,
            lipSyncIntensity: 0.8,
            lipSyncMultiMorphEnabled: false,
        };
    }
    return {
        lipSyncEnabled: l.enabled ?? false,
        lipSyncSensitivity: l.sensitivity ?? 0.2,
        lipSyncIntensity: l.intensity ?? 0.8,
        lipSyncMultiMorphEnabled: l.multiMorphEnabled ?? false,
    };
}

/** 从旧 procMotion 状态迁移为 PerceptionState（供测试与序列化共用） */
export function migratePerceptionFromProcMotion(
    old: Partial<ProcMotionState>
): Partial<PerceptionState> {
    const t = old.boneToggles;
    // lip-sync：旧存档独立的 lipSync state 映射为 PerceptionState 字段
    const lipSync = migrateLipSyncFromOldState(old as any);
    return {
        eyeTrackingEnabled: old.eyeTrackingEnabled ?? true,
        headTrackingEnabled: old.headTrackingEnabled ?? true,
        // 旧存档：boneToggles.blink 控制眨眼，boneToggles.head 无对应感知字段（head-follow 由 gaze 接管）
        blinkEnabled: t?.blink ?? true,
        breathEnabled: true,
        // 旧 boneToggles.emotion 语义是「启用微表情」（boolean），不映射具体情绪
        microExpressionEnabled: t?.emotion ?? true,
        emotion: 'neutral',
        // 躯干微晃：四个 toggle 任一为 true 则开启；无 boneToggles（旧旧存档）默认开启
        balanceSwayEnabled: t ? !!(t.center || t.upper2 || t.waist || t.allParent) : true,
        // Lip-sync 字段（从旧 lipSync state 迁移）
        lipSyncEnabled: lipSync.lipSyncEnabled,
        lipSyncSensitivity: lipSync.lipSyncSensitivity,
        lipSyncIntensity: lipSync.lipSyncIntensity,
        lipSyncMultiMorphEnabled: lipSync.lipSyncMultiMorphEnabled,
    };
}

/** 从旧 procMotion 的躯干 toggle 迁移为 balanceSwayEnabled（任一为 true 则 true；无 boneToggles 默认开启） */
export function migrateBalanceSwayFromProcMotion(old: {
    boneToggles?: { center?: boolean; upper2?: boolean; waist?: boolean; allParent?: boolean };
}): { balanceSwayEnabled: boolean } {
    const t = old.boneToggles;
    if (!t) {
        return { balanceSwayEnabled: true };
    } // 无旧数据时默认开启
    return {
        balanceSwayEnabled: !!(t.center || t.upper2 || t.waist || t.allParent),
    };
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
        visible?: boolean;
        opacity?: number;
        wireframe?: boolean;
        showBoneLines?: boolean;
        showBoneJoints?: boolean;
        physicsEnabled?: boolean;
        outfitVariant?: string;
        /** [doc:adr-049] 球面坐标轨道控制：坐标模式，缺省按 'cartesian' 处理 */
        positionMode?: 'cartesian' | 'orbit';
        orbitAzimuth?: number;
        orbitElevation?: number;
        orbitDistance?: number;
        /** [doc:adr-061] Motion Override — 逐骨骼覆盖条目 */
        boneOverrides?: BoneOverrideEntry[];
        /** [doc:adr-085] 脚部地面跟随状态（按模型） */
        feet?: FeetState;
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
    perception?: PerceptionState;
    lipSync?: LipSyncStateType;
    props?: Array<{
        filePath: string;
        libraryRef?: string;
        /** Stable unique identifier for this prop. Persisted to survive re-load cycles. */
        uuid?: string;
        name: string;
        positionX: number;
        positionY: number;
        positionZ: number;
        rotationY: number;
        scaling: number;
        visible: boolean;
        /** [doc:adr-049] 球面坐标轨道控制：坐标模式，缺省按 'cartesian' 处理 */
        positionMode?: 'cartesian' | 'orbit';
        orbitAzimuth?: number;
        orbitElevation?: number;
        orbitDistance?: number;
        /** [doc:adr-061] Accessory 骨骼锚定 */
        boneName?: string;
        targetModelUuid?: string;
        boneOffset?: [number, number, number];
        boneRotation?: [number, number, number];
    }>;
    gravityStrength?: number;
    /** [doc:adr-054] Active formation preset (re-computed on load). */
    formation?: {
        type: FormationType;
        spacing: number;
    };
    stageLight?: StageLightState;
    stageLights?: StageLightState[];
}

// ======== Serialization ========

/** Generate a simple UUID v4 (browser-safe, no crypto dependency). */
function generateUuid(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}

// Map runtime instance ID → persistent UUID, maintained by serialize/deserialize.
const modelUuidMap = new Map<string, string>();
const propUuidMap = new Map<string, string>();

export function serializeScene(): SceneFile {
    const procState = getProcMotionState();
    const lipState = getLipSyncState();
    const models = Array.from(modelRegistry.values()).map((inst) => {
        // Persist UUID — reuse existing if known, generate if first time
        let uuid = modelUuidMap.get(inst.id);
        if (!uuid) {
            uuid = generateUuid();
            modelUuidMap.set(inst.id, uuid);
        }
        return {
            filePath: inst.filePath,
            libraryRef: computeLibraryRef(inst.filePath) || undefined,
            uuid,
            name: inst.name,
            kind: inst.kind,
            vmdPath: inst.vmdPath,
            vmdLibraryRef: inst.vmdPath ? computeLibraryRef(inst.vmdPath) || undefined : undefined,
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
            visible: inst.visible,
            opacity: inst.opacity,
            wireframe: inst.wireframe,
            showBoneLines: inst.showBoneLines,
            showBoneJoints: inst.showBoneJoints,
            physicsEnabled: inst.physicsEnabled,
            outfitVariant: inst.activeVariant,
            positionMode: inst.positionMode,
            orbitAzimuth: inst.orbitAzimuth,
            orbitElevation: inst.orbitElevation,
            orbitDistance: inst.orbitDistance,
            boneOverrides: inst.boneOverrides.length > 0 ? inst.boneOverrides : undefined,
            feet: inst.feet,
        };
    });
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
                      ? computeLibraryRef(getCameraVmdPath()) || undefined
                      : undefined,
                  name: getCameraVmdName(),
                  active: getCameraMode() === 'vmd',
              }
            : undefined,
        audio: getAudioName()
            ? {
                  path: getAudioPath(),
                  libraryRef: getAudioPath()
                      ? computeLibraryRef(getAudioPath()) || undefined
                      : undefined,
                  name: getAudioName(),
                  volume: getVolume(),
                  offset: getAudioOffset(),
                  playing: isAudioPlaying(),
              }
            : undefined,
        procMotion: { ...procState },
        perception: { ...getPerceptionState() },
        lipSync: { ...lipState },
        props: Array.from(propRegistry.values()).map((p) => {
            let uuid = propUuidMap.get(p.id);
            if (!uuid) {
                uuid = generateUuid();
                propUuidMap.set(p.id, uuid);
            }
            return {
                filePath: p.filePath,
                libraryRef: computeLibraryRef(p.filePath) || undefined,
                uuid,
                name: p.name,
                positionX: p.position[0],
                positionY: p.position[1],
                positionZ: p.position[2],
                rotationY: p.rotationY,
                scaling: p.scaling,
                visible: p.visible,
                positionMode: p.positionMode,
                orbitAzimuth: p.orbitAzimuth,
                orbitElevation: p.orbitElevation,
                orbitDistance: p.orbitDistance,
                boneName: p.boneName,
                targetModelUuid: p.targetModelId ? modelUuidMap.get(p.targetModelId) : undefined,
                boneOffset: p.boneOffset,
                boneRotation: p.boneRotation,
            };
        }),
        gravityStrength: getGravityStrength(),
        formation: getActiveFormation()
            ? { type: getActiveFormation()!, spacing: getActiveFormationSpacing() }
            : undefined,
        stageLights: getStageLights(),
    };
}

// ======== Deserialization ========

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
export async function deserializeScene(data: SceneFile, skipEnv = false): Promise<void> {
    // --- Clear existing scene ---
    for (const id of Array.from(modelRegistry.keys())) {
        removeModel(id);
    }
    modelUuidMap.clear();
    for (const id of Array.from(propRegistry.keys())) {
        removeProp(id);
    }
    propUuidMap.clear();

    // --- Phase 1: Load all models and record runtime IDs ---
    // modelIds[i] = runtime instance ID if load succeeded, null if failed
    const modelIds: Array<string | null> = [];
    const errors: string[] = [];

    for (let i = 0; i < data.models.length; i++) {
        const m = data.models[i];
        try {
            const resolvedPath = resolvePathFromRef(m.filePath, m.libraryRef);
            if (!resolvedPath) {
                errors.push(t('scene.serialize.modelPathUnresolved', { name: m.name }));
                modelIds.push(null);
                continue;
            }
            // D5: 直接用 loadPMXFile 返回的运行时 ID 查询，不依赖 focusedModel() 反查
            const loadedId = await loadPMXFile(resolvedPath, m.kind === 'stage', true);
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
            // Map the persisted UUID to the runtime ID
            if (m.uuid) {
                modelUuidMap.set(inst.id, m.uuid);
            }

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
                modelManager.setRotationY(inst.id, m.rotationY);
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
            if (m.boneOverrides) {
                inst.boneOverrides = m.boneOverrides.map((b) => ({
                    boneName: b.boneName,
                    euler: b.euler,
                    weight: b.weight,
                    enabled: b.enabled ?? true,
                }));
            }
            // 恢复脚部调整状态（合并默认值，向前兼容缺字段的旧存档）
            if (m.feet) {
                Object.assign(inst.feet, m.feet);
            }
            if (inst.visible === false) {
                for (const mesh of inst.meshes) {
                    mesh.setEnabled(false);
                }
            }
            if (inst.opacity < 1.0 || inst.wireframe) {
                for (const mesh of inst.meshes) {
                    if (mesh.material) {
                        mesh.material.alpha = inst.opacity;
                        if (mesh.material instanceof StandardMaterial) {
                            mesh.material.wireframe = inst.wireframe;
                        }
                    }
                }
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
    for (let i = 0; i < data.models.length; i++) {
        const id = modelIds[i];
        if (!id) {
            continue;
        } // Model failed to load

        const m = data.models[i];
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
                await loadOutfits(id);
                applyOutfitVariant(id, m.outfitVariant);
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
    }

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
    // IMPORTANT: setEnvSunAngle must be called BEFORE setEnvState because
    // setEnvState's auto-link logic uses the module-level envSunAngle variable.
    // If we set env state first, auto-link would use the OLD sun angle.
    if (data.env && !skipEnv) {
        if (data.env.sunAngle !== undefined) {
            setEnvSunAngle(data.env.sunAngle);
        }
        setEnvState(data.env, true);
    }
    if (data.gravityStrength !== undefined) {
        setGravityStrength(data.gravityStrength);
    }
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
    if (data.procMotion) {
        const s = { ...DEFAULT_PROC_STATE, ...(data.procMotion as Partial<ProcMotionState>) };
        setProcMotionState(s);
        regenerateProcMotion();
    }

    // --- Perception Layer --- [doc:adr-071]
    // 优先读 data.perception；旧存档无此字段时从 procMotion 迁移
    if (data.perception) {
        setPerceptionState(data.perception as Partial<PerceptionState>);
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
            const resolvedPath = resolvePathFromRef(data.cameraVmd.path, data.cameraVmd.libraryRef);
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
                await loadAudioFile(resolvedPath);
                setVolume(data.audio.volume ?? 1);
                setAudioOffset(data.audio.offset ?? 0);
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
                            resumeAudio();
                        }
                    } catch {
                        // If AudioContext is unavailable, just try resumeAudio
                        resumeAudio();
                    }
                }
            }
        } catch (err) {
            logWarn('scene-serialize', '场景恢复: 音频加载失败:', err);
        }
    }

    // --- Props ---
    if (data.props && data.props.length > 0) {
        for (const p of data.props) {
            try {
                const resolvedPath = resolvePathFromRef(p.filePath, p.libraryRef);
                if (!resolvedPath) {
                    continue;
                }
                const propId = await loadProp(resolvedPath);
                if (propId) {
                    if (p.uuid) {
                        propUuidMap.set(propId, p.uuid);
                    }
                    if (
                        p.positionMode === 'orbit' &&
                        p.orbitAzimuth !== undefined &&
                        p.orbitElevation !== undefined &&
                        p.orbitDistance !== undefined
                    ) {
                        setPropTransform(propId, {
                            rotationY: p.rotationY,
                            scaling: p.scaling,
                            visible: p.visible,
                        });
                        setPropOrbit(propId, p.orbitAzimuth, p.orbitElevation, p.orbitDistance);
                    } else {
                        setPropTransform(propId, {
                            position: [p.positionX, p.positionY, p.positionZ],
                            rotationY: p.rotationY,
                            scaling: p.scaling,
                            visible: p.visible,
                        });
                    }
                }
            } catch (err) {
                logWarn('scene-serialize', `场景恢复: 道具 ${p.name} 加载失败:`, err);
            }
        }
    }

    // --- Accessory: 恢复道具骨骼锚定 ---
    if (data.props && data.props.length > 0) {
        for (const p of data.props) {
            if (!p.boneName || !p.targetModelUuid) {
                continue;
            }
            // 通过 UUID 找到运行时的模型 ID
            let targetModelId: string | undefined;
            for (const [runtimeId, uuid] of modelUuidMap) {
                if (uuid === p.targetModelUuid) {
                    targetModelId = runtimeId;
                    break;
                }
            }
            if (!targetModelId) {
                continue;
            }
            // 找到对应的 prop ID
            let propId: string | undefined;
            for (const [runtimeId, uuid] of propUuidMap) {
                if (uuid === p.uuid) {
                    propId = runtimeId;
                    break;
                }
            }
            if (!propId) {
                continue;
            }
            try {
                const { attachPropToBone } = await import('./env/accessory');
                attachPropToBone(
                    propId,
                    p.boneName,
                    targetModelId,
                    p.boneOffset ?? [0, 0, 0],
                    p.boneRotation ?? [0, 0, 0]
                );
            } catch (err) {
                logWarn('scene-serialize', `场景恢复: 道具 ${p.name} 骨骼锚定失败:`, err);
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
}

// ======== Auto-save Debounce ========

const _autoSaveDebounced = debounce((): void => {
    swallowError(saveSceneImmediate());
}, 500);

export function triggerAutoSaveImpl(): void {
    _autoSaveDebounced();
}

/** Save scene immediately (no debounce). Used in visibilitychange / beforeunload.
 *  @param suppressToast  When true (visibilitychange scenario), skip toast on error. */
export async function saveSceneImmediate(suppressToast = false): Promise<void> {
    try {
        const _sStart = performance.now();
        const data = serializeScene();
        const _sSerialize = performance.now() - _sStart;
        const json = JSON.stringify(data);
        const _sJson = performance.now() - _sStart - _sSerialize;
        if (_sSerialize + _sJson > 2) {
            logWarn(
                'perf:save',
                `serialize=${_sSerialize.toFixed(1)}ms json=${_sJson.toFixed(1)}ms len=${json.length}`
            );
        }

        // Go 端作为唯一存储（Fail-Fast：失败直接抛错）
        await SaveLastScene(json);
    } catch (_err) {
        if (!suppressToast) {
            showErrorToast(
                t('scene.serialize.autosaveFailed'),
                _err instanceof Error ? _err.message : String(_err ?? 'unknown error')
            );
        }
    }
}

/** Clean up pending timers and save state. Must be called before window unload. */
function cleanupAndFlushSave(): void {
    // Clear any pending debounced save — we're about to flush immediately
    _autoSaveDebounced.cancel();
    flushEnvState();
    flushUIState();
    swallowError(saveSceneImmediate(true));
}

// Flush save when page becomes hidden (covers app close / Alt+F4 / refresh).
// visibilitychange fires reliably in Wails; beforeunload is fallback.
if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            cleanupAndFlushSave();
        }
    });
    window.addEventListener('beforeunload', () => {
        cleanupAndFlushSave();
    });
}

// ======== Auto-restore ========

/** Currently supported scene file versions. */
const SUPPORTED_VERSIONS = [1];

/**
 * Migrate a scene file from an older version to the latest format.
 * Each migration function transforms the data in-place.
 * Add new migration steps here when the SceneFile format changes.
 */
function migrateScene(data: Record<string, unknown>): Record<string, unknown> {
    let version: number = (data.version as number) ?? 0;

    // v0 → v1: no-op (v1 is the initial version)
    if (version < 1) {
        data.version = 1;
        version = 1;
    }

    // Future migrations:
    // if (version < 2) {
    //     data = migrateV1ToV2(data);
    //     version = 2;
    // }

    return data;
}

export async function tryRestoreLastScene(): Promise<void> {
    let json: string | null = null;

    // Go 端作为唯一存储（Fail-Fast：失败直接抛错）
    json = await LoadLastScene();

    if (!json) {
        return;
    }

    try {
        const raw = JSON.parse(json);

        // 防御二次序列化：parse 后仍是字符串说明数据异常
        if (!raw || typeof raw !== 'object') {
            logWarn('scene-serialize', '场景数据格式异常（可能被二次序列化），跳过恢复');
            return;
        }

        const data = migrateScene(raw);
        const version = data.version as number;

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

        await deserializeScene(data as unknown as SceneFile, true);
        logCameraAlpha(); // 记录当前 alpha 诊断
        console.info(`从 v${version} 场景文件恢复成功`);
    } catch (err) {
        logWarn('scene-serialize', '场景恢复失败（数据可能已损坏）:', err);
    }
}
