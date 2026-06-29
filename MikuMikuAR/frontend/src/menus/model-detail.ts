// [doc:architecture] Model Detail — 模型详情子菜单（从 library.ts 提取）
// 职责: 模型详情各层级构建（信息/变换/可见性/标签/表情/材质）

import {
  modelRegistry,
  escapeHtml,
  cardContainer,
  setStatus,
  PopupLevel,
  modelMetaCache,
  computeLibraryRef,
  dom,
  stackRegistry,
} from "../core/config";
import {
  getModelPosition,
  setModelPosition,
  setModelScaling,
  setModelRotationY,
  getModelMorphs,
  setModelMorphWeight,
  resetModelMorphs,
  getMatCatGroups,
  getMatCatParams,
  setMatCatParams,
  resetMatCatParams,
  getMatDetailList,
  getMatParams,
  setMatParams,
  resetSingleMatParams,
  resetAllMatParams,
  setModelWireframe,
  setModelBoneLinesVis,
  setModelBoneJointsVis,
  setModelVisibility,
  setModelOpacity,
  removeModel,
  resetModelTransform,
  getMatState,
  applyMatState,
  setMatEnabled,
  isMatEnabled,
  getPhysicsCategories,
  isPhysicsCategoryEnabled,
  setPhysicsCategory,
  getPhysicsCatState,
  stopVMD,
  loadVMDFromPath,
} from "../scene/scene";
import { buildMatRootLevel } from "./model-material";
import { createIconifyIcon, softwareKindIcon } from "../core/icons";
import { isPlaying } from "../core/config";
import { getAudioPath, getAudioName, getVolume, getAudioOffset } from "../outfit/audio";
import { slideRow, addSliderRow, addModeSlider, addToggleRow, addCollapsible } from "../core/ui-helpers";
import { buildOutfitLevel } from "./outfit-ui";
import { loadOutfits, applyOutfitVariant } from "../outfit/outfit";
import {
  savePresetToLibDialog,
  buildPresetListLevel,
} from "./model-preset";
import {
  GetTagsByModel,
  AddTag,
  RemoveTag,
  GetAllTags,
  OpenWithSoftware,
  ScanSoftwareDir,
} from "../../wailsjs/go/main/App";
import type { main } from "../../wailsjs/go/models";

// ======== Open With (software tools submenu) ========

export function buildOpenWithLevel(id: string): PopupLevel {
  return {
    label: "用…打开",
    dir: "",
    items: [],
    renderCustom: async (container) => {
      container.classList.remove("render-card");
      let entries: main.SoftwareEntry[];
      try { entries = await ScanSoftwareDir(); } catch { entries = []; }

      if (entries.length === 0) {
        container.innerHTML = '<div style="font-size:11px;color:var(--text-dim);text-align:center;padding:12px 0;">暂无可用软件<br>请先在设置中添加</div>';
        return;
      }

      cardContainer(container, (c) => {
      for (const sw of entries) {
        const row = document.createElement("div");
        row.className = "slide-item";
        row.innerHTML = `<span class="slide-icon"><iconify-icon icon="${softwareKindIcon(sw.kind)}"></iconify-icon></span><span class="slide-label">${escapeHtml(sw.name)}</span>`;
        row.addEventListener("click", async () => {
          const inst = modelRegistry.get(id);
          if (!inst || !inst.filePath) { setStatus("✗ 模型无文件路径", false); return; }
          try { await OpenWithSoftware(inst.filePath, sw.path, sw.args || ""); setStatus(`✓ 已启动: ${sw.name}`, true); }
          catch (err: any) { setStatus("✗ " + (err.message || err), false); }
        });
        c.appendChild(row);
      }

      const manageLink = document.createElement("div");
      manageLink.className = "slide-item";
      manageLink.innerHTML = '<span class="slide-icon"><iconify-icon icon="lucide:plus"></iconify-icon></span><span class="slide-label" style="color:var(--accent);">管理软件</span>';
      manageLink.addEventListener("click", () => { dom.btnSettings.click(); });
      c.appendChild(manageLink);
      });
    },
  };
}

// ======== Model Detail Root ========

