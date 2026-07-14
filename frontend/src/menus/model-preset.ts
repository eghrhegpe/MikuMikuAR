// [doc:architecture] Model Preset — 预设序列化/库管理/自动应用

import {
    modelRegistry,
    setStatus,
    PopupLevel,
    computeLibraryRef,
    stackRegistry,
    escapeHtml,
    isPlaying,
} from '../core/config';
import { loadManager } from '../core/load-manager';
import {
    setModelPosition,
    setModelScaling,
    setModelRotationY,
    setModelVisibility,
    setModelOpacity,
    setModelWireframe,
    stopVMD,
    getMatState,
    applyMatState,
    MaterialCategoryParams,
} from '../scene/scene';
import {
    SelectPresetSaveFile,
    SelectPresetOpenFile,
    SaveModelPreset,
    LoadModelPreset,
    GetModelPresets,
    SaveModelPresetToLibAuto,
    LoadModelPresetFromLib,
    DeleteModelPreset,
} from '../core/wails-bindings';
import {
    clearAudio,
    getAudioPath,
    getAudioName,
    getVolume,
    getAudioOffset,
    setVolume,
    setAudioOffset,
} from '../outfit/audio';
import {
    tryCatchStatus,
    showErrorToast,
    getBaseName,
    normPath,
    logWarn,
    jsonStringify,
} from '../core/utils';
import { t } from '../core/i18n/t';
import { buildPresetListLevel as buildGenericPresetLevel } from './preset-list-viewer';

export interface ModelPresetEntry {
    name: string;
    presetName: string;
    modelName: string;
    modelRef: string;
    updatedAt: number;
    autoApply: boolean;
}

export interface ModelPresetFile {
    version: 1;
    presetName?: string;
    autoApply?: boolean;
    model: {
        filePath: string;
        libraryRef?: string;
        name: string;
        kind: 'actor' | 'stage';
    };
    transform: {
        positionX?: number;
        positionY?: number;
        positionZ?: number;
        scaling?: number;
        rotationY?: number;
    };
    visibility: {
        visible?: boolean;
        opacity?: number;
        wireframe?: boolean;
    };
    vmd: {
        path: string | null;
        libraryRef?: string | undefined;
        name: string;
        playing?: boolean;
    };
    audio?: {
        path: string;
        name: string;
        volume: number;
        offset: number;
    };
    materialCategories?: Record<string, MaterialCategoryParams>;
    materialOverrides?: Record<number, MaterialCategoryParams>;
    materialEnabled?: Record<number, boolean>;
}

export function serializeModelPreset(id: string, presetName?: string): string {
    const inst = modelRegistry.get(id);
    if (!inst) {
        return '';
    }
    const matState = getMatState(id);
    const rm = inst.rootMesh;
    const pos = rm?.position ?? { x: 0, y: 0, z: 0 };
    const preset: ModelPresetFile = {
        version: 1,
        presetName: presetName,
        model: {
            filePath: inst.filePath,
            libraryRef: computeLibraryRef(inst.filePath) || undefined,
            name: inst.name,
            kind: inst.kind,
        },
        transform: {
            positionX: pos.x,
            positionY: pos.y,
            positionZ: pos.z,
            scaling: inst.scaling,
            rotationY: inst.rotationY,
        },
        visibility: {
            visible: inst.visible,
            opacity: inst.opacity,
            wireframe: inst.wireframe,
        },
        vmd: {
            path: inst.vmdPath,
            libraryRef: inst.vmdPath ? computeLibraryRef(inst.vmdPath) || undefined : undefined,
            name: inst.vmdName,
            playing: inst.vmdPath ? isPlaying : undefined,
        },
        audio: getAudioPath()
            ? {
                  path: getAudioPath(),
                  name: getAudioName(),
                  volume: getVolume(),
                  offset: getAudioOffset(),
              }
            : undefined,
        materialCategories: matState?.categories ?? {},
        materialOverrides: matState?.overrides ?? {},
        materialEnabled: matState?.enabled ?? {},
    };
    return jsonStringify(preset);
}

