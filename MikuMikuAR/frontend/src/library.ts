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
  ToggleFavorite,
  GetFavorites,
  AddTag,
  RemoveTag,
  GetAllTags,
  GetTagsByModel,
  GetModelsByTag,
  OpenInMMD,
  OpenInBlender,
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
  favorites,
  setFavorites,
  computeLibraryRef,
} from "./config";
import {
  loadPMXFile,
  loadVMDFromPath,
  loadVMDMotion,
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
} from "./scene";
import { MenuStack } from "./menu";

// ======== MenuStack instances ========

const makeModelStack = (): MenuStack => {
  return new MenuStack({
    parentEl: dom.modelPopup,
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
          case "motion": return buildMotionBindingLevel(id);
          case "transform": return buildTransformLevel(id);
          case "visibility": return buildVisibilityLevel(id);
          case "tags": return buildModelTagsLevel(id);
          default: return null;
        }
      }
      // Motion browsing for model detail: detail:motion:browse:${id}
      if (row.target && row.target.startsWith("detail:motion:browse:")) {
        const id = row.target.replace("detail:motion:browse:", "");
        motionBindingTargetId = id;
        // Open motion library for this specific model
        const level = buildLevel(libraryRoot, "动作库", (m) => m.format === "vmd");
        // Override label to show which model we're binding to
        const inst = modelRegistry.get(id);
        level.label = `绑定动作 → ${inst?.name || "模型"}`;
        return level;
      }
      // Favorites collection
      if (row.target === "__favorites__") {
        const favModels = allModels.filter(m => {
          const ref = computeLibraryRef(m.file_path);
          return ref && favorites.has(ref);
        });
        return {
          label: "收藏",
          dir: "",
          items: favModels.map(m => modelToRow(m)),
        };
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
          case "fav": {
            const libRef = inst.filePath ? computeLibraryRef(inst.filePath) : null;
            if (libRef) {
              const isFav = favorites.has(libRef);
              ToggleFavorite(libRef).then(() => {
                if (isFav) {
                  favorites.delete(libRef);
                } else {
                  favorites.add(libRef);
                }
                setFavorites(new Set(favorites));
                // Refresh all levels so the star icon and favorites count update immediately
                if (modelStack) {
                  // Update root level's __favorites__ folder sublabel
                  const root = modelStack.getLevel(0);
                  if (root) {
                    const favFolder = root.items.find(i => i.target === "__favorites__");
                    if (favFolder) {
                      favFolder.sublabel = favorites.size > 0 ? `${favorites.size} 个模型` : "暂无收藏";
                    }
                  }
                  // Replace the detail level with fresh computed data
                  const detailIdx = modelStack.levelCount - 1;
                  modelStack.setLevel(detailIdx, buildModelDetailLevel(id));
                  modelStack.reRender();
                }
                setStatus(isFav ? "✓ 已取消收藏" : "✓ 已收藏", true);
              }).catch((err) => {
                console.warn("ToggleFavorite failed:", err);
                setStatus("✗ 收藏操作失败", false);
              });
            }
            break;
          }
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
          case "motion": {
            const action = parts[2];
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
                  modelStack?.reRender();
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
                  modelStack?.reRender();
                  setStatus("✓ 动作已重置", true);
                }
                break;
              case "loop":
                setAutoLoop(!autoLoop);
                modelStack?.reRender();
                setStatus(`循环: ${autoLoop ? "开" : "关"}`, true);
                break;
            }
            break;
          }
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
        "detail:fav": "收藏或取消收藏此模型",
        "detail:focus": "相机对准此模型",
        "detail:remove": "从场景中移除此模型",
        "detail:export-mmd": "在 MikuMikuDance 中打开此模型",
        "detail:blender": "在 Blender 中编辑此模型",
        "detail:motion:pause": "暂停或继续当前动作",
        "detail:motion:reset": "移除动作，恢复初始姿势",
        "detail:motion:loop": "切换动作自动循环",
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

