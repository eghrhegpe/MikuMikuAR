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
} from "./core/config";
import {
  setModelPosition,
  setModelScaling,
  setModelRotationY,
  setModelVisibility,
  setModelOpacity,
  setModelWireframe,
  stopVMD,
  loadVMDFromPath,
  getMatState,
  applyMatState,
} from "./scene/scene";
import { createIconifyIcon } from "./core/icons";
import { getAudioPath, getAudioName, getVolume, getAudioOffset } from "./audio";
import { loadOutfits, applyOutfitVariant } from "./outfit";
import {
  SelectPresetSaveFile,
  SelectPresetOpenFile,
  SaveModelPreset,
  LoadModelPreset,
  GetModelPresets,
  SaveModelPresetToLib,
  LoadModelPresetFromLib,
  DeleteModelPreset,
  RenameModelPreset,
} from "../wailsjs/go/main/App";

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
    kind: "actor" | "stage";
  };
  transform: {
    positionX?: number; positionY?: number; positionZ?: number;
    scaling?: number; rotationY?: number;
  };
  visibility: {
    visible?: boolean; opacity?: number; wireframe?: boolean;
  };
  vmd: {
    path: string | null;
    libraryRef?: string | undefined;
    name: string;
    playing?: boolean;
  };
  audio?: {
    path: string; name: string; volume: number; offset: number;
  };
  materialCategories?: Record<string, { diffuseMul: number; specularMul: number; shininess: number; ambientMul: number }>;
  materialOverrides?: Record<number, { diffuseMul: number; specularMul: number; shininess: number; ambientMul: number }>;
}

export function serializeModelPreset(id: string, presetName?: string): string {
  const inst = modelRegistry.get(id);
  if (!inst) return "";
  const matState = getMatState(id);
  const rm = inst.rootMesh;
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
      positionX: rm?.position.x ?? 0,
      positionY: rm?.position.y ?? 0,
      positionZ: rm?.position.z ?? 0,
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
      libraryRef: inst.vmdPath ? (computeLibraryRef(inst.vmdPath) || undefined) : undefined,
      name: inst.vmdName,
      playing: inst.vmdPath ? isPlaying : undefined,
    },
    audio: getAudioPath() ? {
      path: getAudioPath(),
      name: getAudioName(),
      volume: getVolume(),
      offset: getAudioOffset(),
    } : undefined,
    materialCategories: matState?.categories,
    materialOverrides: matState?.overrides,
  };
  return JSON.stringify(preset, null, 2);
}

export async function applyModelPreset(id: string, jsonStr: string): Promise<void> {
  let preset: ModelPresetFile;
  try { preset = JSON.parse(jsonStr); } catch { setStatus("✗ 预设文件格式错误", false); return; }
  if (preset.version !== 1) { setStatus("✗ 不支持的预设版本", false); return; }
  if (preset.transform) {
    const t = preset.transform;
    if (t.positionX !== undefined && t.positionY !== undefined && t.positionZ !== undefined) {
      setModelPosition(id, t.positionX, t.positionY, t.positionZ);
    }
    if (t.scaling !== undefined) setModelScaling(id, t.scaling);
    if (t.rotationY !== undefined) setModelRotationY(id, t.rotationY);
  }
  if (preset.visibility) {
    const v = preset.visibility;
    if (v.visible !== undefined) setModelVisibility(id, v.visible);
    if (v.opacity !== undefined) setModelOpacity(id, v.opacity);
    if (v.wireframe !== undefined) setModelWireframe(id, v.wireframe);
  }
  if (preset.vmd) {
    if (preset.vmd.path) {
      stopVMD(id);
      loadVMDFromPath(preset.vmd.path, id);
    } else {
      stopVMD(id);
    }
  }
  if (preset.materialCategories || preset.materialOverrides) {
    applyMatState(id, { categories: preset.materialCategories, overrides: preset.materialOverrides });
  }
  setStatus("✓ 预设已应用", true);
}

export async function selectAndSavePreset(id: string): Promise<void> {
  const path = await SelectPresetSaveFile();
  if (!path) return;
  const json = serializeModelPreset(id);
  if (!json) {
    setStatus("✗ 无法序列化模型状态", false);
    return;
  }
  try {
    await SaveModelPreset(json, path);
    setStatus("✓ 预设已保存", true);
  } catch (err: any) {
    setStatus("✗ 保存失败: " + (err.message || err), false);
  }
}

