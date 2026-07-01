// [doc:architecture] Scene Serialization — 场景序列化与自动保存
// 规范文档: docs/architecture.md §场景序列化
// 职责: SceneFile 定义、serialize/deserialize、auto-save debounce、last-scene restore
// 注意: 从 scene.ts 静态导入但仅在函数体内访问，ES module live binding 保证安全。

import { SaveLastScene, LoadLastScene } from '../../wailsjs/go/main/App';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';

import {
    computeLibraryRef,
    resolveLibraryRef,
    envState,
    EnvState,
    modelRegistry,
    propRegistry,
} from '../core/config';
import {
    getCameraState,
    setCameraState,
    hasCameraVmd,
    getCameraVmdPath,
    getCameraVmdName,
    getCameraMode,
    switchCameraMode,
} from './camera';
import { loadCameraVmdFromPath } from './scene-vmd';
import type { CameraState } from './camera';
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
    getRenderState,
    setRenderState,
    removeModel,
    loadPMXFile,
    focusedModel,
    setModelBoneLinesVis,
    setModelBoneJointsVis,
    setModelPhysics,
    loadVMDFromPath,
    LightState,
    RenderState,
} from './scene';
import { removeProp, loadProp, setPropTransform } from './scene-props';
import { setEnvState, setEnvSunAngle } from './scene-env-bridge';
import { setGravityStrength, getGravityStrength } from './scene-env-bridge';
import { regenerateProcMotion, getProcMotionState, setProcMotionState } from './scene-proc-motion';
import { getLipSyncState, setLipSyncState } from './scene-lipsync';

import { DEFAULT_PROC_STATE } from '../motion/procedural-motion';
import { DEFAULT_LIPSYNC_STATE } from '../motion/lipsync';
import type { ProcMotionState } from '../motion/procedural-motion';
import type { LipSyncState as LipSyncStateType } from '../motion/lipsync';

// ======== Utilities ========

/**
 * Resolve a file path from either a libraryRef or a raw absolute path.
 * Returns the resolved absolute path, or null if neither source is valid.
 * This centralizes the "(libraryRef ? resolveLibraryRef(...) : null) || filePath" pattern
 * that appears repeatedly in serialize/deserialize.
 */