export async function applyModelPreset(id: string, jsonStr: string): Promise<void> {
    let preset: ModelPresetFile;
    try {
        preset = JSON.parse(jsonStr);
    } catch {
        setStatus(t('model-preset.formatError'), false);
        return;
    }
    if (preset.version !== 1) {
        setStatus(t('model-preset.unsupportedVersion'), false);
        return;
    }
    if (preset.transform) {
        const t = preset.transform;
        if (t.positionX !== undefined && t.positionY !== undefined && t.positionZ !== undefined) {
            setModelPosition(id, t.positionX, t.positionY, t.positionZ);
        }
        if (t.scaling !== undefined) {
            setModelScaling(id, t.scaling);
        }
        if (t.rotationY !== undefined) {
            setModelRotationY(id, t.rotationY);
        }
    }
    if (preset.visibility) {
        const v = preset.visibility;
        if (v.visible !== undefined) {
            setModelVisibility(id, v.visible);
        }
        if (v.opacity !== undefined) {
            setModelOpacity(id, v.opacity);
        }
        if (v.wireframe !== undefined) {
            setModelWireframe(id, v.wireframe);
        }
    }
    if (preset.vmd) {
        if (preset.vmd.path) {
            stopVMD(id);
            try {
                await loadManager.load({ kind: 'vmd', path: preset.vmd.path, modelId: id });
            } catch (vmdErr) {
                setStatus(t('model-preset.vmdLoadFailed'), false);
                logWarn('model-preset', 'applyModelPreset: vmd load failed', vmdErr);
            }
        } else {
            stopVMD(id);
        }
    }
    if (preset.materialCategories || preset.materialOverrides || preset.materialEnabled) {
        applyMatState(id, {
            categories: preset.materialCategories,
            overrides: preset.materialOverrides,
            enabled: preset.materialEnabled,
        });
    }
    if (preset.audio && preset.audio.path) {
        try {
            await loadManager.load({ kind: 'audio', path: preset.audio.path });
            setVolume(preset.audio.volume);
            setAudioOffset(preset.audio.offset);
        } catch (_) {
            /* audio load failed, non-fatal */
        }
    } else if (getAudioPath()) {
        clearAudio();
    }
    setStatus(t('model-preset.applied'), true);
}

export async function selectAndSavePreset(id: string): Promise<void> {
    const path = await SelectPresetSaveFile();
    if (!path) {
        return;
    }
    const json = serializeModelPreset(id);
    if (!json) {
        setStatus(t('model-preset.serializeFailed'), false);
        return;
    }
    const _r0 = await tryCatchStatus(
        () => SaveModelPreset(json, path),
        t('model-preset.saveFailed'),
        (err) =>
            showErrorToast(
                t('model-preset.saveErrorToast'),
                err instanceof Error ? err.message : String(err)
            )
    );
    if (_r0 !== undefined) {
        setStatus(t('model-preset.saved'), true);
    }
}

const _presetUndoStack = new Map<string, string>();

function showUndoToast(message: string, undoFn: () => void): void {
    showErrorToast(message, undefined, [{ label: t('toast.undo'), onClick: undoFn }], 8000);
}

