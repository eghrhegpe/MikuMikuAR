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

// ======== Scene File Format ========

export interface SceneFile {
    version: 1;
    models: Array<{
        filePath: string;
        libraryRef?: string;
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

export function serializeScene(): SceneFile {
    const procState = getProcMotionState();
    const lipState = getLipSyncState();
    const models = Array.from(modelRegistry.values()).map((inst) => ({
        filePath: inst.filePath,
        libraryRef: computeLibraryRef(inst.filePath) || undefined,
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
    }));
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
        props: Array.from(propRegistry.values()).map((p) => ({
            filePath: p.filePath,
            libraryRef: computeLibraryRef(p.filePath) || undefined,
            name: p.name,
            positionX: p.position[0],
            positionY: p.position[1],
            positionZ: p.position[2],
            rotationY: p.rotationY,
            scaling: p.scaling,
            visible: p.visible,
        })),
        gravityStrength: getGravityStrength(),
    };
}

// ======== Deserialization ========

export async function deserializeScene(data: SceneFile, skipEnv = false): Promise<void> {
    for (const id of Array.from(modelRegistry.keys())) {
        removeModel(id);
    }
    for (const id of Array.from(propRegistry.keys())) {
        removeProp(id);
    }
    for (const m of data.models) {
        try {
            const resolvedPath =
                (m.libraryRef ? resolveLibraryRef(m.libraryRef) : null) || m.filePath;
            await loadPMXFile(resolvedPath, m.kind === 'stage', true);
            const inst = focusedModel();
            if (inst && inst.meshes[0]) {
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
            }
            if (m.vmdPath) {
                const resolvedVmdPath =
                    (m.vmdLibraryRef ? resolveLibraryRef(m.vmdLibraryRef) : null) || m.vmdPath;
                await loadVMDFromPath(resolvedVmdPath);
            }
            if (m.outfitVariant) {
                const freshInst = focusedModel();
                if (freshInst) {
                    await loadOutfits(freshInst.id);
                    applyOutfitVariant(freshInst.id, m.outfitVariant);
                }
            }
        } catch (err) {
            console.warn(`Scene restore: skip ${m.name}:`, err);
        }
    }
    if (data.camera) {
        setCameraState(data.camera);
    }
    if (data.lights) {
        setLightState(data.lights);
    }
    if (data.render) {
        setRenderState(data.render);
    }
    if (data.env && !skipEnv) {
        setEnvState(data.env, true);
    }
    if (data.env.sunAngle !== undefined) {
        setEnvSunAngle(data.env.sunAngle);
    }
    if (data.gravityStrength !== undefined) {
        setGravityStrength(data.gravityStrength);
    }

    if (data.procMotion) {
        const s = { ...DEFAULT_PROC_STATE, ...(data.procMotion as Partial<ProcMotionState>) };
        setProcMotionState(s);
        regenerateProcMotion();
    }

    if (data.lipSync) {
        setLipSyncState({
            ...DEFAULT_LIPSYNC_STATE,
            ...(data.lipSync as Partial<LipSyncStateType>),
        });
    } else {
        setLipSyncState({ ...DEFAULT_LIPSYNC_STATE });
    }

    if (data.cameraVmd && data.cameraVmd.path) {
        try {
            const resolvedPath =
                (data.cameraVmd.libraryRef ? resolveLibraryRef(data.cameraVmd.libraryRef) : null) ||
                data.cameraVmd.path;
            await loadCameraVmdFromPath(resolvedPath);
            if (data.cameraVmd.active) {
                switchCameraMode('vmd');
            }
        } catch (err) {
            console.warn('Scene restore: camera VMD failed:', err);
        }
    }

    if (data.audio && data.audio.path) {
        try {
            const resolvedPath =
                (data.audio.libraryRef ? resolveLibraryRef(data.audio.libraryRef) : null) ||
                data.audio.path;
            await loadAudioFile(resolvedPath);
            setVolume(data.audio.volume ?? 1);
            setAudioOffset(data.audio.offset ?? 0);
            if (data.audio.playing) {
                resumeAudio();
            }
        } catch (err) {
            console.warn('Scene restore: audio failed:', err);
        }
    }

    if (data.props && data.props.length > 0) {
        for (const p of data.props) {
            try {
                const resolvedPath =
                    (p.libraryRef ? resolveLibraryRef(p.libraryRef) : null) || p.filePath;
                const propId = await loadProp(resolvedPath);
                if (propId) {
                    setPropTransform(propId, {
                        position: [p.positionX, p.positionY, p.positionZ],
                        rotationY: p.rotationY,
                        scaling: p.scaling,
                        visible: p.visible,
                    });
                }
            } catch (err) {
                console.warn(`Scene restore: skip prop ${p.name}:`, err);
            }
        }
    }
}

// ======== Auto-save Debounce ========

let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;

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
        await SaveLastScene(json);
    } catch (err) {
        // Silent — auto-save is best-effort
    }
}

// Flush save when page becomes hidden (covers app close / Alt+F4 / refresh).
// visibilitychange fires reliably in Wails; beforeunload is fallback.
if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            saveSceneImmediate().catch(() => {});
        }
    });
    window.addEventListener('beforeunload', () => {
        saveSceneImmediate().catch(() => {});
    });
}

// ======== Auto-restore ========

export async function tryRestoreLastScene(): Promise<void> {
    try {
        const json = await LoadLastScene();
        if (!json) {
            return;
        }
        const data = JSON.parse(json);
        if (data && data.version === 1) {
            await deserializeScene(data, true);
            console.log('Auto-restored last scene');
        }
    } catch (err) {
        // No saved scene or corrupt — silent
    }
}
