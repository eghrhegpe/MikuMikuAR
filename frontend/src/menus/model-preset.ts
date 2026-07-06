// [doc:architecture] Model Preset — 预设序列化/库管理/自动应用

import {
    modelRegistry,
    cardContainer,
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
} from '../scene/scene';
import {
    SelectPresetSaveFile,
    SelectPresetOpenFile,
    SaveModelPreset,
    LoadModelPreset,
    GetModelPresets,
    SaveModelPresetToLib,
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
import { showConfirm, showPrompt } from '../core/dialog';
import { tryCatchStatus, showErrorToast } from '../core/utils';

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
    materialCategories?: Record<
        string,
        { diffuseMul: number; specularMul: number; shininess: number; ambientMul: number }
    >;
    materialOverrides?: Record<
        number,
        { diffuseMul: number; specularMul: number; shininess: number; ambientMul: number }
    >;
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
    return JSON.stringify(preset, null, 2);
}

export async function applyModelPreset(id: string, jsonStr: string): Promise<void> {
    let preset: ModelPresetFile;
    try {
        preset = JSON.parse(jsonStr);
    } catch {
        setStatus('✗ 预设文件格式错误', false);
        return;
    }
    if (preset.version !== 1) {
        setStatus('✗ 不支持的预设版本', false);
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
                setStatus('⚠ VMD 加载失败，其余预设已应用', false);
                console.warn('applyModelPreset: vmd load failed', vmdErr);
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
    setStatus('✓ 预设已应用', true);
}

export async function selectAndSavePreset(id: string): Promise<void> {
    const path = await SelectPresetSaveFile();
    if (!path) {
        return;
    }
    const json = serializeModelPreset(id);
    if (!json) {
        setStatus('✗ 无法序列化模型状态', false);
        return;
    }
    const _r0 = await tryCatchStatus(() => SaveModelPreset(json, path), '✗ 保存失败', (err) => showErrorToast('保存模型预设失败', err instanceof Error ? err.message : String(err)));
    if (_r0 !== undefined) {
        setStatus('✓ 预设已保存', true);
    }
}

const _presetUndoStack = new Map<string, string>();

function showUndoToast(message: string, undoFn: () => void): void {
    showErrorToast(message, undefined, [{ label: '撤销', onClick: undoFn }], 8000);
}

export async function tryAutoApplyPreset(id: string): Promise<void> {
    const inst = modelRegistry.get(id);
    if (!inst) {
        return;
    }
    setStatus('正在加载预设库...', false);
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
        if (e.modelRef && inst.filePath.replace(/\\/g, '/').endsWith(e.modelRef)) {
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
    showUndoToast(`已自动应用预设「${escapeHtml(preset.presetName || match.name)}」`, async () => {
        const snap = _presetUndoStack.get(id);
        _presetUndoStack.delete(id);
        if (snap) {
            await applyModelPreset(id, snap);
        }
        setStatus('✓ 已撤销预设应用', true);
    });
}

export async function selectAndLoadPreset(id: string): Promise<void> {
    const path = await SelectPresetOpenFile();
    if (!path) {
        return;
    }
    await tryCatchStatus(async () => {
        const json = await LoadModelPreset(path);
        await applyModelPreset(id, json);
    }, '✗ 加载失败');
}

export async function togglePresetAutoApply(name: string): Promise<void> {
    await tryCatchStatus(async () => {
        const json = await LoadModelPresetFromLib(name);
        const preset: ModelPresetFile = JSON.parse(json);
        preset.autoApply = !preset.autoApply;
        await SaveModelPresetToLib(name, JSON.stringify(preset, null, 2));
    }, '✗ 切换自动应用失败');
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
                const baseName = preset.model.filePath.replace(/\\/g, '/').split('/').pop();
                if (baseName && inst.filePath.replace(/\\/g, '/').endsWith(baseName)) {
                    matchedId = mid;
                    break;
                }
            }
            if (matchedId) {
                await applyModelPreset(matchedId, json);
            } else {
                const handle = await loadManager.load({ kind: 'actor', path: preset.model.filePath });
                if (handle) {
                    await applyModelPreset(handle.id, json);
                } else {
                    setStatus('✗ 模型加载失败，无法应用预设', false);
                }
            }
        }
    }, '✗ 应用预设失败');
}