const makeMotionStack = (): MenuStack => {
  return new MenuStack({
    parentEl: dom.motionPopup,
    onClose: hideMotionPopup,
    onFolderEnter: (row) => {
      if (row.target === "motion:browse") {
        return buildLevel(libraryRoot, "动作库", (m) => m.format === "vmd");
      }
      return null;
    },
    onItemClick: (row: PopupRow) => {
      if (row.model) {
        hideMotionPopup();
        loadVMDFromPath(row.model.file_path);
      }
    },
  });
};

let modelStack: MenuStack | null = null;
let motionStack: MenuStack | null = null;

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

  // Static menu items
  rootItems.push(
    {
      kind: "folder",
      label: "收藏",
      icon: "star",
      target: "__favorites__",
      sublabel: favorites.size > 0 ? `${favorites.size} 个模型` : "暂无收藏",
    },
    {
      kind: "folder",
      label: "标签",
      icon: "tag",
      target: "__tags__",
      sublabel: "管理模型标签",
    },
    {
      kind: "folder",
      label: "加载模型",
      icon: "folder",
      target: "models:browse",
    },
    {
      kind: "folder",
      label: "角色定制",
      icon: "sparkles",
      target: "reserved:customize",
      sublabel: "即将推出",
    },
    {
      kind: "action",
      label: "重新扫描",
      icon: "refresh-cw",
      target: "models:rescan",
    },
  );

  modelStack.reset({ label: "模型", dir: "", items: rootItems });
}

export function hidePopup(): void {
  motionBindingTargetId = null;
  closeAllOverlays();
}

// ======== Motion Popup ========

