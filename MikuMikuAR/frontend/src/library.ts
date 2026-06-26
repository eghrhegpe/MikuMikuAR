// [doc:architecture] Library — 模型库弹窗 + 搜索 + 动作库
// 规范文档: docs/architecture.md §模型库管理
// 职责: 模型库扫描 + MenuStack 导航 + 搜索 + PMX Header 按需解析 + zip 解压触发

import {
  GetConfig,
  SetLibraryRoot,
  SelectDir,
  ScanModelDir,
  GetLibraryIndex,
  ExtractZip,
  CleanOrphanCache,
  ClearExtractCache,
  GetThumbnailBatch,
  GetModelMetaBatch,
  GetRecentModels,
  AddRecentModel,
  AddTag,
  RemoveTag,
  GetAllTags,
  GetTagsByModel,
  GetModelsByTag,
  OpenInMMD,
  OpenInBlender,
  SelectAudioFile,
  SelectVMDMotion,
  SelectVPDPose,
  GetDanceSets,
  SaveDanceSet,
  DeleteDanceSet,
  ImportDanceSet,
  SaveModelPreset,
  LoadModelPreset,
  SelectPresetSaveFile,
  SelectPresetOpenFile,
} from "../wailsjs/go/main/App";
import {
  dom,
  setStatus,
  setLibraryRoot,
  libraryRoot,
  setAllModels,
  allModels,
  setExternalPaths,
  externalPaths,
  setPopupOpen,
  popupOpen,
  setSearchMode,
  searchMode,
  LibraryModel,
  PopupRow,
  PopupLevel,
  escapeHtml,
  normPath,
  thumbnailCache,
  setThumbnailCache,
  displayNamePriority,
  setDisplayNamePriority,
  DisplayNamePriority,
  modelMetaCache,
  setModelMetaCache,
  closeAllOverlays,
  modelRegistry,
  focusedModelId,
  setFocusedModelId,
  isPlaying,
  setIsPlaying,
  autoLoop,
  setAutoLoop,
  mmdRuntime,
  recentModels,
  setRecentModels,
  computeLibraryRef,
  resolveLibraryRef,
} from "./config";
import {
  loadPMXFile,
  loadVMDFromPath,
  loadVMDMotion,
  loadVPDPose,
  focusModel,
  removeModel,
  setModelVisibility,
  setModelOpacity,
  setModelWireframe,
  setModelScaling,
  setModelRotationY,
  setModelPosition,
  getModelPosition,
  resetModelTransform,
  updatePlaybackUI,
  getModelMorphs,
  setModelMorphWeight,
  getModelMorphWeight,
  resetModelMorphs,
  stopVMD,
  getMatState,
  applyMatState,
  getMatCatGroups,
  getMatCatParams,
  setMatCatParams,
  resetMatCatParams,
  getMatDetailList,
  getMatParams,
  setMatParams,
  resetSingleMatParams,
  resetAllMatParams,
  triggerAutoSave,
  loadCameraVmdFromPath,
} from "./scene";
import type { MaterialCategoryParams } from "./scene";
import type { Material } from "@babylonjs/core/Materials/material";
import { SlideMenu } from "./menu";
import { createIconifyIcon } from "./icons";
import { loadAudioFile, setAudioOffset, setVolume, playAudio, pauseAudio, getAudioPath, getAudioName, getVolume, getAudioOffset, isAudioPlaying } from "./audio";

