// [doc:architecture] Model Material — 材质调节 UI 层（batch/per-mat/root/list）

import { Material } from "@babylonjs/core/Materials/material";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import {
  modelRegistry,
  cardContainer,
  setStatus,
  PopupLevel,
  stackRegistry,
  escapeHtml,
} from "../core/config";
import {
  getMatCatGroups,
  getMatCatParams,
  setMatCatParams,
  resetMatCatParams,
  getMatDetailList,
  getMatParams,
  setMatParams,
  resetSingleMatParams,
  resetAllMatParams,
  isMatEnabled,
  setMatEnabled,
} from "../scene/scene";
import { createIconifyIcon } from "../core/icons";
import { slideRow, addSliderRow } from "../core/ui-helpers";

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
