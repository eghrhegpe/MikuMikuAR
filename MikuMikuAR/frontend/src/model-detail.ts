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
} from "./config";
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
  setModelBoneVis,
  setModelVisibility,
  setModelOpacity,
  removeModel,
  focusModel,
  resetModelTransform,
  getMatState,
  applyMatState,
  setMatEnabled,
  isMatEnabled,
  getPhysicsCategories,
  isPhysicsCategoryEnabled,
  setPhysicsCategory,
  stopVMD,
  loadVMDFromPath,
  loadOutfits,
  applyOutfitVariant,
  resetOutfit,
} from "./scene";
import type { OutfitFile, OutfitVariant } from "./config";
import type { MaterialCategoryParams } from "./scene";
import type { Material } from "@babylonjs/core/Materials/material";
import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { createIconifyIcon, softwareKindIcon } from "./icons";
import { isPlaying } from "./config";
import { getAudioPath, getAudioName, getVolume, getAudioOffset } from "./audio";
import { getSceneStack } from "./scene-menu";
import { slideRow, addSliderRow } from "./ui-helpers";
import {
  GetTagsByModel,
  AddTag,
  RemoveTag,
  GetAllTags,
  OpenWithSoftware,
  ScanSoftwareDir,
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
import type { main } from "../wailsjs/go/models";

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
  const sceneStack = getSceneStack();
  return {
    label: inst.name,
    dir: "",
    items: [],
    renderCustom: (container) => {
      container.classList.remove("render-card");

      const card1 = document.createElement("div");
      card1.className = "lcard";
      slideRow(card1, "lucide:info", "模型信息", true, () => {
        const level = buildModelInfoLevel(id);
        stackRegistry.modelStack?.push(level);
      });
      slideRow(card1, "lucide:move", "变换", true, () => {
        const level = buildTransformLevel(id);
        stackRegistry.modelStack?.push(level);
      });
      slideRow(card1, "lucide:eye", "可见性", true, () => {
        const level = buildVisibilityLevel(id);
        stackRegistry.modelStack?.push(level);
      });
      slideRow(card1, "lucide:box", "材质调节", true, () => {
        const level = buildMatRootLevel(id, inst.name);
        stackRegistry.modelStack?.push(level);
      });
      slideRow(card1, "lucide:tag", "模型标签", true, () => {
        const level = buildModelTagsLevel(id);
        stackRegistry.modelStack?.push(level);
      });
      slideRow(card1, "lucide:smile", "表情预览", true, () => {
        const level = buildMorphPreviewLevel(id);
        stackRegistry.modelStack?.push(level);
      });
      container.appendChild(card1);

      const card2 = document.createElement("div");
      card2.className = "lcard";
      slideRow(card2, "lucide:target", "聚焦", false, () => {
        focusModel(id); stackRegistry.modelStack?.popTo(0);
      });
      slideRow(card2, "lucide:trash-2", "移除", false, () => {
        sceneStack?.popTo(0); removeModel(id);
      });
      container.appendChild(card2);

      const card3 = document.createElement("div");
      card3.className = "lcard";
      slideRow(card3, "lucide:save", "保存预设", false, () => {
        savePresetToLibDialog(id);
      });
      slideRow(card3, "lucide:folder-open", "加载预设", true, () => {
        const level = buildPresetListLevel(id);
        stackRegistry.modelStack?.push(level);
      });
      slideRow(card3, "lucide:upload", "导出文件", false, () => {
        selectAndSavePreset(id);
      });
      slideRow(card3, "lucide:download", "导入文件", false, () => {
        selectAndLoadPreset(id);
      });
      slideRow(card3, "lucide:shirt", "服装变体", true, () => {
        const level = buildOutfitLevel(id);
        stackRegistry.modelStack?.push(level);
      });
      container.appendChild(card3);

      const card4 = document.createElement("div");
      card4.className = "lcard";
      slideRow(card4, "lucide:external-link", "用…打开", true, () => {
        const level = buildOpenWithLevel(id);
        stackRegistry.modelStack?.push(level);
      });
      container.appendChild(card4);
    },
  };
}