export function buildModelDetailLevel(id: string): PopupLevel {
  const inst = modelRegistry.get(id);
  if (!inst) return { label: "未知模型", dir: "", items: [] };
  return {
    label: inst.name,
    dir: "",
    items: [],
    renderCustom: (container) => {
      cardContainer(container, (c) => {
        // 核心组：始终可见，默认展开
        slideRow(c, "lucide:move", "变换", true, () => {
          const level = buildTransformLevel(id);
          stackRegistry.modelStack?.push(level);
        });
        slideRow(c, "lucide:eye", "可见性", true, () => {
          const level = buildVisibilityLevel(id);
          stackRegistry.modelStack?.push(level);
        });

        // 外观与预设折叠组
        addCollapsible(c, {
          title: "外观与预设",
          icon: "lucide:palette",
          defaultOpen: false,
          renderContent: (inner) => {
            slideRow(inner, "lucide:box", "材质调节", true, () => {
              const level = buildMatRootLevel(id, inst.name);
              stackRegistry.modelStack?.push(level);
            });
            slideRow(inner, "lucide:smile", "表情预览", true, () => {
              const level = buildMorphPreviewLevel(id);
              stackRegistry.modelStack?.push(level);
            });
            slideRow(inner, "lucide:shirt", "服装变体", true, () => {
              const level = buildOutfitLevel(id);
              stackRegistry.modelStack?.push(level);
            });
            slideRow(inner, "lucide:save", "保存预设", false, () => {
              savePresetToLibDialog(id);
            });
            slideRow(inner, "lucide:folder-open", "加载预设", true, () => {
              const level = buildPresetListLevel(id);
              stackRegistry.modelStack?.push(level);
            });
          },
        });

        // 信息与工具折叠组
        addCollapsible(c, {
          title: "信息与工具",
          icon: "lucide:info",
          defaultOpen: false,
          renderContent: (inner) => {
            slideRow(inner, "lucide:info", "模型信息", true, () => {
              const level = buildModelInfoLevel(id);
              stackRegistry.modelStack?.push(level);
            });
            slideRow(inner, "lucide:external-link", "用…打开", true, () => {
              const level = buildOpenWithLevel(id);
              stackRegistry.modelStack?.push(level);
            });
          },
        });
      });

      // 危险操作：移除（独立在底部）
      cardContainer(container, (c) => {
        const removeBtn = document.createElement("div");
        removeBtn.className = "slide-item";
        const removeIcon = document.createElement("span");
        removeIcon.className = "slide-icon";
        const removeIconEl = createIconifyIcon("lucide:trash-2");
        if (removeIconEl) removeIcon.appendChild(removeIconEl);
        const removeLabel = document.createElement("span");
        removeLabel.className = "slide-label";
        removeLabel.textContent = "移除模型";
        removeLabel.style.color = "var(--danger)";
        removeBtn.appendChild(removeIcon);
        removeBtn.appendChild(removeLabel);
        removeBtn.addEventListener("click", async () => {
          const { getSceneMenu } = await import("./scene-menu");
          getSceneMenu()?.popTo(0);
          removeModel(id);
        });
        c.appendChild(removeBtn);
      });
    },
  };
}

// ======== Model Info ========

export function buildModelInfoLevel(id: string): PopupLevel {
  const inst = modelRegistry.get(id);
  if (!inst) return { label: "模型信息", dir: "", items: [] };
  return {
    label: "模型信息",
    dir: "",
    items: [],
    renderCustom: (container) => {
      container.classList.remove("render-card");
      const meta = modelMetaCache.get(inst.filePath);
      let vertCount = 0, faceCount = 0;
      for (const m of inst.meshes) { vertCount += m.getTotalVertices() || 0; faceCount += m.getTotalIndices() || 0; }
      const boneCount = inst.mmdModel?.runtimeBones?.length ?? null;
      const morphCount = inst.mmdModel?.morph?.morphs?.length ?? null;
      const fields: Array<{ label: string; value: string }> = [
        { label: "名称", value: inst.name }, { label: "文件", value: inst.filePath.split("/").pop() || inst.filePath },
        { label: "类型", value: inst.kind === "actor" ? "角色模型" : "舞台模型" }, { label: "动作", value: inst.vmdName || "无" },
        { label: "顶点数", value: vertCount.toLocaleString() }, { label: "面数", value: (faceCount / 3).toLocaleString() },
        { label: "材质数", value: String(inst.meshes.length) },
        { label: "骨骼数", value: boneCount !== null ? boneCount.toLocaleString() : "N/A" },
        { label: "表情数", value: morphCount !== null ? morphCount.toLocaleString() : "N/A" },
        { label: "日文名", value: meta?.name_jp || "—" }, { label: "英文名", value: meta?.name_en || "—" },
        { label: "备注", value: meta?.comment ? meta.comment.substring(0, 80) : "—" },
      ];
      cardContainer(container, (c) => {
        for (const f of fields) {
          const row = document.createElement("div");
          row.className = "slide-item";
          row.style.cssText = "display:flex;justify-content:space-between;padding:6px 14px;min-height:auto;margin:0;";
          row.innerHTML = `<span class="slide-label" style="color:var(--text-dim);flex:none;">${f.label}</span><span class="slide-label" style="text-align:right;max-width:60%;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(f.value)}</span>`;
          c.appendChild(row);
        }
      });
    },
  };
}