function resolvePathFromRef(filePath: string, libraryRef?: string): string | null {
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
    }>;
    gravityStrength?: number;
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
            };
        }),
        gravityStrength: getGravityStrength(),
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
                errors.push(`模型 ${m.name}: 无法解析文件路径`);
                modelIds.push(null);
                continue;
            }
            await loadPMXFile(resolvedPath, m.kind === 'stage', true);
            const inst = focusedModel();
            if (!inst || inst.meshes.length === 0) {
                errors.push(`模型 ${m.name}: 加载成功但无网格数据`);
                modelIds.push(null);
                continue;
            }
            modelIds.push(inst.id);
            // Map the persisted UUID to the runtime ID
            if (m.uuid) {
                modelUuidMap.set(inst.id, m.uuid);
            }

            // Apply immediate model properties (position, scale, visibility, etc.)
            inst.meshes[0].position.x = m.positionX ?? 0;
            inst.meshes[0].position.y = m.positionY ?? 0;
            inst.meshes[0].position.z = m.positionZ ?? 0;
            if (m.scaling !== undefined) {
                inst.scaling = m.scaling;
                inst.meshes[0].scaling.setAll(m.scaling);
            }
            if (m.rotationY !== undefined) {
                inst.rotationY = m.rotationY;
                inst.meshes[0].rotation.y = m.rotationY;
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
            errors.push(`模型 ${m.name}: ${(err as Error)?.message ?? String(err)}`);
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
                console.warn(`场景恢复: 模型 ${m.name} VMD 加载失败:`, err);
            }
        }
        if (m.outfitVariant) {
            try {
                await loadOutfits(id);
                applyOutfitVariant(id, m.outfitVariant);
            } catch (err) {
                console.warn(`场景恢复: 模型 ${m.name} 变体应用失败:`, err);
            }
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

    // --- Procedural Motion ---
    // regenerateProcMotion() is needed because procedural motion is driven by
    // per-frame callbacks that get reset when models are cleared/reloaded.
    // Simply restoring state won't re-register these callbacks.
    if (data.procMotion) {
        const s = { ...DEFAULT_PROC_STATE, ...(data.procMotion as Partial<ProcMotionState>) };
        setProcMotionState(s);
        regenerateProcMotion();
    }

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
            console.warn('场景恢复: 相机 VMD 加载失败:', err);
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
                            console.warn(
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
            console.warn('场景恢复: 音频加载失败:', err);
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
                    setPropTransform(propId, {
                        position: [p.positionX, p.positionY, p.positionZ],
                        rotationY: p.rotationY,
                        scaling: p.scaling,
                        visible: p.visible,
                    });
                }
            } catch (err) {
                console.warn(`场景恢复: 道具 ${p.name} 加载失败:`, err);
            }
        }
    }

    // --- Report loading errors ---
    if (errors.length > 0) {
        console.warn(`场景恢复: ${errors.length}/${data.models.length} 个模型加载失败`);
        for (const err of errors) {
            console.warn(`  - ${err}`);
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

let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;

/** localStorage key for backup auto-save (sync fallback when async Go call can't complete). */
const LOCAL_SAVE_KEY = 'mikumikuar_last_scene_backup';

export function triggerAutoSaveImpl(): void {
    if (autoSaveTimer) {
        clearTimeout(autoSaveTimer);
    }
    autoSaveTimer = setTimeout(() => {
        saveSceneImmediate().catch(() => {});
    }, 2000);
}

/** Save scene immediately (no debounce). Used in visibilitychange / beforeunload. */
export async function saveSceneImmediate(): Promise<void> {
    try {
        const json = JSON.stringify(serializeScene());

        // Always write to localStorage as a synchronous backup.
        // If the Go call below is interrupted by window close, this
        // backup will be picked up on the next app launch.
        try {
            localStorage.setItem(LOCAL_SAVE_KEY, json);
        } catch {
            // localStorage may be full or unavailable — ignore
        }

        await SaveLastScene(json);

        // If we got here, the Go-side save completed successfully.
        // Clean up the localStorage backup since it's no longer needed.
        try {
            localStorage.removeItem(LOCAL_SAVE_KEY);
        } catch {
            // ignore
        }
    } catch (_err) {
        // Silent — auto-save is best-effort
    }
}

/** Clean up pending timers and save state. Must be called before window unload. */
function cleanupAndFlushSave(): void {
    // Clear any pending debounced save — we're about to flush immediately
    if (autoSaveTimer) {
        clearTimeout(autoSaveTimer);
        autoSaveTimer = null;
    }
    saveSceneImmediate().catch(() => {});
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

    try {
        json = await LoadLastScene();
    } catch {
        // No saved scene from Go backend
    }

    // Fallback: check localStorage for a backup from a previous interrupted save
    if (!json) {
        try {
            const backup = localStorage.getItem(LOCAL_SAVE_KEY);
            if (backup) {
                json = backup;
                console.info('从本地存储备份恢复场景');
                // Don't remove the backup here — saveSceneImmediate will do it
                // after the next successful save.
            }
        } catch {
            // localStorage unavailable
        }
    }

    if (!json) {
        return;
    }

    try {
        const raw = JSON.parse(json);
        if (!raw) {
            return;
        }

        // Run version migration before checking version
        const data = migrateScene(raw);
        const version = data.version as number;

        if (SUPPORTED_VERSIONS.includes(version)) {
            await deserializeScene(data as unknown as SceneFile, true);
            console.info(`从 v${version} 场景文件恢复成功`);
        } else {
            console.warn(
                `场景文件版本 v${version} 不受支持（支持: ${SUPPORTED_VERSIONS.join(', ')}）`
            );
        }
    } catch (err) {
        // Corrupt or unparseable — silently skip
        console.warn('场景恢复失败（数据可能已损坏）:', err);
    }
}