// ======== Outfit Variants ========

export function buildOutfitLevel(id: string): PopupLevel {
  return {
    label: "服装变体",
    dir: "",
    items: [],
    renderCustom: async (container) => {
      container.classList.remove("render-card");
      const inst = modelRegistry.get(id);
      if (!inst) { container.textContent = ""; return; }

      // Ensure outfits.json is loaded
      let outfit: OutfitFile | undefined | null = inst.outfitFile;
      if (!outfit) {
        outfit = await loadOutfits(id);
      }

      if (!outfit || !outfit.variants || outfit.variants.length === 0) {
        const empty = document.createElement("div");
        empty.style.cssText = "font-size:11px;color:var(--text-dim);text-align:center;padding:20px;line-height:1.6;";
        empty.innerHTML = "此模型无 outfits.json 配置。<br>在模型所在目录创建 outfits.json 即可启用服装变体。";
        container.appendChild(empty);
        return;
      }

      const active = inst.activeVariant;

      cardContainer(container, (c) => {
        // "默认" always first
        const defRow = document.createElement("div"); defRow.className = "slide-item";
        const defIcon = document.createElement("span"); defIcon.className = "slide-icon";
        defIcon.innerHTML = active === undefined || active === "默认"
          ? '<iconify-icon icon="lucide:check-circle"></iconify-icon>'
          : '<iconify-icon icon="lucide:circle"></iconify-icon>';
        defRow.appendChild(defIcon);
        const defLabel = document.createElement("span"); defLabel.className = "slide-label";
        defLabel.textContent = "默认";
        defRow.appendChild(defLabel);
        defRow.addEventListener("click", () => applyOutfitVariant(id, "默认"));
        c.appendChild(defRow);

        for (const v of outfit.variants) {
          const row = document.createElement("div"); row.className = "slide-item";
          const icon = document.createElement("span"); icon.className = "slide-icon";
          icon.innerHTML = active === v.name
            ? '<iconify-icon icon="lucide:check-circle"></iconify-icon>'
            : '<iconify-icon icon="lucide:circle"></iconify-icon>';
          row.appendChild(icon);
          const label = document.createElement("span"); label.className = "slide-label";
          label.textContent = v.name;
          row.appendChild(label);
          row.addEventListener("click", () => applyOutfitVariant(id, v.name));
          c.appendChild(row);
        }

        const resetBtn = document.createElement("button");
        resetBtn.className = "btn btn-sm";
        resetBtn.textContent = "重置全部";
        resetBtn.style.cssText = "width:100%;margin-top:8px;";
        resetBtn.addEventListener("click", () => { resetOutfit(id); loadOutfits(id); });
        c.appendChild(resetBtn);
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
        container.appendChild(row);
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
      container.appendChild(resetBtn);
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
      container.classList.remove("render-card");
      const opts = [
        { label: "显示", icon: "lucide:eye", hint: "完全可见", active: inst.visible && inst.opacity >= 0.99, action: () => { setModelVisibility(id, true); setModelOpacity(id, 1); } },
        { label: "半透明", icon: "lucide:eye-off", hint: "半透明 50%", active: inst.visible && inst.opacity < 0.99 && inst.opacity > 0.1, action: () => { setModelVisibility(id, true); setModelOpacity(id, 0.5); } },
        { label: "隐藏", icon: "lucide:eye-off", hint: "完全隐藏", active: !inst.visible, action: () => { setModelVisibility(id, false); } },
      ];
      cardContainer(container, (c) => {
        for (const opt of opts) {
          const row = document.createElement("div");
          row.className = "slide-item" + (opt.active ? " slide-focused" : "");
          row.setAttribute("data-hint", opt.hint);
          const iconEl = createIconifyIcon(opt.active ? "lucide:check" : opt.icon);
          const s = document.createElement("span"); s.className = "slide-icon"; if (iconEl) s.appendChild(iconEl);
          row.appendChild(s);
          const lbl = document.createElement("span"); lbl.className = "slide-label"; lbl.textContent = opt.label;
          row.appendChild(lbl);
          row.addEventListener("click", () => { opt.action(); stackRegistry.modelStack?.reRender(); setStatus(opt.hint, true); });
          c.appendChild(row);
        }
        const wfRow = document.createElement("div");
        wfRow.className = "slide-item";
        wfRow.setAttribute("data-hint", inst.wireframe ? "线框模式已开启" : "点击开启线框模式");
        const wfIcon = createIconifyIcon(inst.wireframe ? "lucide:check-square" : "lucide:square");
        const wfS = document.createElement("span"); wfS.className = "slide-icon"; if (wfIcon) wfS.appendChild(wfIcon);
        wfRow.appendChild(wfS);
        const wfLbl = document.createElement("span"); wfLbl.className = "slide-label"; wfLbl.textContent = "线框模式";
        wfRow.appendChild(wfLbl);
        wfRow.addEventListener("click", () => { setModelWireframe(id, !inst.wireframe); stackRegistry.modelStack?.reRender(); setStatus(inst.wireframe ? "线框模式: 关" : "线框模式: 开", true); });
        c.appendChild(wfRow);

        const boneRow = document.createElement("div");
        boneRow.className = "slide-item";
        boneRow.setAttribute("data-hint", inst.showBones ? "骨骼叠加已开启" : "点击显示骨骼");
        const boneIcon = createIconifyIcon(inst.showBones ? "lucide:check-square" : "lucide:square");
        const boneS = document.createElement("span"); boneS.className = "slide-icon"; if (boneIcon) boneS.appendChild(boneIcon);
        boneRow.appendChild(boneS);
        const boneLbl = document.createElement("span"); boneLbl.className = "slide-label"; boneLbl.textContent = "骨骼显示";
        boneRow.appendChild(boneLbl);
        boneRow.addEventListener("click", () => { setModelBoneVis(id, !inst.showBones); stackRegistry.modelStack?.reRender(); setStatus(inst.showBones ? "骨骼显示: 关" : "骨骼显示: 开", true); });
        c.appendChild(boneRow);
      });

      const physCategories = getPhysicsCategories(id);
      const CAT_LABELS: Record<string, string> = { skirt: "裙子物理", chest: "胸部物理", hair: "头发物理", accessory: "配件物理" };
      const CAT_ICONS: Record<string, string> = { skirt: "lucide:skirt", chest: "lucide:heart", hair: "lucide:feather", accessory: "lucide:gift" };
      if (physCategories.length > 0) {
        cardContainer(container, (c) => {
          for (const cat of physCategories) {
            const enabled = isPhysicsCategoryEnabled(id, cat);
            const row = document.createElement("div");
            row.className = "slide-item";
            row.setAttribute("data-hint", enabled ? `已启用${CAT_LABELS[cat] || cat}` : `已禁用${CAT_LABELS[cat] || cat}`);
            const iconEl = createIconifyIcon(enabled ? "lucide:check-square" : "lucide:square");
            const s = document.createElement("span"); s.className = "slide-icon"; if (iconEl) s.appendChild(iconEl);
            row.appendChild(s);
            const lbl = document.createElement("span"); lbl.className = "slide-label"; lbl.textContent = CAT_LABELS[cat] || cat;
            row.appendChild(lbl);
            row.addEventListener("click", () => {
              const newState = !isPhysicsCategoryEnabled(id, cat);
              setPhysicsCategory(id, cat, newState);
              stackRegistry.modelStack?.reRender();
              setStatus(newState ? `✓ ${CAT_LABELS[cat] || cat} 已开启` : `✕ ${CAT_LABELS[cat] || cat} 已关闭`, true);
            });
            c.appendChild(row);
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

// ======== Material Batch Level (按部位批量调) ========

export function buildMatBatchLevel(id: string, modelName: string): PopupLevel {
  const label = "按部位批量 — " + modelName;
  return {
    label,
    dir: "",
    items: [],
    renderCustom: (container) => {
      container.style.padding = "12px 14px";
      const groups = getMatCatGroups(id);
      const detailList = getMatDetailList(id);
      const overrideCount = detailList.filter(d => d.modified).length;

      if (overrideCount > 0) {
        const hint = document.createElement("div");
        hint.style.cssText = "font-size:11px;color:var(--warn);margin-bottom:10px;padding:4px 10px;background:var(--white-04);border-radius:6px;text-align:center;";
        hint.textContent = `⚠ ${overrideCount} 个材质有单独覆盖（分类调整不影响已覆盖材质）`;
        container.appendChild(hint);
      }

      const CATEGORY_ICONS: Record<string, string> = {
        "皮肤": "droplet", "头发": "feather", "眼睛": "eye", "服装": "shirt",
      };

      for (const [cat, mats] of groups) {
        const params = getMatCatParams(id, cat);
        const card = document.createElement("div");
        card.className = "mat-card";

        const header = document.createElement("div");
        header.className = "mat-card-header";
        header.innerHTML = `
          <span class="mat-card-icon"><iconify-icon icon="${CATEGORY_ICONS[cat] || "box"}"></iconify-icon></span>
          <span class="mat-card-title">${cat}</span>
          <span class="mat-card-count">${mats.length}</span>
        `;
        card.appendChild(header);

        const sliderToggle = document.createElement("div");
        sliderToggle.className = "mat-slider-toggle";
        sliderToggle.innerHTML = `<iconify-icon icon="lucide:sliders"></iconify-icon> 参数微调 <span class="arrow">▾</span>`;

        const sliderPanel = document.createElement("div");
        sliderPanel.className = "mat-slider-panel mat-cat-slider";
        sliderPanel.style.display = "none";

        addSliderRow(sliderPanel, "漫反射倍率", params.diffuseMul, 0, 2, 0.05, (v) => setMatCatParams(id, cat, { diffuseMul: v }));
        addSliderRow(sliderPanel, "高光倍率", params.specularMul, 0, 2, 0.05, (v) => setMatCatParams(id, cat, { specularMul: v }));
        addSliderRow(sliderPanel, "高光指数", params.shininess, 0, 200, 1, (v) => setMatCatParams(id, cat, { shininess: v }));
        addSliderRow(sliderPanel, "环境光倍率", params.ambientMul, 0, 2, 0.05, (v) => setMatCatParams(id, cat, { ambientMul: v }));

        sliderToggle.addEventListener("click", () => {
          const isOpen = sliderPanel.style.display !== "none";
          sliderPanel.style.display = isOpen ? "none" : "block";
          sliderToggle.querySelector(".arrow")!.textContent = isOpen ? "▾" : "▴";
        });

        card.appendChild(sliderToggle);
        card.appendChild(sliderPanel);
        container.appendChild(card);
      }
    },
  };
}

// ======== Per-Material Level ========

export function buildPerMatLevel(id: string, modelName: string, matName: string, mat: Material, matIndex: number): PopupLevel {
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

      const stackingHint = document.createElement("div");
      stackingHint.style.cssText = "font-size:10px;color:var(--text-muted);margin-bottom:10px;padding:4px 8px;background:var(--accent-dim);border-radius:4px;";
      stackingHint.textContent = "覆盖分类设置，分类调整仍生效于其他材质";
      container.appendChild(stackingHint);

      const current = getMatParams(id, matIndex);
      const params = current ?? { diffuseMul: 1, specularMul: 1, shininess: 50, ambientMul: 1 };
      const isModified = current !== null;

      const sliderWrap = document.createElement("div");
      sliderWrap.className = "mat-mat-slider";
      addSliderRow(sliderWrap, "漫反射倍率", params.diffuseMul, 0, 2, 0.05, (v) => {
        setMatParams(id, matIndex, { diffuseMul: v });
      });
      addSliderRow(sliderWrap, "高光倍率", params.specularMul, 0, 2, 0.05, (v) => {
        setMatParams(id, matIndex, { specularMul: v });
      });
      addSliderRow(sliderWrap, "高光指数", params.shininess, 0, 200, 1, (v) => {
        setMatParams(id, matIndex, { shininess: v });
      });
      addSliderRow(sliderWrap, "环境光倍率", params.ambientMul, 0, 2, 0.05, (v) => {
        setMatParams(id, matIndex, { ambientMul: v });
      });
      container.appendChild(sliderWrap);

      if (isModified) {
        cardContainer(container, (c) => {
          const resetRow = document.createElement("div");
          resetRow.className = "slide-item";
          const ri = document.createElement("span"); ri.className = "slide-icon";
          const re = createIconifyIcon("lucide:rotate-ccw"); if (re) ri.appendChild(re);
          resetRow.appendChild(ri);
          const rl = document.createElement("span"); rl.className = "slide-label"; rl.textContent = "重置此材质";
          resetRow.appendChild(rl);
          resetRow.addEventListener("click", () => {
            resetSingleMatParams(id, matIndex);
            stackRegistry.modelStack?.reRender();
            setStatus(`✓ 已重置: ${matName}`, true);
          });
          c.appendChild(resetRow);
        });
      }
    },
  };
}

// ======== Material Root Level (材质调节根菜单) ========

export function buildMatRootLevel(id: string, modelName: string): PopupLevel {
  return {
    label: "材质调节 — " + modelName,
    dir: "",
    items: [],
    renderCustom: (container) => {
      container.classList.remove("render-card");
      const detailList = getMatDetailList(id);
      const hasOverrides = detailList.some(d => d.modified);

      cardContainer(container, (c) => {
        slideRow(c, "lucide:layers", "按部位批量调", true, () => {
          stackRegistry.modelStack?.push(buildMatBatchLevel(id, modelName));
        });
        slideRow(c, "lucide:list", "逐材质调参", true, () => {
          stackRegistry.modelStack?.push(buildMatListLevel(id, modelName));
        });
      });

      cardContainer(container, (c) => {
        if (hasOverrides) {
          const resetRow = document.createElement("div");
          resetRow.className = "slide-item";
          const ri = document.createElement("span"); ri.className = "slide-icon";
          const re = createIconifyIcon("lucide:rotate-ccw"); if (re) ri.appendChild(re);
          resetRow.appendChild(ri);
          const rl = document.createElement("span"); rl.className = "slide-label"; rl.textContent = "重置所有单独调整";
          rl.style.color = "var(--warn)";
          resetRow.appendChild(rl);
          resetRow.addEventListener("click", () => {
            resetAllMatParams(id);
            stackRegistry.modelStack?.reRender();
            setStatus("✓ 所有单独材质调整已重置", true);
          });
          c.appendChild(resetRow);
        }

        const resetAllRow = document.createElement("div");
        resetAllRow.className = "slide-item";
        const ri2 = document.createElement("span"); ri2.className = "slide-icon";
        const re2 = createIconifyIcon("lucide:refresh-ccw"); if (re2) ri2.appendChild(re2);
        resetAllRow.appendChild(ri2);
        const rl2 = document.createElement("span"); rl2.className = "slide-label"; rl2.textContent = "重置全部材质参数";
        resetAllRow.appendChild(rl2);
        resetAllRow.addEventListener("click", () => {
          resetMatCatParams(id);
          resetAllMatParams(id);
          stackRegistry.modelStack?.reRender();
          setStatus("✓ 全部材质参数已重置", true);
        });
        c.appendChild(resetAllRow);
      });
    },
  };
}

// ======== Material List Level (逐材质调参) ========

export function buildMatListLevel(id: string, modelName: string): PopupLevel {
  return {
    label: "逐材质 — " + modelName,
    dir: "",
    items: [],
    renderCustom: (container) => {
      container.classList.remove("render-card");
      const detailList = getMatDetailList(id);
      const list = document.createElement("div");
      list.className = "lcard";
      list.style.padding = "6px 10px";

      for (const detail of detailList) {
        const inst = modelRegistry.get(id);
        const mat = inst?.meshes[detail.index]?.material as StandardMaterial;
        if (!mat) continue;

        const matEnabled = isMatEnabled(id, detail.index);
        let swatchStyle: string;
        if (!matEnabled) {
          swatchStyle = "background:transparent;border:2px dashed var(--text-muted);";
        } else {
          swatchStyle = "background:#555";
          try {
            if (mat.diffuseColor) {
              swatchStyle = `background:rgb(${Math.round(mat.diffuseColor.r*255)},${Math.round(mat.diffuseColor.g*255)},${Math.round(mat.diffuseColor.b*255)})`;
            }
          } catch {}
        }

        const row = document.createElement("div");
        row.className = `mat-row${detail.modified ? " modified" : ""}${!matEnabled ? " mat-disabled" : ""}`;
        row.innerHTML = `
          <span class="mat-swatch${!matEnabled ? " mat-swatch-disabled" : ""}" style="${swatchStyle}"></span>
          <span class="mat-index">#${String(detail.index + 1).padStart(2, "0")}</span>
          <span class="mat-name" title="${escapeHtml(detail.name)}">${escapeHtml(detail.name)}</span>
          ${detail.modified ? '<span class="mat-modified"><iconify-icon icon="check-circle"></iconify-icon></span>' : ''}
        `;
        const swatch = row.querySelector(".mat-swatch") as HTMLElement;
        swatch.addEventListener("click", (e) => {
          e.stopPropagation();
          const newState = !isMatEnabled(id, detail.index);
          setMatEnabled(id, detail.index, newState);
          if (newState) {
            let newStyle = "background:#555";
            try { if ((mat as StandardMaterial).diffuseColor) { newStyle = `background:rgb(${Math.round((mat as StandardMaterial).diffuseColor.r*255)},${Math.round((mat as StandardMaterial).diffuseColor.g*255)},${Math.round((mat as StandardMaterial).diffuseColor.b*255)})`; } } catch {}
            swatch.style.cssText = newStyle;
            swatch.classList.remove("mat-swatch-disabled");
            row.classList.remove("mat-disabled");
          } else {
            swatch.style.cssText = "background:transparent;border:2px dashed var(--text-muted);";
            swatch.classList.add("mat-swatch-disabled");
            row.classList.add("mat-disabled");
          }
          setStatus(newState ? `✓ 已显示: ${detail.name}` : `✕ 已隐藏: ${detail.name}`, true);
        });
        row.addEventListener("click", () => {
          stackRegistry.modelStack?.push(buildPerMatLevel(id, modelName, detail.name, mat, detail.index));
        });
        list.appendChild(row);
      }

      container.appendChild(list);
    },
  };
}

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
  const inst = modelRegistry.get(id);
  if (!inst) { setStatus("✗ 目标模型不存在", false); return; }

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

// ======== Auto-Apply & Undo Stack ========

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
  // Save undo snapshot
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
      // No target model: try to find a loaded model that matches this preset
      const targetRef = computeLibraryRef(preset.model.filePath);
      let matchedId: string | null = null;
      for (const [mid, inst] of modelRegistry) {
        if (inst.filePath === preset.model.filePath) { matchedId = mid; break; }
        if (targetRef && computeLibraryRef(inst.filePath) === targetRef) { matchedId = mid; break; }
        const baseName = preset.model.filePath.split("/").pop()?.split("\\").pop();
        if (baseName && inst.filePath.replace(/\\/g, "/").endsWith(baseName)) { matchedId = mid; break; }
      }
      if (matchedId) {
        await applyModelPreset(matchedId, json);
      } else {
        // No match → load model from preset's filePath
        const { loadPMXFile } = await import("./scene");
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
  // Preserve autoApply if re-saving an existing preset
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
          // Auto-apply toggle
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
