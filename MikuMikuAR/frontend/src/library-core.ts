// [doc:architecture] Library Core — 模型库核心逻辑
// 从 library.ts 提取

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
  GetAllTags,
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
  recentModels,
  setRecentModels,
  computeLibraryRef,
  motionBindingTargetId,
  setMotionBindingTargetId,
  cardContainer,
} from "./config";
import {
  loadPMXFile,
  loadVMDFromPath,
  focusModel,
  removeModel,
  resetModelMorphs,
} from "./scene";
import {
  buildModelDetailLevel,
  buildModelInfoLevel,
  buildTransformLevel,
  buildVisibilityLevel,
  buildModelTagsLevel,
  buildMorphPreviewLevel,
  buildMatCatLevel,
  buildOpenWithLevel,
  selectAndSavePreset,
  selectAndLoadPreset,
} from "./model-detail";
import { buildDanceSetDetailLevel, loadDanceSets } from "./motion-popup";
import { SlideMenu } from "./menu";
import { createIconifyIcon } from "./icons";
import { slideRow } from "./ui-helpers";
import { stackRegistry } from "./config";

// ======== Model Stack ========

const makeModelStack = (): SlideMenu => {
  return new SlideMenu({
    container: dom.modelPopup,
    onClose: hidePopup,
    onFolderEnter: (row) => {
      if (row.target && row.target.startsWith("scene:")) {
        setMotionBindingTargetId(null);
        const id = row.target.replace("scene:", "");
        const inst = modelRegistry.get(id);
        if (!inst) return null;
        return buildModelDetailLevel(id);
      }
      if (row.target && row.target.startsWith("detail:")) {
        setMotionBindingTargetId(null);
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
      if (row.target && row.target.startsWith("__dance_set:")) {
        const setId = row.target.replace("__dance_set:", "");
        return buildDanceSetDetailLevel(setId);
      }
      if (row.target === "__tags__") {
        return buildTagsOverviewLevel();
      }
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
        if (row.model.format === "vmd" && motionBindingTargetId) {
          hidePopup();
          loadVMDFromPath(row.model.file_path, motionBindingTargetId);
          setMotionBindingTargetId(null);
          return;
        }
        hidePopup();
        replaceModel(row.model);
        return;
      }
      if (row.target === "models:rescan") {
        refreshLibrary();
        return;
      }
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

// ======== Thumbnail batch loading ========

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

export function buildLevel(
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

// Register buildLevel for use by motion-popup.ts (avoids circular import)
stackRegistry.buildLevel = buildLevel;

function modelToRow(m: LibraryModel): PopupRow {
  let icon = "box";
  if (m.format === "vmd") icon = "music";
  else if (m.container === "zip" && m.format === "pmx") icon = "archive";
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
    onAddClick: () => {
      hidePopup();
      onModelRowClick(m);
    },
  };
}

function onModelRowClick(m: LibraryModel): void {
  const isStage = m.type === "stage" || m.type === "scene";
  if (m.format === "pmx") {
    const ref = computeLibraryRef(m.file_path);
    if (ref) {
      AddRecentModel(ref).catch(() => {});
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
  if (focusedModelId) {
    removeModel(focusedModelId);
  }
  onModelRowClick(m);
}

function isSearchLayer(): boolean {
  return stackRegistry.modelStack?.currentLevel?.label === "🔍 搜索结果";
}

// ======== Tag System ========

function buildTagsOverviewLevel(): PopupLevel {
  return {
    label: "标签",
    dir: "",
    items: [],
    renderCustom: async (container) => {
      container.style.padding = "12px 14px";
      try {
        const favRefs = await GetModelsByTag("收藏");
        const favRow = document.createElement("div");
        favRow.className = "menu-item";
        favRow.innerHTML = `<span class="menu-icon"><iconify-icon icon="star" style="color:var(--accent);"></iconify-icon></span><span class="menu-label">收藏</span><span class="menu-sublabel" style="color:var(--text-muted);font-size:11px;">${favRefs ? favRefs.length : 0} 个模型</span><span class="menu-arrow">&gt;</span>`;
        favRow.addEventListener("click", () => {
          const level = buildTagDetailLevel("收藏");
          stackRegistry.modelStack?.push(level);
        });
        container.appendChild(favRow);
        const sep = document.createElement("div");
        sep.className = "menu-divider";
        container.appendChild(sep);

        const tags = await GetAllTags();
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
              stackRegistry.modelStack?.push(level);
            });
            container.appendChild(row);
          }
        }
        const divider = document.createElement("div");
        divider.className = "menu-divider";
        container.appendChild(divider);
        const addRow = document.createElement("div");
        addRow.className = "menu-item";
        addRow.innerHTML = '<span class="menu-icon"><iconify-icon icon="plus"></iconify-icon></span><span class="menu-label">新建标签</span>';
        addRow.addEventListener("click", () => {
          setStatus("请先进入模型详情页，在详情中为模型添加标签", false);
          stackRegistry.modelStack?.pop();
        });
        container.appendChild(addRow);
      } catch (err) {
        console.warn("buildTagsOverviewLevel:", err);
        container.textContent = "加载标签失败";
      }
    },
  };
}

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

  if (!stackRegistry.modelStack) {
    stackRegistry.modelStack = makeModelStack();
  }

  const rootItems: PopupRow[] = [];

  for (const [id, inst] of modelRegistry) {
    rootItems.push({
      kind: "folder",
      label: inst.name,
      icon: "tabler:cube-3d-sphere",
      target: `scene:${id}`,
      sublabel: inst.vmdName || undefined,
      editable: id === focusedModelId,
    });
  }
  if (rootItems.length > 0) {
    rootItems.push({ kind: "divider", label: "", icon: "", target: "" });
  }

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

  stackRegistry.modelStack.reset({ label: "模型", dir: "", items: rootItems });
}

export function hidePopup(): void {
  setMotionBindingTargetId(null);
  if (focusedModelId) {
    resetModelMorphs(focusedModelId);
  }
  closeAllOverlays();
}

// ======== Search ========

function handlePopupSearch(): void {
  const q = dom.popupSearchInput.value.trim().toLowerCase();
  if (!q) {
    setSearchMode(false);
    if (isSearchLayer()) {
      stackRegistry.modelStack?.pop();
    }
    return;
  }
  setSearchMode(true);
  if (isSearchLayer()) {
    stackRegistry.modelStack?.pop();
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
      const resultLevel: PopupLevel = {
        label: "搜索结果",
        dir: "",
        items: results.map((m) => modelToRow(m)),
      };
      loadThumbnailsForLevel(resultLevel);
    },
  };

  stackRegistry.modelStack?.push(resultLevel);
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
    if (cfg.display_name_priority) {
      setDisplayNamePriority(cfg.display_name_priority as DisplayNamePriority);
    }
    try {
      const recents = await GetRecentModels();
      if (recents && recents.length > 0) {
        setRecentModels(recents);
      }
    } catch (err) {
      console.warn("Load recent models:", err);
    }
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

export async function rescanAndSync(dir?: string): Promise<LibraryModel[]> {
  const root = dir ?? libraryRoot;
  const models = await ScanModelDir(root, externalPaths);
  setAllModels(models);
  await SetLibraryRoot(root);
  return models;
}

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

export function handlePopupSearchInput(): void {
  handlePopupSearch();
}

// Wire up event listeners
dom.btnClosePopup?.addEventListener("click", hidePopup);
dom.btnRescan?.addEventListener("click", refreshLibrary);
dom.popupSearchInput?.addEventListener("input", handlePopupSearchInput);
dom.btnMainAction?.addEventListener("click", togglePopup);