/** Shape of a .mcupreset.json file — single-model state snapshot. */
export interface ModelPresetFile {
  version: 1;
  model: {
    filePath: string;
    libraryRef?: string;
    name: string;
    kind: "actor" | "stage";
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
  materialCategories?: Record<string, { diffuseMul: number; specularMul: number; shininess: number; ambientMul: number }>;
  materialOverrides?: Record<number, { diffuseMul: number; specularMul: number; shininess: number; ambientMul: number }>;
}

// ======== SlideMenu instances ========

const makeModelStack = (): SlideMenu => {
  return new SlideMenu({
    container: dom.modelPopup,
    onClose: hidePopup,
    onFolderEnter: (row) => {
      // Model detail submenu: scene:${id}
      if (row.target && row.target.startsWith("scene:")) {
        motionBindingTargetId = null;
        const id = row.target.replace("scene:", "");
        const inst = modelRegistry.get(id);
        if (!inst) return null;
        return buildModelDetailLevel(id);
      }
      // Detail sub-submenus: detail:type:${id}
      if (row.target && row.target.startsWith("detail:")) {
        motionBindingTargetId = null;
        const parts = row.target.split(":");
        const type = parts[1];
        const id = parts.slice(2).join(":");
        const inst = modelRegistry.get(id);
        if (!inst) return null;
        switch (type) {
          case "info": return buildModelInfoLevel(id);
          case "transform": return buildTransformLevel(id);
          case "visibility": return buildVisibilityLevel(id);
          case "tags": return buildModelTagsLevel(id);
          case "morph": return buildMorphPreviewLevel(id);
          case "material": return buildMatCatLevel(id, inst.name);
          default: return null;
        }
      }
      // Recent models
      if (row.target === "__recent__") {
        const recentMap = new Map<string, number>();
        recentModels.forEach((ref, i) => recentMap.set(ref, i));
        const recentModelsList = allModels
          .filter(m => {
            const ref = computeLibraryRef(m.file_path);
            return ref && recentMap.has(ref);
          })
          .sort((a, b) => {
            const refA = computeLibraryRef(a.file_path);
            const refB = computeLibraryRef(b.file_path);
            return (recentMap.get(refA!) ?? 999) - (recentMap.get(refB!) ?? 999);
          });
        return {
          label: "最近打开",
          dir: "",
          items: recentModelsList.length > 0
            ? recentModelsList.map(m => modelToRow(m))
            : [{ kind: "action" as const, label: "暂无记录", icon: "clock", target: "", sublabel: "加载模型后会出现在这里" }],
        };
      }
      // Dance set detail: __dance_set:${id}
      if (row.target && row.target.startsWith("__dance_set:")) {
        const setId = row.target.replace("__dance_set:", "");
        return buildDanceSetDetailLevel(setId);
      }
      // Tags overview
      if (row.target === "__tags__") {
        return buildTagsOverviewLevel();
      }
      // Tag detail: __tag:tagName
      if (row.target && row.target.startsWith("__tag:")) {
        const tagName = row.target.replace("__tag:", "");
        return buildTagDetailLevel(tagName);
      }
      if (row.target === "models:browse") {
        if (!libraryRoot) {
          return {
            label: "模型库",
            dir: "",
            items: [],
            renderCustom: (container) => {
              container.style.cssText =
                "padding:24px;text-align:center;color:var(--text-muted);font-size:13px;";
              container.innerHTML =
                '<div>尚未设置模型库目录</div><div style="font-size:11px;margin-top:8px;color:var(--text-dark);">请前往 设置 → 系统 中设置</div>';
            },
          };
        }
        // Enter file browser at library root
        const level = buildLevel(
          libraryRoot,
          "模型库",
          (m) => m.format === "pmx",
        );
        for (const ep of externalPaths) {
          level.items.unshift({
            kind: "folder",
            label: ep.name,
            icon: "plug",
            target: ep.path,
          });
        }
        return level;
      }
      // Reserved items — no-op
      // Fallback: file browser folder navigation
      if (
        row.target &&
        !row.target.startsWith("reserved:") &&
        !row.target.startsWith("models:") &&
        !row.target.startsWith("detail:") &&
        !row.target.startsWith("__")
      ) {
        return buildLevel(row.target, row.label, (m) => m.format === "pmx");
      }
      return null;
    },
    onItemClick: (row: PopupRow) => {
      if (row.model) {
        // If we're in motion-binding context, bind VMD to the target model
        if (row.model.format === "vmd" && motionBindingTargetId) {
          hidePopup();
          // Fetch the VMD and bind to the target model
          loadVMDFromPath(row.model.file_path, motionBindingTargetId);
          motionBindingTargetId = null;
          return;
        }
        // Normal row click → REPLACE: remove current focused model, load new model
        // The "+" add button is handled separately in menu.ts via row.onAddClick
        hidePopup();
        replaceModel(row.model);
        return;
      }
      if (row.target === "models:rescan") {
        refreshLibrary();
        return;
      }
      // Detail actions
      if (row.target && row.target.startsWith("detail:")) {
        const parts = row.target.split(":");
        const type = parts[1];
        const id = parts.slice(2).join(":");
        if (!id) return;
        const inst = modelRegistry.get(id);
        if (!inst) return;
        switch (type) {
          case "focus":
            setFocusedModelId(id);
            focusModel(id);
            setStatus(`✓ 已聚焦: ${inst.name}`, true);
            break;
          case "remove":
            removeModel(id);
            setStatus(`✓ 已移除: ${inst.name}`, true);
            hidePopup();
            break;
          case "export-mmd":
            (async () => {
              try {
                const path = inst.filePath;
                if (!path) { setStatus("✗ 模型无文件路径", false); return; }
                await OpenInMMD(path);
                setStatus("✓ 已启动: MMD", true);
              } catch (err: any) {
                setStatus("✗ " + (err.message || err), false);
              }
            })();
            break;
          case "blender":
            (async () => {
              try {
                const path = inst.filePath;
                if (!path) { setStatus("✗ 模型无文件路径", false); return; }
                await OpenInBlender(path);
                setStatus("✓ 已启动: Blender", true);
              } catch (err: any) {
                setStatus("✗ " + (err.message || err), false);
              }
            })();
            break;
          case "preset-save":
            selectAndSavePreset(id);
            break;
          case "preset-load":
            selectAndLoadPreset(id);
            break;
        }
        return;
      }
    },
    onHover: (row, entering) => {
      if (!entering) {
        setStatus("", false);
        return;
      }
      const hints: Record<string, string> = {
        "models:browse": "浏览和加载 PMX 模型",
        "detail:focus": "相机对准此模型",
        "detail:remove": "从场景中移除此模型",
        "detail:export-mmd": "在 MikuMikuDance 中打开此模型",
        "detail:blender": "在 Blender 中编辑此模型",
        "detail:preset-save": "将模型当前的变换/材质/VMD状态保存为预设文件",
        "detail:preset-load": "从预设文件恢复模型的变换/材质/VMD状态",
      };
      // Dynamic hints for detail:* targets
      if (row.target && row.target.startsWith("detail:")) {
        const parts = row.target.split(":");
        const key = `detail:${parts[1]}`;
        const hint = hints[key];
        if (hint) setStatus(hint, false);
        return;
      }
      const hint = hints[row.target || ""];
      if (hint) setStatus(hint, false);
    },
  });
};

/** Build a per-model row for the action (motion) popup. */
function buildActionModelRow(id: string): PopupRow {
  const inst = modelRegistry.get(id);
  if (!inst) return { kind: "action", label: "?", icon: "help-circle", target: "" };
  return {
    kind: "folder",
    label: inst.name,
    icon: "tabler:cube-3d-sphere",
    target: `action:binding:${id}`,
    sublabel: inst.vmdName || undefined,
    catTag: inst.kind === "actor" ? "角色" : "舞台",
  };
}

/** Build the action binding submenu for a model (in motion popup). */
function buildActionBindingLevel(id: string): PopupLevel {
  const inst = modelRegistry.get(id);
  if (!inst) return { label: "动作绑定", dir: "", items: [] };
  return {
    label: `动作 — ${inst.name}`,
    dir: "",
    items: [
      { kind: "action", label: `当前: ${inst.vmdName || "无"}`, icon: "info", target: "", sublabel: undefined },
      { kind: "divider", label: "", icon: "", target: "" },
      { kind: "folder", label: "更换动作", icon: "music", target: `action:motion:browse:${id}`, sublabel: "从动作库选择" },
      { kind: "action", label: "加载姿势 (VPD)", icon: "user", target: `action:motion:pose:${id}`, sublabel: "从 VPD 文件加载静态姿势" },
      { kind: "action", label: inst.mmdModel ? (inst.vmdData ? "暂停动作" : "—") : "—", icon: "pause-circle", target: `action:motion:pause:${id}`, sublabel: inst.vmdData ? "暂停/继续" : "无动作" },
      { kind: "action", label: "重置动作", icon: "rotate-ccw", target: `action:motion:reset:${id}`, sublabel: "恢复初始姿势" },
      { kind: "divider", label: "", icon: "", target: "" },
      { kind: "action", label: `循环: ${inst.vmdData ? (autoLoop ? "开" : "关") : "—"}`, icon: "repeat", target: `action:motion:loop:${id}`, sublabel: inst.vmdData ? "切换自动循环" : "加载动作后可用" },
    ],
  };
}

/** Build the music level for the action popup. */
function buildActionMusicLevel(): PopupLevel {
  const name = getAudioName();
  const offset = getAudioOffset();
  return {
    label: "音乐",
    dir: "",
    items: [],
    renderCustom: (container) => {
      container.style.padding = "12px 14px";
      const nameRow = document.createElement("div");
      nameRow.style.cssText = "font-size:12px;color:var(--text-dim);margin-bottom:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
      nameRow.textContent = name ? `当前: ${name}` : "未加载音乐";
      container.appendChild(nameRow);

      const loadRow = document.createElement("div");
      loadRow.className = "menu-item";
      loadRow.innerHTML = '<span class="menu-icon"><iconify-icon icon="folder-open"></iconify-icon></span><span class="menu-label">加载音乐</span>';
      loadRow.addEventListener("click", async () => {
        try {
          const path = await SelectAudioFile();
          if (!path) return;
          await loadAudioFile(path);
          setStatus(`✓ 音乐: ${getAudioName()}`, true);
          motionStack?.reRender();
        } catch (err) {
          console.warn("Load audio failed:", err);
          setStatus("✗ 音乐加载失败", false);
        }
      });
      container.appendChild(loadRow);

      // Audio offset slider (inline to avoid cross-module dependency)
      const offsetRow = document.createElement("div");
      offsetRow.style.cssText = "display:flex;align-items:center;gap:8px;margin-bottom:10px;";
      const offsetLbl = document.createElement("label");
      offsetLbl.style.cssText = "font-size:11px;color:var(--text-dim);width:80px;flex-shrink:0;";
      offsetLbl.textContent = "音频偏移";
      const offsetVal = document.createElement("span");
      offsetVal.style.cssText = "font-size:11px;color:var(--text-bright);width:36px;text-align:right;";
      offsetVal.textContent = offset.toFixed(2);
      const offsetSlider = document.createElement("input");
      offsetSlider.type = "range";
      offsetSlider.min = "-5";
      offsetSlider.max = "5";
      offsetSlider.step = "0.1";
      offsetSlider.value = String(offset);
      offsetSlider.style.cssText = "flex:1;accent-color:var(--accent);height:4px;";
      offsetSlider.addEventListener("input", () => {
        const v = parseFloat(offsetSlider.value);
        offsetVal.textContent = v.toFixed(2);
        setAudioOffset(v);
      });
      offsetRow.appendChild(offsetLbl);
      offsetRow.appendChild(offsetSlider);
      offsetRow.appendChild(offsetVal);
      container.appendChild(offsetRow);
      const offsetHint = document.createElement("div");
      offsetHint.style.cssText = "font-size:10px;color:var(--text-dark);margin:-4px 0 10px 88px;";
      offsetHint.textContent = "正=音频先播，负=音频后播";
      container.appendChild(offsetHint);
    },
  };
}

const makeMotionStack = (): SlideMenu => {
  return new SlideMenu({
    container: dom.motionPopup,
    onClose: hideMotionPopup,
    onFolderEnter: (row) => {
      if (row.target === "__dance_sets__") {
        motionBindingTargetId = null;
        return buildDanceSetsOverviewLevel();
      }
      if (row.target === "__music__") {
        motionBindingTargetId = null;
        return buildActionMusicLevel();
      }
      if (row.target && row.target.startsWith("action:binding:")) {
        motionBindingTargetId = null;
        const id = row.target.replace("action:binding:", "");
        return buildActionBindingLevel(id);
      }
      if (row.target && row.target.startsWith("action:motion:browse:")) {
        const id = row.target.replace("action:motion:browse:", "");
        motionBindingTargetId = id;
        const level = buildLevel(libraryRoot, "动作库", (m) => m.format === "vmd");
        const inst = modelRegistry.get(id);
        level.label = `绑定动作 → ${inst?.name || "模型"}`;
        return level;
      }
      return null;
    },
    onItemClick: (row: PopupRow) => {
      if (row.model) {
        if (row.model.format === "vmd" && motionBindingTargetId) {
          hideMotionPopup();
          loadVMDFromPath(row.model.file_path, motionBindingTargetId);
          motionBindingTargetId = null;
          return;
        }
        hideMotionPopup();
        if (row.model.format === "vmd") loadVMDFromPath(row.model.file_path);
        return;
      }
      if (row.target && row.target.startsWith("action:motion:")) {
        const parts = row.target.split(":");
        const action = parts[2];
        const id = parts.slice(3).join(":");
        if (!id) return;
        const inst = modelRegistry.get(id);
        if (!inst) return;
        switch (action) {
          case "pause":
            if (mmdRuntime) {
              if (isPlaying) {
                mmdRuntime.pauseAnimation();
                setIsPlaying(false);
                setAutoLoop(false);
              } else {
                setAutoLoop(true);
                mmdRuntime.playAnimation().then(() => setIsPlaying(true));
              }
              updatePlaybackUI();
              motionStack?.reRender();
            }
            break;
          case "reset":
            if (inst.mmdModel && mmdRuntime) {
              inst.mmdModel.setRuntimeAnimation(null);
              inst.vmdData = null;
              inst.vmdName = "";
              inst.vmdPath = null;
              inst.animationDuration = 0;
              if (isPlaying) {
                mmdRuntime.pauseAnimation();
                setIsPlaying(false);
              }
              updatePlaybackUI();
              motionStack?.reRender();
              setStatus("✓ 动作已重置", true);
            }
            break;
          case "pose":
            (async () => {
              try {
                const path = await SelectVPDPose();
                if (!path) { setStatus("✗ 未选择文件", false); return; }
                await loadVPDPose(path, id);
                motionStack?.reRender();
              } catch (err: any) {
                setStatus("✗ " + (err.message || err), false);
              }
            })();
            break;
          case "loop":
            setAutoLoop(!autoLoop);
            motionStack?.reRender();
            setStatus(`循环: ${autoLoop ? "开" : "关"}`, true);
            break;
        }
        return;
      }
    },
  });
};

// ======== Dance Set Types & State ========

export type DanceSet = {
  name: string;
  vmd_path: string;
  audio_path: string;
  audio_offset: number;
  description: string;
  thumbnail: string;
  source: string;
};

let danceSets: DanceSet[] = [];
let currentDanceSetId: string | null = null;

function computeDanceSetId(ds: DanceSet): string {
  return sha256Hex(ds.vmd_path + ":" + ds.audio_path).substring(0, 16);
}

function sha256Hex(s: string): string {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    const char = s.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(16, "0") + Math.abs(hash * 7).toString(16).padStart(16, "0");
}

async function loadDanceSets(): Promise<void> {
  try {
    const sets = await GetDanceSets();
    danceSets = sets || [];
  } catch (err) {
    console.warn("loadDanceSets:", err);
    danceSets = [];
  }
}

async function loadDanceSetAudio(ds: DanceSet): Promise<void> {
  if (!ds.audio_path) return;
  try {
    await loadAudioFile(ds.audio_path);
    setAudioOffset(ds.audio_offset || 0);
  } catch (err) {
    console.warn("loadDanceSetAudio failed:", err);
    setStatus("✗ 音频加载失败", false);
  }
}

let modelStack: SlideMenu | null = null;
let motionStack: SlideMenu | null = null;

/** When browsing motion from a model detail, track which model to bind to. */
let motionBindingTargetId: string | null = null;

// ======== Popup Show / Hide ========
export function togglePopup(): void {
  if (popupOpen) {
    hidePopup();
    return;
  }
  showPopup();
}

export function showPopup(): void {
  closeAllOverlays();
  setPopupOpen(true);
  dom.popupSearchInput.value = "";
  setSearchMode(false);
  dom.modelPopup.classList.add("visible");

  if (!modelStack) {
    modelStack = makeModelStack();
  }

  // Build root menu: scene models first, then divider, then features
  const rootItems: PopupRow[] = [];

  // Add currently loaded models as quick-access buttons (navigate to detail)
  for (const [id, inst] of modelRegistry) {
    rootItems.push({
      kind: "folder",
      label: inst.name,
      icon: "tabler:cube-3d-sphere",
      target: `scene:${id}`,
      sublabel: inst.vmdName || undefined,
      editable: id === focusedModelId,
      showDetailBtn: true,
      // 📄 button focuses the model (highlights + camera frames) instead of entering detail submenu
      onDetailClick: () => {
        setFocusedModelId(id);
        focusModel(id);
        setStatus(`✓ 已聚焦: ${inst.name}`, true);
      },
    });
  }
  if (rootItems.length > 0) {
    rootItems.push({ kind: "divider", label: "", icon: "", target: "" });
  }

  // Static menu items — 常用操作优先，管理功能其次
  rootItems.push(
    {
      kind: "folder",
      label: "加载模型",
      icon: "folder",
      target: "models:browse",
    },
    {
      kind: "action",
      label: "重新扫描",
      icon: "refresh-cw",
      target: "models:rescan",
    },
    { kind: "divider", label: "", icon: "", target: "" },
    {
      kind: "folder",
      label: "最近打开",
      icon: "clock",
      target: "__recent__",
      sublabel: recentModels.length > 0 ? `${recentModels.length} 个模型` : "暂无记录",
    },
    {
      kind: "folder",
      label: "标签",
      icon: "tag",
      target: "__tags__",
      sublabel: "管理模型标签",
    },
  );

  modelStack.reset({ label: "模型", dir: "", items: rootItems });
}

export function hidePopup(): void {
  motionBindingTargetId = null;
  // Reset morph preview when closing popup
  if (focusedModelId) {
    resetModelMorphs(focusedModelId);
  }
  closeAllOverlays();
}

// ======== Motion Popup ========

export function showMotionPopup(): void {
  closeAllOverlays();
  dom.motionPopup.classList.add("visible");

  if (!motionStack) {
    motionStack = makeMotionStack();
  }

  const rootItems: PopupRow[] = [];

  // Loaded models — each row → binding submenu
  if (modelRegistry.size > 0) {
    for (const [id, inst] of modelRegistry) {
      rootItems.push(buildActionModelRow(id));
    }
  }

  rootItems.push({ kind: "divider", label: "", icon: "", target: "" });
  rootItems.push(
    {
      kind: "folder",
      label: "舞蹈套装",
      icon: "music",
      target: "__dance_sets__",
      sublabel: danceSets.length > 0 ? `${danceSets.length} 个套装` : "暂无套装",
    },
    {
      kind: "folder",
      label: "音乐",
      icon: "music",
      target: "__music__",
      sublabel: getAudioName() || "未加载",
    },
  );

  motionStack.reset({ label: "动作", dir: "", items: rootItems });
}

export function hideMotionPopup(): void {
  dom.motionPopup.classList.remove("visible");
}

// ======== Thumbnail batch loading ========

/** Load thumbnails for all model rows in a level and cache them in memory. */
async function loadThumbnailsForLevel(level: PopupLevel): Promise<void> {
  const pmxPaths = level.items
    .filter((r) => r.kind === "model" && r.model)
    .map((r) => r.model!.file_path);
  if (pmxPaths.length === 0) return;
  try {
    const batch = await GetThumbnailBatch(pmxPaths);
    setThumbnailCache(new Map(Object.entries(batch)));
  } catch (err) {
    console.warn("loadThumbnailsForLevel:", err);
  }
}

/** Ensure PMX header metadata (name_jp/name_en/comment) is loaded for the given model paths.
 *  Skips paths already in cache; fetches missing ones via Go binding. */
async function ensureModelMeta(pmxPaths: string[]): Promise<void> {
  const uncached = pmxPaths.filter((p) => !modelMetaCache.has(p));
  if (uncached.length === 0) return;
  try {
    const batch = await GetModelMetaBatch(uncached);
    if (batch) {
      const merged = new Map(modelMetaCache);
      for (const [path, meta] of Object.entries(batch)) {
        merged.set(path, meta);
      }
      setModelMetaCache(merged);
    }
  } catch (err) {
    console.warn("ensureModelMeta:", err);
  }
}

// ======== Build list from scan data ========
function buildLevel(
  dir: string,
  label: string,
  filter?: (m: LibraryModel) => boolean,
): PopupLevel {
  dir = normPath(dir);
  const isRoot = filter ? false : normPath(libraryRoot) === dir;
  const items: PopupRow[] = [];
  const subdirs = new Set<string>();
  const subdirIsLeaf = new Set<string>();

  for (const m of allModels) {
    if (filter && !filter(m)) continue;
    const mdir = normPath(m.dir);
    const rel = mdir.startsWith(dir)
      ? mdir.substring(dir.length).replace(/^\//, "")
      : null;
    if (rel === null) continue;
    const parts = rel.split("/").filter(Boolean);

    if (parts.length === 0) {
      items.push(modelToRow(m));
    } else {
      const topDir = parts[0];
      subdirs.add(topDir);
      if (parts.length === 1) {
        subdirIsLeaf.add(topDir);
      }
    }
  }

  for (const d of Array.from(subdirs).sort()) {
    const fullPath = dir + "/" + d;
    if (subdirIsLeaf.has(d) && !isRoot) {
      const entries = allModels.filter((m) => {
        if (filter && !filter(m)) return false;
        return normPath(m.dir) === fullPath;
      });
      const allZip =
        entries.length > 0 && entries.every((m) => m.container === "zip");
      if (!allZip) {
        for (const m of entries) {
          items.push(modelToRow(m));
        }
        continue;
      }
    }
    items.unshift({
      kind: "folder",
      label: d,
      icon: "folder",
      target: fullPath,
    });
  }

  return { label, dir, items };
}

function modelToRow(m: LibraryModel): PopupRow {
  let icon = "box";
  if (m.format === "vmd") icon = "music";
  else if (m.container === "zip" && m.format === "pmx") icon = "archive";
  // Compute display label based on user's priority setting
  // For zip containers, file_path is the zip file path — use zip_inner to get the real model name
  const fp = m.file_path || "";
  const filename =
    m.container === "zip" && m.zip_inner
      ? m.zip_inner.split("/").pop() || "未知"
      : fp.split("/").pop() || "未知";
  const cached = modelMetaCache.get(fp);
  let label: string;
  switch (displayNamePriority) {
    case "filename":
      label = filename;
      break;
    case "name_en":
      label =
        cached?.name_en ||
        m.name_en ||
        cached?.name_jp ||
        m.name_jp ||
        filename;
      break;
    case "name_jp":
    default:
      label =
        cached?.name_jp ||
        m.name_jp ||
        cached?.name_en ||
        m.name_en ||
        filename;
      break;
  }
  const comment = cached?.comment || m.comment || "";
  return {
    kind: "model",
    label,
    icon,
    target: m.file_path,
    sublabel: comment ? comment.substring(0, 28) : undefined,
    model: m,
    catTag: m.category || undefined,
    editable: m.format === "pmx",
    // "+" add button: add additional model (keep existing)
    onAddClick: () => {
      hidePopup();
      onModelRowClick(m);
    },
  };
}

function onModelRowClick(m: LibraryModel): void {
  const isStage = m.type === "stage" || m.type === "scene";
  // Add to recent models (only for PMX, VMD doesn't make sense)
  if (m.format === "pmx") {
    const ref = computeLibraryRef(m.file_path);
    if (ref) {
      AddRecentModel(ref).catch(() => {});
      // Sync local recentModels so root menu sublabel stays fresh
      setRecentModels([ref, ...recentModels.filter(r => r !== ref)].slice(0, 20));
    }
  }
  if (m.container === "zip") {
    hidePopup();
    setStatus("正在解压 zip...", false);
    ExtractZip(m.file_path, m.zip_inner)
      .then((result) => {
        setStatus(result.cached ? "✓ 命中缓存" : "✓ 解压完成", true);
        if (m.format === "vmd") loadVMDFromPath(result.file_path);
        else loadPMXFile(result.file_path, isStage);
      })
      .catch((err) => {
        setStatus("✗ 解压失败: " + (err as Error).message, false);
      });
    return;
  }
  hidePopup();
  if (m.format === "pmx") loadPMXFile(m.file_path, isStage);
  else if (m.format === "vmd") loadVMDFromPath(m.file_path);
}

function replaceModel(m: LibraryModel): void {
  // Remove current focused model first, then load new model into same slot
  if (focusedModelId) {
    removeModel(focusedModelId);
  }
  onModelRowClick(m);
}

function isSearchLayer(): boolean {
  return modelStack?.currentLevel?.label === "🔍 搜索结果";
}

// ======== Tag System ========

/** Build the tags overview level showing all tags + create option. */
function buildTagsOverviewLevel(): PopupLevel {
  return {
    label: "标签",
    dir: "",
    items: [],
    renderCustom: async (container) => {
      container.style.padding = "12px 14px";
      try {
        // Built-in "收藏" tag
        const favRefs = await GetModelsByTag("收藏");
        const favRow = document.createElement("div");
        favRow.className = "menu-item";
        favRow.innerHTML = `<span class="menu-icon"><iconify-icon icon="star" style="color:var(--accent);"></iconify-icon></span><span class="menu-label">收藏</span><span class="menu-sublabel" style="color:var(--text-muted);font-size:11px;">${favRefs ? favRefs.length : 0} 个模型</span><span class="menu-arrow">&gt;</span>`;
        favRow.addEventListener("click", () => {
          const level = buildTagDetailLevel("收藏");
          modelStack?.push(level);
        });
        container.appendChild(favRow);
        const sep = document.createElement("div");
        sep.className = "menu-divider";
        container.appendChild(sep);

        const tags = await GetAllTags();
        // Filter out "收藏" from regular tag list since we show it separately
        const regularTags = tags ? tags.filter(t => t !== "收藏") : [];
        if (regularTags.length === 0) {
          const empty = document.createElement("div");
          empty.style.cssText = "padding:8px 0;text-align:center;color:var(--text-muted);font-size:13px;";
          empty.textContent = "暂无其他标签";
          container.appendChild(empty);
        } else {
          for (const tag of regularTags) {
            const row = document.createElement("div");
            row.className = "menu-item";
            row.innerHTML = `<span class="menu-icon"><iconify-icon icon="tag"></iconify-icon></span><span class="menu-label">${escapeHtml(tag)}</span><span class="menu-arrow">&gt;</span>`;
            row.addEventListener("click", () => {
              const level = buildTagDetailLevel(tag);
              modelStack?.push(level);
            });
            container.appendChild(row);
          }
        }
        // Divider + create button
        const divider = document.createElement("div");
        divider.className = "menu-divider";
        container.appendChild(divider);
        const addRow = document.createElement("div");
        addRow.className = "menu-item";
        addRow.innerHTML = '<span class="menu-icon"><iconify-icon icon="plus"></iconify-icon></span><span class="menu-label">新建标签</span>';
        addRow.addEventListener("click", () => {
          setStatus("请先进入模型详情页，在详情中为模型添加标签", false);
          modelStack?.pop();
        });
        container.appendChild(addRow);
      } catch (err) {
        console.warn("buildTagsOverviewLevel:", err);
        container.textContent = "加载标签失败";
      }
    },
  };
}

/** Build a level showing all models tagged with a specific tag. */
function buildTagDetailLevel(tagName: string): PopupLevel {
  return {
    label: `标签: ${tagName}`,
    dir: "",
    items: [],
    renderCustom: async (container) => {
      container.style.padding = "0";
      try {
        const modelRefs = await GetModelsByTag(tagName);
        if (!modelRefs || modelRefs.length === 0) {
          container.style.padding = "12px 14px";
          container.innerHTML = '<div style="text-align:center;color:var(--text-muted);font-size:13px;">该标签下没有模型</div>';
          return;
        }
        // Find matching models from allModels by resolving libraryRef
        const matched = allModels.filter(m => {
          const ref = computeLibraryRef(m.file_path);
          return ref && modelRefs.includes(ref);
        });
        if (matched.length === 0) {
          container.style.padding = "12px 14px";
          container.innerHTML = '<div style="text-align:center;color:var(--text-muted);font-size:13px;">未找到匹配的模型（库可能已变更）</div>';
          return;
        }
        for (const m of matched) {
          const row = modelToRow(m);
          const el = document.createElement("div");
          el.className = "menu-item";
          const iconSpan = document.createElement("span");
          iconSpan.className = "menu-icon";
          const iconEl = createIconifyIcon(row.icon);
          if (iconEl) {
            iconSpan.appendChild(iconEl);
          } else {
            iconSpan.textContent = row.icon;
          }
          el.appendChild(iconSpan);
          const labelSpan = document.createElement("span");
          labelSpan.className = "menu-label";
          labelSpan.textContent = row.label;
          el.appendChild(labelSpan);
          el.addEventListener("click", () => {
            onModelRowClick(m);
          });
          container.appendChild(el);
        }
      } catch (err) {
        console.warn("buildTagDetailLevel:", err);
        container.textContent = "加载失败";
      }
    },
  };
}

// ======== Dance Sets ========

/** Build the dance sets overview level showing all dance sets + create option. */
function buildDanceSetsOverviewLevel(): PopupLevel {
  return {
    label: "舞蹈套装",
    dir: "",
    items: [],
    renderCustom: async (container) => {
      container.style.padding = "12px 14px";
      try {
        await loadDanceSets();
        if (!danceSets || danceSets.length === 0) {
          const empty = document.createElement("div");
          empty.style.cssText = "padding:16px;text-align:center;color:var(--text-muted);font-size:13px;";
          empty.innerHTML = '<div>暂无舞蹈套装</div><div style="font-size:11px;margin-top:8px;color:var(--text-dark);">点击下方按钮创建新套装</div>';
          container.appendChild(empty);
        } else {
          for (const ds of danceSets) {
            const setId = computeDanceSetId(ds);
            const row = document.createElement("div");
            row.className = "menu-item";
            const vmdName = ds.vmd_path.split("/").pop() || ds.vmd_path;
            row.innerHTML = `
              <span class="menu-icon"><iconify-icon icon="music"></iconify-icon></span>
              <span class="menu-label">${escapeHtml(ds.name)}</span>
              <span class="menu-arrow">&gt;</span>
            `;
            row.setAttribute("data-hint", ds.description || vmdName);
            row.addEventListener("click", () => {
              const level = buildDanceSetDetailLevel(setId);
              modelStack?.push(level);
            });
            container.appendChild(row);
          }
        }
        const divider = document.createElement("div");
        divider.className = "menu-divider";
        container.appendChild(divider);
        const addRow = document.createElement("div");
        addRow.className = "menu-item";
        addRow.innerHTML = '<span class="menu-icon"><iconify-icon icon="plus"></iconify-icon></span><span class="menu-label">新建套装</span>';
        addRow.addEventListener("click", () => {
          createNewDanceSet();
        });
        container.appendChild(addRow);
      } catch (err) {
        console.warn("buildDanceSetsOverviewLevel:", err);
        container.textContent = "加载失败";
      }
    },
  };
}

/** Build the dance set detail level for a specific dance set. */
function buildDanceSetDetailLevel(setId: string): PopupLevel {
  const ds = danceSets.find(d => computeDanceSetId(d) === setId);
  if (!ds) return { label: "未知套装", dir: "", items: [] };

  const vmdName = ds.vmd_path.split("/").pop() || ds.vmd_path;
  const audioName = ds.audio_path ? ds.audio_path.split("/").pop() : "无";

  return {
    label: ds.name,
    dir: "",
    items: [],
    renderCustom: (container) => {
      container.style.padding = "12px 14px";

      const fields: Array<{ label: string; value: string }> = [
        { label: "套装名称", value: ds.name },
        { label: "VMD 文件", value: vmdName },
        { label: "音频文件", value: audioName },
        { label: "音频偏移", value: `${ds.audio_offset.toFixed(2)} 秒` },
        { label: "描述", value: ds.description || "—" },
      ];

      for (const f of fields) {
        const row = document.createElement("div");
        row.style.cssText = "display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);font-size:12px;";
        const lbl = document.createElement("span");
        lbl.style.cssText = "color:var(--text-dim);";
        lbl.textContent = f.label;
        const val = document.createElement("span");
        val.style.cssText = "color:var(--text-bright);text-align:right;max-width:60%;overflow:hidden;text-overflow:ellipsis;";
        val.textContent = f.value;
        val.title = f.value;
        row.appendChild(lbl);
        row.appendChild(val);
        container.appendChild(row);
      }

      const divider1 = document.createElement("div");
      divider1.className = "menu-divider";
      divider1.style.marginTop = "8px";
      container.appendChild(divider1);

      const loadBtn = document.createElement("div");
      loadBtn.className = "menu-item";
      loadBtn.innerHTML = '<span class="menu-icon"><iconify-icon icon="play"></iconify-icon></span><span class="menu-label">一键加载</span>';
      loadBtn.addEventListener("click", () => {
        loadDanceSet(ds);
      });
      container.appendChild(loadBtn);

      const deleteBtn = document.createElement("div");
      deleteBtn.className = "menu-item";
      deleteBtn.innerHTML = '<span class="menu-icon"><iconify-icon icon="trash-2"></iconify-icon></span><span class="menu-label" style="color:var(--danger,#ff6b6b);">删除套装</span>';
      deleteBtn.addEventListener("click", () => {
        if (confirm(`确定要删除舞蹈套装「${ds.name}」吗？`)) {
          DeleteDanceSet(setId).then(() => {
            setStatus("✓ 已删除舞蹈套装", true);
            loadDanceSets().then(() => {
              modelStack?.pop();
              const rootIdx = modelStack?.levelCount ? modelStack.levelCount - 1 : 0;
              if (modelStack && rootIdx >= 0) {
                modelStack.setLevel(rootIdx, buildDanceSetsOverviewLevel());
                modelStack.reRender();
              }
            });
          }).catch((err) => {
            console.warn("DeleteDanceSet failed:", err);
            setStatus("✗ 删除失败", false);
          });
        }
      });
      container.appendChild(deleteBtn);
    },
  };
}

/** Load a dance set: apply VMD to focused model and play audio. */
async function loadDanceSet(ds: DanceSet): Promise<void> {
  if (!focusedModelId) {
    setStatus("✗ 请先加载并聚焦一个模型", false);
    return;
  }
  hidePopup();
  await Promise.all([
    loadVMDFromPath(ds.vmd_path, focusedModelId),
    loadDanceSetAudio(ds),
  ]);
  setStatus(`✓ 已加载舞蹈套装: ${ds.name}`, true);
}

/** Create a new dance set from VMD + audio files. */
async function createNewDanceSet(): Promise<void> {
  try {
    const vmdPath = await SelectVMDMotion();
    if (!vmdPath) return;

    const audioPath = await SelectAudioFile().catch(() => "");

    const defaultName = vmdPath.split(/[\\/]/).pop()?.replace(/\.vmd$/i, "") || "";
    const name = prompt("请输入舞蹈套装名称：", defaultName);
    if (!name) return;

    const setId = await ImportDanceSet(vmdPath, audioPath, name);
    if (setId) {
      setStatus("✓ 已创建舞蹈套装", true);
      await loadDanceSets();
      const rootIdx = modelStack?.levelCount ? modelStack.levelCount - 1 : 0;
      if (modelStack && rootIdx >= 0) {
        modelStack.setLevel(rootIdx, buildDanceSetsOverviewLevel());
        modelStack.reRender();
      }
    }
  } catch (err) {
    console.warn("createNewDanceSet failed:", err);
    setStatus("✗ 创建失败", false);
  }
}

// ======== Model Detail Submenu ========

/** Build the model detail submenu for a specific model instance. */
function addSliderRow(container: HTMLElement, label: string, value: number, min: number, max: number, step: number, onChange: (v: number) => void): void {
  const row = document.createElement("div");
  row.style.cssText = "display:flex;align-items:center;gap:8px;margin-bottom:10px;";
  const lbl = document.createElement("label");
  lbl.style.cssText = "font-size:11px;color:var(--text-dim);width:80px;flex-shrink:0;";
  lbl.textContent = label;
  const val = document.createElement("span");
  val.style.cssText = "font-size:11px;color:var(--text-bright);width:36px;text-align:right;";
  val.textContent = step < 1 ? value.toFixed(2) : String(Math.round(value));
  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = String(min);
  slider.max = String(max);
  slider.step = String(step);
  slider.value = String(value);
  slider.style.cssText = "flex:1;accent-color:var(--accent);height:4px;";
  slider.addEventListener("input", () => {
    const v = parseFloat(slider.value);
    val.textContent = step < 1 ? v.toFixed(2) : String(Math.round(v));
    onChange(v);
  });
  row.appendChild(lbl);
  row.appendChild(slider);
  row.appendChild(val);
  container.appendChild(row);
}

function buildMatCatLevel(id: string, modelName: string): PopupLevel {
  const label = "材质 — " + modelName;
  return {
    label,
    dir: "",
    items: [],
    renderCustom: (container) => {
      container.style.padding = "12px 14px";
      const groups = getMatCatGroups(id);
      const detailList = getMatDetailList(id);
      const detailMap = new Map(detailList.map(d => [d.name, d]));

      const CATEGORY_ICONS: Record<string, string> = {
        "皮肤": "droplet", "头发": "feather", "眼睛": "eye", "服装": "shirt",
      };

      for (const [cat, mats] of groups) {
        const params = getMatCatParams(id, cat);
        const catModified = mats.some(m => detailMap.get(m.name)?.modified);
        const card = document.createElement("div");
        card.style.cssText = "border:1px solid var(--white-08);border-radius:6px;padding:8px;margin-bottom:10px;";

        const header = document.createElement("div");
        header.style.cssText = "font-size:12px;color:var(--text-bright);margin-bottom:6px;display:flex;align-items:center;gap:4px;";
        header.innerHTML = `<iconify-icon icon="${CATEGORY_ICONS[cat] || "box"}"></iconify-icon> ${cat} <span style="font-size:10px;color:var(--text-dim);">(${mats.length} 个材质)</span>`;
        if (catModified) {
          header.innerHTML += ' <span style="font-size:10px;color:var(--accent);margin-left:auto;">已修改</span>';
        }
        card.appendChild(header);

        // Per-material list
        for (const mat of mats) {
          const detail = detailMap.get(mat.name);
          const isModified = detail?.modified ?? false;
          const matRow = document.createElement("div");
          matRow.style.cssText = `display:flex;align-items:center;gap:6px;padding:4px 6px;margin:2px 0;border-radius:4px;cursor:pointer;font-size:11px;${isModified ? "color:var(--accent);background:var(--white-04);" : "color:var(--text-dim);"}`;
          matRow.innerHTML = `<iconify-icon icon="${isModified ? "check-circle" : "circle"}"></iconify-icon><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(mat.name)}</span>`;
          matRow.addEventListener("mouseenter", () => { matRow.style.background = "var(--white-08)"; });
          matRow.addEventListener("mouseleave", () => { matRow.style.background = isModified ? "var(--white-04)" : ""; });
          matRow.addEventListener("click", () => {
            modelStack?.push(buildPerMatLevel(id, modelName, mat.name, mat.mat, detail?.index ?? 0));
          });
          card.appendChild(matRow);
        }

        // Category-level sliders
        const sliderGroup = document.createElement("div");
        sliderGroup.style.cssText = "margin-top:4px;padding-top:4px;border-top:1px solid var(--white-04);";
        addSliderRow(sliderGroup, "漫反射倍率", params.diffuseMul, 0, 2, 0.05, (v) => setMatCatParams(id, cat, { diffuseMul: v }));
        addSliderRow(sliderGroup, "高光倍率", params.specularMul, 0, 2, 0.05, (v) => setMatCatParams(id, cat, { specularMul: v }));
        addSliderRow(sliderGroup, "高光指数", params.shininess, 0, 200, 1, (v) => setMatCatParams(id, cat, { shininess: v }));
        addSliderRow(sliderGroup, "环境光倍率", params.ambientMul, 0, 2, 0.05, (v) => setMatCatParams(id, cat, { ambientMul: v }));
        card.appendChild(sliderGroup);

        container.appendChild(card);
      }

      const divider = document.createElement("div");
      divider.className = "menu-divider";
      container.appendChild(divider);

      // Reset per-material overrides
      const hasOverrides = detailList.some(d => d.modified);
      if (hasOverrides) {
        const resetAllRow = document.createElement("div");
        resetAllRow.className = "menu-item";
        resetAllRow.style.color = "var(--warn)";
        resetAllRow.innerHTML = '<span class="menu-icon"><iconify-icon icon="rotate-ccw"></iconify-icon></span><span class="menu-label">重置所有单独调整</span>';
        resetAllRow.addEventListener("click", () => {
          resetAllMatParams(id);
          modelStack?.reRender();
          setStatus("✓ 所有单独材质调整已重置", true);
        });
        container.appendChild(resetAllRow);
      }

      const resetRow = document.createElement("div");
      resetRow.className = "menu-item";
      resetRow.innerHTML = '<span class="menu-icon"><iconify-icon icon="rotate-ccw"></iconify-icon></span><span class="menu-label">重置全部材质参数</span>';
      resetRow.addEventListener("click", () => {
        resetMatCatParams(id);
        resetAllMatParams(id);
        modelStack?.reRender();
        setStatus("✓ 全部材质参数已重置", true);
      });
      container.appendChild(resetRow);
    },
  };
}

function buildPerMatLevel(id: string, modelName: string, matName: string, mat: Material, matIndex: number): PopupLevel {
  const shortName = matName.length > 24 ? matName.slice(0, 24) + "…" : matName;
  return {
    label: shortName,
    dir: "",
    items: [],
    renderCustom: (container) => {
      container.style.padding = "12px 14px";

      const nameEl = document.createElement("div");
      nameEl.style.cssText = "font-size:11px;color:var(--text-dim);margin-bottom:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
      nameEl.textContent = modelName + " > " + matName;
      container.appendChild(nameEl);

      const current = getMatParams(id, matIndex);
      const params = current ?? { diffuseMul: 1, specularMul: 1, shininess: 50, ambientMul: 1 };
      const isModified = current !== null;

      addSliderRow(container, "漫反射倍率", params.diffuseMul, 0, 2, 0.05, (v) => {
        setMatParams(id, matIndex, { diffuseMul: v });
      });
      addSliderRow(container, "高光倍率", params.specularMul, 0, 2, 0.05, (v) => {
        setMatParams(id, matIndex, { specularMul: v });
      });
      addSliderRow(container, "高光指数", params.shininess, 0, 200, 1, (v) => {
        setMatParams(id, matIndex, { shininess: v });
      });
      addSliderRow(container, "环境光倍率", params.ambientMul, 0, 2, 0.05, (v) => {
        setMatParams(id, matIndex, { ambientMul: v });
      });

      const divider = document.createElement("div");
      divider.className = "menu-divider";
      container.appendChild(divider);

      if (isModified) {
        const resetRow = document.createElement("div");
        resetRow.className = "menu-item";
        resetRow.innerHTML = '<span class="menu-icon"><iconify-icon icon="rotate-ccw"></iconify-icon></span><span class="menu-label">重置此材质</span>';
        resetRow.addEventListener("click", () => {
          resetSingleMatParams(id, matIndex);
          modelStack?.reRender();
          setStatus(`✓ 已重置: ${matName}`, true);
        });
        container.appendChild(resetRow);
      }
    },
  };
}

function buildModelDetailLevel(id: string): PopupLevel {
  const inst = modelRegistry.get(id);
  if (!inst) return { label: "未知模型", dir: "", items: [] };
  return {
    label: inst.name,
    dir: "",
    items: [
      { kind: "folder", label: "模型信息", icon: "info", target: `detail:info:${id}`, sublabel: "模型名称与描述" },
      { kind: "folder", label: "变换", icon: "move", target: `detail:transform:${id}`, sublabel: "位置/缩放/旋转" },
      { kind: "folder", label: "可见性", icon: "eye", target: `detail:visibility:${id}`, sublabel: inst.visible ? "显示" : "隐藏" },
      { kind: "folder", label: "材质列表", icon: "box", target: `detail:material:${id}`, sublabel: "材质参数调整" },
      { kind: "folder", label: "标签", icon: "tag", target: `detail:tags:${id}`, sublabel: "管理标签" },
      { kind: "folder", label: "表情预览", icon: "smile", target: `detail:morph:${id}`, sublabel: "预览模型表情" },
      { kind: "divider", label: "", icon: "", target: "" },
      { kind: "action", label: "聚焦", icon: "target", target: `detail:focus:${id}`, sublabel: "相机对准此模型" },
      { kind: "action", label: "移除", icon: "trash-2", target: `detail:remove:${id}`, sublabel: "从场景删除" },
      { kind: "divider", label: "", icon: "", target: "" },
      { kind: "action", label: "保存预设", icon: "save", target: `detail:preset-save:${id}`, sublabel: "保存模型状态到预设文件" },
      { kind: "action", label: "加载预设", icon: "folder-open", target: `detail:preset-load:${id}`, sublabel: "从预设文件恢复模型状态" },
      { kind: "divider", label: "", icon: "", target: "" },
      { kind: "action", label: "在 MMD 中打开", icon: "external-link", target: `detail:export-mmd:${id}`, sublabel: "用 MikuMikuDance 打开" },
      { kind: "action", label: "在 Blender 中编辑", icon: "edit-3", target: `detail:blender:${id}`, sublabel: "用 Blender 编辑此模型" },
    ],
  };
}

// ======== Model Preset (save/load single-model state) ========

/** Serialize a model instance's state into a preset JSON string. */
export function serializeModelPreset(id: string): string {
  const inst = modelRegistry.get(id);
  if (!inst) return "";
  const matState = getMatState(id);
  const rm = inst.rootMesh;
  const preset: ModelPresetFile = {
    version: 1,
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

/** Apply a preset JSON to the specified model instance. */
export async function applyModelPreset(id: string, jsonStr: string): Promise<void> {
  let preset: ModelPresetFile;
  try {
    preset = JSON.parse(jsonStr);
  } catch {
    setStatus("✗ 预设文件格式错误", false);
    return;
  }
  if (preset.version !== 1) {
    setStatus("✗ 不支持的预设版本", false);
    return;
  }
  const inst = modelRegistry.get(id);
  if (!inst) {
    setStatus("✗ 目标模型不存在", false);
    return;
  }

  // Apply transform — rootMesh is the authoritative transform root for MMD models
  if (preset.transform) {
    const t = preset.transform;
    setModelPosition(id, t.positionX ?? 0, t.positionY ?? 0, t.positionZ ?? 0);
    if (t.scaling !== undefined) setModelScaling(id, t.scaling);
    if (t.rotationY !== undefined) setModelRotationY(id, t.rotationY);
  }

  // Apply visibility
  if (preset.visibility) {
    const v = preset.visibility;
    if (v.visible !== undefined) setModelVisibility(id, v.visible);
    if (v.opacity !== undefined) setModelOpacity(id, v.opacity);
    if (v.wireframe !== undefined) setModelWireframe(id, v.wireframe);
  }

  // Apply VMD — reuse stopVMD() for clean cleanup when no VMD in preset
  if (preset.vmd && preset.vmd.path) {
    try {
      const resolvedVmdPath = preset.vmd.libraryRef
        ? (resolveLibraryRef(preset.vmd.libraryRef) || preset.vmd.path)
        : preset.vmd.path;
      await loadVMDFromPath(resolvedVmdPath, id);
      // Restore playback state so physics runs if it was playing when saved
      if (preset.vmd.playing === true && mmdRuntime && !isPlaying) {
        await mmdRuntime.playAnimation();
        setIsPlaying(true);
      } else if (preset.vmd.playing === false && mmdRuntime && isPlaying) {
        mmdRuntime.pauseAnimation();
        setIsPlaying(false);
      }
    } catch (err) {
      console.warn("Preset VMD load failed:", err);
    }
  } else {
    stopVMD(id);
  }

  // Apply material state
  if (preset.materialCategories || preset.materialOverrides) {
    applyMatState(id, {
      categories: preset.materialCategories,
      overrides: preset.materialOverrides,
    });
  }

  // Apply audio
  if (preset.audio && preset.audio.path) {
    try {
      await loadAudioFile(preset.audio.path);
      setVolume(preset.audio.volume ?? 1);
      setAudioOffset(preset.audio.offset ?? 0);
    } catch (err) {
      console.warn("Preset audio load failed:", err);
    }
  }

  updatePlaybackUI();
  triggerAutoSave();
  setStatus(`✓ 已应用预设: ${preset.model.name}`, true);
}

/** Open save dialog → serialize model state → write preset file. */
async function selectAndSavePreset(id: string): Promise<void> {
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

/** Open file dialog → read preset file → apply to model. */
async function selectAndLoadPreset(id: string): Promise<void> {
  const path = await SelectPresetOpenFile();
  if (!path) return;
  try {
    const json = await LoadModelPreset(path);
    await applyModelPreset(id, json);
  } catch (err: any) {
    setStatus("✗ 加载失败: " + (err.message || err), false);
  }
}

/** Build the transform slider submenu for a model. */
function buildTransformLevel(id: string): PopupLevel {
  const inst = modelRegistry.get(id);
  if (!inst) return { label: "变换", dir: "", items: [] };
  const pos = getModelPosition(id);
  return {
    label: "变换",
    dir: "",
    items: [],
    renderCustom: (container) => {
      container.style.padding = "12px 14px";
      const fields: Array<{
        label: string; key: string; min: number; max: number; step: number; get: () => number; set: (v: number) => void;
      }> = [
        { label: "位置 X", key: "px", min: -20, max: 20, step: 0.1,
          get: () => getModelPosition(id)[0],
          set: (v) => { const p = getModelPosition(id); setModelPosition(id, v, p[1], p[2]); } },
        { label: "位置 Y", key: "py", min: -20, max: 20, step: 0.1,
          get: () => getModelPosition(id)[1],
          set: (v) => { const p = getModelPosition(id); setModelPosition(id, p[0], v, p[2]); } },
        { label: "位置 Z", key: "pz", min: -20, max: 20, step: 0.1,
          get: () => getModelPosition(id)[2],
          set: (v) => { const p = getModelPosition(id); setModelPosition(id, p[0], p[1], v); } },
        { label: "缩放", key: "scale", min: 0.01, max: 5, step: 0.05,
          get: () => modelRegistry.get(id)?.scaling ?? 1,
          set: (v) => setModelScaling(id, v) },
        { label: "旋转 Y", key: "ry", min: -180, max: 180, step: 1,
          get: () => ((modelRegistry.get(id)?.rotationY ?? 0) * 180 / Math.PI),
          set: (v) => setModelRotationY(id, v * Math.PI / 180) },
      ];
      for (const f of fields) {
        const row = document.createElement("div");
        row.style.cssText = "display:flex;align-items:center;gap:8px;margin-bottom:10px;";
        const label = document.createElement("label");
        label.style.cssText = "font-size:11px;color:var(--text-dim);width:60px;flex-shrink:0;";
        label.textContent = f.label;
        const val = document.createElement("span");
        val.style.cssText = "font-size:11px;color:var(--text-bright);width:40px;text-align:right;";
        val.textContent = f.get().toFixed(f.step < 0.1 ? 2 : f.step >= 1 ? 0 : 1);
        const slider = document.createElement("input");
        slider.type = "range";
        slider.min = String(f.min);
        slider.max = String(f.max);
        slider.step = String(f.step);
        slider.value = String(f.get());
        slider.style.cssText = "flex:1;accent-color:var(--accent);height:4px;";
        slider.addEventListener("input", () => {
          const v = parseFloat(slider.value);
          val.textContent = f.step >= 1 ? String(Math.round(v)) : v.toFixed(f.step < 0.1 ? 2 : 1);
          f.set(v);
        });
        row.appendChild(label);
        row.appendChild(slider);
        row.appendChild(val);
        container.appendChild(row);
      }
      // Reset button
      const resetBtn = document.createElement("div");
      resetBtn.className = "menu-item";
      resetBtn.style.cssText = "margin-top:4px;";
      resetBtn.innerHTML = '<span class="menu-icon"><iconify-icon icon="rotate-ccw"></iconify-icon></span><span class="menu-label">重置变换</span>';
      resetBtn.addEventListener("click", () => {
        resetModelTransform(id);
        // Re-render the level to reflect reset values
        modelStack?.reRender();
        setStatus("✓ 变换已重置", true);
      });
      container.appendChild(resetBtn);
    },
  };
}

/** Build the visibility submenu for a model. */
function buildVisibilityLevel(id: string): PopupLevel {
  const inst = modelRegistry.get(id);
  if (!inst) return { label: "可见性", dir: "", items: [] };
  return {
    label: "可见性",
    dir: "",
    items: [],
    renderCustom: (container) => {
      container.style.padding = "12px 14px";
      const options = [
        { label: "✅ 显示", active: inst.visible && inst.opacity >= 0.99, action: () => { setModelVisibility(id, true); setModelOpacity(id, 1); } },
        { label: "👻 半透明", active: inst.visible && inst.opacity < 0.99 && inst.opacity > 0.1, action: () => { setModelVisibility(id, true); setModelOpacity(id, 0.5); } },
        { label: "🚫 隐藏", active: !inst.visible, action: () => { setModelVisibility(id, false); } },
      ];
      for (const opt of options) {
        const row = document.createElement("div");
        row.className = "menu-item";
        if (opt.active) row.style.background = "var(--accent-dark)";
        row.innerHTML = `<span class="menu-label">${opt.label}</span>`;
        row.addEventListener("click", () => {
          opt.action();
          modelStack?.reRender();
          setStatus(opt.label, true);
        });
        container.appendChild(row);
      }
      // Divider
      const divider = document.createElement("div");
      divider.className = "menu-divider";
      container.appendChild(divider);
      // Wireframe toggle
      const wfRow = document.createElement("div");
      wfRow.className = "menu-item";
      wfRow.innerHTML = `<span class="menu-label">🔲 线框模式 ${inst.wireframe ? "✅" : ""}</span>`;
      wfRow.addEventListener("click", () => {
        setModelWireframe(id, !inst.wireframe);
        modelStack?.reRender();
        setStatus(inst.wireframe ? "线框模式: 开" : "线框模式: 关", true);
      });
      container.appendChild(wfRow);
    },
  };
}

/** Build the model tags management level for a specific model. */
function buildModelTagsLevel(id: string): PopupLevel {
  const inst = modelRegistry.get(id);
  if (!inst) return { label: "标签", dir: "", items: [] };
  const libRef = inst.filePath ? computeLibraryRef(inst.filePath) : null;
  return {
    label: "标签管理",
    dir: "",
    items: [],
    renderCustom: (container) => {
      container.style.padding = "12px 14px";

      // 收藏 toggle
      const favRow = document.createElement("div");
      favRow.style.cssText = "display:flex;align-items:center;gap:8px;padding:6px 0;margin-bottom:8px;cursor:pointer;border-radius:4px;";
      favRow.addEventListener("mouseenter", () => favRow.style.background = "var(--white-08)");
      favRow.addEventListener("mouseleave", () => favRow.style.background = "transparent");
      const refreshFav = async () => {
        if (!libRef) return;
        const tags = await GetTagsByModel(libRef);
        const isFav = tags && tags.includes("收藏");
        favRow.innerHTML = `<iconify-icon icon="star" style="font-size:16px;color:${isFav ? 'var(--accent)' : 'var(--text-muted)'};"></iconify-icon><span style="font-size:13px;color:var(--text);">${isFav ? '已收藏' : '未收藏'}</span><span style="font-size:11px;color:var(--text-muted);margin-left:auto;">点击切换</span>`;
        favRow.onclick = async () => {
          if (!libRef) return;
          try {
            if (isFav) {
              await RemoveTag(libRef, "收藏");
              setStatus("✓ 已取消收藏", true);
            } else {
              await AddTag(libRef, "收藏");
              setStatus("✓ 已收藏", true);
            }
            refreshFav();
          } catch (err) {
            console.warn("Toggle favorite failed:", err);
            setStatus("✗ 收藏操作失败", false);
          }
        };
      };
      refreshFav();
      container.appendChild(favRow);

      const sep = document.createElement("div");
      sep.className = "menu-divider";
      container.appendChild(sep);

      const tagContainer = document.createElement("div");
      tagContainer.style.cssText = "display:flex;flex-wrap:wrap;gap:4px;margin-bottom:10px;min-height:28px;";
      container.appendChild(tagContainer);

      function refreshTags(): void {
        if (!libRef) {
          tagContainer.innerHTML = '<span style="color:var(--text-muted);font-size:11px;">无法识别模型路径</span>';
          return;
        }
        GetTagsByModel(libRef).then((tags) => {
          tagContainer.innerHTML = "";
          if (!tags || tags.length === 0) {
            const empty = document.createElement("span");
            empty.style.cssText = "color:var(--text-muted);font-size:11px;";
            empty.textContent = "暂无标签";
            tagContainer.appendChild(empty);
            return;
          }
          for (const tag of tags) {
            const chip = document.createElement("span");
            chip.className = "menu-tag";
            chip.style.cssText = "display:inline-flex;align-items:center;gap:4px;cursor:pointer;";
            chip.innerHTML = `${escapeHtml(tag)} <span style="font-size:10px;opacity:0.6;">✕</span>`;
            chip.title = "点击移除标签";
            chip.addEventListener("click", () => {
              RemoveTag(libRef, tag).then(() => {
                refreshTags();
                setStatus(`✓ 已移除标签: ${tag}`, true);
              }).catch((err) => {
                console.warn("RemoveTag failed:", err);
                setStatus("✗ 移除标签失败", false);
              });
            });
            tagContainer.appendChild(chip);
          }
        }).catch((err) => {
          console.warn("GetTagsByModel failed:", err);
          tagContainer.textContent = "加载标签失败";
        });
      }

      refreshTags();

      // Add tag input + button
      const addRow = document.createElement("div");
      addRow.style.cssText = "display:flex;gap:6px;";
      const input = document.createElement("input");
      input.type = "text";
      input.placeholder = "输入标签名...";
      input.style.cssText = "flex:1;background:var(--white-08);border:1px solid var(--border);border-radius:4px;color:var(--text);padding:6px 8px;font-size:12px;outline:none;";
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") addBtn.click();
      });
      const addBtn = document.createElement("button");
      addBtn.textContent = "添加";
      addBtn.style.cssText = "background:var(--accent);color:#fff;border:none;border-radius:4px;padding:6px 12px;font-size:12px;cursor:pointer;";
      addBtn.addEventListener("click", () => {
        const tagName = input.value.trim();
        if (!tagName || !libRef) return;
        if (tagName.includes(" ")) {
          setStatus("标签名不能包含空格", false);
          return;
        }
        AddTag(libRef, tagName).then(() => {
          input.value = "";
          refreshTags();
          setStatus(`✓ 已添加标签: ${tagName}`, true);
        }).catch((err) => {
          console.warn("AddTag failed:", err);
          setStatus("✗ 添加标签失败", false);
        });
      });
      addRow.appendChild(input);
      addRow.appendChild(addBtn);
      container.appendChild(addRow);

      // Hint text
      const hint = document.createElement("div");
      hint.style.cssText = "font-size:10px;color:var(--text-dark);margin-top:8px;";
      hint.textContent = "点击标签上的 ✕ 可移除";
      container.appendChild(hint);
    },
  };
}

/** Build the model info submenu — read-only metadata from ModelInstance + PMX. */
function buildModelInfoLevel(id: string): PopupLevel {
  const inst = modelRegistry.get(id);
  if (!inst) return { label: "模型信息", dir: "", items: [] };
  return {
    label: "模型信息",
    dir: "",
    items: [],
    renderCustom: (container) => {
      container.style.padding = "12px 14px";
      const meta = modelMetaCache.get(inst.filePath);

      // Compute stats from live meshes
      let vertCount = 0;
      let faceCount = 0;
      for (const m of inst.meshes) {
        vertCount += m.getTotalVertices() || 0;
        faceCount += m.getTotalIndices() || 0;
      }
      const faceCountDisplay = (faceCount / 3).toLocaleString();

      // Bone and morph from babylon-mmd runtime
      const boneCount = inst.mmdModel?.runtimeBones?.length ?? null;
      const morphCount = inst.mmdModel?.morph?.morphs?.length ?? null;

      const fields: Array<{ label: string; value: string }> = [
        { label: "名称", value: inst.name },
        { label: "文件", value: inst.filePath.split("/").pop() || inst.filePath },
        { label: "类型", value: inst.kind === "actor" ? "角色模型" : "舞台模型" },
        { label: "动作", value: inst.vmdName || "无" },
        { label: "顶点数", value: vertCount.toLocaleString() },
        { label: "面数", value: faceCountDisplay },
        { label: "材质数", value: String(inst.meshes.length) },
        { label: "骨骼数", value: boneCount !== null ? boneCount.toLocaleString() : "N/A" },
        { label: "表情数", value: morphCount !== null ? morphCount.toLocaleString() : "N/A" },
        { label: "日文名", value: meta?.name_jp || "—" },
        { label: "英文名", value: meta?.name_en || "—" },
        { label: "备注", value: meta?.comment ? meta.comment.substring(0, 80) : "—" },
      ];
      for (const f of fields) {
        const row = document.createElement("div");
        row.style.cssText = "display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);font-size:12px;";
        const lbl = document.createElement("span");
        lbl.style.cssText = "color:var(--text-dim);";
        lbl.textContent = f.label;
        const val = document.createElement("span");
        val.style.cssText = "color:var(--text-bright);text-align:right;max-width:60%;overflow:hidden;text-overflow:ellipsis;";
        val.textContent = f.value;
        row.appendChild(lbl);
        row.appendChild(val);
        container.appendChild(row);
      }
    },
  };
}

/** Build the morph (expression) preview panel for a model. */
function buildMorphPreviewLevel(id: string): PopupLevel {
  const inst = modelRegistry.get(id);
  const morphs = inst ? getModelMorphs(id) : [];
  const typeLabels: Record<number, string> = {
    0: "组", 1: "顶点", 2: "骨骼", 3: "UV", 8: "材质",
  };
  return {
    label: "表情预览",
    dir: "",
    items: [],
    renderCustom: (container) => {
      container.style.padding = "8px 6px";

      // Top toolbar
      const toolbar = document.createElement("div");
      toolbar.style.cssText = "display:flex;gap:8px;padding:0 8px 10px;border-bottom:1px solid var(--border);margin-bottom:8px;";
      const resetBtn = document.createElement("button");
      resetBtn.textContent = "全部重置";
      resetBtn.style.cssText = "flex:1;padding:6px 10px;font-size:11px;background:var(--overlay-bg);border:1px solid var(--border);border-radius:6px;color:var(--text);cursor:pointer;";
      resetBtn.addEventListener("click", () => {
        resetModelMorphs(id);
        // Re-render list
        container.querySelectorAll(".morph-slider").forEach((el) => {
          (el as HTMLInputElement).value = "0";
          const valLabel = (el as HTMLElement).parentElement?.querySelector(".morph-val");
          if (valLabel) valLabel.textContent = "0.00";
        });
        setStatus("✓ 已重置所有表情", true);
      });
      toolbar.appendChild(resetBtn);
      container.appendChild(toolbar);

      // Morph list with sliders
      const list = document.createElement("div");
      list.style.cssText = "max-height:340px;overflow-y:auto;";
      for (const m of morphs) {
        const row = document.createElement("div");
        row.style.cssText = "padding:6px 8px;";

        const header = document.createElement("div");
        header.style.cssText = "display:flex;align-items:center;gap:6px;margin-bottom:4px;";
        const name = document.createElement("span");
        name.style.cssText = "flex:1;font-size:12px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
        name.textContent = m.name;
        name.title = m.name;
        const typeTag = document.createElement("span");
        typeTag.style.cssText = "font-size:10px;color:var(--text-dim);flex-shrink:0;";
        typeTag.textContent = typeLabels[m.type] || `类型${m.type}`;
        const valLabel = document.createElement("span");
        valLabel.className = "morph-val";
        valLabel.style.cssText = "font-size:11px;color:var(--text-dim);width:32px;text-align:right;flex-shrink:0;";
        valLabel.textContent = "0.00";
        header.appendChild(name);
        header.appendChild(typeTag);
        header.appendChild(valLabel);

        const slider = document.createElement("input");
        slider.type = "range";
        slider.min = "0";
        slider.max = "1";
        slider.step = "0.01";
        slider.value = "0";
        slider.className = "morph-slider";
        slider.style.cssText = "width:100%;accent-color:var(--accent);height:4px;";
        slider.addEventListener("input", () => {
          const v = parseFloat(slider.value);
          setModelMorphWeight(id, m.name, v);
          valLabel.textContent = v.toFixed(2);
        });

        row.appendChild(header);
        row.appendChild(slider);
        list.appendChild(row);
      }

      if (morphs.length === 0) {
        const empty = document.createElement("div");
        empty.style.cssText = "text-align:center;padding:24px;color:var(--text-muted);font-size:12px;";
        empty.textContent = "此模型无表情数据";
        list.appendChild(empty);
      }

      container.appendChild(list);
    },
  };
}

function handlePopupSearch(): void {
  const q = dom.popupSearchInput.value.trim().toLowerCase();
  if (!q) {
    setSearchMode(false);
    if (isSearchLayer()) {
      modelStack?.pop();
    }
    return;
  }
  setSearchMode(true);
  if (isSearchLayer()) {
    // Update existing search results by re-pushing (pop first, then push)
    modelStack?.pop();
  }
  const results = allModels.filter((m) => {
    const cached = modelMetaCache.get(m.file_path);
    const nameJp = cached?.name_jp || m.name_jp || "";
    const nameEn = cached?.name_en || m.name_en || "";
    const comment = cached?.comment || m.comment || "";
    return (
      nameJp.toLowerCase().includes(q) ||
      nameEn.toLowerCase().includes(q) ||
      comment.toLowerCase().includes(q) ||
      m.file_path.toLowerCase().includes(q)
    );
  });

  // Trigger on-demand PMX header parsing for search results (background)
  ensureModelMeta(
    results.filter((m) => m.format === "pmx").map((m) => m.file_path),
  );

  const resultLevel: PopupLevel = {
    label: "🔍 搜索结果",
    dir: "",
    items: [],
    renderCustom: (container) => {
      if (results.length === 0) {
        const empty = document.createElement("div");
        empty.style.cssText =
          "padding:24px;text-align:center;color:var(--text-muted);font-size:13px;";
        empty.innerHTML =
          '<div style="font-size:28px;margin-bottom:6px;">🔍</div><div>没有找到匹配的模型</div>';
        container.appendChild(empty);
        return;
      }
      for (const m of results) {
        const row = modelToRow(m);
        const el = document.createElement("div");
        el.className = "menu-item";

        const iconSpan = document.createElement("span");
        iconSpan.className = "menu-icon";
        const iconEl = createIconifyIcon(row.icon);
        if (iconEl) {
          iconSpan.appendChild(iconEl);
        } else {
          iconSpan.textContent = row.icon;
        }
        el.appendChild(iconSpan);

        const labelSpan = document.createElement("span");
        labelSpan.className = "menu-label";
        labelSpan.textContent = row.label;
        el.appendChild(labelSpan);

        if (row.catTag) {
          const tagSpan = document.createElement("span");
          tagSpan.className = "menu-tag";
          tagSpan.textContent = row.catTag;
          el.appendChild(tagSpan);
        }

        const thumbB64 = thumbnailCache.get(m.file_path);
        if (thumbB64) {
          const img = document.createElement("img");
          img.className = "row-thumb";
          img.src = `data:image/png;base64,${thumbB64}`;
          el.insertBefore(img, el.firstChild);
        }

        el.addEventListener("click", () => {
          replaceModel(m);
        });
        container.appendChild(el);
      }
      // Load thumbnails
      const resultLevel: PopupLevel = {
        label: "搜索结果",
        dir: "",
        items: results.map((m) => modelToRow(m)),
      };
      loadThumbnailsForLevel(resultLevel);
    },
  };

  // Push search results onto the model stack
  modelStack?.push(resultLevel);
}

// ======== Library loading ========
export async function initLibrary(): Promise<void> {
  try {
    const cfg = await GetConfig();
    if (!cfg || !cfg.library_root) {
      setStatus(
        "📦 首次使用：点击这里打开模型库 → 加载模型，模型目录请在 ⚙ 设置中配置",
        false,
      );
      return;
    }
    setLibraryRoot(cfg.library_root);
    setExternalPaths(cfg.external_paths || []);
    // Load saved display name priority
    if (cfg.display_name_priority) {
      setDisplayNamePriority(cfg.display_name_priority as DisplayNamePriority);
    }
    // Load recent models
    try {
      const recents = await GetRecentModels();
      if (recents && recents.length > 0) {
        setRecentModels(recents);
      }
    } catch (err) {
      console.warn("Load recent models:", err);
    }
    // Load dance sets
    try {
      await loadDanceSets();
    } catch (err) {
      console.warn("Load dance sets:", err);
    }
    try {
      const cached = await GetLibraryIndex();
      const validCached = cached ? cached.filter((m: any) => m.file_path) : [];
      if (validCached.length > 0) setAllModels(validCached);
    } catch {
      /* no cache */
    }
    try {
      await rescanAndSync();
    } catch (err) {
      console.warn("ScanModelDir refresh:", err);
    }
    CleanOrphanCache().catch((err) => console.warn("CleanOrphanCache:", err));
    setStatus(
      "📦 点击这里浏览模型 · 💃 点击这里加载动作 · 拖拽旋转 · 滚轮缩放",
      false,
    );
  } catch (err) {
    console.warn("initLibrary:", err);
    setStatus("✗ 模型库加载失败", false);
  }
}

async function selectAndSetLibraryRoot(): Promise<void> {
  try {
    const dir = await SelectDir();
    if (!dir) return;
    setLibraryRoot(dir);
    setStatus("扫描模型库...", false);
    const models = await rescanAndSync();
    setStatus(`✓ ${models.length} 个条目`, true);
    showPopup();
  } catch (err) {
    console.error("Error setting library root:", err);
    setStatus("✗ 目录选择失败", false);
  }
}

// ======== Library loading ========

/** Re-scan the model directory and sync all local state. */
export async function rescanAndSync(dir?: string): Promise<LibraryModel[]> {
  const root = dir ?? libraryRoot;
  const models = await ScanModelDir(root, externalPaths);
  setAllModels(models);
  await SetLibraryRoot(root);
  return models;
}

/** Reload config from disk and update local library state. */
export async function reloadConfig(): Promise<void> {
  const cfg = await GetConfig();
  if (cfg) {
    setLibraryRoot(cfg.library_root || "");
    setExternalPaths(cfg.external_paths || []);
  }
}

export async function refreshLibrary(): Promise<void> {
  setStatus("扫描中...", false);
  try {
    await ClearExtractCache();
    const models = await rescanAndSync();
    setStatus(`✓ ${models.length} 个条目`, true);
    CleanOrphanCache().catch((err) =>
      console.warn("CleanOrphanCache (background):", err),
    );
    if (popupOpen) showPopup();
  } catch (err) {
    setStatus("✗ 扫描失败", false);
  }
}

// ======== Popup search input handler ========
export function handlePopupSearchInput(): void {
  handlePopupSearch();
}

// Wire up event listeners that belong to library module
dom.btnClosePopup.addEventListener("click", hidePopup);
dom.btnRescan.addEventListener("click", refreshLibrary);
dom.popupSearchInput.addEventListener("input", handlePopupSearchInput);
dom.btnMainAction.addEventListener("click", togglePopup);
dom.canvas.addEventListener("click", () => {
  if (popupOpen) hidePopup();
});

// ======== Motion Popup Events ========
dom.btnMotionPopup.addEventListener("click", showMotionPopup);
dom.btnCloseMotionPopup.addEventListener("click", hideMotionPopup);