// ======== Transform ========

export function buildTransformLevel(id: string): PopupLevel {
  const inst = modelRegistry.get(id);
  if (!inst) return { label: "变换", dir: "", items: [] };
  const pos = getModelPosition(id);
  return {
    label: "变换",
    dir: "",
    items: [],
    renderCustom: (container) => {
      cardContainer(container, (c) => {
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
      const FIELD_ICONS: Record<string, string> = {
        px: "lucide:move", py: "lucide:move", pz: "lucide:move",
        scale: "lucide:maximize", ry: "lucide:rotate-cw",
      };
      for (const f of fields) {
        let currentValue = f.get();
        const range = f.max - f.min;
        const row = document.createElement("div");
        row.className = "cs-row";

        const top = document.createElement("div");
        top.className = "cs-top";

        const iconBox = document.createElement("span");
        iconBox.className = "cs-icon";
        const iconEl = createIconifyIcon(FIELD_ICONS[f.key] || "lucide:settings");
        if (iconEl) iconBox.appendChild(iconEl);
        top.appendChild(iconBox);

        const lbl = document.createElement("span");
        lbl.className = "cs-label";
        lbl.textContent = f.label;

        const val = document.createElement("span");
        val.className = "cs-value";
        const fmt = (v: number) => f.step >= 1 ? String(Math.round(v)) : v.toFixed(f.step < 0.1 ? 2 : 1);
        val.textContent = fmt(currentValue);

        top.appendChild(lbl);
        top.appendChild(val);

        const bar = document.createElement("div");
        bar.className = "cs-bar";

        const fill = document.createElement("div");
        fill.className = "cs-fill";
        const pct = ((currentValue - f.min) / range) * 100;
        fill.style.width = Math.max(0, Math.min(100, pct)) + "%";

        bar.appendChild(fill);

        function updateDisplay(v: number): void {
          currentValue = v;
          val.textContent = fmt(v);
          const newPct = ((v - f.min) / range) * 100;
          fill.style.width = Math.max(0, Math.min(100, newPct)) + "%";
        }

        row.addEventListener("click", (e) => {
          const rect = row.getBoundingClientRect();
          const x = (e.clientX - rect.left) / rect.width;
          let delta: number;
          if (x < 0.25) delta = -0.5;
          else if (x < 0.5) delta = -0.1;
          else if (x < 0.75) delta = 0.1;
          else delta = 0.5;
          let newVal = currentValue + delta;
          newVal = Math.round(newVal / f.step) * f.step;
          newVal = Math.max(f.min, Math.min(f.max, newVal));
          updateDisplay(newVal);
          f.set(newVal);
        });

        row.appendChild(top);
        row.appendChild(bar);
        c.appendChild(row);
      }
      const resetBtn = document.createElement("div");
      resetBtn.className = "slide-item";
      resetBtn.setAttribute("data-hint", "重置所有变换参数");
      const resetIcon = document.createElement("span");
      resetIcon.className = "slide-icon";
      const resetIconEl = createIconifyIcon("lucide:rotate-ccw");
      if (resetIconEl) resetIcon.appendChild(resetIconEl);
      const resetLabel = document.createElement("span");
      resetLabel.className = "slide-label";
      resetLabel.textContent = "重置变换";
      resetBtn.appendChild(resetIcon);
      resetBtn.appendChild(resetLabel);
      resetBtn.addEventListener("click", () => {
        resetModelTransform(id);
        stackRegistry.modelStack?.reRender();
        setStatus("✓ 变换已重置", true);
      });
      c.appendChild(resetBtn);
      });
    },
  };
}

// ======== Visibility ========