export async function savePresetToLibDialog(id: string): Promise<void> {
    const name = await showPrompt('输入预设名称：');
    if (!name) {
        return;
    }
    const trimmed = name.trim();
    if (!trimmed) {
        setStatus('✗ 名称不能为空', false);
        return;
    }
    let json = serializeModelPreset(id, trimmed);
    if (!json) {
        setStatus('✗ 无法序列化模型状态', false);
        return;
    }
    try {
        const existing = await LoadModelPresetFromLib(trimmed);
        if (existing) {
            const existingPreset: ModelPresetFile = JSON.parse(existing);
            if (existingPreset.autoApply) {
                const merged: ModelPresetFile = JSON.parse(json);
                merged.autoApply = true;
                json = JSON.stringify(merged, null, 2);
            }
        }
    } catch {
        /* no existing preset — fine */
    }
    const _r1 = await tryCatchStatus(() => SaveModelPresetToLib(trimmed, json), '✗ 保存失败', (err) => showErrorToast('保存模型预设失败', err instanceof Error ? err.message : String(err)));
    if (_r1 !== undefined) {
        setStatus('✓ 预设已保存到库', true);
    }
}

export function buildPresetListLevel(id: string | null): PopupLevel {
    return {
        label: '预设库',
        dir: '',
        items: [],
        renderCustom: async (container) => {
            container.classList.remove('render-card');
            setStatus('正在加载预设库...', false);
            const entries: ModelPresetEntry[] = (await GetModelPresets()) || [];
            if (entries.length === 0) {
                const empty = document.createElement('div');
                empty.style.cssText =
                    'font-size:12px;color:var(--text-dim);text-align:center;padding:24px;';
                empty.textContent = '暂无预设';
                container.appendChild(empty);
                return;
            }
            cardContainer(container, (c) => {
                for (const e of entries) {
                    const row = document.createElement('div');
                    row.className = 'slide-item';
                    const iconSpan = document.createElement('span');
                    iconSpan.className = 'slide-icon';
                    const iconify = document.createElement('iconify-icon');
                    iconify.icon = 'lucide:bookmark';
                    iconSpan.appendChild(iconify);
                    row.appendChild(iconSpan);
                    const labelSpan = document.createElement('span');
                    labelSpan.className = 'slide-label';
                    labelSpan.textContent = e.presetName || e.name;
                    row.appendChild(labelSpan);
                    if (e.modelName) {
                        const sub = document.createElement('span');
                        sub.style.cssText =
                            'font-size:11px;color:var(--text-dim);margin-right:4px;';
                        sub.textContent = e.modelName;
                        row.appendChild(sub);
                    }
                    const toggleLabel = document.createElement('label');
                    toggleLabel.className = 'toggle';
                    toggleLabel.title = e.autoApply ? '自动应用：开' : '自动应用：关';
                    const toggleInput = document.createElement('input');
                    toggleInput.type = 'checkbox';
                    toggleInput.checked = e.autoApply;
                    toggleInput.addEventListener('change', async (ev) => {
                        ev.stopPropagation();
                        await togglePresetAutoApply(e.name);
                        stackRegistry.modelStack.reRender();
                    });
                    const slider = document.createElement('span');
                    slider.className = 'slider';
                    toggleLabel.appendChild(toggleInput);
                    toggleLabel.appendChild(slider);
                    row.appendChild(toggleLabel);
                    const delBtn = document.createElement('span');
                    delBtn.textContent = '✕';
                    delBtn.title = '删除此预设';
                    delBtn.style.cssText =
                        'font-size:10px;color:var(--text-dim);cursor:pointer;padding:2px 6px;';
                    delBtn.addEventListener('click', async (ev) => {
                        ev.stopPropagation();
                        if (!(await showConfirm(`确定删除「${e.presetName || e.name}」？`))) {
                            return;
                        }
                        const _r2 = await tryCatchStatus(async () => {
                            await DeleteModelPreset(e.name);
                            stackRegistry.modelStack.reRender();
                        }, '✗ 删除失败');
                        if (_r2 !== undefined) {
                            setStatus('✓ 预设已删除', true);
                        }
                    });
                    row.appendChild(delBtn);
                    row.addEventListener('click', (ev) => {
                        if ((ev.target as HTMLElement).closest('.toggle')) {
                            return;
                        }
                        applyPresetFromLib(e.name, id);
                    });
                    c.appendChild(row);
                }
            });
        },
    };
}