export async function tryAutoApplyPreset(id: string): Promise<void> {
    const inst = modelRegistry.get(id);
    if (!inst) {
        return;
    }
    setStatus(t('model-preset.loadingLib'), false);
    const entries: ModelPresetEntry[] = (await GetModelPresets()) || [];
    if (entries.length === 0) {
        return;
    }
    const libraryRef = computeLibraryRef(inst.filePath);
    const match = entries.find((e) => {
        if (!e.name) {
            return false;
        }
        if (libraryRef && e.modelRef === libraryRef) {
            return true;
        }
        if (e.modelRef && normPath(inst.filePath).endsWith(e.modelRef)) {
            return true;
        }
        return false;
    });
    if (!match) {
        return;
    }
    const json = await LoadModelPresetFromLib(match.name);
    const preset: ModelPresetFile = JSON.parse(json);
    if (preset.autoApply !== true) {
        return;
    }
    _presetUndoStack.set(id, serializeModelPreset(id));
    await applyModelPreset(id, json);
    showUndoToast(
        t('model-preset.autoApplied', { name: escapeHtml(preset.presetName || match.name) }),
        async () => {
            const snap = _presetUndoStack.get(id);
            _presetUndoStack.delete(id);
            if (snap) {
                await applyModelPreset(id, snap);
            }
            setStatus(t('model-preset.undoApplied'), true);
        }
    );
}

export async function selectAndLoadPreset(id: string): Promise<void> {
    const path = await SelectPresetOpenFile();
    if (!path) {
        return;
    }
    await tryCatchStatus(async () => {
        const json = await LoadModelPreset(path);
        await applyModelPreset(id, json);
    }, t('model-preset.loadFailed'));
}

export async function applyPresetFromLib(
    presetName: string,
    targetModelId: string | null
): Promise<void> {
    await tryCatchStatus(async () => {
        const json = await LoadModelPresetFromLib(presetName);
        const preset: ModelPresetFile = JSON.parse(json);
        if (targetModelId) {
            await applyModelPreset(targetModelId, json);
        } else {
            const targetRef = computeLibraryRef(preset.model.filePath);
            let matchedId: string | null = null;
            for (const [mid, inst] of modelRegistry) {
                if (inst.filePath === preset.model.filePath) {
                    matchedId = mid;
                    break;
                }
                if (targetRef && computeLibraryRef(inst.filePath) === targetRef) {
                    matchedId = mid;
                    break;
                }
                const baseName = getBaseName(preset.model.filePath);
                if (baseName && normPath(inst.filePath).endsWith(baseName)) {
                    matchedId = mid;
                    break;
                }
            }
            if (matchedId) {
                await applyModelPreset(matchedId, json);
            } else {
                const handle = await loadManager.load({
                    kind: 'actor',
                    path: preset.model.filePath,
                });
                if (handle) {
                    await applyModelPreset(handle.id, json);
                } else {
                    setStatus(t('model-preset.modelLoadFailed'), false);
                }
            }
        }
    }, t('model-preset.applyFailed'));
}

export async function savePresetToLibDialog(id: string): Promise<void> {
    const json = serializeModelPreset(id);
    if (!json) {
        setStatus(t('model-preset.serializeFailed'), false);
        return;
    }
    const filename = await tryCatchStatus(
        () => SaveModelPresetToLibAuto(json),
        t('model-preset.saveFailed'),
        (err) =>
            showErrorToast(
                t('model-preset.saveErrorToast'),
                err instanceof Error ? err.message : String(err)
            )
    );
    if (filename !== undefined) {
        setStatus(t('model-preset.savedToLib'), true);
    }
}

export function buildPresetListLevel(id: string | null): PopupLevel {
    const reRender = () => stackRegistry.modelStack.reRender();
    return buildGenericPresetLevel(
        {
            label: t('model-preset.presetLib'),
            loadItems: () => GetModelPresets().then((e) => e || []),
            getLabel: (e) => e.presetName || e.name,
            onApply: async (e) => {
                await applyPresetFromLib(e.name, id);
            },
            onDelete: async (e) => {
                const r = await tryCatchStatus(
                    () => DeleteModelPreset(e.name),
                    t('model-preset.deleteFailed')
                );
                if (r === undefined) {
                    throw new Error('delete failed');
                }
                setStatus(t('model-preset.deleted'), true);
            },
            deleteConfirmText: (e) =>
                t('model-preset.confirmDelete', { name: e.presetName || e.name }),
            emptyText: t('model-preset.noPresets'),
        },
        reRender
    );
}