const _presetUndoStack = new Map<string, string>();

function showUndoToast(message: string, undoFn: () => void): void {
  const existing = document.getElementById("preset-undo-toast");
  if (existing) existing.remove();
  const toast = document.createElement("div");
  toast.id = "preset-undo-toast";
  toast.style.cssText = "position:fixed;bottom:48px;left:50%;transform:translateX(-50%);background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:8px 16px;display:flex;align-items:center;gap:12px;z-index:9999;font-size:13px;box-shadow:0 2px 12px rgba(0,0,0,0.3);";
  const msg = document.createElement("span");
  msg.textContent = message;
  toast.appendChild(msg);
  const undoBtn = document.createElement("button");
  undoBtn.className = "mode-btn";
  undoBtn.textContent = "撤销";
  undoBtn.style.cssText = "font-size:12px;padding:2px 10px;cursor:pointer;";
  undoBtn.addEventListener("click", () => { undoFn(); toast.remove(); });
  toast.appendChild(undoBtn);
  const closeBtn = document.createElement("span");
  closeBtn.textContent = "✕";
  closeBtn.style.cssText = "font-size:10px;color:var(--text-dim);cursor:pointer;padding:2px;";
  closeBtn.addEventListener("click", () => toast.remove());
  toast.appendChild(closeBtn);
  document.body.appendChild(toast);
  setTimeout(() => { if (toast.parentNode) toast.remove(); }, 8000);
}

export async function tryAutoApplyPreset(id: string): Promise<void> {
  const inst = modelRegistry.get(id);
  if (!inst) return;
  const entries: ModelPresetEntry[] = (await GetModelPresets()) || [];
  const libraryRef = computeLibraryRef(inst.filePath);
  const match = entries.find(e => {
    if (!e.name) return false;
    if (libraryRef && e.modelRef === libraryRef) return true;
    if (e.modelRef && inst.filePath.replace(/\\/g, "/").endsWith(e.modelRef)) return true;
    return false;
  });
  if (!match) return;
  const json = await LoadModelPresetFromLib(match.name);
  const preset: ModelPresetFile = JSON.parse(json);
  if (preset.autoApply !== true) return;
  _presetUndoStack.set(id, serializeModelPreset(id));
  await applyModelPreset(id, json);
  showUndoToast(`已自动应用预设「${preset.presetName || match.name}」`, async () => {
    const snap = _presetUndoStack.get(id);
    _presetUndoStack.delete(id);
    if (snap) await applyModelPreset(id, snap);
    setStatus("✓ 已撤销预设应用", true);
  });
}

export async function selectAndLoadPreset(id: string): Promise<void> {
  const path = await SelectPresetOpenFile();
  if (!path) return;
  try {
    const json = await LoadModelPreset(path);
    await applyModelPreset(id, json);
  } catch (err: any) {
    setStatus("✗ 加载失败: " + (err.message || err), false);
  }
}

export async function togglePresetAutoApply(name: string): Promise<void> {
  try {
    const json = await LoadModelPresetFromLib(name);
    const preset: ModelPresetFile = JSON.parse(json);
    preset.autoApply = !preset.autoApply;
    await SaveModelPresetToLib(name, JSON.stringify(preset, null, 2));
  } catch (err: any) {
    setStatus("✗ 切换自动应用失败: " + (err.message || err), false);
  }
}

export async function applyPresetFromLib(
  presetName: string,
  targetModelId: string | null,
): Promise<void> {
  try {
    const json = await LoadModelPresetFromLib(presetName);
    const preset: ModelPresetFile = JSON.parse(json);
    if (targetModelId) {
      await applyModelPreset(targetModelId, json);
    } else {
      const targetRef = computeLibraryRef(preset.model.filePath);
      let matchedId: string | null = null;
      for (const [mid, inst] of modelRegistry) {
        if (inst.filePath === preset.model.filePath) { matchedId = mid; break; }
        if (targetRef && computeLibraryRef(inst.filePath) === targetRef) { matchedId = mid; break; }
        const baseName = preset.model.filePath.replace(/\\/g, "/").split("/").pop();
        if (baseName && inst.filePath.replace(/\\/g, "/").endsWith(baseName)) { matchedId = mid; break; }
      }
      if (matchedId) {
        await applyModelPreset(matchedId, json);
      } else {
        const { loadPMXFile } = await import("./scene/scene");
        await loadPMXFile(preset.model.filePath);
        for (const [mid, inst] of modelRegistry) {
          if (inst.filePath === preset.model.filePath) {
            await applyModelPreset(mid, json);
            return;
          }
        }
        setStatus("✗ 模型已加载但未在注册表中找到", false);
      }
    }
  } catch (err: any) {
    setStatus("✗ 应用预设失败: " + (err.message || err), false);
  }
}