export function buildVisibilityLevel(id: string): PopupLevel {
  const inst = modelRegistry.get(id);
  if (!inst) return { label: "可见性", dir: "", items: [] };
  return {
    label: "可见性",
    dir: "",
    items: [],
    renderCustom: (container) => {
      let mode: "visible" | "semi" | "hidden";
      if (inst.visible && inst.opacity >= 0.99) mode = "visible";
      else if (inst.visible && inst.opacity < 0.99) mode = "semi";
      else mode = "hidden";

      cardContainer(container, (c) => {
        addModeSlider(c, "可见性", [
          { value: "visible", label: "显示" },
          { value: "semi", label: "半透明" },
          { value: "hidden", label: "隐藏" },
        ], mode, (v) => {
          if (v === "visible") { setModelVisibility(id, true); setModelOpacity(id, 1); }
          else if (v === "semi") { setModelVisibility(id, true); setModelOpacity(id, 0.5); }
          else { setModelVisibility(id, false); }
          stackRegistry.modelStack?.reRender();
          setStatus(v === "visible" ? "完全可见" : v === "semi" ? "半透明 50%" : "完全隐藏", true);
        }, "lucide:eye");
      });

      cardContainer(container, (c) => {
        addToggleRow(c, "材质线框", inst.wireframe, (v) => {
          setModelWireframe(id, v);
          stackRegistry.modelStack?.reRender();
          setStatus(v ? "材质线框: 开" : "材质线框: 关", true);
        }, "lucide:square");
        addToggleRow(c, "骨骼线", inst.showBoneLines, (v) => {
          setModelBoneLinesVis(id, v);
          stackRegistry.modelStack?.reRender();
          setStatus(v ? "骨骼线: 开" : "骨骼线: 关", true);
        }, "lucide:git-branch");
        addToggleRow(c, "骨骼关节球", inst.showBoneJoints, (v) => {
          setModelBoneJointsVis(id, v);
          stackRegistry.modelStack?.reRender();
          setStatus(v ? "骨骼关节球: 开" : "骨骼关节球: 关", true);
        }, "lucide:circle-dot");
      });

      const physCategories = getPhysicsCategories(id);
      const CAT_LABELS: Record<string, string> = { skirt: "裙子物理", chest: "胸部物理", hair: "头发物理", accessory: "配件物理" };
      if (physCategories.length > 0) {
        cardContainer(container, (c) => {
          for (const cat of physCategories) {
            const enabled = isPhysicsCategoryEnabled(id, cat);
            addToggleRow(c, CAT_LABELS[cat] || cat, enabled, (v) => {
              setPhysicsCategory(id, cat, v);
              stackRegistry.modelStack?.reRender();
              setStatus(v ? `✓ ${CAT_LABELS[cat] || cat} 已开启` : `✕ ${CAT_LABELS[cat] || cat} 已关闭`, true);
            }, "lucide:settings");
          }
        });
      }
    },
  };
}

// ======== Tags Management ========