export function showMotionPopup(): void {
  closeAllOverlays();
  dom.motionPopup.classList.add("visible");

  if (!motionStack) {
    motionStack = makeMotionStack();
  }

  const rootItems: PopupRow[] = [
    {
      kind: "folder",
      label: "加载动作",
      icon: "folder",
      target: "motion:browse",
    },
    {
      kind: "folder",
      label: "动作倍率",
      icon: "timer",
      target: "reserved:motionSpeed",
      sublabel: "即将推出",
    },
  ];
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
        const tags = await GetAllTags();
        if (!tags || tags.length === 0) {
          const empty = document.createElement("div");
          empty.style.cssText = "padding:16px;text-align:center;color:var(--text-muted);font-size:13px;";
          empty.innerHTML = '<div>暂无标签</div><div style="font-size:11px;margin-top:8px;color:var(--text-dark);">在模型详情中添加标签</div>';
          container.appendChild(empty);
        } else {
          for (const tag of tags) {
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
        addRow.innerHTML = '<span class="menu-icon">➕</span><span class="menu-label">新建标签</span>';
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
          el.innerHTML = `<span class="menu-icon">📦</span><span class="menu-label">${escapeHtml(row.label)}</span>`;
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

// ======== Model Detail Submenu ========

/** Build the model detail submenu for a specific model instance. */
function buildModelDetailLevel(id: string): PopupLevel {
  const inst = modelRegistry.get(id);
  if (!inst) return { label: "未知模型", dir: "", items: [] };
  const libRef = inst.filePath ? computeLibraryRef(inst.filePath) : null;
  const isFav = libRef ? favorites.has(libRef) : false;
  return {
    label: inst.name,
    dir: "",
    items: [
      { kind: "action", label: isFav ? "取消收藏" : "收藏", icon: "star", target: `detail:fav:${id}`, sublabel: isFav ? "点击取消收藏" : "点击加入收藏" },
      { kind: "folder", label: "模型信息", icon: "info", target: `detail:info:${id}`, sublabel: "模型名称与描述" },
      { kind: "folder", label: "动作绑定", icon: "music", target: `detail:motion:${id}`, sublabel: inst.vmdName || "无" },
      { kind: "folder", label: "变换", icon: "move", target: `detail:transform:${id}`, sublabel: "位置/缩放/旋转" },
      { kind: "folder", label: "可见性", icon: "eye", target: `detail:visibility:${id}`, sublabel: inst.visible ? "显示" : "隐藏" },
      { kind: "folder", label: "标签", icon: "tag", target: `detail:tags:${id}`, sublabel: "管理标签" },
      { kind: "divider", label: "", icon: "", target: "" },
      { kind: "action", label: "聚焦", icon: "target", target: `detail:focus:${id}`, sublabel: "相机对准此模型" },
      { kind: "action", label: "移除", icon: "trash-2", target: `detail:remove:${id}`, sublabel: "从场景删除" },
      { kind: "divider", label: "", icon: "", target: "" },
      { kind: "action", label: "导出到 MMD", icon: "external-link", target: `detail:export-mmd:${id}`, sublabel: "在 MikuMikuDance 中打开" },
      { kind: "action", label: "在 Blender 中编辑", icon: "edit-3", target: `detail:blender:${id}`, sublabel: "用 Blender 编辑此模型" },
    ],
  };
}

/** Build the motion binding submenu for a model. */
function buildMotionBindingLevel(id: string): PopupLevel {
  const inst = modelRegistry.get(id);
  if (!inst) return { label: "动作绑定", dir: "", items: [] };
  return {
    label: "动作绑定",
    dir: "",
    items: [
      { kind: "action", label: `当前: ${inst.vmdName || "无"}`, icon: "info", target: "", sublabel: undefined },
      { kind: "divider", label: "", icon: "", target: "" },
      { kind: "folder", label: "更换动作", icon: "music", target: `detail:motion:browse:${id}`, sublabel: "从动作库选择" },
      { kind: "action", label: inst.mmdModel ? (inst.vmdData ? "暂停动作" : "—") : "—", icon: "pause-circle", target: `detail:motion:pause:${id}`, sublabel: inst.vmdData ? "暂停/继续" : "无动作" },
      { kind: "action", label: "重置动作", icon: "rotate-ccw", target: `detail:motion:reset:${id}`, sublabel: "恢复初始姿势" },
      { kind: "divider", label: "", icon: "", target: "" },
      { kind: "action", label: `循环: ${inst.vmdData ? (autoLoop ? "开" : "关") : "—"}`, icon: "repeat", target: `detail:motion:loop:${id}`, sublabel: inst.vmdData ? "切换自动循环" : "加载动作后可用" },
    ],
  };
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
      const fields: Array<{ label: string; value: string }> = [
        { label: "名称", value: inst.name },
        { label: "文件", value: inst.filePath.split("/").pop() || inst.filePath },
        { label: "类型", value: inst.kind === "actor" ? "actor" : "stage" },
        { label: "动作", value: inst.vmdName || "无" },
        { label: "面数", value: inst.meshes.reduce((sum, m) => sum + (m.getTotalVertices() || 0), 0).toLocaleString() },
        { label: "材质数", value: String(inst.meshes.length) },
        { label: "骨骼数", value: inst.mmdModel ? "可用" : "N/A (舞台)" },
        { label: "日文名", value: meta?.name_jp || "—" },
        { label: "英文名", value: meta?.name_en || "—" },
        { label: "备注", value: meta?.comment ? meta.comment.substring(0, 60) : "—" },
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
        let html = `<span class="menu-icon">${row.icon}</span><span class="menu-label">${escapeHtml(row.label)}</span>`;
        if (row.catTag) {
          html += `<span class="menu-tag">${escapeHtml(row.catTag)}</span>`;
        }
        const thumbB64 = thumbnailCache.get(m.file_path);
        if (thumbB64) {
          html =
            `<img class="row-thumb" src="data:image/png;base64,${thumbB64}">` +
            html;
        }
        el.innerHTML = html;
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
    // Load favorites
    try {
      const favs = await GetFavorites();
      if (favs && favs.length > 0) {
        setFavorites(new Set(favs));
      }
    } catch (err) {
      console.warn("Load favorites:", err);
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