export async function savePresetToLibDialog(id: string): Promise<void> {
  const name = prompt("输入预设名称：");
  if (!name) return;
  const trimmed = name.trim();
  if (!trimmed) { setStatus("✗ 名称不能为空", false); return; }
  let json = serializeModelPreset(id, trimmed);
  if (!json) { setStatus("✗ 无法序列化模型状态", false); return; }
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
  } catch { /* no existing preset — fine */ }
  try {
    await SaveModelPresetToLib(trimmed, json);
    setStatus("✓ 预设已保存到库", true);
  } catch (err: any) {
    setStatus("✗ 保存失败: " + (err.message || err), false);
  }
}

export function buildPresetListLevel(id: string | null): PopupLevel {
  return {
    label: "预设库",
    dir: "",
    items: [],
    renderCustom: async (container) => {
      container.classList.remove("render-card");
      const entries: ModelPresetEntry[] = (await GetModelPresets()) || [];
      if (entries.length === 0) {
        const empty = document.createElement("div");
        empty.style.cssText = "font-size:12px;color:var(--text-dim);text-align:center;padding:24px;";
        empty.textContent = "暂无预设";
        container.appendChild(empty);
        return;
      }
      cardContainer(container, (c) => {
        for (const e of entries) {
          const row = document.createElement("div"); row.className = "slide-item";
          const iconSpan = document.createElement("span"); iconSpan.className = "slide-icon";
          const iconify = document.createElement("iconify-icon");
          iconify.icon = "lucide:bookmark";
          iconSpan.appendChild(iconify);
          row.appendChild(iconSpan);
          const labelSpan = document.createElement("span"); labelSpan.className = "slide-label";
          labelSpan.textContent = e.presetName || e.name;
          row.appendChild(labelSpan);
          if (e.modelName) {
            const sub = document.createElement("span");
            sub.style.cssText = "font-size:11px;color:var(--text-dim);margin-right:4px;";
            sub.textContent = e.modelName;
            row.appendChild(sub);
          }
          const toggleLabel = document.createElement("label");
          toggleLabel.className = "toggle";
          toggleLabel.title = e.autoApply ? "自动应用：开" : "自动应用：关";
          const toggleInput = document.createElement("input");
          toggleInput.type = "checkbox";
          toggleInput.checked = e.autoApply;
          toggleInput.addEventListener("change", async (ev) => {
            ev.stopPropagation();
            await togglePresetAutoApply(e.name);
            stackRegistry.modelStack?.reRender();
          });
          const slider = document.createElement("span");
          slider.className = "slider";
          toggleLabel.appendChild(toggleInput);
          toggleLabel.appendChild(slider);
          row.appendChild(toggleLabel);
          const delBtn = document.createElement("span");
          delBtn.textContent = "✕";
          delBtn.title = "删除此预设";
          delBtn.style.cssText = "font-size:10px;color:var(--text-dim);cursor:pointer;padding:2px 6px;";
          delBtn.addEventListener("click", async (ev) => {
            ev.stopPropagation();
            if (!confirm(`确定删除「${e.presetName || e.name}」？`)) return;
            try {
              await DeleteModelPreset(e.name);
              stackRegistry.modelStack?.reRender();
              setStatus("✓ 预设已删除", true);
            } catch { setStatus("✗ 删除失败", false); }
          });
          row.appendChild(delBtn);
          row.addEventListener("click", (ev) => {
            if ((ev.target as HTMLElement).closest(".toggle")) return;
            applyPresetFromLib(e.name, id);
          });
          c.appendChild(row);
        }
      });
    },
  };
}