export function buildModelTagsLevel(id: string): PopupLevel {
  const inst = modelRegistry.get(id);
  if (!inst) return { label: "标签", dir: "", items: [] };
  const libRef = inst.filePath ? computeLibraryRef(inst.filePath) : null;
  return {
    label: "模型标签",
    dir: "",
    items: [],
    renderCustom: (container) => {
      container.classList.remove("render-card");

      cardContainer(container, (c) => {
        const favRow = document.createElement("div");
        favRow.className = "slide-item";
        favRow.setAttribute("data-hint", "收藏此模型到收藏夹");
        const refreshFav = async () => {
          if (!libRef) return;
          const tags = await GetTagsByModel(libRef);
          const isFav = tags && tags.includes("收藏");
          favRow.innerHTML = `<span class="slide-icon"><iconify-icon icon="lucide:star" style="color:${isFav ? 'var(--accent)' : 'var(--text-muted)'};"></iconify-icon></span><span class="slide-label" style="color:${isFav ? 'var(--accent)' : 'var(--text)'};">${isFav ? '★ 已收藏' : '☆ 加入收藏'}</span>`;
          favRow.onclick = async () => {
            if (!libRef) return;
            try {
              if (isFav) { await RemoveTag(libRef, "收藏"); setStatus("✓ 已取消收藏", true); }
              else { await AddTag(libRef, "收藏"); setStatus("✓ 已收藏", true); }
              refreshFav();
            } catch (err) { setStatus("✗ 收藏操作失败", false); }
          };
        };
        refreshFav();
        c.appendChild(favRow);
      });

      cardContainer(container, (c) => {
        const tagContainer = document.createElement("div");
        tagContainer.className = "tag-container";
        c.appendChild(tagContainer);

        function refreshTags(): void {
          if (!libRef) { tagContainer.innerHTML = '<span class="tag-empty">无法识别模型路径</span>'; return; }
          GetTagsByModel(libRef).then((tags) => {
            tagContainer.innerHTML = "";
            if (!tags || tags.length === 0) return;
            for (const tag of tags) {
              const chip = document.createElement("span");
              chip.className = "tag-chip";
              chip.innerHTML = `${escapeHtml(tag)} <span class="tag-del">✕</span>`;
              chip.title = "点击移除标签";
              chip.addEventListener("click", () => {
                RemoveTag(libRef, tag).then(() => { refreshTags(); setStatus(`✓ 已移除标签: ${tag}`, true); }).catch(() => setStatus("✗ 移除标签失败", false));
              });
              tagContainer.appendChild(chip);
            }
          }).catch(() => { tagContainer.textContent = "加载标签失败"; });
        }
        refreshTags();

        const pickerLabel = document.createElement("div");
        pickerLabel.style.cssText = "font-size:11px;color:var(--text-dim);margin:8px 0 4px;";
        pickerLabel.textContent = "添加已有标签";
        c.appendChild(pickerLabel);

        const picker = document.createElement("div");
        picker.className = "tag-container";
        GetAllTags().then((allTags) => {
          const assigned = new Set<string>();
          GetTagsByModel(libRef!).then((modelTags) => {
            (modelTags || []).forEach(t => assigned.add(t));
            (allTags || []).forEach((tag) => {
              if (tag === "收藏") return;
              const chip = document.createElement("span");
              chip.className = "tag-chip" + (assigned.has(tag) ? " active" : "");
              chip.style.cssText = assigned.has(tag) ? "border:1px solid var(--accent);color:var(--accent);background:var(--accent-dim);" : "border:1px solid var(--white-08);color:var(--text-dim);background:transparent;cursor:pointer;";
              chip.textContent = assigned.has(tag) ? `✓ ${tag}` : `+ ${tag}`;
              chip.title = assigned.has(tag) ? "已添加，点击移除" : "点击添加此标签";
              chip.addEventListener("click", () => {
                if (!libRef) return;
                if (assigned.has(tag)) { RemoveTag(libRef, tag).then(() => { refreshTags(); }).catch(() => {}); }
                else { AddTag(libRef, tag).then(() => { refreshTags(); }).catch(() => {}); }
              });
              picker.appendChild(chip);
            });
            if (!allTags || allTags.filter(t => t !== "收藏").length === 0) {
              picker.innerHTML = '<span style="color:var(--text-muted);font-size:11px;">暂无全局标签，可返回标签管理创建</span>';
            }
          }).catch(() => {});
        }).catch(() => {});
        c.appendChild(picker);
      });
    },
  };
}

// ======== Morph Preview ========

export function buildMorphPreviewLevel(id: string): PopupLevel {
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
      container.classList.remove("render-card");
      cardContainer(container, (c) => {
      const resetBtn = document.createElement("button");
      resetBtn.className = "btn btn-sm";
      resetBtn.textContent = "全部重置";
      resetBtn.style.cssText = "width:100%;margin-bottom:8px;";
      resetBtn.addEventListener("click", () => {
        resetModelMorphs(id);
        c.querySelectorAll(".morph-slider").forEach((el) => {
          (el as HTMLInputElement).value = "0";
          const valLabel = (el as HTMLElement).parentElement?.querySelector(".morph-val");
          if (valLabel) valLabel.textContent = "0.00";
        });
        setStatus("✓ 已重置所有表情", true);
      });
      c.appendChild(resetBtn);

      const list = document.createElement("div");
      list.className = "morph-list";
      for (const m of morphs) {
        const row = document.createElement("div");
        row.className = "morph-row";

        const header = document.createElement("div");
        header.className = "morph-header";
        const name = document.createElement("span");
        name.className = "morph-name";
        name.textContent = m.name;
        name.title = m.name;
        const typeTag = document.createElement("span");
        typeTag.className = "morph-type";
        typeTag.textContent = typeLabels[m.type] || `类型${m.type}`;
        const valLabel = document.createElement("span");
        valLabel.className = "morph-val";
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
        slider.className = "morph-slider rng-input";
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
        empty.className = "morph-empty";
        empty.textContent = "此模型无表情数据";
        list.appendChild(empty);
      }

      c.appendChild(list);
      });
    },
  };
}
